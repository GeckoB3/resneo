import type { SupabaseClient } from '@supabase/supabase-js';
import { isSuperuserFreeBillingAccess } from '@/lib/billing/billing-access-source';
import {
  effectivePlanStatus,
  resolveVenueSubscriptionEntitlement,
} from '@/lib/billing/subscription-entitlement';
import { planDisplayName } from '@/lib/pricing-constants';
import { firstNameFrom } from '@/lib/platform/broadcast-email';

/**
 * Who a Contact Users email can go to.
 *
 * A venue is in the audience while it is a current subscriber: paying, on a trial, cancelling but
 * still inside its paid period, overdue on payment, or complimentary. A venue whose subscription has
 * fully ended is left out, and so are test venues unless someone picks one by hand.
 *
 * The addresses are the venue's account admins (the people who sign in and run it), not its public
 * business email. A venue with no admin login on file falls back to that business email so it is
 * never silently skipped. One person who runs several venues gets one email, not one per venue.
 */

export type AudienceSegment = 'paying' | 'trial' | 'cancelling' | 'past_due' | 'complimentary' | 'test';

export const AUDIENCE_SEGMENT_LABELS: Record<AudienceSegment, string> = {
  paying: 'Paying',
  trial: 'On trial',
  cancelling: 'Cancelling',
  past_due: 'Payment overdue',
  complimentary: 'Complimentary',
  test: 'Test venue',
};

export interface AudienceVenueRow {
  id: string;
  name: string;
  slug: string | null;
  email: string | null;
  pricing_tier: string | null;
  plan_status: string | null;
  billing_access_source: string | null;
  subscription_current_period_end: string | null;
  is_test: boolean | null;
}

export interface AudienceStaffRow {
  venue_id: string;
  name: string | null;
  email: string | null;
}

export interface AudienceContact {
  name: string | null;
  email: string;
  optedOut: boolean;
}

export interface AudienceVenue {
  id: string;
  name: string;
  slug: string | null;
  planLabel: string;
  segment: AudienceSegment;
  contacts: AudienceContact[];
  /** 'business_email' when no admin login had an address and the venue email stood in. */
  contactSource: 'admins' | 'business_email' | 'none';
}

export interface BroadcastRecipient {
  email: string;
  firstName: string | null;
  venueIds: string[];
  venueNames: string[];
  optedOut: boolean;
}

export type BroadcastAudienceSelection = { mode: 'all' } | { mode: 'selected'; venueIds: string[] };

/** Where a venue sits in the audience, or null when its subscription has fully ended. */
export function classifyAudienceSegment(v: AudienceVenueRow, nowMs: number): AudienceSegment | null {
  if (v.is_test) return 'test';
  if (isSuperuserFreeBillingAccess(v.billing_access_source)) return 'complimentary';
  const entitlement = resolveVenueSubscriptionEntitlement(v, nowMs);
  if (entitlement.kind === 'past_due') return 'past_due';
  if (entitlement.kind === 'expired_cancelled') return null;
  const effective = effectivePlanStatus(v.plan_status, v.subscription_current_period_end, nowMs);
  if (effective === 'trialing') return 'trial';
  if (effective === 'cancelling' || effective === 'cancelled') return 'cancelling';
  return 'paying';
}

