import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getDayOfWeek } from '@/lib/availability/engine';
import { createSupabaseFake } from '@/lib/testing/supabase-fake';
import { getEventClassSlots } from '@/lib/unified-availability';
import { openOn, venueWriteGate, type SchedulingWorld } from '@/lib/availability/parity/scheduling-world';

/**
 * Stage 0b: the group-session listing path, paired with the gate that runs at checkout.
 *
 * This is the consumer the harness could not reach before Stage 0a, on two counts:
 * `getEventClassSlots` was unexported, and it needs a Supabase client. It is driven here
 * through the filter-applying fake, which is the reason that fake exists.
 *
 * It pins plan §1.2 item 15: this path applies NO venue-wide gate at all, while
 * `booking/create/route.ts:1031` applies the full one. A 19:00 session at a 09:00-17:00
 * venue is listed to the guest and then refused at checkout.
 *
 * See Docs/Resneo_Scheduling_Resolver_Plan_August_2026.md §1.2 item 15 and Stage 0b.
 */

const DATE = '2030-06-05';
const DK = String(getDayOfWeek(DATE));
const VENUE = 'venue-1';
const CAL = 'cal-event-1';

function fakeWith(sessions: Array<{ start: string; end: string }>) {
  return createSupabaseFake({
    tables: {
      event_sessions: sessions.map((s, i) => ({
        id: `sess-${i}`,
        venue_id: VENUE,
        calendar_id: CAL,
        session_date: DATE,
        start_time: s.start,
        end_time: s.end,
        capacity_override: null,
        is_cancelled: false,
        service_item_id: 'svc-1',
      })),
      unified_calendars: [{ id: CAL, capacity: 10, calendar_type: 'event' }],
      bookings: [],
    },
  });
}

function worldFor(instance: { start: string; end: string }): SchedulingWorld {
  return {
    name: 'group session',
    date: DATE,
    venueOpeningHours: openOn(DATE, [{ open: '09:00', close: '17:00' }]),
    venueBlocks: [],
    workingHours: { [DK]: [{ start: '09:00', end: '17:00' }] },
    instance,
  };
}

describe('read/write agreement / group sessions', () => {
  it('lists an in-hours session, and the create gate accepts it', async () => {
    const fake = fakeWith([{ start: '10:00', end: '11:00' }]);
    const slots = await getEventClassSlots(fake.asSupabaseClient<SupabaseClient>(), VENUE, CAL, DATE, 'svc-1');

    expect(slots.map((s) => s.time)).toEqual(['10:00']);
    expect(venueWriteGate(worldFor({ start: '10:00', end: '11:00' }))).toBeNull();
  });

  /**
   * PINS THE LIVE DEFECT. The listing has no venue gate, so it sells a 19:00 session at a
   * venue that closes at 17:00. The create gate refuses it with the message the guest sees.
   *
   * When Stage 5 closes this, the fix depends on the calendar's type: for a `class` column
   * the LISTING is correct and the gate must stop consulting weekly hours; for an `event`
   * column the gate is correct and the listing must start. `getEventClassSlots` serves both
   * (`unified-availability.ts:239-241`), which is why plan §1.2 item 14 needs three gates
   * rather than two, and why this expectation must be split in two when it changes.
   */
  it('DIVERGES: lists a 19:00 session at a 09:00-17:00 venue that the create gate refuses', async () => {
    const fake = fakeWith([{ start: '19:00', end: '20:00' }]);
    const slots = await getEventClassSlots(fake.asSupabaseClient<SupabaseClient>(), VENUE, CAL, DATE, 'svc-1');

    expect(slots.map((s) => s.time)).toEqual(['19:00']);
    expect(venueWriteGate(worldFor({ start: '19:00', end: '20:00' }))).toBe(
      'The venue is closed for this date or time.',
    );
  });

  it('DIVERGES: lists sessions on a day the venue is explicitly closed', async () => {
    const fake = fakeWith([{ start: '10:00', end: '11:00' }]);
    const slots = await getEventClassSlots(fake.asSupabaseClient<SupabaseClient>(), VENUE, CAL, DATE, 'svc-1');

    // The listing never reads availability_blocks at all, so a closure cannot reach it.
    expect(slots).toHaveLength(1);
    expect(fake.calls.map((c) => c.table)).not.toContain('availability_blocks');
  });

  it('excludes cancelled sessions and sessions on other dates', async () => {
    const fake = createSupabaseFake({
      tables: {
        event_sessions: [
          { id: 'a', venue_id: VENUE, calendar_id: CAL, session_date: DATE, start_time: '10:00', end_time: '11:00', capacity_override: null, is_cancelled: false, service_item_id: 'svc-1' },
          { id: 'b', venue_id: VENUE, calendar_id: CAL, session_date: DATE, start_time: '12:00', end_time: '13:00', capacity_override: null, is_cancelled: true, service_item_id: 'svc-1' },
          { id: 'c', venue_id: VENUE, calendar_id: CAL, session_date: '2030-06-06', start_time: '14:00', end_time: '15:00', capacity_override: null, is_cancelled: false, service_item_id: 'svc-1' },
        ],
        unified_calendars: [{ id: CAL, capacity: 10 }],
        bookings: [],
      },
    });
    const slots = await getEventClassSlots(fake.asSupabaseClient<SupabaseClient>(), VENUE, CAL, DATE, 'svc-1');
    expect(slots.map((s) => s.time)).toEqual(['10:00']);
  });

  it('returns nothing, rather than throwing, when the sessions read fails', async () => {
    const fake = createSupabaseFake({
      tables: { event_sessions: [] },
      errors: { event_sessions: { message: 'connection lost' } },
    });
    const slots = await getEventClassSlots(fake.asSupabaseClient<SupabaseClient>(), VENUE, CAL, DATE, 'svc-1');
    expect(slots).toEqual([]);
  });
});
