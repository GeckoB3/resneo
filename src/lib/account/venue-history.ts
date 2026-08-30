import type { AccountBookingRow, AccountGuestSafeRow, AccountVenueRow } from './account-bookings';
import { isUpcomingBooking } from './account-booking-filters';
import { accountBookingStartMs } from './account-booking-filters';
import { rebookUrl } from './rebook-url';

export interface AccountVenueHistory {
  venue: AccountVenueRow;
  /** Bookings ever made with this venue, cancellations excluded. */
  visits: number;
  first_booked_at: string | null;
  last_booked_at: string | null;
  /**
   * Deposits paid, in minor units. NOT total spend, and the UI must not call
   * it that.
   *
   * `total_spent_minor` is `SUM(deposit_amount_pence) FILTER (deposit_status =
   * 'Paid')`, so it excludes the whole `booking_payments` ledger and every
   * class-commerce purchase. A customer who paid 500 pounds in full sees the
   * 50 pound deposit. Making it a true total means changing
   * `refresh_guest_booking_aggregates`, which runs from a trigger on every
   * booking write, so it is a migration on a hot path rather than a label
   * change; until that is done, the honest thing is to name what it counts.
   */
  deposits_paid_minor: number;
  /** The soonest booking still to come at this venue, or null. */
  next_booking: AccountBookingRow | null;
  /** Where "Book again" goes, or null when nothing can be carried over. */
  rebook_href: string | null;
}

/**
 * One card per venue the customer has actually booked with (P3-2).
 *
 * **Counts come from the guest aggregates, not from the bookings array**, and
 * that is the whole reason this takes both. `loadAccountBookings` is capped at
 * 100 rows, so counting visits from it would silently understate anyone with a
 * longer history, and the understatement would grow with loyalty: the customers
 * most likely to look at this card are the ones it would be most wrong about.
 * `guests.total_bookings_count` is maintained by the
 * `bookings_refresh_guest_aggregates` trigger on every insert, update and
 * delete, so it is accurate regardless of the page size.
 *
 * The bookings array is used only for what it can answer completely: which
 * booking at this venue is next.
 */
export function buildVenueHistory(
  guests: AccountGuestSafeRow[],
  venues: AccountVenueRow[],
  bookings: AccountBookingRow[],
  nowMs: number,
): AccountVenueHistory[] {
  const venueById = new Map(venues.map((v) => [v.id, v]));

  /*
    A customer can hold more than one guest row at one venue: linked accounts
    merge by email, and a venue may hold rows created by staff. Summed rather
    than picked, or a card would report one row's history as the whole
    relationship.
  */
  const merged = new Map<string, AccountVenueHistory>();
  for (const g of guests) {
    const venue = venueById.get(g.venue_id);
    if (!venue) continue;
    const existing = merged.get(g.venue_id);
    const visits = (existing?.visits ?? 0) + (g.total_bookings_count ?? 0);
    merged.set(g.venue_id, {
      venue,
      visits,
      first_booked_at: earlier(existing?.first_booked_at ?? null, g.first_booked_at),
      last_booked_at: later(existing?.last_booked_at ?? null, g.last_booked_at),
      deposits_paid_minor: (existing?.deposits_paid_minor ?? 0) + (g.total_spent_minor ?? 0),
      next_booking: null,
      rebook_href: null,
    });
  }

  // Soonest upcoming booking per venue, and the most recent past one, which is
  // what "Book again" repeats.
  const upcoming = bookings
    .filter((b) => isUpcomingBooking(b, nowMs))
    .sort((a, b) => accountBookingStartMs(a) - accountBookingStartMs(b));
  const past = bookings
    .filter((b) => !isUpcomingBooking(b, nowMs))
    .sort((a, b) => accountBookingStartMs(b) - accountBookingStartMs(a));

  for (const [venueId, row] of merged) {
    row.next_booking = upcoming.find((b) => b.venue_id === venueId) ?? null;
    const lastVisit = past.find((b) => b.venue_id === venueId);
    row.rebook_href = lastVisit
      ? rebookUrl({
          venueSlug: row.venue.slug,
          serviceItemId: lastVisit.service_item_id,
          practitionerSlug: lastVisit.practitioner_slug,
        })
      : null;
  }

  /*
    A venue with no bookings is not a relationship the customer would recognise:
    guest rows are created by staff too, and a card saying "0 visits" for a
    venue they have never been to reads as a mistake.
  */
  return [...merged.values()]
    .filter((r) => r.visits > 0)
    .sort((a, b) => rank(b.last_booked_at) - rank(a.last_booked_at));
}

/** Nulls sort last: a relationship with no date is older than any with one. */
function rank(iso: string | null): number {
  if (!iso) return Number.NEGATIVE_INFINITY;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

function earlier(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

function later(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}
