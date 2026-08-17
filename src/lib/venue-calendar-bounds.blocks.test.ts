import { describe, it, expect } from 'vitest';
import { getCalendarGridBounds, getVenueBusinessDayStatus } from '@/lib/venue-calendar-bounds';
import { utcWeekdayKey } from '@/lib/venue-calendar-bounds';
import type { AvailabilityBlock, OpeningHours } from '@/types/availability';

/**
 * Stage 4: the diary grid and the month grey-out follow the venue's RESOLVED hours.
 *
 * Both functions read weekly `opening_hours` alone before this, so an owner who amended a
 * day to run until 20:00 at a venue whose weekly hours end at 17:00 got a grid ending at
 * 17:00 and the amended stripe was clipped away by `schedule-closure-blocks` -- the very
 * hours they had just entered were the ones they could not see or drag into. The month
 * grid had the mirror problem: it greyed out a day the owner had specially opened.
 *
 * The blocks parameter is OPTIONAL on both, and omitting it must reproduce the old answer
 * exactly. That is what keeps the three restaurant call sites out of scope (plan §8), and
 * the last test here is the proof.
 */

const DATE = '2030-06-05';
const DK = utcWeekdayKey(DATE);

const NINE_TO_FIVE: OpeningHours = { [DK]: { periods: [{ open: '09:00', close: '17:00' }] } } as OpeningHours;
const CLOSED_THIS_WEEKDAY: OpeningHours = {
  [String((Number(DK) + 1) % 7)]: { periods: [{ open: '09:00', close: '17:00' }] },
} as OpeningHours;

function blk(partial: Partial<AvailabilityBlock> & { block_type: string }): AvailabilityBlock {
  return {
    id: 'b1',
    venue_id: 'v1',
    service_id: null,
    date_start: DATE,
    date_end: DATE,
    time_start: null,
    time_end: null,
    override_max_covers: null,
    reason: null,
    yield_overrides: null,
    override_periods: null,
    ...partial,
  } as unknown as AvailabilityBlock;
}

describe('getCalendarGridBounds with venue-wide blocks', () => {
  it('widens the grid to an amended window that runs past the weekly close', () => {
    const amended = [blk({ block_type: 'amended_hours', override_periods: [{ open: '08:00', close: '20:00' }] })];

    expect(getCalendarGridBounds(DATE, NINE_TO_FIVE)).toEqual({ startHour: 9, endHour: 17 });
    expect(getCalendarGridBounds(DATE, NINE_TO_FIVE, 7, 21, { venueWideBlocks: amended })).toEqual({
      startHour: 8,
      endHour: 20,
    });
  });

  it('follows an amended window on a weekday the venue would not otherwise trade', () => {
    const amended = [blk({ block_type: 'amended_hours', override_periods: [{ open: '10:00', close: '14:00' }] })];

    // Without blocks the weekday has no periods, so the grid falls back to 07:00-21:00 and
    // the stripe lands inside it by luck. With blocks it follows the hours the owner set.
    expect(getCalendarGridBounds(DATE, CLOSED_THIS_WEEKDAY)).toEqual({ startHour: 7, endHour: 21 });
    expect(getCalendarGridBounds(DATE, CLOSED_THIS_WEEKDAY, 7, 21, { venueWideBlocks: amended })).toEqual({
      startHour: 10,
      endHour: 14,
    });
  });

  it('keeps the weekly bounds when the only block is a closure, so the closure can be drawn', () => {
    // Closures are not subtracted from the bounds: the grid still has to SHOW the closed
    // window, and schedule-closure-blocks draws it from the same data.
    const closed = [blk({ block_type: 'closed', time_start: '12:00', time_end: '13:00' })];

    expect(getCalendarGridBounds(DATE, NINE_TO_FIVE, 7, 21, { venueWideBlocks: closed })).toEqual({
      startHour: 9,
      endHour: 17,
    });
  });
});

describe('getVenueBusinessDayStatus with venue-wide blocks', () => {
  it('stops greying out a day the owner opened specially', () => {
    const amended = [blk({ block_type: 'amended_hours', override_periods: [{ open: '10:00', close: '14:00' }] })];

    expect(getVenueBusinessDayStatus(DATE, CLOSED_THIS_WEEKDAY)).toBe('closed');
    expect(getVenueBusinessDayStatus(DATE, CLOSED_THIS_WEEKDAY, null, amended)).toBe('open');
  });

  it('greys out a day an override closed, even though the weekly shape says open', () => {
    const closed = [blk({ block_type: 'closed' })];

    expect(getVenueBusinessDayStatus(DATE, NINE_TO_FIVE)).toBe('open');
    expect(getVenueBusinessDayStatus(DATE, NINE_TO_FIVE, null, closed)).toBe('closed');
  });

  it('reports no opinion when the venue has no weekly hours and no blocks', () => {
    expect(getVenueBusinessDayStatus(DATE, null, null, [])).toBeNull();
  });
});

describe('the blocks parameter is additive', () => {
  /**
   * The guarantee that keeps the restaurant grid call sites out of scope: every existing
   * caller passes no blocks, and must get byte-identical answers.
   */
  it.each([
    ['weekly open day', NINE_TO_FIVE, { startHour: 9, endHour: 17 }],
    ['weekday with no periods', CLOSED_THIS_WEEKDAY, { startHour: 7, endHour: 21 }],
    ['no hours at all', null, { startHour: 7, endHour: 21 }],
  ])('gives the pre-Stage-4 bounds when blocks are omitted: %s', (_name, hours, expected) => {
    expect(getCalendarGridBounds(DATE, hours as OpeningHours | null)).toEqual(expected);
    expect(getCalendarGridBounds(DATE, hours as OpeningHours | null, 7, 21, { timeZone: 'Europe/London' })).toEqual(
      expected,
    );
    expect(getCalendarGridBounds(DATE, hours as OpeningHours | null, 7, 21, { venueWideBlocks: [] })).toEqual(expected);
  });
});
