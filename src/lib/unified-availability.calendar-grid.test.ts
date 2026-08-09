import { describe, expect, it } from 'vitest';
import { getCalendarGrid } from '@/lib/unified-availability';

/**
 * `getCalendarGrid` serves `/api/venue/calendar-grid`, which has no web
 * consumers at all — it is the mobile calendar's only source. That is why it was
 * missed when every other read path learned to prefer `service_name_snapshot`
 * (migration 20270103125000): the list, detail, summary, guest-history and
 * linked-calendar routes were all updated, so a deleted service kept its name
 * everywhere except the one grid nobody on the web looks at, where bars fell
 * back to the generic word "Service".
 *
 * These tests pin the precedence and the two visit-grouping columns the grid now
 * carries, so the same omission cannot recur silently.
 */

const VENUE_ID = '00000000-0000-4000-8000-00000000cafe';
const CAL_ID = '00000000-0000-4000-8000-0000000000c1';

/** Chainable stub: every filter returns itself, awaiting yields the table's rows. */
function stubDb(rowsByTable: Record<string, Array<Record<string, unknown>>>) {
  return {
    from(table: string) {
      const result = { data: rowsByTable[table] ?? [], error: null };
      const builder: Record<string, unknown> = {
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
      };
      for (const method of ['select', 'eq', 'neq', 'in', 'or', 'gte', 'lte', 'order', 'limit', 'not', 'is']) {
        builder[method] = () => builder;
      }
      builder.maybeSingle = async () => ({ data: null, error: null });
      return builder as never;
    },
  } as never;
}

function bookingRow(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: '00000000-0000-4000-8000-0000000000b1',
    calendar_id: CAL_ID,
    booking_date: '2026-08-09',
    booking_time: '11:00:00',
    booking_end_time: '11:30:00',
    status: 'Completed',
    guest_id: null,
    service_item_id: null,
    appointment_service_id: null,
    service_name_snapshot: null,
    group_booking_id: null,
    person_label: null,
    ...over,
  };
}

async function gridFor(bookings: Array<Record<string, unknown>>, serviceItems: Array<Record<string, unknown>> = []) {
  const grid = await getCalendarGrid({
    supabase: stubDb({
      unified_calendars: [{ id: CAL_ID, name: 'Chair 1', working_hours: {} }],
      bookings,
      calendar_blocks: [],
      event_sessions: [],
      guests: [],
      service_items: serviceItems,
      appointment_services: [],
    }),
    venueId: VENUE_ID,
    calendarIds: [CAL_ID],
    startDate: '2026-08-09',
    endDate: '2026-08-09',
  });
  return grid.calendars[0]!.dates[0]!.bookings;
}

describe('getCalendarGrid service names', () => {
  it('uses the recorded name when the service has been deleted (ids nulled)', async () => {
    const bookings = await gridFor([
      bookingRow({ service_item_id: null, service_name_snapshot: 'Test 3' }),
    ]);
    expect(bookings[0]!.serviceName).toBe('Test 3');
  });

  it('prefers the recorded name over a service since renamed', async () => {
    const bookings = await gridFor(
      [bookingRow({ service_item_id: 'svc-1', service_name_snapshot: 'Gents Cut' })],
      [{ id: 'svc-1', name: 'Classic Cut' }],
    );
    // Renaming the catalogue must not rewrite what a past booking says it was for.
    expect(bookings[0]!.serviceName).toBe('Gents Cut');
  });

  it('falls back to the live catalogue for rows taken before snapshotting', async () => {
    const bookings = await gridFor(
      [bookingRow({ service_item_id: 'svc-1', service_name_snapshot: null })],
      [{ id: 'svc-1', name: 'Classic Cut' }],
    );
    expect(bookings[0]!.serviceName).toBe('Classic Cut');
  });

  it('still shows the generic word when there is neither snapshot nor service', async () => {
    const bookings = await gridFor([bookingRow({})]);
    expect(bookings[0]!.serviceName).toBe('Service');
  });

  it('treats a blank snapshot as absent rather than rendering an empty bar', async () => {
    const bookings = await gridFor(
      [bookingRow({ service_item_id: 'svc-1', service_name_snapshot: '   ' })],
      [{ id: 'svc-1', name: 'Classic Cut' }],
    );
    expect(bookings[0]!.serviceName).toBe('Classic Cut');
  });
});

describe('getCalendarGrid visit grouping columns', () => {
  it('carries group_booking_id and person_label through to the client', async () => {
    const bookings = await gridFor([
      bookingRow({ group_booking_id: 'grp-1', person_label: 'Person 1' }),
    ]);
    expect(bookings[0]!.group_booking_id).toBe('grp-1');
    expect(bookings[0]!.person_label).toBe('Person 1');
  });

  it('nulls them for an ordinary standalone booking', async () => {
    const bookings = await gridFor([bookingRow({})]);
    expect(bookings[0]!.group_booking_id).toBeNull();
    expect(bookings[0]!.person_label).toBeNull();
  });

  it('keeps every segment of a multi-service visit as its own row (grouping is the client’s job)', async () => {
    const bookings = await gridFor([
      bookingRow({ id: 'b1', booking_time: '11:00:00', group_booking_id: 'grp-1', service_name_snapshot: 'Cut' }),
      bookingRow({ id: 'b2', booking_time: '11:30:00', group_booking_id: 'grp-1', service_name_snapshot: 'Colour' }),
    ]);
    expect(bookings).toHaveLength(2);
    expect(bookings.map((b) => b.group_booking_id)).toEqual(['grp-1', 'grp-1']);
  });
});
