import { describe, it, expect } from 'vitest';
import { evaluateEventLeaveConflict } from '@/lib/experience-events/event-leave-conflict';
import { evaluateClassWindowAvailabilityConflict } from '@/lib/calendar/class-schedule-availability-conflicts';

/**
 * §1.2 item 24: event creation never checked staff leave, while class creation always did.
 *
 * The point of these fixtures is not that leave blocks an event, which is obvious. It is
 * that events and classes now REFUSE THE SAME WINDOWS, since the whole defect was one venue
 * getting two different answers depending on what it was scheduling.
 */

/** A Wednesday. */
const DATE = '2030-06-05';

function ev(leavePeriods: Array<{ unavailable_start_time: string | null; unavailable_end_time: string | null }>) {
  return evaluateEventLeaveConflict({
    date: DATE,
    startHHmm: '14:00',
    endHHmm: '16:00',
    calendarName: 'Dana',
    leavePeriods,
  });
}

describe('evaluateEventLeaveConflict', () => {
  it('allows the window when there is no leave', () => {
    expect(ev([])).toBeNull();
  });

  it('refuses a whole-day leave period, naming the calendar and the date', () => {
    const err = ev([{ unavailable_start_time: null, unavailable_end_time: null }]);

    expect(err).toBe(
      'Dana is on leave (marked unavailable all day) on Wed 5 Jun 2030. Choose another day or remove the leave.',
    );
  });

  it('refuses a partial window that overlaps the event', () => {
    const err = ev([{ unavailable_start_time: '15:00', unavailable_end_time: '17:00' }]);

    expect(err).toBe(
      'Dana is on leave from 15:00 to 17:00 on Wed 5 Jun 2030, which clashes with this event time.',
    );
  });

  it('allows a partial window that ends exactly when the event starts', () => {
    expect(ev([{ unavailable_start_time: '12:00', unavailable_end_time: '14:00' }])).toBeNull();
  });

  it('allows a partial window that starts exactly when the event ends', () => {
    expect(ev([{ unavailable_start_time: '16:00', unavailable_end_time: '18:00' }])).toBeNull();
  });

  it('ignores an inverted time pair rather than refusing the day', () => {
    expect(ev([{ unavailable_start_time: '17:00', unavailable_end_time: '15:00' }])).toBeNull();
  });

  it('falls back to a generic subject when the calendar has no name', () => {
    const err = evaluateEventLeaveConflict({
      date: DATE,
      startHHmm: '14:00',
      endHHmm: '16:00',
      calendarName: null,
      leavePeriods: [{ unavailable_start_time: null, unavailable_end_time: null }],
    });

    expect(err).toMatch(/^This calendar is on leave/);
  });

  /** House style: no em-dashes in anything a user can read. */
  it('uses no em-dash in any refusal message', () => {
    const messages = [
      ev([{ unavailable_start_time: null, unavailable_end_time: null }]),
      ev([{ unavailable_start_time: '15:00', unavailable_end_time: '17:00' }]),
    ];

    for (const m of messages) {
      expect(m).not.toBeNull();
      expect(m).not.toContain('—');
    }
  });
});

describe('events and classes now refuse the same leave windows (§1.2 item 24)', () => {
  const CASES: Array<{ name: string; leave: { unavailable_start_time: string | null; unavailable_end_time: string | null } }> = [
    { name: 'whole-day leave', leave: { unavailable_start_time: null, unavailable_end_time: null } },
    { name: 'overlapping partial leave', leave: { unavailable_start_time: '15:00', unavailable_end_time: '17:00' } },
    { name: 'leave ending as the window starts', leave: { unavailable_start_time: '12:00', unavailable_end_time: '14:00' } },
    { name: 'leave starting as the window ends', leave: { unavailable_start_time: '16:00', unavailable_end_time: '18:00' } },
  ];

  for (const c of CASES) {
    it(`agrees on ${c.name}`, () => {
      const eventErr = ev([c.leave]);

      const classErr = evaluateClassWindowAvailabilityConflict({
        date: DATE,
        startMin: 14 * 60,
        endMin: 16 * 60,
        calendarName: 'Dana',
        // Venue wide open, so only the leave rule can speak here.
        openingHours: { '3': { periods: [{ open: '00:00', close: '23:59' }] } },
        venueWideBlocks: [],
        leavePeriods: [c.leave],
        daysOff: [],
        breakTimes: null,
        breakTimesByDay: null,
        blockedRanges: [],
      });

      // Same verdict, and where both refuse, the same subject and shape of reason.
      expect(eventErr === null).toBe(classErr === null);
      if (eventErr && classErr) {
        expect(eventErr.startsWith('Dana is on leave')).toBe(true);
        expect(classErr.startsWith('Dana is on leave')).toBe(true);
      }
    });
  }
});
