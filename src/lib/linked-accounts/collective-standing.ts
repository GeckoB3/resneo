/**
 * One venue's standing for a collective hosted by another (Docs/link-and-collective-setup-wizard-plan.md
 * §3.1; UX spec J1 step 2, `create.venues.*`).
 *
 * The same checks the engine's `collective_join_blocker` makes, in the order the Create dialog lists
 * them, so a host reads the reason before sending anything: another collective, timezone, currency,
 * the way bookings are taken, no appointments, the plan, and, as a warning rather than a block, no
 * card payments. The link's permissions are not checked here: the candidates list checks them
 * against the accepted link, and the setup wizard fixes them by construction.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { evaluateLinkEligibility } from '@/lib/linked-accounts/eligibility';
import { findCollectiveLockForVenue } from '@/lib/linked-accounts/collective-venue-locks';
import { normalCurrency } from '@/lib/linked-accounts/collective-currency';
import { resolveActiveBookingModels } from '@/lib/booking/active-models';
import { collectiveCopy } from '@/lib/linked-accounts/collective-copy';

export type CollectiveStanding = 'ok' | 'no_payments' | 'blocked';

export interface CollectiveStandingResult {
  standing: CollectiveStanding;
  /** The reason line for `blocked`; the warning for `no_payments`; null when `ok`. */
  reason: string | null;
  /** A second line, where the spec gives one (the currency sentence). */
  detail: string | null;
}

export type VenueStandingRow = Record<string, unknown>;

/** The venue columns the standing needs; the candidates list and the lookup read the same set. */
export const STANDING_VENUE_COLUMNS =
  'id, name, slug, timezone, currency, stripe_charges_enabled, pricing_tier, plan_status, booking_model, enabled_models, active_booking_models, subscription_current_period_end, billing_access_source';

const tz = (v: unknown) => ((v as string | null) ?? 'Europe/London');

/** Pure: the standing from the two venue rows and whether the venue is locked into another collective. */
export function collectiveStandingFromRows(
  host: VenueStandingRow | undefined,
  venue: VenueStandingRow | undefined,
  facts: { inOtherCollective: boolean; now?: number },
): CollectiveStandingResult {
  if (!venue) return { standing: 'blocked', reason: collectiveCopy('create.venues.blocked.plan'), detail: null };
  const name = (venue.name as string | null) ?? 'That venue';
  if (facts.inOtherCollective) {
    return { standing: 'blocked', reason: collectiveCopy('create.venues.blocked.otherCollective'), detail: null };
  }
  if (tz(venue.timezone) !== tz(host?.timezone)) {
    return {
      standing: 'blocked',
      reason: collectiveCopy('create.venues.blocked.timezone', { timezone: tz(venue.timezone), yourTimezone: tz(host?.timezone) }),
      detail: null,
    };
  }
  const currency = normalCurrency(venue.currency as string | null);
  const hostCurrency = normalCurrency(host?.currency as string | null);
  if (currency !== hostCurrency) {
    return {
      standing: 'blocked',
      reason: collectiveCopy('create.venues.blocked.currency', { currency, yourCurrency: hostCurrency }),
      detail: collectiveCopy('bm.currency.blocked', { venue: name, currency, hostCurrency }),
    };
  }
  if (!evaluateLinkEligibility(venue as never, facts.now ?? Date.now()).canCreate) {
    return { standing: 'blocked', reason: collectiveCopy('create.venues.blocked.plan'), detail: null };
  }
  const models = resolveActiveBookingModels({
    pricingTier: venue.pricing_tier as string | null,
    bookingModel: venue.booking_model as never,
    enabledModels: venue.enabled_models,
    activeBookingModels: venue.active_booking_models,
  });
  if (!models.includes('unified_scheduling' as never)) {
    return { standing: 'blocked', reason: collectiveCopy('bm.invite.noAppointments', { venue: name }), detail: null };
  }
  // The engine's join blocker also wants the same booking model as the host; a venue that does offer
  // appointments but runs a different primary model reads that rather than "no appointments".
  if (host && (venue.booking_model ?? null) !== (host.booking_model ?? null)) {
    return { standing: 'blocked', reason: collectiveCopy('create.venues.blocked.bookingModel'), detail: null };
  }
  if (venue.stripe_charges_enabled !== true) {
    return { standing: 'no_payments', reason: collectiveCopy('create.venues.warn.noStripe', { venue: name }), detail: null };
  }
  return { standing: 'ok', reason: null, detail: null };
}

/** The standing of `venueId` for a collective `hostVenueId` would host. */
export async function collectiveStandingBetween(
  admin: SupabaseClient,
  hostVenueId: string,
  venueId: string,
): Promise<CollectiveStandingResult> {
  const { data: venues } = await admin.from('venues').select(STANDING_VENUE_COLUMNS).in('id', [hostVenueId, venueId]);
  const rows = (venues ?? []) as VenueStandingRow[];
  const host = rows.find((v) => v.id === hostVenueId);
  const venue = rows.find((v) => v.id === venueId);
  const lock = venue ? await findCollectiveLockForVenue(admin, venueId) : null;
  return collectiveStandingFromRows(host, venue, { inOtherCollective: Boolean(lock) });
}
