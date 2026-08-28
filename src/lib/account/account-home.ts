import type { SupabaseClient } from '@supabase/supabase-js';
import {
  loadAccountBookings,
  type AccountBookingRow,
  type AccountVenueRow,
} from '@/lib/account/account-bookings';
import { isUpcomingBooking, accountBookingStartMs } from '@/lib/account/account-booking-filters';
import { loadOutstandingBookingFormLinks } from '@/lib/compliance/form-links-service';

/**
 * Everything the account hub renders, in one loader (P1-1, AD5).
 *
 * ONE FUNCTION, TWO CALLERS. `GET /api/account/home` and the server page both
 * call this; the page must not reimplement the fetch inline. That is the rule
 * AD5 exists to state, and it is why the shape below is a plain object rather
 * than a Response.
 *
 * THE QUERY BUDGET IS THE POINT. A hub that costs one query per booking, or
 * per venue, gets slower for exactly the customers who use the product most.
 * This issues a bounded number regardless of how many bookings, venues or
 * passes a customer has, which `account-home.test.ts` asserts with a fixture
 * of 100 bookings across 4 venues. The bookings half is already bounded by
 * P0-3; the credits and membership summaries below are written set-based for
 * the same reason.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not return the credit ledger or
 * the membership allowance history. `GET /api/account/credits` and
 * `GET /api/account/memberships` still own those, and duplicating them here
 * would mean the hub paying for detail nobody reads above the fold. The hub
 * gets counts and the next thing that matters.
 */

export interface AccountHomeCreditSummary {
  /** Total credits remaining across every venue. */
  total_remaining: number;
  /** Venues where the customer holds at least one credit. */
  venue_count: number;
  /** The soonest expiry across all balances, if any expire. */
  next_expiry: string | null;
}

export interface AccountHomeMembershipSummary {
  /** Memberships in a state that entitles the customer to something. */
  active_count: number;
  /** Those cancelling at period end, which the hub should surface. */
  cancelling_count: number;
}

/**
 * What an appointment actually IS, which the portal could not say before
 * (G8b). `bookings_account_safe` carries `calendar_id` and `service_item_id`
 * since P0-6 widened its column allowlist; these are their names.
 *
 * Resolved for the NEXT booking only. The hub shows one, and doing it for all
 * hundred would be the N+1 P1-1's budget exists to prevent.
 */
export interface AccountHomeAppointmentLabel {
  /** The service booked, e.g. "Cut and finish". */
  service: string | null;
  /** Who it is with: the calendar the booking sits on. */
  practitioner: string | null;
}

export interface AccountHomeData {
  /** The next booking that has not finished, or null. Fully hydrated. */
  next_booking: AccountBookingRow | null;
  /** Forms still to complete for that booking. Empty when there is none. */
  next_booking_form_links: Array<{ name: string; url: string }>;
  /** Service and practitioner for `next_booking`, when it is an appointment. */
  next_booking_appointment: AccountHomeAppointmentLabel;
  /** How many bookings are still to come, including `next_booking`. */
  upcoming_count: number;
  /** Every venue the customer has booked with, by name. */
  venues: AccountVenueRow[];
  credits: AccountHomeCreditSummary;
  memberships: AccountHomeMembershipSummary;
}

/** Membership statuses that entitle the customer to something today. */
const LIVE_MEMBERSHIP_STATUSES = new Set(['active', 'trialing', 'past_due']);

/**
 * An empty hub, for a customer with nothing yet.
 *
 * Returned as a well-formed payload rather than null, so the page renders an
 * empty state rather than branching on null at every field. A hub that can be
 * null is a hub every caller has to defend against.
 */
export function emptyAccountHome(): AccountHomeData {
  return {
    next_booking: null,
    next_booking_form_links: [],
    next_booking_appointment: { service: null, practitioner: null },
    upcoming_count: 0,
    venues: [],
    credits: { total_remaining: 0, venue_count: 0, next_expiry: null },
    memberships: { active_count: 0, cancelling_count: 0 },
  };
}

