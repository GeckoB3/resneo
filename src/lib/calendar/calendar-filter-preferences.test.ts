import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CALENDAR_FILTERS,
  calendarFiltersAreDefault,
  decodeCalendarFilters,
  encodeCalendarFilters,
  isPractitionerCalendarFilters,
  type PractitionerCalendarFilters,
} from './calendar-filter-preferences';

const CAL = '11111111-1111-4111-8111-111111111111';

describe('calendar filter preferences', () => {
  it('round-trips through the cookie encoding', () => {
    const filters: PractitionerCalendarFilters = {
      visibleCalendarIdsState: [CAL],
      visibleLinkedColumnIds: ['linked:venue:cal'],
      filterStatus: 'Booked',
      workingHoursOnly: true,
    };
    expect(decodeCalendarFilters(encodeCalendarFilters(filters))).toEqual(filters);
  });

  it('rejects a malformed or foreign value rather than throwing', () => {
    expect(decodeCalendarFilters('not json')).toBeNull();
    expect(decodeCalendarFilters(encodeURIComponent('{"filterStatus":"all"}'))).toBeNull();
    expect(isPractitionerCalendarFilters({ ...DEFAULT_CALENDAR_FILTERS, visibleCalendarIdsState: ['nope'] })).toBe(false);
    expect(isPractitionerCalendarFilters({ ...DEFAULT_CALENDAR_FILTERS, visibleLinkedColumnIds: [CAL] })).toBe(false);
  });

  it('keeps the status and toggle when the column lists would overflow the cookie', () => {
    const ids = Array.from(
      { length: 200 },
      (_, i) => `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`,
    );
    const decoded = decodeCalendarFilters(
      encodeCalendarFilters({
        ...DEFAULT_CALENDAR_FILTERS,
        visibleCalendarIdsState: ids,
        filterStatus: 'Confirmed',
        workingHoursOnly: true,
      }),
    );
    expect(decoded).toEqual({ ...DEFAULT_CALENDAR_FILTERS, filterStatus: 'Confirmed', workingHoursOnly: true });
  });

  it('knows the default state', () => {
    expect(calendarFiltersAreDefault(DEFAULT_CALENDAR_FILTERS)).toBe(true);
    expect(calendarFiltersAreDefault({ ...DEFAULT_CALENDAR_FILTERS, workingHoursOnly: true })).toBe(false);
    expect(calendarFiltersAreDefault({ ...DEFAULT_CALENDAR_FILTERS, visibleCalendarIdsState: [] })).toBe(false);
  });
});
