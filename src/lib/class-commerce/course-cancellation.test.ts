import { describe, expect, it } from 'vitest';
import { computeProratedRefundPence } from '@/lib/class-commerce/course-cancellation';

describe('computeProratedRefundPence', () => {
  it('refunds in full when zero sessions have been delivered', () => {
    expect(
      computeProratedRefundPence({ pricePence: 6000, totalSessions: 6, remainingSessions: 6 }),
    ).toBe(6000);
  });

  it('refunds half when half the sessions have been delivered', () => {
    expect(
      computeProratedRefundPence({ pricePence: 6000, totalSessions: 6, remainingSessions: 3 }),
    ).toBe(3000);
  });

  it('refunds nothing when all sessions have been delivered', () => {
    expect(
      computeProratedRefundPence({ pricePence: 6000, totalSessions: 6, remainingSessions: 0 }),
    ).toBe(0);
  });

  it('rounds to the nearest pence', () => {
    // 5000 * 1/3 = 1666.66… → 1667
    expect(
      computeProratedRefundPence({ pricePence: 5000, totalSessions: 3, remainingSessions: 1 }),
    ).toBe(1667);
    // 5000 * 2/3 = 3333.33… → 3333
    expect(
      computeProratedRefundPence({ pricePence: 5000, totalSessions: 3, remainingSessions: 2 }),
    ).toBe(3333);
    // 100 * 1/7 = 14.28… → 14
    expect(
      computeProratedRefundPence({ pricePence: 100, totalSessions: 7, remainingSessions: 1 }),
    ).toBe(14);
  });

  it('falls back to a full refund when the session total is unknown (cannot prorate)', () => {
    expect(
      computeProratedRefundPence({ pricePence: 6000, totalSessions: 0, remainingSessions: 0 }),
    ).toBe(6000);
  });

  it('returns zero when the price is zero regardless of sessions', () => {
    expect(
      computeProratedRefundPence({ pricePence: 0, totalSessions: 6, remainingSessions: 6 }),
    ).toBe(0);
  });

  it('clamps remaining above total to a full refund (no over-refund)', () => {
    expect(
      computeProratedRefundPence({ pricePence: 6000, totalSessions: 4, remainingSessions: 10 }),
    ).toBe(6000);
  });

  it('clamps negative inputs to zero', () => {
    expect(
      computeProratedRefundPence({ pricePence: 6000, totalSessions: 6, remainingSessions: -2 }),
    ).toBe(0);
  });
});