export async function loadAccountHome(
  supabase: SupabaseClient,
  admin: SupabaseClient,
  nowMs: number = Date.now(),
): Promise<AccountHomeData> {
  // Bookings come through `bookings_account_safe` on the SESSION client, and
  // already arrive hydrated and bounded (P0-6, P0-3).
  const [bookings, credits, memberships] = await Promise.all([
    loadAccountBookings(supabase, admin, 100),
    loadCreditSummary(admin, supabase),
    loadMembershipSummary(admin, supabase),
  ]);

  // "Next" is derived from a real instant, never from a date string (P0-2).
  // Sorting on `booking_date` alone puts a 09:00 booking after a 18:00 one on
  // the same day, which is the whole class of bug P0-2 closed.
  const upcoming = bookings
    .filter((b) => isUpcomingBooking(b, nowMs))
    .sort((a, b) => accountBookingStartMs(a) - accountBookingStartMs(b));

  const nextBooking = upcoming[0] ?? null;

  // Only for the one booking shown. Loading them for all 100 would be the N+1
  // this loader exists to avoid, and the hub shows one.
  const [formLinks, appointment] = nextBooking
    ? await Promise.all([
        loadOutstandingBookingFormLinks(admin, nextBooking.venue_id, nextBooking.id),
        loadAppointmentLabel(admin, nextBooking),
      ])
    : [[], { service: null, practitioner: null } as AccountHomeAppointmentLabel];

  // Venues the customer has actually booked with, deduplicated, name-sorted.
  const venueById = new Map<string, AccountVenueRow>();
  for (const b of bookings) {
    if (b.venue && !venueById.has(b.venue.id)) venueById.set(b.venue.id, b.venue);
  }

  return {
    next_booking: nextBooking,
    next_booking_form_links: formLinks,
    next_booking_appointment: appointment,
    upcoming_count: upcoming.length,
    venues: [...venueById.values()].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')),
    credits,
    memberships,
  };
}

/**
 * Credits, summarised in one query.
 *
 * `GET /api/account/credits` builds the full per-venue breakdown with the
 * product and venue names; the hub needs a total, a venue count and the next
 * expiry, so it reads the balances alone and aggregates in memory.
 */
async function loadCreditSummary(
  admin: SupabaseClient,
  session: SupabaseClient,
): Promise<AccountHomeCreditSummary> {
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) return emptyAccountHome().credits;

  const { data, error } = await admin
    .from('user_class_credit_balances')
    .select('venue_id, credits_remaining, expires_at')
    .eq('user_id', user.id);

  if (error) {
    // Degrade rather than fail the hub: a customer's next appointment matters
    // more than their credit total, and one should not hide the other.
    console.error('[account-home] credits:', error.message);
    return emptyAccountHome().credits;
  }

  const rows = (data ?? []) as Array<{
    venue_id?: string | null;
    credits_remaining?: number | null;
    expires_at?: string | null;
  }>;

  const venues = new Set<string>();
  let total = 0;
  let nextExpiry: string | null = null;
  for (const row of rows) {
    const remaining = row.credits_remaining ?? 0;
    if (remaining <= 0) continue;
    total += remaining;
    if (row.venue_id) venues.add(row.venue_id);
    if (row.expires_at && (!nextExpiry || row.expires_at < nextExpiry)) nextExpiry = row.expires_at;
  }

  return { total_remaining: total, venue_count: venues.size, next_expiry: nextExpiry };
}

/** Memberships, summarised in one query. */
async function loadMembershipSummary(
  admin: SupabaseClient,
  session: SupabaseClient,
): Promise<AccountHomeMembershipSummary> {
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) return emptyAccountHome().memberships;

  const { data, error } = await admin
    .from('class_memberships')
    .select('status, cancel_at_period_end')
    .eq('user_id', user.id);

  if (error) {
    console.error('[account-home] memberships:', error.message);
    return emptyAccountHome().memberships;
  }

  const rows = (data ?? []) as Array<{ status?: string | null; cancel_at_period_end?: boolean | null }>;
  const live = rows.filter((r) => LIVE_MEMBERSHIP_STATUSES.has((r.status ?? '').trim()));

  return {
    active_count: live.length,
    cancelling_count: live.filter((r) => r.cancel_at_period_end === true).length,
  };
}

/**
 * Name the service and the practitioner on an appointment booking (G8b).
 *
 * Every venue is on unified scheduling, so the ids that matter are
 * `service_item_id` and `calendar_id`; the legacy `appointment_service_id` and
 * `practitioner_id` pair is dead on this codebase and deliberately not read.
 *
 * Best-effort: a name that will not load costs the card a line, not the
 * booking. The date, time and venue are what the customer needs most.
 */
async function loadAppointmentLabel(
  admin: SupabaseClient,
  booking: AccountBookingRow,
): Promise<AccountHomeAppointmentLabel> {
  const serviceId = booking.service_item_id ?? null;
  const calendarId = booking.calendar_id ?? null;
  if (!serviceId && !calendarId) return { service: null, practitioner: null };

  const [service, practitioner] = await Promise.all([
    serviceId
      ? admin.from('service_items').select('name').eq('id', serviceId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    calendarId
      ? admin.from('unified_calendars').select('name').eq('id', calendarId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const name = (r: { data: unknown }) => {
    const value = (r.data as { name?: string | null } | null)?.name;
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  };

  return { service: name(service), practitioner: name(practitioner) };
}
