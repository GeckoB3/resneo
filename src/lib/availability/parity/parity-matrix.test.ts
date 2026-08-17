import { describe, it, expect } from 'vitest';
import { getDayOfWeek } from '@/lib/availability/engine';
import {
  appointmentStarts,
  block,
  classOffered,
  configuredButClosedOn,
  eventOffered,
  hostCalendar,
  openOn,
  resourceStarts,
  venueResolution,
  venueWriteGate,
  type SchedulingWorld,
} from '@/lib/availability/parity/scheduling-world';

/**
 * Stage 0b: the parity matrix.
 *
 * Every expectation here describes what the code does **today**, divergences included.
 * Several of these assertions are pinning behaviour the resolver plan calls a defect, and
 * they are written that way on purpose: the plan's stages are reviewed as diffs against
 * this file, so a stage that changes a cell must change its expectation and say why.
 *
 * Each block names the plan item it pins. When a stage lands, update the expectation in
 * the same commit as the code.
 *
 * See Docs/Resneo_Scheduling_Resolver_Plan_August_2026.md §1.2, §5 and Stage 0b.
 */

/** A Wednesday, far enough out that no past-slot or notice filter fires. */
const DATE = '2030-06-05';
const DK = String(getDayOfWeek(DATE));
const NINE_TO_FIVE = { [DK]: [{ start: '09:00', end: '17:00' }] };

function world(over: Partial<SchedulingWorld> & { name: string }): SchedulingWorld {
  return {
    date: DATE,
    venueOpeningHours: openOn(DATE, [{ open: '09:00', close: '17:00' }]),
    venueBlocks: [],
    workingHours: NINE_TO_FIVE,
    durationMinutes: 60,
    instance: { start: '10:00', end: '11:00' },
    ...over,
  };
}

const HOURLY_9_TO_5 = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00'];

describe('parity matrix / baseline', () => {
  it('agrees across every consumer when nothing unusual is configured', () => {
    const w = world({ name: 'plain open day' });

    expect(appointmentStarts(w)).toEqual(HOURLY_9_TO_5);
    expect(resourceStarts(w)).toEqual(HOURLY_9_TO_5);
    expect(classOffered(w)).toBe(true);
    expect(eventOffered(w)).toBe(true);
    expect(venueResolution(w)).toEqual({ kind: 'allowed', ranges: ['09:00-17:00'] });
    expect(venueWriteGate(w)).toBeNull();
  });

  it('treats absent weekly hours as unrestricted, so only calendar hours bound the day', () => {
    const w = world({ name: 'no venue hours', venueOpeningHours: null });

    expect(venueResolution(w)).toEqual({ kind: 'unrestricted', ranges: [] });
    expect(appointmentStarts(w)).toEqual(HOURLY_9_TO_5);
    expect(resourceStarts(w)).toEqual(HOURLY_9_TO_5);
    expect(venueWriteGate(w)).toBeNull();
  });
});

describe('parity matrix / weekly-closed weekday (plan §1.2 items 7 and 16)', () => {
  const w = world({
    name: 'configured venue, no periods this weekday, no blocks',
    venueOpeningHours: configuredButClosedOn(DATE, [{ open: '09:00', close: '17:00' }]),
  });

  it('resolves closed, and appointments and resources offer nothing', () => {
    expect(venueResolution(w)).toEqual({ kind: 'closed', ranges: [] });
    expect(appointmentStarts(w)).toEqual([]);
    expect(resourceStarts(w)).toEqual([]);
  });

  /**
   * PINS A LIVE DEFECT (plan §1.2 item 16). The class engine short-circuits on
   * `dayBlocks.length === 0` and the event engine carves this case out via
   * `isWeeklyScheduleClosedForDate`, so both sell the instance. The create gate refuses it.
   * Guest is offered the session and then rejected at checkout.
   *
   * Stage 2 closes this by making read and write agree. Decision (H) settles which way:
   * events keep the allowance, so it is the WRITE gate that must move for events.
   */
  it('DIVERGES: class and event listings sell it while the create gate refuses it', () => {
    expect(classOffered(w)).toBe(true);
    expect(eventOffered(w)).toBe(true);
    expect(venueWriteGate(w)).toBe('The venue is closed for this date or time.');
  });
});

