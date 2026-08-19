import { describe, expect, it } from 'vitest';
import { createSupabaseFake } from '@/lib/testing/supabase-fake';
import { withScheduleReadContext } from '@/lib/availability/schedule-read-context';
import { getCalendarGrid } from '@/lib/unified-availability';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * `getCalendarGrid` reported nothing at all until 2026-08-19.
 *
 * Stage 1 instrumented the availability engines and never reached this function, so all
 * seven of its reads destructured `{ data }` and discarded `error`. This function is the
 * mobile calendar screen's only source, so a failed `bookings` read rendered an EMPTY DAY
 * and staff concluded nobody was booked. Nothing logged it, nothing reached Sentry, and no
 * wrapper could have helped: `withScheduleFailClosed` converts a success to a 503 only when
 * a failure was REPORTED, so wrapping the route while this function stayed silent would
 * have been inert and would have read as protection.
 *
 * These fixtures are the reason the route is safe to wrap later, and the reason it is not
 * wrapped yet: see `MUST_NOT_WRAP` in `schedule-fail-closed-coverage.test.ts`.
 */

const VENUE = 'venue-1';
const CAL = 'cal-1';

function world(errors: Record<string, { message: string }> = {}) {
  return createSupabaseFake({
    tables: {
      unified_calendars: [{ id: CAL, venue_id: VENUE, name: 'Ada', working_hours: null }],
      bookings: [
        {
          id: 'bk-1',
          venue_id: VENUE,
          calendar_id: CAL,
          booking_date: '2026-09-01',
          booking_time: '10:00:00',
          booking_end_time: '10:30:00',
          status: 'Booked',
          guest_id: 'g-1',
          service_item_id: 'svc-1',
          service_name_snapshot: 'Blow Dry',
        },
      ],
      calendar_blocks: [],
      event_sessions: [],
      guests: [{ id: 'g-1', first_name: 'Sam', last_name: 'Guest' }],
      appointment_services: [],
      service_items: [{ id: 'svc-1', venue_id: VENUE, name: 'Blow Dry' }],
    },
    errors,
  });
}

async function runGrid(errors: Record<string, { message: string }> = {}) {
  const fake = world(errors);
  return withScheduleReadContext(() =>
    getCalendarGrid({
      supabase: fake.asSupabaseClient<SupabaseClient>(),
      venueId: VENUE,
      calendarIds: [CAL],
      startDate: '2026-09-01',
      endDate: '2026-09-01',
    }),
  );
}

describe('getCalendarGrid reports its fail-open reads', () => {
  it('reports nothing when every read succeeds', async () => {
    const { result, failures } = await runGrid();

    expect(failures).toEqual([]);
    expect(result.calendars[0]?.dates[0]?.bookings).toHaveLength(1);
  });

  /**
   * The severe one. An empty booking list is indistinguishable from a quiet day, which is
   * exactly what staff were shown.
   */
  it('reports a failed bookings read, and still returns an empty day', async () => {
    const { result, failures } = await runGrid({ bookings: { message: 'boom' } });

    expect(failures.map((f) => f.table)).toContain('bookings');
    expect(failures.find((f) => f.table === 'bookings')?.assumed).toBe(
      'nothing is booked in this range, so every column reads as free',
    );
    // Fail OPEN is unchanged: this commit makes the failure visible, it does not alter the
    // answer. The empty day is still returned, which is why the route may be wrapped later.
    expect(result.calendars[0]?.dates[0]?.bookings ?? []).toHaveLength(0);
  });

  it.each([
    ['unified_calendars', 'the venue has no calendars, so the grid is empty'],
    ['calendar_blocks', 'no time is blocked out, so blocked slots look bookable'],
    ['event_sessions', 'no sessions are scheduled, so their columns look free'],
  ])('reports a failed %s read', async (table, assumed) => {
    const { failures } = await runGrid({ [table]: { message: 'boom' } });

    expect(failures.find((f) => f.table === table)?.assumed).toBe(assumed);
  });

  /**
   * Label-only reads are reported too, and say so in `assumed`. They matter separately:
   * the collector is flat, so if this route is ever wrapped, a failed guest-name lookup
   * would blank the whole calendar. That is a decision to take deliberately when wrapping.
   */
  it.each(['guests', 'service_items'])('reports a failed %s read as label only', async (table) => {
    const { failures } = await runGrid({ [table]: { message: 'boom' } });

    expect(failures.find((f) => f.table === table)?.assumed).toContain('label only');
  });

  it('reports every failed read in one pass, not just the first', async () => {
    const { failures } = await runGrid({
      bookings: { message: 'boom' },
      calendar_blocks: { message: 'boom' },
      event_sessions: { message: 'boom' },
    });

    expect(failures.map((f) => f.table).sort()).toEqual([
      'bookings',
      'calendar_blocks',
      'event_sessions',
    ]);
  });
});
