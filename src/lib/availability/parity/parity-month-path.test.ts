import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getDayOfWeek } from '@/lib/availability/engine';
import { createSupabaseFake, type FakeRow } from '@/lib/testing/supabase-fake';
import { computeAppointmentAvailableDatesInMonth } from '@/lib/availability/appointment-month-availability';

/**
 * Stage 5, harness debt: the appointment MONTH path.
 *
 * Stage 0b named this consumer and did not assert it, and Stages 3 and 4 both changed code
 * it runs: Stage 3 rewrote how it resolves venue hours, Stage 4 stopped it discarding its
 * venue-clock read error. It went through both uncovered. This closes that.
 *
 * The month path decides which dates a guest sees as bookable at all, so a defect here is
 * invisible to the day engine's tests and immediately visible to guests.
 *
 * Driven through the Stage 0a Supabase fake, which applies filters rather than returning
 * everything, so the date window and the `service_id is null` predicate are genuinely
 * exercised rather than assumed.
 */

const VENUE = 'venue-1';
const CAL = 'cal-1';
const SVC = 'svc-1';

/** June 2030; the 5th is a Wednesday. */
const YEAR = 2030;
const MONTH = 6;
const WED = '2030-06-05';
const THU = '2030-06-06';
const DK = String(getDayOfWeek(WED));

const OPEN_9_TO_5 = { [DK]: { periods: [{ open: '09:00', close: '17:00' }] } };

function calendarRow(workingHours: Record<string, Array<{ start: string; end: string }>>): FakeRow {
  return {
    id: CAL,
    venue_id: VENUE,
    name: 'Parity calendar',
    is_active: true,
    calendar_type: 'practitioner',
    working_hours: workingHours,
    break_times: [],
    break_times_by_day: null,
    days_off: [],
    parallel_clients: 1,
  };
}

function baseTables(blocks: FakeRow[] = [], workingHours?: Record<string, Array<{ start: string; end: string }>>) {
  return {
    venues: [
      { id: VENUE, timezone: null, booking_rules: null, opening_hours: OPEN_9_TO_5, venue_opening_exceptions: null },
    ],
    unified_calendars: [calendarRow(workingHours ?? { [DK]: [{ start: '09:00', end: '17:00' }] })],
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
      },
    ],
    availability_blocks: blocks,
    bookings: [],
    service_variants: [],
    practitioners: [],
    practitioner_services: [],
    practitioner_leave_periods: [],
    practitioner_calendar_blocks: [],
    appointment_services: [],
  };
}

function blk(partial: Partial<FakeRow> & { block_type: string }): FakeRow {
  return {
    id: `blk-${String(partial.block_type)}-${String(partial.date_start ?? WED)}`,
    venue_id: VENUE,
    service_id: null,
    date_start: WED,
    date_end: WED,
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

async function run(tables: ReturnType<typeof baseTables>, errors?: Record<string, { message: string }>) {
  const fake = createSupabaseFake({ tables, errors });
  return computeAppointmentAvailableDatesInMonth(
    fake.asSupabaseClient<SupabaseClient>(),
    VENUE,
    CAL,
    SVC,
    YEAR,
    MONTH,
    {
      audience: 'staff',
      // The month path filters dates through the service booking window, and the default
      // caps advance booking at 90 days. Fixtures sit far in the future so no clock filter
      // fires, so the window has to be widened or every date is rejected before the
      // resolver is ever consulted.
      bookingWindow: {
        max_advance_booking_days: 3650,
        min_booking_notice_hours: 0,
        cancellation_notice_hours: 0,
        allow_same_day_booking: true,
      },
    },
  );
}

const monthDates = (blocks: FakeRow[] = []) => run(baseTables(blocks));

describe('month path / venue-wide blocks', () => {
  it('offers the trading weekdays when nothing is blocked', async () => {
    const dates = await monthDates();

    expect(dates).toContain(WED);
    // Only one weekday is configured, so every offered date falls on it.
    expect(dates.every((d) => String(getDayOfWeek(d)) === DK)).toBe(true);
    expect(dates.length).toBeGreaterThan(3);
  });

  it('drops a date a whole-day closure covers, and keeps the next one', async () => {
    const dates = await monthDates([blk({ block_type: 'closed' })]);

    expect(dates).not.toContain(WED);
    expect(dates).toContain('2030-06-12');
  });

  /**
   * Stage 3: a part-day closure narrows the day rather than removing it. Before Stage 3 the
   * appointment path discarded the times and lost the whole date, so this is the month-path
   * half of §1.2 item 3.
   */
  it('keeps a date that a part-day closure only narrows', async () => {
    const dates = await monthDates([blk({ block_type: 'closed', time_start: '12:00', time_end: '13:00' })]);

    expect(dates).toContain(WED);
  });

  /**
   * Stage 3: Hours overrides REPLACE the weekly baseline, so a date the venue does not
   * normally trade becomes bookable. Defect #1, on the month path.
   */
  it('offers a weekly-closed date that an Hours override opens', async () => {
    const tables = baseTables(
      [
        blk({
          block_type: 'amended_hours',
          date_start: THU,
          date_end: THU,
          override_periods: [{ open: '10:00', close: '14:00' }],
        }),
      ],
      {
        [DK]: [{ start: '09:00', end: '17:00' }],
        [String(getDayOfWeek(THU))]: [{ start: '09:00', end: '17:00' }],
      },
    );

    const dates = await run(tables);

    expect(dates).toContain(THU);
  });

  it('drops a date whose Hours override leaves no room for the service', async () => {
    const dates = await monthDates([
      blk({ block_type: 'amended_hours', override_periods: [{ open: '10:00', close: '10:30' }] }),
    ]);

    // A 60-minute service cannot fit a 30-minute window.
    expect(dates).not.toContain(WED);
  });

  it('ignores an Hours override with no valid periods rather than closing the day', async () => {
    const dates = await monthDates([blk({ block_type: 'amended_hours', override_periods: [] })]);

    expect(dates).toContain(WED);
  });

  it('applies a multi-day closure to every date it covers', async () => {
    const dates = await monthDates([
      blk({ block_type: 'closed', date_start: '2030-06-01', date_end: '2030-06-15' }),
    ]);

    expect(dates).not.toContain('2030-06-05');
    expect(dates).not.toContain('2030-06-12');
    expect(dates).toContain('2030-06-19');
  });

  it('ignores a service-scoped block, which is not venue-wide', async () => {
    const dates = await monthDates([blk({ block_type: 'closed', service_id: 'other-service' })]);

    expect(dates).toContain(WED);
  });

  /**
   * Stage 4: the venue-clock read used to be discarded, so a failure became `{}` -- no
   * timezone, no opening hours, no exceptions -- and every date resolved unrestricted. It is
   * reported now; this pins that it still degrades rather than throwing.
   */
  it('degrades rather than throwing when the venue row cannot be read', async () => {
    await expect(run(baseTables(), { venues: { message: 'venues unavailable' } })).resolves.toBeInstanceOf(Array);
  });
});