describe('parity matrix / amended hours (plan §1.2 items 1 and 2)', () => {
  /**
   * PINS DEFECT #1. `resolveVenueWideAllowedMinuteRanges` returns `closed` for a weekday
   * with no periods before it ever looks at amended hours, so only appointments (which
   * resolve through the legacy exception path, where amended REPLACES) honour it.
   * Stage 3 makes every consumer behave the way appointments already do.
   */
  it('DIVERGES: amended hours open a weekly-closed day for appointments only', () => {
    const w = world({
      name: 'amended hours on a weekly-closed weekday',
      venueOpeningHours: configuredButClosedOn(DATE, [{ open: '09:00', close: '17:00' }]),
      venueBlocks: [
        block({
          block_type: 'amended_hours',
          date_start: DATE,
          date_end: DATE,
          override_periods: [{ open: '10:00', close: '14:00' }],
        }),
      ],
      workingHours: { [DK]: [{ start: '08:00', end: '20:00' }] },
    });

    expect(appointmentStarts(w)).toEqual(['10:00', '11:00', '12:00', '13:00']);
    expect(venueResolution(w)).toEqual({ kind: 'closed', ranges: [] });
    expect(resourceStarts(w)).toEqual([]);
    expect(classOffered(w)).toBe(false);
    expect(eventOffered(w)).toBe(false);
  });

  /**
   * PINS DEFECT #2. Amended hours REPLACE for appointments and INTERSECT for everyone
   * else, so an override that extends beyond the weekly hours is honoured on one path
   * and clipped on the others.
   */
  it('DIVERGES: an override extending past closing is honoured by appointments, clipped elsewhere', () => {
    const w = world({
      name: 'amended 08:00-20:00 over a 09:00-17:00 weekly',
      venueBlocks: [
        block({
          block_type: 'amended_hours',
          date_start: DATE,
          date_end: DATE,
          override_periods: [{ open: '08:00', close: '20:00' }],
        }),
      ],
      workingHours: { [DK]: [{ start: '08:00', end: '20:00' }] },
    });

    expect(appointmentStarts(w)).toEqual([
      '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00',
    ]);
    expect(venueResolution(w)).toEqual({ kind: 'allowed', ranges: ['09:00-17:00'] });
    expect(resourceStarts(w)).toEqual(HOURLY_9_TO_5);
  });

  /**
   * PINS DEFECT #17, and it is the one that moves availability in BOTH directions.
   * An amended row with no periods is dropped by `blocksToVenueOpeningExceptions`
   * (appointments sell the day) and closes the whole day everywhere else. Production
   * has zero such rows (query Q3), and Stage 1 item 3 stops new ones appearing.
   */
  it('DIVERGES: an empty override is ignored by appointments and closes the day elsewhere', () => {
    const w = world({
      name: 'amended_hours with no periods',
      venueBlocks: [
        block({ block_type: 'amended_hours', date_start: DATE, date_end: DATE, override_periods: [] }),
      ],
    });

    expect(appointmentStarts(w)).toEqual(HOURLY_9_TO_5);
    expect(venueResolution(w)).toEqual({ kind: 'closed', ranges: [] });
    expect(resourceStarts(w)).toEqual([]);
    expect(classOffered(w)).toBe(false);
    expect(eventOffered(w)).toBe(false);
  });

  /**
   * PINS DEFECT #19, half-closed, and sizes decision (E).
   *
   * Stage 1 item 6 merged the resolver's output, so overlapping ranges no longer escape and
   * the duplicate-slot bug is gone. What remains is the SEMANTIC half: the periods of every
   * amended block on the date are still concatenated, so a one-day 10:00-14:00 override
   * nested inside a three-month 08:00-20:00 one does not narrow that day. It widens to the
   * union instead, silently and with no error.
   *
   * Decision (E) replaces the concat with most-specific-wins, in Stage 3. When that lands
   * this expectation becomes `['10:00-14:00']`.
   */
  it('DIVERGES: a nested override widens to the union instead of narrowing the day', () => {
    const w = world({
      name: 'one-day override nested in a long one',
      venueBlocks: [
        block({
          block_type: 'amended_hours',
          date_start: '2030-06-01',
          date_end: '2030-06-30',
          override_periods: [{ open: '08:00', close: '20:00' }],
        }),
        block({
          block_type: 'amended_hours',
          date_start: DATE,
          date_end: DATE,
          override_periods: [{ open: '10:00', close: '14:00' }],
        }),
      ],
    });

    const res = venueResolution(w);
    expect(res.kind).toBe('allowed');
    // Merged, so no duplicate start times reach a guest. But the nested 10:00-14:00
    // override has been absorbed rather than applied: the day is still the wider window.
    expect(res.ranges).toEqual(['09:00-17:00']);
    expect(res.ranges).not.toContain('10:00-14:00');
  });

  it('emits no duplicate start times when two amended blocks overlap', () => {
    const w = world({
      name: 'two overlapping overrides',
      venueOpeningHours: null,
      venueBlocks: [
        block({
          block_type: 'amended_hours',
          date_start: DATE,
          date_end: DATE,
          override_periods: [{ open: '09:00', close: '13:00' }],
        }),
        block({
          block_type: 'amended_hours',
          date_start: DATE,
          date_end: DATE,
          override_periods: [{ open: '11:00', close: '15:00' }],
        }),
      ],
      workingHours: { [DK]: [{ start: '08:00', end: '20:00' }] },
    });

    const starts = resourceStarts(w);
    expect(starts).toEqual([...new Set(starts)]);
    expect(starts).toEqual(['09:00', '10:00', '11:00', '12:00', '13:00', '14:00']);
  });
});

