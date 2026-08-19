import { describe, it, expect } from 'vitest';
import {
  calendarHoursOutsideVenue,
  describeVenueDay,
  venueDayContext,
} from '@/lib/calendar/venue-hours-context';
import type { OpeningHours } from '@/types/availability';

/**
 * Decision (K) step 6: showing the venue's hours beside the calendar's, and saying when the
 * calendar's fall outside them.
 *
 * The consequential half is the overlap arithmetic. A false positive tells a venue its
 * hours are broken when they are fine; a false negative leaves the original problem, which
 * is time that is set, looks saved, and silently never becomes bookable.
 */

const WED = '3';
const open = (periods: Array<{ open: string; close: string }>) => ({ [WED]: { periods } }) as OpeningHours;

describe('venueDayContext', () => {
  it('reads a periods day', () => {
    expect(venueDayContext(open([{ open: '09:00', close: '17:00' }]), WED)).toEqual({
      kind: 'open',
      periods: [{ open: '09:00', close: '17:00' }],
    });
  });

  it('reads a closed day', () => {
    expect(venueDayContext({ [WED]: { closed: true } } as OpeningHours, WED)).toEqual({ kind: 'closed' });
  });

  it('reads the legacy single range as one period', () => {
    expect(venueDayContext({ [WED]: { open: '10:00', close: '14:00' } } as unknown as OpeningHours, WED)).toEqual({
      kind: 'open',
      periods: [{ open: '10:00', close: '14:00' }],
    });
  });

  /** `unset` must stay distinct from `closed`: no hours means no constraint. */
  it('reports unset for a missing day, missing object, or unusable entry', () => {
    expect(venueDayContext(open([{ open: '09:00', close: '17:00' }]), '4')).toEqual({ kind: 'unset' });
    expect(venueDayContext(null, WED)).toEqual({ kind: 'unset' });
    expect(venueDayContext({ [WED]: {} } as unknown as OpeningHours, WED)).toEqual({ kind: 'unset' });
  });
});

describe('describeVenueDay', () => {
  it('joins multiple windows', () => {
    expect(
      describeVenueDay({ kind: 'open', periods: [{ open: '09:00', close: '12:00' }, { open: '14:00', close: '18:00' }] }),
    ).toBe('09:00 to 12:00, 14:00 to 18:00');
  });

  it('names the closed and unset cases distinctly', () => {
    expect(describeVenueDay({ kind: 'closed' })).toBe('Venue closed');
    expect(describeVenueDay({ kind: 'unset' })).toBe('No business hours set');
  });

  /** House style: no em-dash in anything a user reads. */
  it('uses no em-dash', () => {
    expect(describeVenueDay({ kind: 'open', periods: [{ open: '09:00', close: '17:00' }] })).not.toContain('—');
  });
});

describe('calendarHoursOutsideVenue', () => {
  const venue = { kind: 'open' as const, periods: [{ open: '09:00', close: '17:00' }] };

  it('is false when the calendar sits inside the venue hours', () => {
    expect(calendarHoursOutsideVenue([{ open: '10:00', close: '16:00' }], venue)).toBe(false);
  });

  it('is false when the calendar exactly matches', () => {
    expect(calendarHoursOutsideVenue([{ open: '09:00', close: '17:00' }], venue)).toBe(false);
  });

  it('is true when the calendar starts before the venue opens', () => {
    expect(calendarHoursOutsideVenue([{ open: '08:00', close: '12:00' }], venue)).toBe(true);
  });

  it('is true when the calendar runs past the venue close', () => {
    expect(calendarHoursOutsideVenue([{ open: '15:00', close: '19:00' }], venue)).toBe(true);
  });

  /** The case a split venue day makes easy to miss. */
  it('is true when the calendar spans a gap between two venue windows', () => {
    const split = { kind: 'open' as const, periods: [{ open: '09:00', close: '12:00' }, { open: '14:00', close: '18:00' }] };

    expect(calendarHoursOutsideVenue([{ open: '10:00', close: '16:00' }], split)).toBe(true);
    expect(calendarHoursOutsideVenue([{ open: '10:00', close: '11:00' }], split)).toBe(false);
    expect(calendarHoursOutsideVenue([{ open: '15:00', close: '17:00' }], split)).toBe(false);
  });

  it('covers a calendar period spanning both windows only if the gap is filled', () => {
    const contiguous = { kind: 'open' as const, periods: [{ open: '09:00', close: '13:00' }, { open: '13:00', close: '18:00' }] };

    expect(calendarHoursOutsideVenue([{ open: '10:00', close: '16:00' }], contiguous)).toBe(false);
  });

  it('checks every calendar period, not just the first', () => {
    expect(
      calendarHoursOutsideVenue([{ open: '10:00', close: '12:00' }, { open: '18:00', close: '20:00' }], venue),
    ).toBe(true);
  });

  it('is true for any hours at all on a day the venue is closed', () => {
    expect(calendarHoursOutsideVenue([{ open: '10:00', close: '11:00' }], { kind: 'closed' })).toBe(true);
  });

  /** No opening hours means no constraint, so nothing can be outside them. */
  it('is false when the venue has no hours set', () => {
    expect(calendarHoursOutsideVenue([{ open: '03:00', close: '05:00' }], { kind: 'unset' })).toBe(false);
  });

  it('is false when the calendar is closed that day', () => {
    expect(calendarHoursOutsideVenue([], venue)).toBe(false);
    expect(calendarHoursOutsideVenue(null, venue)).toBe(false);
  });
});
