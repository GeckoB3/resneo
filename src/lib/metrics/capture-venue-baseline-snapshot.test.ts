import { describe, expect, it } from 'vitest';
import { rolling90DayPeriod } from '@/lib/metrics/capture-venue-baseline-snapshot';

describe('rolling90DayPeriod', () => {
  it('returns an inclusive 90-day window ending on the reference date', () => {
    const { from, to } = rolling90DayPeriod(new Date('2026-05-19T12:00:00.000Z'));
    expect(to).toBe('2026-05-19');
    expect(from).toBe('2026-02-19');
  });
});
