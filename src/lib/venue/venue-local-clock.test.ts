/**
 * Venue wall clock to UTC (SA-H1).
 *
 * The function these tests cover replaced `venueLocalDateTimeToUtcMs`, which
 * probed a 15-minute grid outward from noon UTC and returned NOON when nothing
 * matched. Since every real IANA offset is a multiple of 15 minutes, only wall
 * times ending :00, :15, :30 and :45 could ever match, so 1344 of the 1440
 * minutes in a day resolved to noon. A 09:35 appointment's two-hour reminder was
 * computed against noon and therefore fired after the appointment had started.
 *
 * There was no test on this file at all, which is why a 93%-wrong function
 * survived. The minute sweep below exists so that can never be true again: it
 * asserts every minute of a day round-trips, not a handful of samples.
 */

import { describe, expect, it } from 'vitest';
import {
  endOfCaptureDayInVenueTimezone,
  endOfLocalDayForYmd,
  formatYmdInTimezone,
  getVenueLocalDateAndMinutes,
  venueLocalWallTimeToUtcMs,
} from '@/lib/venue/venue-local-clock';

const TZ = 'Europe/London';

/** The wall time a UTC instant reads as in `TZ`, for round-trip assertions. */
function wallAt(utcMs: number, timeZone = TZ): string {
  const { minutesSinceMidnight } = getVenueLocalDateAndMinutes(timeZone, new Date(utcMs));
  const hh = String(Math.floor(minutesSinceMidnight / 60)).padStart(2, '0');
  const mm = String(minutesSinceMidnight % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

describe('venueLocalWallTimeToUtcMs — on-grid times the old probe also got right', () => {
  it('resolves a summer (BST) wall time one hour behind UTC', () => {
    expect(venueLocalWallTimeToUtcMs('2026-07-10', '09:30', TZ)).toBe(
      Date.parse('2026-07-10T08:30:00.000Z'),
    );
  });

  it('resolves a winter (GMT) wall time as UTC', () => {
    expect(venueLocalWallTimeToUtcMs('2026-01-10', '09:30', TZ)).toBe(
      Date.parse('2026-01-10T09:30:00.000Z'),
    );
  });

  it('resolves midnight to the previous UTC day under BST', () => {
    expect(venueLocalWallTimeToUtcMs('2026-07-10', '00:00', TZ)).toBe(
      Date.parse('2026-07-09T23:00:00.000Z'),
    );
  });
});

describe('venueLocalWallTimeToUtcMs — off-grid times, which used to return noon', () => {
  /**
   * The failure that gave this finding its name. Under the old probe this
   * returned 12:00Z, so a two-hour reminder for an 09:35 appointment was
   * scheduled for 10:00Z: an hour and a half AFTER the guest had arrived.
   */
  it('resolves :35 exactly rather than falling back to noon', () => {
    expect(venueLocalWallTimeToUtcMs('2026-07-10', '09:35', TZ)).toBe(
      Date.parse('2026-07-10T08:35:00.000Z'),
    );
  });

  /** A day whose hours open at 09:05 makes EVERY generated slot off-grid. */
  it('resolves :05 exactly', () => {
    expect(venueLocalWallTimeToUtcMs('2026-07-10', '09:05', TZ)).toBe(
      Date.parse('2026-07-10T08:05:00.000Z'),
    );
  });

  /** Staff drag snaps to one minute, which the help article tells them to use. */
  it('resolves a one-minute offset exactly', () => {
    expect(venueLocalWallTimeToUtcMs('2026-07-10', '14:01', TZ)).toBe(
      Date.parse('2026-07-10T13:01:00.000Z'),
    );
  });

  it('resolves off-grid winter times too', () => {
    expect(venueLocalWallTimeToUtcMs('2026-01-10', '09:35', TZ)).toBe(
      Date.parse('2026-01-10T09:35:00.000Z'),
    );
  });

  /**
   * Late evening was the worst case in absolute terms: the old probe put a
   * 23:50 booking almost eleven hours earlier than it really was.
   */
  it('resolves a late-evening time exactly', () => {
    expect(venueLocalWallTimeToUtcMs('2026-07-10', '23:50', TZ)).toBe(
      Date.parse('2026-07-10T22:50:00.000Z'),
    );
  });
});

describe('venueLocalWallTimeToUtcMs — DST transition days', () => {
  // UK 2026: clocks forward 29 March, back 25 October.

  it('resolves an ordinary time on the spring-forward day', () => {
    expect(venueLocalWallTimeToUtcMs('2026-03-29', '09:30', TZ)).toBe(
      Date.parse('2026-03-29T08:30:00.000Z'),
    );
  });

  it('resolves an off-grid time on the spring-forward day', () => {
    expect(venueLocalWallTimeToUtcMs('2026-03-29', '09:35', TZ)).toBe(
      Date.parse('2026-03-29T08:35:00.000Z'),
    );
  });

  /**
   * 01:30 does not exist on this date: the clocks jump 01:00 to 02:00. Pinned
   * rather than asserted as "correct" — it maps to the instant the clocks
   * skipped to, which is the documented contract.
   */
  it('maps a nonexistent spring-forward wall time to the instant clocks skipped to', () => {
    expect(venueLocalWallTimeToUtcMs('2026-03-29', '01:30', TZ)).toBe(
      Date.parse('2026-03-29T01:30:00.000Z'),
    );
  });

  it('resolves an ordinary time on the autumn-back day', () => {
    expect(venueLocalWallTimeToUtcMs('2026-10-25', '09:30', TZ)).toBe(
      Date.parse('2026-10-25T09:30:00.000Z'),
    );
  });

  it('resolves an off-grid time on the autumn-back day', () => {
    expect(venueLocalWallTimeToUtcMs('2026-10-25', '09:35', TZ)).toBe(
      Date.parse('2026-10-25T09:35:00.000Z'),
    );
  });

  /**
   * 01:30 happens TWICE on this date. This resolves to the second occurrence,
   * after the clocks go back; most date libraries default to the first.
   *
   * This is the one case where the deleted grid probe and this function
   * disagree on an ON-grid time — the probe walked upward from the previous
   * day and so found the earlier one. Pinned deliberately: it is a single
   * repeated hour a year in the middle of the night, `cancellation-deadline`
   * has shipped on this behaviour, and a known answer beats an accidental one.
   */
  it('pins the ambiguous autumn wall time to the second occurrence', () => {
    expect(venueLocalWallTimeToUtcMs('2026-10-25', '01:30', TZ)).toBe(
      Date.parse('2026-10-25T01:30:00.000Z'),
    );
  });
});

describe('venueLocalWallTimeToUtcMs — every minute, not just samples', () => {
  /**
   * The regression guard. The old probe passed every on-grid spot check anyone
   * would think to write and was wrong for 93% of the day; only an exhaustive
   * sweep distinguishes the two.
   */
  it('round-trips all 1440 minutes of an ordinary BST day', () => {
    const date = '2026-07-10';
    const wrong: string[] = [];
    for (let m = 0; m < 1440; m++) {
      const hm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      const utcMs = venueLocalWallTimeToUtcMs(date, hm, TZ);
      if (wallAt(utcMs) !== hm || formatYmdInTimezone(utcMs, TZ) !== date) wrong.push(hm);
    }
    expect(wrong).toEqual([]);
  });

  it('round-trips all 1440 minutes of an ordinary GMT day', () => {
    const date = '2026-01-10';
    const wrong: string[] = [];
    for (let m = 0; m < 1440; m++) {
      const hm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      const utcMs = venueLocalWallTimeToUtcMs(date, hm, TZ);
      if (wallAt(utcMs) !== hm || formatYmdInTimezone(utcMs, TZ) !== date) wrong.push(hm);
    }
    expect(wrong).toEqual([]);
  });

  /**
   * The autumn day round-trips for all 1440 minutes, including the repeated
   * hour, which is worth stating because it is easy to assume otherwise.
   * Ambiguity does not break a round trip: the function picks one of the two
   * instants consistently, and that instant reads back as the wall time asked
   * for. What ambiguity costs is the ability to ADDRESS the other instant, not
   * round-trip fidelity. The choice of which one is pinned separately above.
   */
  it('round-trips all 1440 minutes of the autumn transition day', () => {
    const date = '2026-10-25';
    const wrong: string[] = [];
    for (let m = 0; m < 1440; m++) {
      const hm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      const utcMs = venueLocalWallTimeToUtcMs(date, hm, TZ);
      if (wallAt(utcMs) !== hm || formatYmdInTimezone(utcMs, TZ) !== date) wrong.push(hm);
    }
    expect(wrong).toEqual([]);
  });
});

describe('venueLocalWallTimeToUtcMs — other zones', () => {
  it('handles a zone east of UTC', () => {
    expect(venueLocalWallTimeToUtcMs('2026-07-10', '09:35', 'Europe/Dublin')).toBe(
      Date.parse('2026-07-10T08:35:00.000Z'),
    );
  });

  /** A 30-minute offset: on-grid for the old probe, which is why it hid there. */
  it('handles a half-hour offset zone', () => {
    expect(venueLocalWallTimeToUtcMs('2026-07-10', '09:35', 'Asia/Kolkata')).toBe(
      Date.parse('2026-07-10T04:05:00.000Z'),
    );
  });
});

describe('endOfLocalDayForYmd', () => {
  it('ends a BST day one hour before UTC midnight', () => {
    // 2026-05-18 is BST (UTC+1): the day ends at 2026-05-19T00:00 BST = 2026-05-18T23:00Z.
    expect(endOfLocalDayForYmd('2026-05-18', TZ).toISOString()).toBe('2026-05-18T22:59:59.999Z');
  });

  it('ends a GMT day at UTC midnight', () => {
    expect(endOfLocalDayForYmd('2026-11-05', TZ).toISOString()).toBe('2026-11-05T23:59:59.999Z');
  });

  it('handles both DST transition days', () => {
    // Spring forward (2026-03-29): the day ends in BST, so an hour before UTC midnight.
    expect(endOfLocalDayForYmd('2026-03-29', TZ).toISOString()).toBe('2026-03-29T22:59:59.999Z');
    // Autumn back (2026-10-25): the day ends in GMT, so at UTC midnight, and is 25h long.
    expect(endOfLocalDayForYmd('2026-10-25', TZ).toISOString()).toBe('2026-10-25T23:59:59.999Z');
  });

  it('honours other zones and falls back to Europe/London on a blank one', () => {
    // New York on 2026-05-18 is EDT (UTC-4).
    expect(endOfLocalDayForYmd('2026-05-18', 'America/New_York').toISOString()).toBe(
      '2026-05-19T03:59:59.999Z',
    );
    expect(endOfLocalDayForYmd('2026-05-18', 'UTC').toISOString()).toBe('2026-05-18T23:59:59.999Z');
    expect(endOfLocalDayForYmd('2026-05-18', '  ').toISOString()).toBe(
      endOfLocalDayForYmd('2026-05-18', TZ).toISOString(),
    );
  });

  it('agrees with endOfCaptureDayInVenueTimezone for the day an instant falls on', () => {
    // 2026-05-18T23:30Z is already 2026-05-19 in London (BST), so the capture day is the 19th.
    const lateEvening = new Date('2026-05-18T23:30:00Z');
    expect(endOfCaptureDayInVenueTimezone(lateEvening, TZ).toISOString()).toBe(
      endOfLocalDayForYmd('2026-05-19', TZ).toISOString(),
    );
    const midday = new Date('2026-05-18T12:00:00Z');
    expect(endOfCaptureDayInVenueTimezone(midday, TZ).toISOString()).toBe(
      endOfLocalDayForYmd('2026-05-18', TZ).toISOString(),
    );
  });
});
