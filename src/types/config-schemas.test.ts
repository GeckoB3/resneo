import { describe, it, expect } from 'vitest';
import { openingHoursDaySchema, openingHoursSchema } from '@/types/config-schemas';
import { resolveVenueWideAllowedMinuteRanges } from '@/lib/availability/venue-wide-business-hours';

/**
 * Decision (K): the 2-period cap on venue opening hours is removed.
 *
 * The cap was never a product rule. It existed because `OpeningHoursControl` renders
 * `periods[0]` and `periods[1]` and cannot draw a third, so the schema was the only thing
 * stopping that display truncation from silently dropping a period on save. With the editor
 * rewritten to render N periods, the schema no longer needs to compensate for it.
 *
 * These fixtures pin both halves: the schema accepts a third period, AND the resolver
 * actually honours it. Accepting data the engine then ignores would be worse than the cap.
 */

/** A Wednesday. */
const DATE = '2030-06-05';
const WED = '3';

describe('openingHoursDaySchema period count', () => {
  it('accepts a single period', () => {
    expect(openingHoursDaySchema.safeParse({ periods: [{ open: '09:00', close: '17:00' }] }).success).toBe(true);
  });

  it('accepts two periods, as it always did', () => {
    const parsed = openingHoursDaySchema.safeParse({
      periods: [
        { open: '09:00', close: '12:00' },
        { open: '13:00', close: '17:00' },
      ],
    });

    expect(parsed.success).toBe(true);
  });

  /** The change. A split shift plus an evening service is a real pattern. */
  it('accepts a THIRD period, which the cap used to reject', () => {
    const parsed = openingHoursDaySchema.safeParse({
      periods: [
        { open: '08:00', close: '11:00' },
        { open: '13:00', close: '16:00' },
        { open: '18:00', close: '21:00' },
      ],
    });

    expect(parsed.success).toBe(true);
  });

  it('still rejects a day with an empty period list', () => {
    expect(openingHoursDaySchema.safeParse({ periods: [] }).success).toBe(false);
  });

  it('still rejects a period that does not advance, at any position', () => {
    const parsed = openingHoursDaySchema.safeParse({
      periods: [
        { open: '09:00', close: '12:00' },
        { open: '13:00', close: '17:00' },
        { open: '19:00', close: '19:00' },
      ],
    });

    expect(parsed.success).toBe(false);
  });

  it('still accepts a closed day', () => {
    expect(openingHoursDaySchema.safeParse({ closed: true }).success).toBe(true);
  });

  it('accepts a whole week carrying three periods on one day', () => {
    const parsed = openingHoursSchema.safeParse({
      [WED]: {
        periods: [
          { open: '08:00', close: '11:00' },
          { open: '13:00', close: '16:00' },
          { open: '18:00', close: '21:00' },
        ],
      },
      '4': { closed: true },
    });

    expect(parsed.success).toBe(true);
  });
});

describe('the resolver honours a third period, not just the schema', () => {
  it('returns all three windows as allowed ranges', () => {
    const res = resolveVenueWideAllowedMinuteRanges(
      {
        [WED]: {
          periods: [
            { open: '08:00', close: '11:00' },
            { open: '13:00', close: '16:00' },
            { open: '18:00', close: '21:00' },
          ],
        },
      },
      DATE,
      [],
    );

    // `unrestricted` means no weekly hours are configured at all; a configured day
    // resolves to `allowed` with explicit ranges, which is the stronger thing to assert.
    expect(res.kind).toBe('allowed');
    if (res.kind === 'allowed') {
      expect(res.ranges).toEqual([
        { start: 480, end: 660 },
        { start: 780, end: 960 },
        { start: 1080, end: 1260 },
      ]);
    }
  });

  /**
   * The behaviour that matters: a booking window inside the THIRD period is allowed. Under
   * the old cap that period could not exist; if anything downstream still assumed two, an
   * evening booking would be refused as out of hours.
   */
  it('allows a window inside the third period', () => {
    const hours = {
      [WED]: {
        periods: [
          { open: '08:00', close: '11:00' },
          { open: '13:00', close: '16:00' },
          { open: '18:00', close: '21:00' },
        ],
      },
    };

    const res = resolveVenueWideAllowedMinuteRanges(hours, DATE, [
      {
        id: 'blk-1',
        venue_id: 'v1',
        service_id: null,
        block_type: 'amended_hours',
        date_start: DATE,
        date_end: DATE,
        time_start: null,
        time_end: null,
        override_periods: [
          { open: '08:00', close: '11:00' },
          { open: '13:00', close: '16:00' },
          { open: '18:00', close: '21:00' },
        ],
      } as never,
    ]);

    expect(res.kind).toBe('allowed');
    if (res.kind === 'allowed') {
      // 18:00-21:00 in minutes.
      expect(res.ranges).toContainEqual({ start: 1080, end: 1260 });
    }
  });
});
