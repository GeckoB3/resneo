import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isNonWorkingBlock, isOccupyingBlock } from './occupying-blocks';

describe('isOccupyingBlock', () => {
  it('lets staff book over a closed venue (SA-H5)', () => {
    // The 17:15 client when the salon shuts at 17:00. The shipped help article
    // promises this is allowed with a note, not a refusal.
    expect(isOccupyingBlock('venue_closed')).toBe(false);
  });

  it('lets staff book outside a practitioner\'s working hours (SA-H5)', () => {
    expect(isOccupyingBlock('practitioner_closed')).toBe(false);
  });

  it('lets staff book over a break (SA-H5)', () => {
    expect(isOccupyingBlock('break')).toBe(false);
  });

  it('lets staff book inside the open window of an amended-hours day (SA-H3)', () => {
    // This block marks the hours the venue IS open. Treating it as occupied
    // blocked the one window that was working while the guest engine sold it.
    expect(isOccupyingBlock('venue_amended_hours')).toBe(false);
  });

  it('still refuses a booking over staff leave', () => {
    // A closure is a boundary the venue may work past; leave means the person
    // is not there. This is the distinction SA-M28 had to create first.
    expect(isOccupyingBlock('practitioner_leave')).toBe(true);
  });

  it('still refuses a booking over a class session', () => {
    expect(isOccupyingBlock('class_session')).toBe(true);
  });

  it('still refuses a booking inside a partner venue\'s closed hours', () => {
    // Working past your own closing time is a decision about your own business.
    // Booking into another venue's closed hours is not, and they have not
    // agreed to it, so a linked column stays hard.
    expect(isOccupyingBlock('linked_venue_closed')).toBe(true);
  });

  it('refuses unknown and absent types, so new ones fail safe', () => {
    expect(isOccupyingBlock('something_added_later')).toBe(true);
    expect(isOccupyingBlock(undefined)).toBe(true);
    // A hand-made staff block carries no schedule type and must keep blocking.
    expect(isOccupyingBlock('')).toBe(true);
  });
});

describe('isNonWorkingBlock', () => {
  it('counts closures and breaks as not normally worked', () => {
    expect(isNonWorkingBlock('venue_closed')).toBe(true);
    expect(isNonWorkingBlock('practitioner_closed')).toBe(true);
    expect(isNonWorkingBlock('break')).toBe(true);
  });

  it('does not count amended hours, which are the hours the venue opened', () => {
    // Landing here must not raise "moved outside opening hours": it is the most
    // inside-hours a slot gets on that day.
    expect(isNonWorkingBlock('venue_amended_hours')).toBe(false);
  });

  it('does not count blocks that already refuse the move', () => {
    // Leave, classes and manual blocks block outright, so they never reach the
    // warning path and must not claim to be an hours problem.
    expect(isNonWorkingBlock('practitioner_leave')).toBe(false);
    expect(isNonWorkingBlock('class_session')).toBe(false);
    expect(isNonWorkingBlock(undefined)).toBe(false);
  });
});

/**
 * The tests above prove the rule. They do not prove the diary applies it: with
 * both calls deleted from `PractitionerCalendarView` they still pass, because
 * the predicate is fine and simply unused. That is the precise failure this
 * whole finding is, a helper that exists and is bypassed, so it gets its own
 * guard.
 *
 * A bypass guard, not a behaviour test. The view is a 8,000-line client
 * component and mounting it to assert a slot's disabled state would cost far
 * more than it proves; staging testing covers the behaviour.
 */
describe('the diary applies the rule (SA-H3, SA-H5)', () => {
  const VIEW = 'src/app/dashboard/practitioner-calendar/PractitionerCalendarView.tsx';

  function viewSource(): string {
    return readFileSync(path.join(process.cwd(), VIEW), 'utf8');
  }

  it('filters blocks through isOccupyingBlock in both conflict loops', () => {
    const source = viewSource();
    const guards = source.match(/if \(!isOccupyingBlock\(bl\.block_type\)\) continue;/g) ?? [];

    // One in `slotOccupied`, one in `appointmentWindowCollides`. Both, or the
    // fix is half applied: the grid would unlock while drags stayed refused.
    expect(guards).toHaveLength(2);
  });

  it('derives the outside-hours warning from the blocks, not the canvas bounds', () => {
    const source = viewSource();
    expect(source).toContain('windowCrossesNonWorkingBlock(');
    expect(source).toContain('isNonWorkingBlock');
  });
});
