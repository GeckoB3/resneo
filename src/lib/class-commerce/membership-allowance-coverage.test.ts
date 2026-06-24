import { describe, expect, it } from 'vitest';
import {
  computeRolloverCarryOver,
  netAllowanceConsumed,
} from '@/lib/class-commerce/membership-allowance-coverage';

describe('netAllowanceConsumed', () => {
  it('sums redeem rows (negative deltas) into positive consumption', () => {
    expect(
      netAllowanceConsumed([{ delta_sessions: -1 }, { delta_sessions: -2 }]),
    ).toBe(3);
  });

  it('nets restore rows (positive deltas) back out', () => {
    // redeemed 3, restored 1 → net 2 consumed
    expect(
      netAllowanceConsumed([
        { delta_sessions: -2 },
        { delta_sessions: -1 },
        { delta_sessions: 1 },
      ]),
    ).toBe(2);
  });

  it('floors at zero when restores exceed redeems', () => {
    expect(
      netAllowanceConsumed([{ delta_sessions: -1 }, { delta_sessions: 3 }]),
    ).toBe(0);
  });

  it('returns zero for an empty ledger', () => {
    expect(netAllowanceConsumed([])).toBe(0);
  });
});

describe('computeRolloverCarryOver', () => {
  it('returns zero when the plan does not roll over', () => {
    expect(
      computeRolloverCarryOver({
        priorStartingBalance: 10,
        priorConsumed: 2,
        rollover: false,
        rolloverLimit: null,
      }),
    ).toBe(0);
  });

  it('carries the full unused balance when under the limit', () => {
    // started 10, used 4 → 6 leftover, no cap
    expect(
      computeRolloverCarryOver({
        priorStartingBalance: 10,
        priorConsumed: 4,
        rollover: true,
        rolloverLimit: null,
      }),
    ).toBe(6);
  });

  it('caps carry-over at rollover_limit', () => {
    // 8 leftover but cap is 3
    expect(
      computeRolloverCarryOver({
        priorStartingBalance: 10,
        priorConsumed: 2,
        rollover: true,
        rolloverLimit: 3,
      }),
    ).toBe(3);
  });

  it('never returns negative when over-consumed', () => {
    // consumed more than granted (e.g. admin adjustment) → no negative carry
    expect(
      computeRolloverCarryOver({
        priorStartingBalance: 4,
        priorConsumed: 9,
        rollover: true,
        rolloverLimit: null,
      }),
    ).toBe(0);
  });

  it('treats negative consumption as zero (cannot inflate leftover)', () => {
    // a stray negative consumed value must not push leftover above the balance
    expect(
      computeRolloverCarryOver({
        priorStartingBalance: 5,
        priorConsumed: -3,
        rollover: true,
        rolloverLimit: null,
      }),
    ).toBe(5);
  });

  it('first-ever rollover (empty prior window) carries the full allowance, capped', () => {
    // Regression for the epoch-fallback bug: when there is no prior period_reset row
    // the prior window is empty, so consumed = 0 and the member rolls over the whole
    // allowance (here capped at the rollover_limit), instead of being wrongly denied
    // by sweeping all historical redeems in as "consumed".
    expect(
      computeRolloverCarryOver({
        priorStartingBalance: 8,
        priorConsumed: netAllowanceConsumed([]),
        rollover: true,
        rolloverLimit: 5,
      }),
    ).toBe(5);
  });
});