describe('parity matrix / closures (plan §1.2 item 3)', () => {
  /**
   * PINS DEFECT #3. `blocksToVenueOpeningExceptions` discards `time_start`/`time_end`, so a
   * part-day closure removes the whole appointment day while narrowing it everywhere else.
   * Stage 3 makes appointments subtract too.
   */
  it('DIVERGES: a part-day closure closes the whole appointment day but only narrows the rest', () => {
    const w = world({
      name: 'closed 12:00-13:00',
      venueBlocks: [
        block({ block_type: 'closed', date_start: DATE, date_end: DATE, time_start: '12:00', time_end: '13:00' }),
      ],
    });

    expect(appointmentStarts(w)).toEqual([]);
    expect(venueResolution(w)).toEqual({ kind: 'allowed', ranges: ['09:00-12:00', '13:00-17:00'] });
    expect(resourceStarts(w)).toEqual(['09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00']);
  });

  it('closes every consumer for a whole-day closure, which is the one case they all agree on', () => {
    const w = world({
      name: 'closed all day',
      venueBlocks: [block({ block_type: 'closed', date_start: DATE, date_end: DATE })],
    });

    expect(appointmentStarts(w)).toEqual([]);
    expect(resourceStarts(w)).toEqual([]);
    expect(classOffered(w)).toBe(false);
    expect(eventOffered(w)).toBe(false);
    expect(venueResolution(w)).toEqual({ kind: 'closed', ranges: [] });
    expect(venueWriteGate(w)).toBe('The venue is closed for this date or time.');
  });

  /**
   * PINS the `time_end <= time_start` shape called out in query Q1. Today it closes the
   * whole appointment day (the adapter ignores the times) and imposes NO constraint on the
   * other paths (`venue-wide-business-hours.ts` requires `end > start`). After Stage 3 the
   * appointment day reopens completely, which is the maximal widening in the plan.
   */
  it('DIVERGES: an inverted closure window closes appointments and constrains nothing else', () => {
    const w = world({
      name: 'closed 13:00-12:00 (inverted)',
      venueBlocks: [
        block({ block_type: 'closed', date_start: DATE, date_end: DATE, time_start: '13:00', time_end: '12:00' }),
      ],
    });

    expect(appointmentStarts(w)).toEqual([]);
    expect(venueResolution(w)).toEqual({ kind: 'allowed', ranges: ['09:00-17:00'] });
    expect(resourceStarts(w)).toEqual(HOURLY_9_TO_5);
  });

  it('applies a multi-day closure range to a date inside it', () => {
    const w = world({
      name: 'closed across a range',
      venueBlocks: [block({ block_type: 'closed', date_start: '2030-06-01', date_end: '2030-06-10' })],
    });

    expect(venueResolution(w)).toEqual({ kind: 'closed', ranges: [] });
    expect(appointmentStarts(w)).toEqual([]);
    expect(classOffered(w)).toBe(false);
  });
});

