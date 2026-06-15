import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import { recordSalesRevenueRefund } from '@/lib/sales/invoice-revenue';
import { computeMonthlyStatement, type SalespersonRow } from '@/lib/sales/earnings';

// ── Refund netting ───────────────────────────────────────────────────────────
function makeRefundAdmin(original: { attribution_id: string; venue_id: string; period_month: string } | null) {
  const upserts: Array<Record<string, unknown>> = [];
  const admin = {
    from() {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve({ data: original, error: null }),
        upsert: (row: Record<string, unknown>) => {
          upserts.push(row);
          return Promise.resolve({ error: null });
        },
      };
      return chain;
    },
  };
  return { admin: admin as unknown as SupabaseClient, upserts };
}

describe('recordSalesRevenueRefund', () => {
  const charge = { id: 'ch_1', invoice: 'in_1', amount_refunded: 5000 } as unknown as Stripe.Charge;

  it('nets the cumulative refund into the original invoice month, keyed by charge', async () => {
    const { admin, upserts } = makeRefundAdmin({ attribution_id: 'attr1', venue_id: 'v1', period_month: '2026-05-01' });
    await recordSalesRevenueRefund(admin, charge);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({
      attribution_id: 'attr1',
      venue_id: 'v1',
      period_month: '2026-05-01',
      amount_paid_pence: -5000,
      stripe_invoice_id: 'refund:ch_1',
    });
  });

  it('is a no-op when the invoice was never recorded as salesperson revenue', async () => {
    const { admin, upserts } = makeRefundAdmin(null);
    await recordSalesRevenueRefund(admin, charge);
    expect(upserts).toHaveLength(0);
  });

  it('is a no-op when nothing was refunded', async () => {
    const { admin, upserts } = makeRefundAdmin({ attribution_id: 'attr1', venue_id: 'v1', period_month: '2026-05-01' });
    await recordSalesRevenueRefund(admin, { id: 'ch_2', invoice: 'in_2', amount_refunded: 0 } as unknown as Stripe.Charge);
    expect(upserts).toHaveLength(0);
  });
});

// ── Reconciliation preserves the bonus ratchet ───────────────────────────────
function makeEmptyStatementAdmin() {
  const admin = {
    from() {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'gte', 'lt', 'not', 'in', 'order', 'limit']) {
        chain[m] = () => chain;
      }
      chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
      // Thenable: awaiting any query resolves to an empty result set.
      chain.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) => resolve({ data: [], error: null });
      return chain;
    },
  };
  return admin as unknown as SupabaseClient;
}

const SP: SalespersonRow = {
  id: 'sp1',
  user_id: 'u1',
  email: 'rep@example.com',
  name: 'Rep',
  lump_sum_per_signup_pence: 5000,
  revenue_share_percent: 0,
  revenue_share_months: 12,
};

describe('computeMonthlyStatement reconciliation (awardBonuses: false)', () => {
  it('preserves the recorded bonus + subscriber snapshot and awards nothing new', async () => {
    const breakdown = await computeMonthlyStatement(
      { admin: makeEmptyStatementAdmin(), salesperson: SP, periodMonth: '2026-05-01', bonusTiers: [] },
      { awardBonuses: false, preservedBonusPence: 9000, preservedActiveSubscribers: 7 },
    );
    expect(breakdown.bonus_pence).toBe(9000);
    expect(breakdown.active_subscribers_end).toBe(7);
    expect(breakdown.new_bonus_awards).toEqual([]);
    // No data this month → lump + revenue are 0, so total is just the preserved bonus.
    expect(breakdown.total_pence).toBe(9000);
  });
});
