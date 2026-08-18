import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getDayOfWeek } from '@/lib/availability/engine';
import { createSupabaseFake, type FakeRow } from '@/lib/testing/supabase-fake';
import { getUnifiedAvailableSlots } from '@/lib/unified-availability';

/**
 * Stage 5, harness debt: `getUnifiedAvailableSlots`.
 *
 * Stage 0b named this consumer and did not assert it. It is the guest-facing slot list for
 * unified-scheduling venues and the public embed, so it is one of the few paths where a
 * resolver defect reaches a customer directly rather than a member of staff.
 *
 * It also carries the fix for §1.2 item 9: its own `availability_blocks` query omitted
 * `special_event`, and because it passes a NON-NULL list onward, a `special_event`-only date
 * passed `[]` and CLEARED the correctly-resolved exceptions the fetcher had already built.
 * One bug firing twice. The first fixture below is that case.
 */

const VENUE = 'venue-1';
const CAL = 'cal-1';
const SVC = 'svc-1';

/**
 * Unlike the rest of the harness, this fixture date is computed RELATIVE TO TODAY.
 *
 * `getUnifiedAvailableSlots` is a guest-facing path and applies
 * `isGuestBookingDateAllowed` before it resolves anything, and
 * `entityBookingWindowFromRow` hard-caps `max_advance_booking_days` at 365 -- a real
 * product rule, not a bug. A fixed far-future date like the one every other file uses is
 * therefore rejected before the resolver is ever consulted, and every assertion sees an
 * empty list that looks exactly like a resolver defect.
 *
 * 30 days out is comfortably inside the cap and far enough that no same-day or
 * minimum-notice filter fires. The weekday key is derived from the date, so the fixture
 * stays correct whichever weekday it lands on.
 */
function dateDaysFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const DATE = dateDaysFromToday(30);
const OTHER_DATE = dateDaysFromToday(31);
const DK = String(getDayOfWeek(DATE));

const OPEN_9_TO_5 = { [DK]: { periods: [{ open: '09:00', close: '17:00' }] } };

function tables(blocks: FakeRow[] = []): Record<string, FakeRow[]> {
  return {
    venues: [
      {
        id: VENUE,
        timezone: 'Europe/London',
        opening_hours: OPEN_9_TO_5,
        venue_opening_exceptions: null,
        booking_rules: null,
        pricing_tier: 'appointments_plus',
        booking_model: 'unified_scheduling',
        enabled_models: null,
        active_booking_models: null,
      },
    ],
    unified_calendars: [
      {
        id: CAL,
        venue_id: VENUE,
        name: 'Parity calendar',
        is_active: true,
        calendar_type: 'practitioner',
        working_hours: { [DK]: [{ start: '09:00', end: '17:00' }] },
        break_times: [],
        break_times_by_day: null,
        days_off: [],
        parallel_clients: 1,
        capacity: 1,
      },
    ],
    calendar_service_assignments: [
      { id: 'csa-1', calendar_id: CAL, service_item_id: SVC, custom_duration_minutes: null, custom_price_pence: null },
    ],
    service_items: [
      {
        id: SVC,
        venue_id: VENUE,
        name: 'Parity service',
        duration_minutes: 60,
        buffer_minutes: 0,
        booking_interval_minutes: 60,
        is_active: true,
        processing_time_minutes: null,
        processing_time_blocks: null,
        // The default is 90 days; 365 is the maximum the parser allows.
        max_advance_booking_days: 365,
        min_booking_notice_hours: 0,
        allow_same_day_booking: true,
        cancellation_notice_hours: 0,
      },
    ],
    availability_blocks: blocks,
    bookings: [],
    calendar_blocks: [],
    practitioner_leave_periods: [],
    practitioner_calendar_blocks: [],
    event_sessions: [],
    service_variants: [],
  };
}

function blk(partial: Partial<FakeRow> & { block_type: string }): FakeRow {
  return {
    id: `blk-${String(partial.block_type)}`,
    venue_id: VENUE,
    service_id: null,
    date_start: DATE,
    date_end: DATE,
    time_start: null,
    time_end: null,
    override_max_covers: null,
    reason: null,
    yield_overrides: null,
    override_periods: null,
    created_at: null,
    ...partial,
  };
}

async function slots(blocks: FakeRow[] = []): Promise<string[]> {
  const fake = createSupabaseFake({ tables: tables(blocks) });
  const out = await getUnifiedAvailableSlots({
    supabase: fake.asSupabaseClient<SupabaseClient>(),
    venueId: VENUE,
    calendarId: CAL,
    date: DATE,
    serviceItemId: SVC,
  });
  return out.map((s) => s.time);
}

