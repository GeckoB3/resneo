import { describe, it, expect } from 'vitest';
import {
  resolveVenueWideAllowedMinuteRanges,
  scheduledInstanceRejectBookingWindow,
  venueClosureWindowsForDate,
  venueWideBlocksRejectBookingWindow,
} from '@/lib/availability/venue-wide-business-hours';
import type { AvailabilityBlock, OpeningHours } from '@/types/availability';

/**
 * Stage 2 replaced `isWeeklyScheduleClosedForDate` with a discriminated resolution.
 *
 * That helper existed only because `closed` did not say WHY, so it had to re-derive the
 * distinction from the block list -- and got it wrong: it returned false the moment ANY
 * block existed on the date, so a single unrelated morning closure silently took every
 * evening event off sale. The resolution now carries `cause` and the materialised
 * `closures`, and both consumers read those instead.
 *
 * These tests cover what that helper covered, plus the case it got wrong.
 */

/** 2026-04-18 is a Saturday. */
const SATURDAY = '2026-04-18';

const MON_TO_FRI: OpeningHours = {
  '1': { periods: [{ open: '09:00', close: '17:00' }] },
  '2': { periods: [{ open: '09:00', close: '17:00' }] },
  '3': { periods: [{ open: '09:00', close: '17:00' }] },
  '4': { periods: [{ open: '09:00', close: '17:00' }] },
  '5': { periods: [{ open: '09:00', close: '17:00' }] },
};

const OPEN_SATURDAY: OpeningHours = { '6': { periods: [{ open: '09:00', close: '17:00' }] } };

function blk(partial: Partial<AvailabilityBlock> & { block_type: string }): AvailabilityBlock {
  return {
    id: 'b1',
    venue_id: 'v',
    service_id: null,
    date_start: SATURDAY,
    date_end: SATURDAY,
    time_start: null,
    time_end: null,
    override_max_covers: null,
    reason: null,
    yield_overrides: null,
    override_periods: null,
    ...partial,
  } as unknown as AvailabilityBlock;
}

describe('resolveVenueWideAllowedMinuteRanges cause', () => {
  it('reports weekly when the weekday has no periods and nothing else applies', () => {
    const res = resolveVenueWideAllowedMinuteRanges(MON_TO_FRI, SATURDAY, []);
    expect(res).toEqual({ kind: 'closed', cause: 'weekly', closures: [] });
  });

  it('still reports weekly when an unrelated closure sits on the date', () => {
    // The old helper returned false here, which is the bug: the reason the venue is shut
    // on a Saturday is that it does not trade Saturdays, not that someone blocked 06:00.
    const res = resolveVenueWideAllowedMinuteRanges(MON_TO_FRI, SATURDAY, [
      blk({ block_type: 'closed', time_start: '06:00', time_end: '07:00' }),
    ]);
    expect(res.kind).toBe('closed');
    expect(res.kind === 'closed' && res.cause).toBe('weekly');
  });

  it('reports override when an amended row names hours for the date', () => {
    // The venue HAS stated hours for this specific date, so the weekly allowance must not
    // apply, even though this resolver cannot honour those hours until Stage 3.
    const res = resolveVenueWideAllowedMinuteRanges(MON_TO_FRI, SATURDAY, [
      blk({ block_type: 'amended_hours', override_periods: [{ open: '10:00', close: '14:00' }] }),
    ]);
    expect(res.kind === 'closed' && res.cause).toBe('override');
  });

  it('reports override for a whole-day closure on a trading weekday', () => {
    const res = resolveVenueWideAllowedMinuteRanges(OPEN_SATURDAY, SATURDAY, [blk({ block_type: 'closed' })]);
    expect(res.kind === 'closed' && res.cause).toBe('override');
  });

  it('carries closure windows on an allowed resolution too', () => {
    const res = resolveVenueWideAllowedMinuteRanges(OPEN_SATURDAY, SATURDAY, [
      blk({ block_type: 'closed', time_start: '12:00', time_end: '13:00' }),
    ]);
    expect(res.kind).toBe('allowed');
    expect(res.closures).toEqual([{ start: 720, end: 780 }]);
  });

  it('reports unrestricted when no weekly hours are configured', () => {
    expect(resolveVenueWideAllowedMinuteRanges(null, SATURDAY, [])).toEqual({
      kind: 'unrestricted',
      closures: [],
    });
  });
});

describe('venueClosureWindowsForDate', () => {
  it('materialises a whole-day closure and merges overlaps', () => {
    const windows = venueClosureWindowsForDate(
      [
        blk({ block_type: 'closed', time_start: '09:00', time_end: '11:00' }),
        blk({ block_type: 'special_event', time_start: '10:00', time_end: '12:00' }),
      ],
      SATURDAY,
    );
    expect(windows).toEqual([{ start: 540, end: 720 }]);
  });

  it('treats a block with no times as the whole day, and ignores amended rows', () => {
    expect(venueClosureWindowsForDate([blk({ block_type: 'closed' })], SATURDAY)).toEqual([
      { start: 0, end: 1440 },
    ]);
    expect(
      venueClosureWindowsForDate(
        [blk({ block_type: 'amended_hours', override_periods: [{ open: '10:00', close: '14:00' }] })],
        SATURDAY,
      ),
    ).toEqual([]);
  });
});

describe('scheduledInstanceRejectBookingWindow vs the slot-generation gate', () => {
  const start = '19:00';
  const end = '20:00';

  it('allows an instance on a weekday the venue does not trade; the slot gate refuses it', () => {
    expect(scheduledInstanceRejectBookingWindow(MON_TO_FRI, SATURDAY, start, end, [])).toBeNull();
    expect(venueWideBlocksRejectBookingWindow(MON_TO_FRI, SATURDAY, start, end, [])).toBe(
      'The venue is closed for this date or time.',
    );
  });

  it('refuses when an explicit closure overlaps the instance', () => {
    const blocks = [blk({ block_type: 'closed', time_start: '18:00', time_end: '21:00' })];
    expect(scheduledInstanceRejectBookingWindow(MON_TO_FRI, SATURDAY, start, end, blocks)).toBe(
      'The venue is closed for this date or time.',
    );
  });

  it('ignores a closure that does not overlap, which the old helper could not do', () => {
    const blocks = [blk({ block_type: 'closed', time_start: '06:00', time_end: '07:00' })];
    expect(scheduledInstanceRejectBookingWindow(MON_TO_FRI, SATURDAY, start, end, blocks)).toBeNull();
  });

  it('refuses a whole-day closure even on a weekday the venue does not trade', () => {
    const blocks = [blk({ block_type: 'closed' })];
    expect(scheduledInstanceRejectBookingWindow(MON_TO_FRI, SATURDAY, start, end, blocks)).toBe(
      'The venue is closed for this date or time.',
    );
  });

  it('still requires coverage on a weekday the venue does trade', () => {
    expect(scheduledInstanceRejectBookingWindow(OPEN_SATURDAY, SATURDAY, start, end, [])).toBe(
      'The venue is closed for this date or time.',
    );
    expect(scheduledInstanceRejectBookingWindow(OPEN_SATURDAY, SATURDAY, '10:00', '11:00', [])).toBeNull();
  });

  it('accepts anything when the venue has no weekly hours at all', () => {
    expect(scheduledInstanceRejectBookingWindow(null, SATURDAY, start, end, [])).toBeNull();
  });
});
