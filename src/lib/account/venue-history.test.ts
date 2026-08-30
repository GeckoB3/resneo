/**
 * P3-2: one card per venue the customer has booked with.
 *
 * The two things worth guarding are both about being WRONG rather than being
 * missing: a visit count that quietly understates a loyal customer, and a
 * money figure that is not the thing its label would suggest.
 */
import { describe, it, expect } from 'vitest';
import { buildVenueHistory } from './venue-history';
import type { AccountBookingRow, AccountGuestSafeRow, AccountVenueRow } from './account-bookings';

const NOW = Date.parse('2026-09-01T12:00:00Z');

function venue(id: string, name: string, slug: string | null = id): AccountVenueRow {
  return { id, name, slug } as AccountVenueRow;
}

function guest(venueId: string, over: Partial<AccountGuestSafeRow> = {}): AccountGuestSafeRow {
  return {
    id: `g-${venueId}`,
    venue_id: venueId,
    total_bookings_count: 1,
    total_spent_minor: 0,
    first_booked_at: '2026-01-01T10:00:00Z',
    last_booked_at: '2026-08-01T10:00:00Z',
    ...over,
  } as AccountGuestSafeRow;
}

function booking(
  venueId: string,
  startsAt: string,
  over: Partial<AccountBookingRow> = {},
): AccountBookingRow {
  return {
    id: `b-${venueId}-${startsAt}`,
    venue_id: venueId,
    starts_at: startsAt,
    booking_date: startsAt.slice(0, 10),
    booking_time: startsAt.slice(11, 19),
    status: 'Booked',
    time_zone: 'UTC',
    ...over,
  } as AccountBookingRow;
}