describe('unified availability / venue-wide blocks', () => {
  it('offers the venue hours when nothing is blocked', async () => {
    expect(await slots()).toEqual(['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00']);
  });

  /**
   * §1.2 item 9, fixed in Stage 1. This path queried only ['closed', 'amended_hours'], so a
   * `special_event` closure was invisible here AND the non-null empty list it passed on
   * wiped the correct answer the fetcher had already resolved.
   */
  it('honours a special_event closure, which its own query used to omit', async () => {
    expect(await slots([blk({ block_type: 'special_event' })])).toEqual([]);
  });

  it('honours a whole-day closure', async () => {
    expect(await slots([blk({ block_type: 'closed' })])).toEqual([]);
  });

  /**
   * Stage 3: a part-day closure narrows the day rather than removing it, and the surviving
   * times keep their grid alignment because closures are vetoed rather than subtracted.
   */
  it('narrows the day for a part-day closure without moving the remaining slots', async () => {
    const out = await slots([blk({ block_type: 'closed', time_start: '12:00', time_end: '13:00' })]);

    expect(out).toEqual(['09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00']);
  });

  /**
   * The decisive veto-vs-subtract fixture for the GUEST path.
   *
   * The case above cannot tell the two apart. Its closure runs 12:00-13:00 on a 60-minute
   * grid, so subtracting it yields [09:00,12:00] and [13:00,17:00] and re-anchoring lands on
   * 13:00 -- exactly where the veto leaves it. Identical output, defect invisible. Every
   * closure fixture on this path shared that property.
   *
   * A closure whose boundaries do NOT fall on the grid separates them:
   *
   *   veto      -> the 12:00 candidate overlaps and is dropped; the rest of the grid is
   *                untouched            -> 09:00 10:00 11:00 13:00 14:00 15:00 16:00
   *   subtract  -> the anchoring range restarts at 12:40 and every later slot follows it
   *                                     -> 09:00 10:00 11:00 12:40 13:40 14:40 15:40
   *
   * The subtract signature is asserted explicitly as well as the ordered list, so a
   * regression names itself in the failure output instead of showing two long arrays that
   * differ somewhere in the middle.
   *
   * Confirmed against the plus-1 staging venue on 2026-08-18 with a real 12:10-12:40 closure:
   * 12:40 was absent and all 28 slots stayed on the 15-minute grid. Plan §2.1, §2.7, [R3-52].
   */
  it('keeps the grid aligned when the closure boundaries are off the slot grid', async () => {
    const out = await slots([blk({ block_type: 'closed', time_start: '12:10', time_end: '12:40' })]);

    // Re-anchoring signature: these appear if and only if the closure was subtracted.
    expect(out).not.toContain('12:40');
    expect(out).not.toContain('13:40');

    expect(out).toEqual(['09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00']);
  });

  /**
   * The same rule under a finer interval, which is the shape the staging venue actually runs
   * (15-minute interval, 30-minute service). Here a subtraction would put every afternoon
   * slot on :10 and :40, so the assertion is that no start falls off the quarter-hour.
   */
  it('keeps every start on the interval grid across an off-grid closure', async () => {
    const world = tables([blk({ block_type: 'closed', time_start: '12:10', time_end: '12:40' })]);
    world.service_items[0]!.duration_minutes = 30;
    world.service_items[0]!.booking_interval_minutes = 15;
    const fake = createSupabaseFake({ tables: world });

    const out = (
      await getUnifiedAvailableSlots({
        supabase: fake.asSupabaseClient<SupabaseClient>(),
        venueId: VENUE,
        calendarId: CAL,
        date: DATE,
        serviceItemId: SVC,
      })
    ).map((s) => s.time);

    expect(out.length).toBeGreaterThan(0);
    expect(out.every((t) => ['00', '15', '30', '45'].includes(t.slice(3)))).toBe(true);
    expect(out).not.toContain('12:40');
  });

  it('follows an Hours override that extends past the weekly close', async () => {
    const out = await slots([
      blk({ block_type: 'amended_hours', override_periods: [{ open: '09:00', close: '19:00' }] }),
    ]);

    // The calendar still stops at 17:00, so the venue override cannot widen past it.
    expect(out).toEqual(['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00']);
  });

  it('follows an Hours override that narrows the day', async () => {
    const out = await slots([
      blk({ block_type: 'amended_hours', override_periods: [{ open: '11:00', close: '14:00' }] }),
    ]);

    expect(out).toEqual(['11:00', '12:00', '13:00']);
  });

  it('ignores an Hours override with no valid periods rather than closing the day', async () => {
    const out = await slots([blk({ block_type: 'amended_hours', override_periods: [] })]);

    expect(out).toHaveLength(8);
  });

  it('ignores a service-scoped block, which is not venue-wide', async () => {
    const out = await slots([blk({ block_type: 'closed', service_id: 'other-service' })]);

    expect(out).toHaveLength(8);
  });

  it('ignores a block on another date', async () => {
    const out = await slots([blk({ block_type: 'closed', date_start: OTHER_DATE, date_end: OTHER_DATE })]);

    expect(out).toHaveLength(8);
  });

  it('queries availability_blocks with all three venue-wide types', async () => {
    const fake = createSupabaseFake({ tables: tables() });
    await getUnifiedAvailableSlots({
      supabase: fake.asSupabaseClient<SupabaseClient>(),
      venueId: VENUE,
      calendarId: CAL,
      date: DATE,
      serviceItemId: SVC,
    });

    const blockCalls = fake.calls.filter((c) => c.table === 'availability_blocks');
    expect(blockCalls.length).toBeGreaterThan(0);
    for (const call of blockCalls) {
      expect(call.filters).toContain('is(service_id,null)');
    }
  });
});
