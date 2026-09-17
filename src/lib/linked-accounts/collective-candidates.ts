/**
 * Who can be invited to a new collective, and why not (UX spec J1 step 2, `create.venues.*`;
 * UI-C-01; W7).
 *
 * The older create dialog listed only the venues that could join, so a host never learned why a
 * linked venue was missing. This lists every venue the host has an active link with, each with its
 * standing: can join; can join but takes no card payments; cannot join yet, with the reason; or
 * linked without the full access a collective needs, with the way to change that. The create route
 * still checks everything again.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadLinkViewsForVenue } from '@/lib/linked-accounts/queries';
import { evaluateLinkEligibility } from '@/lib/linked-accounts/eligibility';
import { findCollectiveLockForVenue } from '@/lib/linked-accounts/collective-venue-locks';
import { normalCurrency } from '@/lib/linked-accounts/collective-currency';
import { resolveActiveBookingModels } from '@/lib/booking/active-models';
import { collectiveCopy } from '@/lib/linked-accounts/collective-copy';

export type CandidateStanding = 'ok' | 'no_payments' | 'blocked' | 'permissions';

export interface CollectiveCandidate {
  venue_id: string;
  venue_name: string;
  /** The venue's own booking address, `/book/{slug}`, for the "what changes" table. */
  venue_slug: string | null;
  link_id: string;
  standing: CandidateStanding;
  /** The pill's reason line, for `blocked` and `permissions`; the warning for `no_payments`. */
  reason: string | null;
  /** A second line, where the spec gives one (the currency sentence). */
  detail: string | null;
}

type Row = Record<string, unknown>;

const sameTimezone = (a: unknown, b: unknown) =>
  ((a as string | null) ?? 'Europe/London') === ((b as string | null) ?? 'Europe/London');

/** The host's own booking address, for the same table. */
export async function hostVenueSlug(admin: SupabaseClient, hostVenueId: string): Promise<string | null> {
  const { data } = await admin.from('venues').select('slug').eq('id', hostVenueId).maybeSingle();
  return (data?.slug as string | null | undefined) ?? null;
}

export async function loadCollectiveCandidates(
  admin: SupabaseClient,
  hostVenueId: string,
  opts: { now?: () => number } = {},
): Promise<CollectiveCandidate[]> {
  const links = (await loadLinkViewsForVenue(admin, hostVenueId)).filter((l) => l.status === 'accepted');
  if (links.length === 0) return [];
  const ids = [hostVenueId, ...links.map((l) => l.otherVenue.id)];
  const { data: venues } = await admin
    .from('venues')
    .select(
      'id, name, slug, timezone, currency, stripe_charges_enabled, pricing_tier, plan_status, booking_model, enabled_models, active_booking_models, subscription_current_period_end, billing_access_source',
    )
    .in('id', ids);
  const byId = new Map(((venues ?? []) as Row[]).map((v) => [v.id as string, v]));
  const host = byId.get(hostVenueId);
  const now = (opts.now ?? Date.now)();

  const out: CollectiveCandidate[] = [];
  for (const link of links) {
    const venueId = link.otherVenue.id;
    const venue = byId.get(venueId);
    const name = (venue?.name as string | undefined) ?? link.otherVenue.name;
    const base = {
      venue_id: venueId,
      venue_name: name,
      venue_slug: (venue?.slug as string | null | undefined) ?? (link.otherVenue.slug || null),
      link_id: link.id,
      detail: null,
    };

    const fullBothWays =
      link.iCan.calendar === 'full_details' &&
      link.theyCan.calendar === 'full_details' &&
      link.iCan.act === 'create_edit_cancel' &&
      link.theyCan.act === 'create_edit_cancel' &&
      !link.iCan.calendarIds &&
      !link.theyCan.calendarIds;
    if (!fullBothWays) {
      out.push({ ...base, standing: 'permissions', reason: collectiveCopy('create.venues.blocked.permissions', { venue: name }) });
      continue;
    }
    if (!venue) {
      out.push({ ...base, standing: 'blocked', reason: collectiveCopy('create.venues.blocked.plan') });
      continue;
    }
    if (await findCollectiveLockForVenue(admin, venueId)) {
      out.push({ ...base, standing: 'blocked', reason: collectiveCopy('create.venues.blocked.otherCollective') });
      continue;
    }
    if (!sameTimezone(venue.timezone, host?.timezone)) {
      out.push({
        ...base,
        standing: 'blocked',
        reason: collectiveCopy('create.venues.blocked.timezone', {
          timezone: (venue.timezone as string | null) ?? 'Europe/London',
          yourTimezone: (host?.timezone as string | null) ?? 'Europe/London',
        }),
      });
      continue;
    }
    if (normalCurrency(venue.currency as string | null) !== normalCurrency(host?.currency as string | null)) {
      const currency = normalCurrency(venue.currency as string | null);
      const hostCurrency = normalCurrency(host?.currency as string | null);
      out.push({
        ...base,
        standing: 'blocked',
        reason: collectiveCopy('create.venues.blocked.currency', { currency, yourCurrency: hostCurrency }),
        detail: collectiveCopy('bm.currency.blocked', { venue: name, currency, hostCurrency }),
      });
      continue;
    }
    if (!evaluateLinkEligibility(venue as never, now).canCreate) {
      out.push({ ...base, standing: 'blocked', reason: collectiveCopy('create.venues.blocked.plan') });
      continue;
    }
    const models = resolveActiveBookingModels({
      pricingTier: venue.pricing_tier as string | null,
      bookingModel: venue.booking_model as never,
      enabledModels: venue.enabled_models,
      activeBookingModels: venue.active_booking_models,
    });
    if (!models.includes('unified_scheduling' as never)) {
      out.push({ ...base, standing: 'blocked', reason: collectiveCopy('bm.invite.noAppointments', { venue: name }) });
      continue;
    }
    if (venue.stripe_charges_enabled !== true) {
      out.push({ ...base, standing: 'no_payments', reason: collectiveCopy('create.venues.warn.noStripe', { venue: name }) });
      continue;
    }
    out.push({ ...base, standing: 'ok', reason: null });
  }
  const rank: Record<CandidateStanding, number> = { ok: 0, no_payments: 1, blocked: 2, permissions: 3 };
  return out.sort((a, b) => rank[a.standing] - rank[b.standing] || a.venue_name.localeCompare(b.venue_name));
}
