import { describe, it, expect } from 'vitest';
import { formatWorkingHoursLineForDate } from '@/lib/calendar/format-working-hours-for-date';
import type { WorkingHours } from '@/types/booking-models';

/**
 * The diary column header.
 *
 * It printed the calendar's RAW working hours while the grid beside it drew the effective
 * ones, so on a day where the venue closes before the calendar does, the two halves of the
 * same screen disagreed and only the grid was right. Staff reading "09:00-22:00" above a
 * grid that stopped at 18:00 would reasonably believe a 19:00 appointment was possible.
 */

/** A Tuesday, in a fixed zone so the weekday is not the thing under test. */
const TUE = '2026-08-25';
const TZ = 'Europe/London';
const NINE_TO_TEN: WorkingHours = { '2': [{ start: '09:00', end: '22:00' }] };

describe('formatWorkingHoursLineForDate', () => {
  describe('without venue context, behaviour is unchanged', () => {
    it('shows the calendar hours', () => {
      expect(formatWorkingHoursLineForDate(NINE_TO_TEN, TUE, TZ)).toBe('09:00–22:00');
    });

    it('shows Closed for a day with no periods', () => {
      expect(formatWorkingHoursLineForDate({}, TUE, TZ)).toBe('Closed');
      expect(formatWorkingHoursLineForDate(null, TUE, TZ)).toBe('Closed');
    });

    it('joins split periods', () => {
      const split: WorkingHours = { '2': [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }] };

      expect(formatWorkingHoursLineForDate(split, TUE, TZ)).toBe('09:00–12:00, 14:00–18:00');
    });
  });

  describe('with venue context', () => {
    /** The reported case: venue closes at 18:00, calendar runs to 22:00. */
    it('shows the effective hours, with the calendar hours in brackets', () => {
      const line = formatWorkingHoursLineForDate(NINE_TO_TEN, TUE, TZ, [{ start: 540, end: 1080 }]);

      expect(line).toBe('09:00–18:00 (calendar 09:00–22:00)');
    });

    /** No divergence, no noise. */
    it('stays terse when the calendar already fits inside the venue hours', () => {
      const line = formatWorkingHoursLineForDate(NINE_TO_TEN, TUE, TZ, [{ start: 540, end: 1320 }]);

      expect(line).toBe('09:00–22:00');
    });

    it('narrows both ends when the venue opens later and closes earlier', () => {
      const line = formatWorkingHoursLineForDate(NINE_TO_TEN, TUE, TZ, [{ start: 600, end: 1020 }]);

      expect(line).toBe('10:00–17:00 (calendar 09:00–22:00)');
    });

    it('splits the line when the venue has two windows inside the calendar day', () => {
      const line = formatWorkingHoursLineForDate(NINE_TO_TEN, TUE, TZ, [
        { start: 540, end: 720 },
        { start: 840, end: 1020 },
      ]);

      expect(line).toBe('09:00–12:00, 14:00–17:00 (calendar 09:00–22:00)');
    });

    it('says so when the venue is closed and nothing overlaps', () => {
      expect(formatWorkingHoursLineForDate(NINE_TO_TEN, TUE, TZ, [])).toBe('Closed (outside business hours)');
    });

    it('says so when the calendar sits entirely outside the venue hours', () => {
      const evening: WorkingHours = { '2': [{ start: '19:00', end: '22:00' }] };

      expect(formatWorkingHoursLineForDate(evening, TUE, TZ, [{ start: 540, end: 1080 }])).toBe(
        'Closed (outside business hours)',
      );
    });

    /**
     * `null` means the venue imposes no constraint, which is NOT the same as an empty list.
     * Conflating them would make every column read "Closed" at a venue that has never set
     * opening hours.
     */
    it('treats null as no constraint, unlike an empty list', () => {
      expect(formatWorkingHoursLineForDate(NINE_TO_TEN, TUE, TZ, null)).toBe('09:00–22:00');
    });

    it('still reports a calendar closed that day as Closed', () => {
      expect(formatWorkingHoursLineForDate({}, TUE, TZ, [{ start: 540, end: 1080 }])).toBe('Closed');
    });
  });
});
