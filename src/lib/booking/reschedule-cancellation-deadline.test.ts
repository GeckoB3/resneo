import { describe, expect, it } from 'vitest';
import { resolveRescheduleCancellationDeadline } from './reschedule-cancellation-deadline';

const NOW = new Date('2026-08-14T12:00:00.000Z');
const PASSED = '2026-08-13T09:00:00.000Z';
const FUTURE = '2026-08-20T09:00:00.000Z';
const RECOMPUTED = '2026-09-01T09:00:00.000Z';

const run = (over: Partial<Parameters<typeof resolveRescheduleCancellationDeadline>[0]>) =>
  resolveRescheduleCancellationDeadline({
    previousDeadline: PASSED,
    depositStatus: 'Paid',
    recomputedDeadline: RECOMPUTED,
    now: NOW,
    ...over,
  });

describe('resolveRescheduleCancellationDeadline (C13)', () => {
  it('pins a passed deadline on a paid deposit', () => {
    // The defect: without this, rescheduling to September moves the deadline
    // into the future and a forfeited deposit becomes refundable again.
    const result = run({});
    expect(result.deadline).toBe(PASSED);
    expect(result.preserved).toBe(true);
  });

  it('pins a passed deadline on a card hold', () => {
    // A post-deadline cancel KEEPS a hold chargeable; a pre-deadline one
    // releases it. Re-pinning would let the guest escape the no-show fee.
    const result = run({ depositStatus: 'Card Held' });
    expect(result.deadline).toBe(PASSED);
    expect(result.preserved).toBe(true);
  });

  it('re-pins when the deadline has not passed yet', () => {
    // The ordinary case, and the one that must keep working: a guest inside
    // their refund window has forfeited nothing, so the deadline follows the
    // booking to its new start.
    const result = run({ previousDeadline: FUTURE });
    expect(result.deadline).toBe(RECOMPUTED);
    expect(result.preserved).toBe(false);
  });

  it.each(['Not Required', 'Pending', 'Waived', 'Failed', 'Refunded', 'Forfeited', 'Charged'])(
    're-pins for deposit_status %s, which has nothing riding on the deadline',
    (depositStatus) => {
      // Scoped this way so a depositless booking does not display a stale
      // deadline in the past for no reason.
      const result = run({ depositStatus });
      expect(result.deadline).toBe(RECOMPUTED);
      expect(result.preserved).toBe(false);
    },
  );

  it('re-pins when the row has no previous deadline at all', () => {
    const result = run({ previousDeadline: null });
    expect(result.deadline).toBe(RECOMPUTED);
    expect(result.preserved).toBe(false);
  });

  it('re-pins rather than trusting an unparseable stored deadline', () => {
    // A value that cannot be shown to have passed cannot justify withholding a
    // refund, so it must not be preserved.
    const result = run({ previousDeadline: 'not-a-date' });
    expect(result.deadline).toBe(RECOMPUTED);
    expect(result.preserved).toBe(false);
  });

  it('treats a deadline exactly at the current instant as passed', () => {
    const result = run({ previousDeadline: NOW.toISOString() });
    expect(result.deadline).toBe(NOW.toISOString());
    expect(result.preserved).toBe(true);
  });

  it('does not let a repeated reschedule walk the deadline forward', () => {
    // The laundering attempt is repeatable, so the guard has to hold on the
    // second pass as well: the preserved value feeds back in as `previous`.
    const first = run({});
    const second = run({ previousDeadline: first.deadline });
    expect(second.deadline).toBe(PASSED);
    expect(second.preserved).toBe(true);
  });
});
