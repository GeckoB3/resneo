import { describe, it, expect } from 'vitest';
import { buildVenueScheduleClosureBlocks } from '@/lib/calendar/schedule-closure-blocks';
import { utcWeekdayKey } from '@/lib/venue-calendar-bounds';
import type { AvailabilityBlock, OpeningHours } from '@/types/availability';

/**
 * Stage 5, harness debt: the diary CLOSURE RENDERER.
 *
 * Stage 0b named this consumer and did not assert it. Stage 3 changed what the resolver
 * returns and Stage 4 changed the grid bounds these stripes are clipped to, and it went
 * through both uncovered.
 *
 * This is the surface where a venue's hours become something an owner can see, so a defect
 * here is invisible to every engine test and immediately visible on the diary.
 */

const DATE = '2030-06-05';
const DK = utcWeekdayKey(DATE);
const COL = 'cal-1';

const NINE_TO_FIVE: OpeningHours = { [DK]: { periods: [{ open: '09:00', close: '17:00' }] } } as OpeningHours;
const CLOSED_THIS_WEEKDAY: OpeningHours = {
  [String((Number(DK) + 1) % 7)]: { periods: [{ open: '09:00', close: '17:00' }] },
} as OpeningHours;

function blk(partial: Partial<AvailabilityBlock> & { block_type: string }): AvailabilityBlock {
  return {
    id: `b-${partial.block_type}`,
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

function render(openingHours: OpeningHours | null, blocks: AvailabilityBlock[]) {
  return buildVenueScheduleClosureBlocks({
    openingHours,
    venueWideBlocks: blocks,
    fromDate: DATE,
    toDate: DATE,
    columnIds: [COL],
  });
}

/** "type start-end" per stripe, in minutes, for readable assertions. */
function shape(blocks: ReturnType<typeof render>): string[] {
  return blocks.map((b) => `${b.block_type} ${b.start_time}-${b.end_time}`);
}

describe('closure renderer / basics', () => {
  it('draws nothing when the venue imposes no constraint', () => {
    expect(render(null, [])).toEqual([]);
  });

  it('draws nothing on an ordinary open day with no blocks', () => {
    expect(render(NINE_TO_FIVE, [])).toEqual([]);
  });

  it('greys the whole grid on a whole-day closure', () => {
    const out = shape(render(NINE_TO_FIVE, [blk({ block_type: 'closed' })]));

    expect(out).toEqual(['venue_closed 09:00-17:00']);
  });

  it('draws the gap either side of a part-day closure, and nothing over the open hours', () => {
    const out = shape(render(NINE_TO_FIVE, [blk({ block_type: 'closed', time_start: '12:00', time_end: '13:00' })]));

    expect(out).toEqual(['venue_closed 12:00-13:00']);
  });
});

describe('closure renderer / amended hours', () => {
  /**
   * The grid follows the RESOLVED hours, so on an amended day it is the amended window --
   * there is no band outside it left to grey. Before Stage 4 the grid stayed at the weekly
   * 09:00-17:00 and the renderer greyed 09:00-10:00 and 14:00-17:00 around the stripe;
   * both halves now agree that the day is 10:00-14:00, which is the point of the change.
   */
  it('draws the amended window, and greys nothing because the grid IS that window', () => {
    const out = shape(
      render(NINE_TO_FIVE, [
        blk({ block_type: 'amended_hours', override_periods: [{ open: '10:00', close: '14:00' }] }),
      ]),
    );

    expect(out).toEqual(['venue_amended_hours 10:00-14:00']);
  });

  /**
   * A split amended day still greys the gap between the two windows, because that gap IS
   * inside the resolved grid. This is the case the staging venue carries on 16 Sep 2026.
   */
  it('greys the gap between two amended windows', () => {
    const out = shape(
      render(NINE_TO_FIVE, [
        blk({
          block_type: 'amended_hours',
          override_periods: [
            { open: '09:00', close: '11:00' },
            { open: '15:00', close: '17:00' },
          ],
        }),
      ]),
    );

    expect(out).toContain('venue_amended_hours 09:00-11:00');
    expect(out).toContain('venue_amended_hours 15:00-17:00');
    expect(out).toContain('venue_closed 11:00-15:00');
  });

  /**
   * THE CASE STAGE 4 NAMED AS BREAKAGE 1, and the reason this fixture exists.
   *
   * Weekly hours end at 17:00; the owner amends the day to run until 20:00. Stage 4 made
   * the visible GRID follow the resolved hours, so it now runs to 20:00 -- but the renderer
   * derives its own bounds and must follow the same hours, or it clips the 17:00-20:00
   * stripe away and the owner sees an empty band where the hours they just entered should be.
   */
  it('draws an amended window that runs past the weekly close', () => {
    const out = shape(
      render(NINE_TO_FIVE, [
        blk({ block_type: 'amended_hours', override_periods: [{ open: '09:00', close: '20:00' }] }),
      ]),
    );

    expect(out).toContain('venue_amended_hours 09:00-20:00');
    // Nothing is greyed: the amended window covers the whole resolved grid.
    expect(out.filter((s) => s.startsWith('venue_closed'))).toEqual([]);
  });

  it('draws an amended window on a weekday the venue does not normally trade', () => {
    const out = shape(
      render(CLOSED_THIS_WEEKDAY, [
        blk({ block_type: 'amended_hours', override_periods: [{ open: '10:00', close: '14:00' }] }),
      ]),
    );

    expect(out).toContain('venue_amended_hours 10:00-14:00');
  });

  it('greys the whole day when a closure overlaps an amended window', () => {
    const out = shape(
      render(NINE_TO_FIVE, [
        blk({ id: 'a', block_type: 'amended_hours', override_periods: [{ open: '10:00', close: '14:00' }] }),
        blk({ id: 'b', block_type: 'closed' }),
      ]),
    );

    expect(out.some((s) => s.startsWith('venue_closed'))).toBe(true);
    expect(out.some((s) => s.startsWith('venue_amended_hours'))).toBe(false);
  });

  it('ignores an amended row with no valid periods rather than greying the day', () => {
    const out = render(NINE_TO_FIVE, [blk({ block_type: 'amended_hours', override_periods: [] })]);

    expect(out).toEqual([]);
  });
});

describe('closure renderer / scope', () => {
  it('emits one stripe set per visible column', () => {
    const out = buildVenueScheduleClosureBlocks({
      openingHours: NINE_TO_FIVE,
      venueWideBlocks: [blk({ block_type: 'closed' })],
      fromDate: DATE,
      toDate: DATE,
      columnIds: ['a', 'b', 'c'],
    });

    expect(out).toHaveLength(3);
    expect(new Set(out.map((b) => b.practitioner_id))).toEqual(new Set(['a', 'b', 'c']));
  });

  it('draws nothing when there are no visible columns', () => {
    expect(
      buildVenueScheduleClosureBlocks({
        openingHours: NINE_TO_FIVE,
        venueWideBlocks: [blk({ block_type: 'closed' })],
        fromDate: DATE,
        toDate: DATE,
        columnIds: [],
      }),
    ).toEqual([]);
  });

  it('covers every date in the range a multi-day closure spans', () => {
    const out = buildVenueScheduleClosureBlocks({
      openingHours: NINE_TO_FIVE,
      venueWideBlocks: [blk({ block_type: 'closed', date_start: '2030-06-05', date_end: '2030-06-07' })],
      fromDate: '2030-06-05',
      toDate: '2030-06-07',
      columnIds: [COL],
    });

    expect(new Set(out.map((b) => b.block_date))).toEqual(new Set(['2030-06-05', '2030-06-06', '2030-06-07']));
  });
});