describe('parity matrix / breaks (plan §1.2 item 6, decision A)', () => {
  const breaks = [{ start: '12:00', end: '12:45' }];

  /**
   * THE CENTRAL DIVERGENCE, and the reason every probe in this harness returns an ordered
   * list rather than a boolean. Appointments VETO a break: the candidate covering it is
   * dropped and the rest of the grid keeps its alignment. A hosted resource SUBTRACTS it:
   * the range splits and every later slot re-anchors to the break's end.
   *
   * Decision (A) unifies on veto, so it is the RESOURCE list below that changes at Stage 5.
   * A boolean matrix would show both engines as "has availability" and see nothing.
   */
  it('DIVERGES: appointments veto the break, hosted resources re-anchor after it', () => {
    const w = world({ name: 'lunch break 12:00-12:45', breakTimes: breaks });

    expect(appointmentStarts(w)).toEqual(['09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00']);
    expect(resourceStarts(w, hostCalendar(w))).toEqual([
      '09:00', '10:00', '11:00', '12:45', '13:45', '14:45', '15:45',
    ]);
  });

  it('leaves an unhosted resource untouched by the calendar break, since it has no host', () => {
    const w = world({ name: 'break, standalone resource', breakTimes: breaks });
    expect(resourceStarts(w)).toEqual(HOURLY_9_TO_5);
  });
});

describe('parity matrix / calendar closures and days_off (plan §1.2 item 18)', () => {
  it('honours an ISO date in days_off as a closed day', () => {
    const w = world({ name: 'days_off ISO date', daysOff: [DATE] });
    expect(appointmentStarts(w)).toEqual([]);
    expect(resourceStarts(w, hostCalendar(w))).toEqual([]);
  });

  /**
   * PINS DEFECT #18. A lowercase weekday name in `days_off` is a PERMANENT recurring
   * closure, honoured by the appointment and resource paths. The target model cannot
   * express it. Production carries none (query Q5) and Stage 1 item 8 closes the write
   * surface that could create one.
   */
  it('honours a recurring weekday name in days_off, which the target model cannot express', () => {
    const dayName = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][getDayOfWeek(DATE)]!;
    const w = world({ name: 'days_off weekday name', daysOff: [dayName] });

    expect(dayName).toBe('wed');
    expect(appointmentStarts(w)).toEqual([]);
    expect(resourceStarts(w, hostCalendar(w))).toEqual([]);
  });

  /**
   * Partial leave arrives as a blocked range of kind `leave` and is VETOED, so the grid
   * keeps its alignment. Plan §2.4 requires this to stay a veto: subtracting it at Stage 6
   * would move every slot after every leave window, which is the §2.7 harm on another rule.
   */
  it('vetoes partial leave without re-anchoring the slots after it', () => {
    const w = world({
      name: 'partial leave 12:00-13:00',
      blockedRanges: [{ practitioner_id: 'cal-1', start: 720, end: 780, kind: 'leave' }],
    });

    expect(appointmentStarts(w)).toEqual(['09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00']);
  });

  it('vetoes an ad-hoc calendar block the same way', () => {
    const w = world({
      name: 'blocked time 12:00-13:00',
      blockedRanges: [{ practitioner_id: 'cal-1', start: 720, end: 780, kind: 'blocked_time' }],
    });

    expect(appointmentStarts(w)).toEqual(['09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00']);
  });
});

