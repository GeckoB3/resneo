import { describe, it, expect } from 'vitest';
import { getDayOfWeek } from '@/lib/availability/engine';
import {
  appointmentAcceptsStart,
  appointmentStarts,
  block,
  classOffered,
  configuredButClosedOn,
  eventOffered,
  openOn,
  instanceWriteGate,
  venueWriteGate,
  type SchedulingWorld,
} from '@/lib/availability/parity/scheduling-world';

/**
 * Stage 0b, second property: read and write are asserted as a PAIR.
 *
 * A matrix over read engines cannot see "the guest is offered the slot and create rejects
 * it". That failure is live today for classes and events, and it is the exact shape a
 * partially-applied Stage 3 would produce on other paths. So for every fixture the
 * question is: does the gate that will run at checkout accept what the listing offered?
 *
 * Scope limit, stated honestly. These pairs are asserted at HELPER level -- against
 * `validateExactAppointmentStart` and `venueWideBlocksRejectBookingWindow` directly --
 * because `booking/create/route.ts` is 2163 lines with no test file and the house route-test
 * pattern mocks the engines out wholesale. That means this file proves the two functions
 * agree; it does NOT prove the route calls the right one for a given calendar type, which is
 * plan §1.2 item 14 and remains a hand-review item in Stages 2 and 5.
 *
 * See Docs/Resneo_Scheduling_Resolver_Plan_August_2026.md Stage 0b and §5 regression class 4.
 */

const DATE = '2030-06-05';
const DK = String(getDayOfWeek(DATE));

function world(over: Partial<SchedulingWorld> & { name: string }): SchedulingWorld {
  return {
    date: DATE,
    venueOpeningHours: openOn(DATE, [{ open: '09:00', close: '17:00' }]),
    venueBlocks: [],
    workingHours: { [DK]: [{ start: '09:00', end: '17:00' }] },
    durationMinutes: 60,
    instance: { start: '10:00', end: '11:00' },
    ...over,
  };
}

/** Offered starts the write gate would refuse. Empty means the pair agrees. */
function appointmentReadWriteMismatches(w: SchedulingWorld): Array<{ start: string; reason?: string }> {
  return appointmentStarts(w)
    .map((start) => ({ start, result: appointmentAcceptsStart(w, start) }))
    .filter((x) => !x.result.ok)
    .map((x) => ({ start: x.start, reason: x.result.reason }));
}

/**
 * The worlds most likely to break the pair: anything where the listing path and the gate
 * derive their answer differently.
 */
const APPOINTMENT_WORLDS: SchedulingWorld[] = [
  world({ name: 'plain open day' }),
  world({ name: 'no venue hours', venueOpeningHours: null }),
  world({ name: 'break 12:00-12:45', breakTimes: [{ start: '12:00', end: '12:45' }] }),
  world({
    name: 'partial leave 12:00-13:00',
    blockedRanges: [{ practitioner_id: 'cal-1', start: 720, end: 780, kind: 'leave' }],
  }),
  world({
    name: 'ad-hoc block 12:00-13:00',
    blockedRanges: [{ practitioner_id: 'cal-1', start: 720, end: 780, kind: 'blocked_time' }],
  }),
  world({
    name: 'amended hours 08:00-20:00',
    venueBlocks: [
      block({
        block_type: 'amended_hours',
        date_start: DATE,
        date_end: DATE,
        override_periods: [{ open: '08:00', close: '20:00' }],
      }),
    ],
    workingHours: { [DK]: [{ start: '08:00', end: '20:00' }] },
  }),
  world({
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
  }),
  world({
    name: 'empty amended override',
    venueBlocks: [block({ block_type: 'amended_hours', date_start: DATE, date_end: DATE, override_periods: [] })],
  }),
  world({
    name: 'inverted closure window',
    venueBlocks: [
      block({ block_type: 'closed', date_start: DATE, date_end: DATE, time_start: '13:00', time_end: '12:00' }),
    ],
  }),
  world({ name: 'split working day', workingHours: { [DK]: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '17:00' }] } }),
];