export function normaliseEmail(raw: string | null | undefined): string | null {
  const e = (raw ?? '').trim().toLowerCase();
  if (!e || e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  return e;
}

/** Pure: venue rows + admin staff + opt-outs into the audience list the composer shows. */
export function buildAudienceVenues(
  venues: AudienceVenueRow[],
  adminStaff: AudienceStaffRow[],
  optedOut: Set<string>,
  nowMs: number,
): AudienceVenue[] {
  const staffByVenue = new Map<string, AudienceStaffRow[]>();
  for (const s of adminStaff) {
    const list = staffByVenue.get(s.venue_id);
    if (list) list.push(s);
    else staffByVenue.set(s.venue_id, [s]);
  }

  const out: AudienceVenue[] = [];
  for (const v of venues) {
    const segment = classifyAudienceSegment(v, nowMs);
    if (!segment) continue;

    const seen = new Set<string>();
    const contacts: AudienceContact[] = [];
    for (const s of staffByVenue.get(v.id) ?? []) {
      const email = normaliseEmail(s.email);
      if (!email || seen.has(email)) continue;
      seen.add(email);
      contacts.push({ name: s.name?.trim() || null, email, optedOut: optedOut.has(email) });
    }
    let contactSource: AudienceVenue['contactSource'] = 'admins';
    if (contacts.length === 0) {
      const business = normaliseEmail(v.email);
      if (business) {
        contacts.push({ name: null, email: business, optedOut: optedOut.has(business) });
        contactSource = 'business_email';
      } else {
        contactSource = 'none';
      }
    }

    out.push({
      id: v.id,
      name: v.name?.trim() || 'Unnamed venue',
      slug: v.slug,
      planLabel: planDisplayName(v.pricing_tier),
      segment,
      contacts,
      contactSource,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'en-GB', { sensitivity: 'base' }));
}

/** The venues a selection resolves to. "All" means every current subscriber except test venues. */
export function selectAudienceVenues(
  audience: AudienceVenue[],
  selection: BroadcastAudienceSelection,
): AudienceVenue[] {
  if (selection.mode === 'all') return audience.filter((v) => v.segment !== 'test');
  const wanted = new Set(selection.venueIds);
  return audience.filter((v) => wanted.has(v.id));
}

/** One recipient per address, across every chosen venue that person runs. */
export function buildBroadcastRecipients(venues: AudienceVenue[]): BroadcastRecipient[] {
  const byEmail = new Map<string, BroadcastRecipient>();
  for (const v of venues) {
    for (const c of v.contacts) {
      const existing = byEmail.get(c.email);
      if (existing) {
        if (!existing.venueIds.includes(v.id)) {
          existing.venueIds.push(v.id);
          existing.venueNames.push(v.name);
        }
        if (!existing.firstName) existing.firstName = firstNameFrom(c.name);
        continue;
      }
      byEmail.set(c.email, {
        email: c.email,
        firstName: firstNameFrom(c.name),
        venueIds: [v.id],
        venueNames: [v.name],
        optedOut: c.optedOut,
      });
    }
  }
  return [...byEmail.values()].sort((a, b) => a.email.localeCompare(b.email));
}

export function parseAudienceSelection(raw: unknown): BroadcastAudienceSelection {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (r.mode === 'selected') {
    const ids = Array.isArray(r.venue_ids ?? r.venueIds) ? ((r.venue_ids ?? r.venueIds) as unknown[]) : [];
    const venueIds = [
      ...new Set(ids.filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x))),
    ].slice(0, 5000);
    return { mode: 'selected', venueIds };
  }
  return { mode: 'all' };
}

/** Stored shape (snake_case, matches platform_broadcasts.audience). */
export function audienceSelectionToJson(sel: BroadcastAudienceSelection): Record<string, unknown> {
  return sel.mode === 'all' ? { mode: 'all' } : { mode: 'selected', venue_ids: sel.venueIds };
}

const PAGE = 1000;

async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

/** Loads the live audience with the service-role client. */
export async function loadBroadcastAudience(admin: SupabaseClient, nowMs = Date.now()): Promise<AudienceVenue[]> {
  const [venues, staff, optOuts] = await Promise.all([
    fetchAllRows<AudienceVenueRow>((from, to) =>
      admin
        .from('venues')
        .select(
          'id, name, slug, email, pricing_tier, plan_status, billing_access_source, subscription_current_period_end, is_test',
        )
        .order('id', { ascending: true })
        .range(from, to),
    ),
    fetchAllRows<AudienceStaffRow>((from, to) =>
      admin
        .from('staff')
        .select('venue_id, name, email')
        .eq('role', 'admin')
        .is('revoked_at', null)
        .order('id', { ascending: true })
        .range(from, to),
    ),
    fetchAllRows<{ email: string }>((from, to) =>
      admin.from('platform_email_opt_outs').select('email').order('email').range(from, to),
    ),
  ]);
  return buildAudienceVenues(venues, staff, new Set(optOuts.map((o) => o.email)), nowMs);
}
