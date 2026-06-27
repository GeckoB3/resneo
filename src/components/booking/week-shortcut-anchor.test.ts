import { describe, expect, it } from 'vitest';
import { addWeeksLocalYmd, weekShortcutAnchorDate } from '@/components/booking/ResourceCalendarMonth';

describe('weekShortcutAnchorDate', () => {
  it('parses a YYYY-MM-DD anchor into a local-midnight Date', () => {
    const d = weekShortcutAnchorDate('2026-08-01');
    expect(d).toBeInstanceOf(Date);
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(7); // August (0-based)
    expect(d?.getDate()).toBe(1);
    expect(d?.getHours()).toBe(0);
  });

  it('returns undefined for missing/invalid input so callers fall back to today', () => {
    expect(weekShortcutAnchorDate(undefined)).toBeUndefined();
    expect(weekShortcutAnchorDate(null)).toBeUndefined();
    expect(weekShortcutAnchorDate('')).toBeUndefined();
    expect(weekShortcutAnchorDate('not-a-date')).toBeUndefined();
  });

  // Rebooking an upcoming booking: the +N wk shortcuts count from that booking's
  // date, not from today (the feature this anchor exists for).
  it('drives the +N week shortcuts off the anchored booking date', () => {
    const base = weekShortcutAnchorDate('2026-08-01');
    expect(addWeeksLocalYmd(2, base)).toBe('2026-08-15');
    expect(addWeeksLocalYmd(6, base)).toBe('2026-09-12');
  });

  // Rebooking a past booking / a normal new booking: no anchor → today, matching
  // the prior behaviour exactly.
  it('falls back to today-relative offsets when no anchor is supplied', () => {
    const base = weekShortcutAnchorDate(undefined);
    expect(addWeeksLocalYmd(3, base)).toBe(addWeeksLocalYmd(3));
  });
});