describe('read/write agreement / appointments', () => {
  /**
   * The invariant: every start the day engine offers, the exact-start gate accepts. This
   * holds today and MUST keep holding through every stage. It is the assertion that would
   * catch a Stage 3 or Stage 5 change applied to slot generation but not to the gate.
   */
  it.each(APPOINTMENT_WORLDS.map((w) => [w.name, w] as const))(
    'offers only starts the write gate accepts: %s',
    (_name, w) => {
      expect(appointmentReadWriteMismatches(w)).toEqual([]);
    },
  );

  it('refuses a start the engine did not offer, so the gate is not vacuously permissive', () => {
    const w = world({ name: 'break 12:00-12:45', breakTimes: [{ start: '12:00', end: '12:45' }] });

    expect(appointmentStarts(w)).not.toContain('12:00');
    expect(appointmentAcceptsStart(w, '12:00')).toEqual({ ok: false, reason: 'Conflicts with a break' });
    expect(appointmentAcceptsStart(w, '18:00').ok).toBe(false);
  });

  /**
   * The pair is one-directional, and the plan's "offers T ⟺ the gate accepts T" overstated
   * it. There are THREE write validators answering three different questions
   * (`revalidate-appointment-slot.ts:58-66`): `grid` re-runs the engine and looks for the
   * slot in the offered set, `exact` runs `validateExactAppointmentStart`, and `interval`
   * runs `validateAppointmentCustomInterval`.
   *
   * `exact` deliberately does NOT enforce grid alignment, because a multi-service visit
   * books off-grid starts and a staff duration override books an arbitrary interval;
   * asking the grid about either would refuse a booking the original check correctly
   * allowed. So `exact` is intentionally MORE permissive than the listing.
   *
   * The invariant that holds, and the only one worth asserting, is the forward direction:
   * everything offered is accepted. The converse is false by design, and a harness that
   * asserted it would fail on correct code.
   */
  it('accepts an off-grid start by design, so the pair is forward-only', () => {
    const w = world({ name: 'plain open day' });

    expect(appointmentStarts(w)).not.toContain('09:30');
    expect(appointmentAcceptsStart(w, '09:30')).toEqual({ ok: true });
  });

  it('still enforces the rules at an off-grid start, so permissiveness is only about the grid', () => {
    const w = world({ name: 'break 12:00-12:45', breakTimes: [{ start: '12:00', end: '12:45' }] });

    expect(appointmentAcceptsStart(w, '12:30')).toEqual({ ok: false, reason: 'Conflicts with a break' });
    expect(appointmentAcceptsStart(w, '16:30').ok).toBe(false);
  });
});