describe('parity matrix / weekly hours shapes (plan §2.3 step 1)', () => {
  it('treats a venue that saved only one weekday as closed on every other one', () => {
    const w = world({
      name: 'one weekday key only',
      venueOpeningHours: configuredButClosedOn(DATE, [{ open: '09:00', close: '17:00' }]),
    });
    expect(venueResolution(w)).toEqual({ kind: 'closed', ranges: [] });
  });

  it('treats {closed:true} the same as a missing weekday', () => {
    const w = world({
      name: 'weekday marked closed',
      venueOpeningHours: { [DK]: { closed: true } } as never,
    });
    expect(venueResolution(w)).toEqual({ kind: 'closed', ranges: [] });
  });

  it('treats an empty periods array the same as a missing weekday', () => {
    const w = world({
      name: 'weekday with empty periods',
      venueOpeningHours: { [DK]: { periods: [] } } as never,
    });
    expect(venueResolution(w)).toEqual({ kind: 'closed', ranges: [] });
  });

  it('reads the legacy {open, close} shape as a single period', () => {
    const w = world({
      name: 'legacy open/close',
      venueOpeningHours: { [DK]: { open: '10:00', close: '15:00' } } as never,
    });
    expect(venueResolution(w)).toEqual({ kind: 'allowed', ranges: ['10:00-15:00'] });
  });
});

describe('parity matrix / special_event (plan §1.2 item 9)', () => {
  it('treats special_event as closure-like in the venue resolver', () => {
    const w = world({
      name: 'special_event whole day',
      venueBlocks: [block({ block_type: 'special_event', date_start: DATE, date_end: DATE })],
    });

    expect(venueResolution(w)).toEqual({ kind: 'closed', ranges: [] });
    expect(classOffered(w)).toBe(false);
    expect(appointmentStarts(w)).toEqual([]);
  });
});

describe('parity matrix / past-midnight instances (plan §1.2 item 12)', () => {
  /**
   * Events store an absolute wall-clock end, so a 22:00-01:00 event arrives as
   * end=60 < start=1320. Before Stage 1 item 7 the coverage check failed outright and the
   * event vanished with no error. It is now treated as crossing midnight, matching the
   * class engine, and judged by whether its START falls inside an open range.
   *
   * No write path can create such a row today, so this is defensive cover for imported or
   * hand-inserted data. Past-midnight opening HOURS remain unsupported (plan §2.2).
   */
  it('offers a past-midnight event whose start is inside opening hours', () => {
    const w = world({
      name: 'event 22:00-01:00, venue open to 23:00',
      venueOpeningHours: openOn(DATE, [{ open: '09:00', close: '23:00' }]),
      instance: { start: '22:00', end: '01:00' },
    });

    expect(eventOffered(w)).toBe(true);
  });

  it('still hides a past-midnight event whose start is outside opening hours', () => {
    const w = world({
      name: 'event 22:00-01:00, venue closes 17:00',
      instance: { start: '22:00', end: '01:00' },
    });

    expect(eventOffered(w)).toBe(false);
  });

  it('agrees with the class engine on the same window', () => {
    const w = world({
      name: 'class 22:00-01:00, venue open to 23:00',
      venueOpeningHours: openOn(DATE, [{ open: '09:00', close: '23:00' }]),
      venueBlocks: [block({ block_type: 'closed', date_start: DATE, date_end: DATE, time_start: '02:00', time_end: '03:00' })],
      instance: { start: '22:00', end: '01:00' },
    });

    expect(classOffered(w)).toBe(true);
    expect(eventOffered(w)).toBe(true);
  });
});
