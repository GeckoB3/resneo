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