describe('buildVenueHistory', () => {
  it('orders venues by last booked, most recent first', () => {
    // The acceptance: three venues, three cards, newest relationship on top.
    const rows = buildVenueHistory(
      [
        guest('a', { last_booked_at: '2026-03-01T10:00:00Z' }),
        guest('b', { last_booked_at: '2026-08-01T10:00:00Z' }),
        guest('c', { last_booked_at: '2026-05-01T10:00:00Z' }),
      ],
      [venue('a', 'Alpha'), venue('b', 'Bravo'), venue('c', 'Charlie')],
      [],
      NOW,
    );
    expect(rows.map((r) => r.venue.name)).toEqual(['Bravo', 'Charlie', 'Alpha']);
  });

  it('takes visits from the AGGREGATE, not from the bookings on this page', () => {
    /*
      The understatement that would grow with loyalty. `loadAccountBookings` is
      capped at 100 rows, so a customer with 240 visits would be shown a number
      derived from whatever fitted on the page. The trigger-maintained count
      does not have that problem.
    */
    const rows = buildVenueHistory(
      [guest('a', { total_bookings_count: 240 })],
      [venue('a', 'Alpha')],
      [booking('a', '2026-08-30T10:00:00Z')],
      NOW,
    );
    expect(rows[0].visits).toBe(240);
  });

  it('SUMS the aggregates when a customer holds two rows at one venue', () => {
    // Linked accounts merge by email and venues create rows themselves, so
    // picking one would report part of the relationship as all of it.
    const rows = buildVenueHistory(
      [
        guest('a', {
          id: 'g1',
          total_bookings_count: 3,
          total_spent_minor: 1000,
          first_booked_at: '2025-01-01T10:00:00Z',
          last_booked_at: '2026-01-01T10:00:00Z',
        }),
        guest('a', {
          id: 'g2',
          total_bookings_count: 2,
          total_spent_minor: 500,
          first_booked_at: '2024-06-01T10:00:00Z',
          last_booked_at: '2026-07-01T10:00:00Z',
        }),
      ],
      [venue('a', 'Alpha')],
      [],
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].visits).toBe(5);
    expect(rows[0].deposits_paid_minor).toBe(1500);
    expect(rows[0].first_booked_at, 'the earliest of the two').toBe('2024-06-01T10:00:00Z');
    expect(rows[0].last_booked_at, 'the latest of the two').toBe('2026-07-01T10:00:00Z');
  });

  it('names the money field for what it counts, not for what it looks like', () => {
    /*
      `total_spent_minor` sums PAID DEPOSITS only, so somebody who paid 500
      pounds in full appears to have spent the 50 pound deposit. The field
      carries that name so a caller cannot label it "total spent" by accident.
    */
    const rows = buildVenueHistory(
      [guest('a', { total_spent_minor: 5000 })],
      [venue('a', 'Alpha')],
      [],
      NOW,
    );
    expect(rows[0]).toHaveProperty('deposits_paid_minor', 5000);
    expect(rows[0]).not.toHaveProperty('total_spent_minor');
  });

  it('picks the SOONEST upcoming booking at each venue', () => {
    const rows = buildVenueHistory(
      [guest('a')],
      [venue('a', 'Alpha')],
      [
        booking('a', '2026-12-01T10:00:00Z'),
        booking('a', '2026-09-15T10:00:00Z'),
        booking('a', '2026-10-01T10:00:00Z'),
      ],
      NOW,
    );
    expect(rows[0].next_booking?.starts_at).toBe('2026-09-15T10:00:00Z');
  });

  it('leaves next_booking null when everything at that venue is past', () => {
    const rows = buildVenueHistory(
      [guest('a')],
      [venue('a', 'Alpha')],
      [booking('a', '2026-01-05T10:00:00Z')],
      NOW,
    );
    expect(rows[0].next_booking).toBeNull();
  });

  it('builds Book again from the most recent PAST visit', () => {
    // Repeating the last thing they actually had, not the next thing they
    // have already booked.
    const rows = buildVenueHistory(
      [guest('a')],
      [venue('a', 'Alpha', 'alpha')],
      [
        booking('a', '2026-01-05T10:00:00Z', { service_item_id: 'old', practitioner_slug: 'ada' }),
        booking('a', '2026-08-05T10:00:00Z', {
          service_item_id: 'recent',
          practitioner_slug: 'ben',
        }),
        booking('a', '2026-12-05T10:00:00Z', {
          service_item_id: 'future',
          practitioner_slug: 'cal',
        }),
      ],
      NOW,
    );
    expect(rows[0].rebook_href).toBe('/book/alpha/ben?service_id=recent&start=time');
  });

  it('offers no Book again when there is nothing to repeat', () => {
    const rows = buildVenueHistory([guest('a')], [venue('a', 'Alpha', 'alpha')], [], NOW);
    expect(rows[0].rebook_href).toBeNull();
  });

  it('drops a venue the customer has never actually booked with', () => {
    // Venues create guest rows themselves. A card reading "0 visits" for a
    // place they have never been looks like a bug in the portal.
    const rows = buildVenueHistory(
      [guest('a', { total_bookings_count: 0 }), guest('b')],
      [venue('a', 'Alpha'), venue('b', 'Bravo')],
      [],
      NOW,
    );
    expect(rows.map((r) => r.venue.name)).toEqual(['Bravo']);
  });

  it('drops a guest row whose venue is unknown, rather than inventing a card', () => {
    expect(buildVenueHistory([guest('ghost')], [venue('a', 'Alpha')], [], NOW)).toEqual([]);
  });

  it('puts a relationship with no dates last instead of first', () => {
    // `Date.parse(null)` is NaN, and NaN comparisons would have shuffled it to
    // an arbitrary position.
    const rows = buildVenueHistory(
      [guest('a', { last_booked_at: null }), guest('b', { last_booked_at: '2026-02-01T10:00:00Z' })],
      [venue('a', 'Alpha'), venue('b', 'Bravo')],
      [],
      NOW,
    );
    expect(rows.map((r) => r.venue.name)).toEqual(['Bravo', 'Alpha']);
  });
});