describe('read/write agreement / scheduled instances', () => {
  it('agrees on an ordinary in-hours instance', () => {
    const w = world({ name: 'in-hours class and event' });

    expect(classOffered(w)).toBe(true);
    expect(eventOffered(w)).toBe(true);
    expect(venueWriteGate(w)).toBeNull();
  });

  it('agrees when the venue is explicitly closed all day', () => {
    const w = world({
      name: 'closed all day',
      venueBlocks: [block({ block_type: 'closed', date_start: DATE, date_end: DATE })],
    });

    expect(classOffered(w)).toBe(false);
    expect(eventOffered(w)).toBe(false);
    expect(venueWriteGate(w)).toBe('The venue is closed for this date or time.');
  });

  /**
   * CLOSED BY STAGE 2 (plan §1.2 item 16). On a weekday the venue has no periods for, both
   * listings sell the session and the create gate now accepts it. Under decision (H) the
   * listing was the correct side, so the GATE moved: `booking/create` uses the
   * scheduled-instance gate for group sessions and event tickets.
   *
   * This was live at every venue with configured opening hours before Stage 2.
   */
  it('AGREES after Stage 2: a session on a weekly-closed weekday is listed and accepted', () => {
    const w = world({
      name: 'weekly-closed weekday, no blocks',
      venueOpeningHours: configuredButClosedOn(DATE, [{ open: '09:00', close: '17:00' }]),
    });

    expect(classOffered(w)).toBe(true);
    expect(eventOffered(w)).toBe(true);
    expect(instanceWriteGate(w)).toBeNull();
    // The slot-generation gate still refuses, and should: appointments and resources are
    // not scheduled instances. That difference is the point of splitting the two gates.
    expect(venueWriteGate(w)).toBe('The venue is closed for this date or time.');
  });

  /**
   * The safety valve that makes decision (H) safe: an explicit closure still wins. An owner
   * who genuinely shuts that day is obeyed, on both sides.
   */
  it('refuses on both sides when the owner explicitly closes the weekly-closed day', () => {
    const w = world({
      name: 'weekly-closed weekday, explicit closure',
      venueOpeningHours: configuredButClosedOn(DATE, [{ open: '09:00', close: '17:00' }]),
      venueBlocks: [block({ block_type: 'closed', date_start: DATE, date_end: DATE })],
    });

    expect(classOffered(w)).toBe(false);
    expect(eventOffered(w)).toBe(false);
    expect(instanceWriteGate(w)).toBe('The venue is closed for this date or time.');
  });

  /**
   * §1.2 item 7, fixed for scheduled instances. A closure that does not overlap the
   * instance no longer changes the answer. Before Stage 2 a single 06:00-07:00 block took
   * every evening event off sale for the whole date.
   */
  it('ignores a non-overlapping closure on a weekly-closed weekday', () => {
    const w = world({
      name: 'weekly-closed weekday, unrelated early closure',
      venueOpeningHours: configuredButClosedOn(DATE, [{ open: '09:00', close: '17:00' }]),
      venueBlocks: [
        block({ block_type: 'closed', date_start: DATE, date_end: DATE, time_start: '06:00', time_end: '07:00' }),
      ],
      instance: { start: '19:00', end: '20:00' },
    });

    expect(eventOffered(w)).toBe(true);
    expect(instanceWriteGate(w)).toBeNull();
  });

  /**
   * PINS the out-of-hours split for classes (plan §1.2 item 15). A 19:00 session at a
   * 09:00-17:00 venue is listed, because the class engine never consults weekly hours when
   * the date has no blocks, and refused by the gate, which always does.
   *
   * Decision (B) keeps the class carve-out, so Stage 5 moves the WRITE gate for classes.
   * Events are gated on venue hours, so their listing correctly refuses this one already.
   */
  it('DIVERGES: a 19:00 class is listed at a 09:00-17:00 venue and the gate refuses it', () => {
    const w = world({ name: 'out-of-hours instance', instance: { start: '19:00', end: '20:00' } });

    expect(classOffered(w)).toBe(true);
    expect(eventOffered(w)).toBe(false);
    expect(venueWriteGate(w)).toBe('The venue is closed for this date or time.');
  });

  /**
   * The presence of ONE unrelated block flips the class engine from "always allowed" to
   * "must fit inside the resolved ranges" for the whole date (plan §1.2 item 7). Same
   * world as above plus a block that does not overlap the instance at all.
   */
  it('FIXED in Stage 5: an unrelated block no longer changes the class rule for the day', () => {
    const withoutBlock = world({ name: 'no blocks', instance: { start: '19:00', end: '20:00' } });
    const withBlock = world({
      name: 'one unrelated morning closure',
      instance: { start: '19:00', end: '20:00' },
      venueBlocks: [
        block({ block_type: 'closed', date_start: DATE, date_end: DATE, time_start: '06:00', time_end: '07:00' }),
      ],
    });

    // Both true now. The class gate asks whether a closure OVERLAPS the instance, not
    // whether the date happens to carry a block: a 06:00-07:00 closure used to take every
    // evening class off sale for the whole day. §1.2 item 7, class half.
    expect(classOffered(withoutBlock)).toBe(true);
    expect(classOffered(withBlock)).toBe(true);
  });
});
