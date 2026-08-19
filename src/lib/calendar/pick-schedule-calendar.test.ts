import { describe, it, expect } from 'vitest';
import { pickScheduleCalendarId, type SelectableCalendar } from '@/lib/calendar/pick-schedule-calendar';

/**
 * The regression this file exists for: a selected resource being silently swapped for a
 * staff calendar after a save, so the next edit rewrote the wrong calendar's hours.
 */

const ANDREW: SelectableCalendar = { id: 'andrew', calendar_type: 'practitioner', staffIds: ['staff-1'] };
const DAVID: SelectableCalendar = { id: 'david', calendar_type: 'practitioner', staffIds: ['staff-2'] };
const ROOM: SelectableCalendar = { id: 'room', calendar_type: 'resource' };
const ALL = [ANDREW, ROOM, DAVID];

describe('pickScheduleCalendarId', () => {
  /** The bug, pinned. Losing this makes a save rewrite a different calendar's hours. */
  it('KEEPS a selected resource across a reload', () => {
    expect(pickScheduleCalendarId({ previous: 'room', calendars: ALL })).toBe('room');
  });

  it('keeps a selected staff calendar across a reload', () => {
    expect(pickScheduleCalendarId({ previous: 'david', calendars: ALL })).toBe('david');
  });

  it('keeps a resource even when the viewer has their own staff calendar', () => {
    expect(pickScheduleCalendarId({ previous: 'room', calendars: ALL, currentStaffId: 'staff-1' })).toBe('room');
  });

  it('prefers the viewer own calendar for a FRESH selection', () => {
    expect(pickScheduleCalendarId({ previous: null, calendars: ALL, currentStaffId: 'staff-2' })).toBe('david');
  });

  it('prefers a staff calendar over a resource for a fresh selection, whatever the order', () => {
    expect(pickScheduleCalendarId({ previous: null, calendars: [ROOM, ANDREW] })).toBe('andrew');
  });

  it('falls back to a resource only when there is no staff calendar at all', () => {
    expect(pickScheduleCalendarId({ previous: null, calendars: [ROOM] })).toBe('room');
  });

  it('drops a stale selection that no longer exists', () => {
    expect(pickScheduleCalendarId({ previous: 'deleted', calendars: ALL })).toBe('andrew');
  });

  it('returns empty string when there are no calendars', () => {
    expect(pickScheduleCalendarId({ previous: 'room', calendars: [] })).toBe('');
  });

  it('treats a calendar with no type as a staff calendar', () => {
    expect(pickScheduleCalendarId({ previous: null, calendars: [{ id: 'untyped' }] })).toBe('untyped');
  });
});
