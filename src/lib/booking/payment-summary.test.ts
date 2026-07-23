import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  deriveBookingPaymentState,
  recomputeBookingPaymentSummary,
  resolveBookingTotalPence,
  resolveBookingTotalPenceFromRow,
} from './payment-summary';

type Row = Record<string, unknown>;
type RecordedCall = {
  table: string;
  op: 'select' | 'update' | 'insert';
  payload?: unknown;
  filters: Array<[string, string, unknown]>;
};

/**
 * Filter-aware fake supabase in the card-hold-charge.test.ts style. The
 * responder decides what each call returns; awaiting the builder directly (a
 * bare list select) resolves the same way maybeSingle does.
 */
function makeAdmin(responder: (call: RecordedCall) => { data?: unknown; error?: unknown }) {
  const calls: RecordedCall[] = [];
  const admin = {
    from(table: string) {
      const call: RecordedCall = { table, op: 'select', filters: [] };
      calls.push(call);
      const builder: Record<string, unknown> = {};
      const chain = (fn: (...args: unknown[]) => void) =>
        (...args: unknown[]) => {
          fn(...args);
          return builder;
        };
      builder.select = chain(() => {});
      builder.update = chain((payload) => {
        call.op = 'update';
        call.payload = payload;
      });
      builder.insert = chain((payload) => {
        call.op = 'insert';
        call.payload = payload;
      });
      builder.eq = chain((k, v) => call.filters.push(['eq', k as string, v]));
      builder.in = chain((k, v) => call.filters.push(['in', k as string, v]));
      builder.is = chain((k, v) => call.filters.push(['is', k as string, v]));
      builder.neq = chain((k, v) => call.filters.push(['neq', k as string, v]));
      builder.maybeSingle = () => Promise.resolve(normalise(responder(call), true));
      builder.single = () => Promise.resolve(normalise(responder(call), true));
      builder.then = (
        resolve: (v: unknown) => unknown,
        reject?: (e: unknown) => unknown,
      ) => Promise.resolve(normalise(responder(call), false)).then(resolve, reject);
      return builder;
    },
  };
  const normalise = (
    res: { data?: unknown; error?: unknown },
    single: boolean,
  ): { data: unknown; error: unknown } => {
    let data = res.data ?? (single ? null : []);
    if (single && Array.isArray(data)) data = data[0] ?? null;
    return { data, error: res.error ?? null };
  };
  return { admin: admin as unknown as SupabaseClient, calls };
}

describe('resolveBookingTotalPence (§5.7)', () => {
  it('uses booking_total_price_pence when positive', () => {
    expect(
      resolveBookingTotalPence({
        booking_total_price_pence: 5000,
        service_variant_price_pence: 3000,
        addons_total_price_pence: 1000,
      }),
    ).toBe(5000);
  });

  it('falls back to variant + addons when the column is null or zero', () => {
    expect(
      resolveBookingTotalPence({
        booking_total_price_pence: null,
        service_variant_price_pence: 3000,
        addons_total_price_pence: 1500,
      }),
    ).toBe(4500);
    expect(
      resolveBookingTotalPence({
        booking_total_price_pence: 0,
        service_variant_price_pence: 3000,
        addons_total_price_pence: 0,
      }),
    ).toBe(3000);
  });

  it('returns null when nothing resolves to a positive total (unknown price)', () => {
    expect(resolveBookingTotalPence({})).toBeNull();
    expect(
      resolveBookingTotalPence({
        booking_total_price_pence: null,
        service_variant_price_pence: 0,
        addons_total_price_pence: 0,
      }),
    ).toBeNull();
    expect(
      resolveBookingTotalPence({
        booking_total_price_pence: null,
        service_variant_price_pence: null,
        addons_total_price_pence: null,
      }),
    ).toBeNull();
  });

  it('addons alone can carry the total', () => {
    expect(
      resolveBookingTotalPence({
        service_variant_price_pence: null,
        addons_total_price_pence: 800,
      }),
    ).toBe(800);
  });
});

describe('resolveBookingTotalPenceFromRow', () => {
  it('skips the variant lookup when the stored column is usable', async () => {
    const { admin, calls } = makeAdmin(() => ({ data: null }));
    const total = await resolveBookingTotalPenceFromRow(admin, {
      booking_total_price_pence: 7000,
      service_variant_id: 'variant-1',
      addons_total_price_pence: 0,
    });
    expect(total).toBe(7000);
    expect(calls).toHaveLength(0);
  });

  it('fetches the variant price when the column is empty', async () => {
    const { admin, calls } = makeAdmin((call) => {
      if (call.table === 'service_variants') return { data: { price_pence: 4200 } };
      throw new Error(`unexpected table ${call.table}`);
    });
    const total = await resolveBookingTotalPenceFromRow(admin, {
      booking_total_price_pence: null,
      service_variant_id: 'variant-1',
      addons_total_price_pence: 300,
    });
    expect(total).toBe(4500);
    expect(calls[0]?.filters).toContainEqual(['eq', 'id', 'variant-1']);
  });

  it('degrades to unknown (null) when the variant lookup errors', async () => {
    const { admin } = makeAdmin(() => ({ data: null, error: { message: 'boom' } }));
    const total = await resolveBookingTotalPenceFromRow(admin, {
      booking_total_price_pence: null,
      service_variant_id: 'variant-1',
      addons_total_price_pence: 0,
    });
    expect(total).toBeNull();
  });
});

describe('deriveBookingPaymentState (§5.5 truth table)', () => {
  const derive = deriveBookingPaymentState;

  it('unpaid when nothing has been paid', () => {
    expect(
      derive({ totalPence: 5000, depositPaidPence: 0, balancePaidPence: 0, hasRefundedRow: false }),
    ).toBe('unpaid');
    expect(
      derive({ totalPence: null, depositPaidPence: 0, balancePaidPence: 0, hasRefundedRow: false }),
    ).toBe('unpaid');
  });

  it('deposit_paid when only the deposit is in', () => {
    expect(
      derive({ totalPence: 5000, depositPaidPence: 1000, balancePaidPence: 0, hasRefundedRow: false }),
    ).toBe('deposit_paid');
    // Unknown total: a deposit alone still reads deposit_paid.
    expect(
      derive({ totalPence: null, depositPaidPence: 1000, balancePaidPence: 0, hasRefundedRow: false }),
    ).toBe('deposit_paid');
  });

  it('partially_paid once a balance payment lands short of the total', () => {
    expect(
      derive({ totalPence: 5000, depositPaidPence: 1000, balancePaidPence: 2000, hasRefundedRow: false }),
    ).toBe('partially_paid');
  });

  it('paid when amount_paid reaches the known total (deposit alone can do it)', () => {
    expect(
      derive({ totalPence: 5000, depositPaidPence: 1000, balancePaidPence: 4000, hasRefundedRow: false }),
    ).toBe('paid');
    expect(
      derive({ totalPence: 1000, depositPaidPence: 1000, balancePaidPence: 0, hasRefundedRow: false }),
    ).toBe('paid');
  });

  it('unknown total never reads paid — a balance payment stays partially_paid (§8-G)', () => {
    expect(
      derive({ totalPence: null, depositPaidPence: 0, balancePaidPence: 9999, hasRefundedRow: false }),
    ).toBe('partially_paid');
  });

  it('refunded only when a refunded row exists AND nothing remains paid (§5.5 precedence)', () => {
    expect(
      derive({ totalPence: 5000, depositPaidPence: 0, balancePaidPence: 0, hasRefundedRow: true }),
    ).toBe('refunded');
    // Balance refunded but the deposit is still paid → back to deposit_paid.
    expect(
      derive({ totalPence: 5000, depositPaidPence: 1000, balancePaidPence: 0, hasRefundedRow: true }),
    ).toBe('deposit_paid');
    // One of two payments refunded → the survivor keeps partially_paid.
    expect(
      derive({ totalPence: 5000, depositPaidPence: 0, balancePaidPence: 2000, hasRefundedRow: true }),
    ).toBe('partially_paid');
  });
});

describe('recomputeBookingPaymentSummary (§5.6)', () => {
  const bookingRow: Row = {
    id: 'b1',
    venue_id: 'v1',
    booking_total_price_pence: null,
    service_variant_id: 'variant-1',
    addons_total_price_pence: 500,
    deposit_status: 'Paid',
    deposit_amount_pence: 1000,
  };

  function run(ledger: Row[], variantPrice: number | null = 4500) {
    const updates: RecordedCall[] = [];
    const { admin } = makeAdmin((call) => {
      if (call.table === 'bookings' && call.op === 'select') return { data: bookingRow };
      if (call.table === 'booking_payments') return { data: ledger };
      if (call.table === 'service_variants') return { data: { price_pence: variantPrice } };
      if (call.table === 'bookings' && call.op === 'update') {
        updates.push(call);
        return { data: null };
      }
      throw new Error(`unexpected ${call.op} on ${call.table}`);
    });
    return { admin, updates };
  }

  it('sums succeeded rows on top of the paid deposit and stamps the state', async () => {
    const { admin, updates } = run([
      { amount_pence: 2000, tip_amount_pence: 0, status: 'succeeded' },
      { amount_pence: 999, tip_amount_pence: 0, status: 'pending' }, // ignored
      { amount_pence: 777, tip_amount_pence: 0, status: 'failed' }, // ignored
    ]);
    await recomputeBookingPaymentSummary(admin, 'b1');
    expect(updates).toHaveLength(1);
    const payload = updates[0]!.payload as Row;
    // total = variant 4500 + addons 500 = 5000; paid = deposit 1000 + 2000.
    expect(payload.amount_paid_pence).toBe(3000);
    expect(payload.tip_amount_pence).toBe(0);
    expect(payload.payment_state).toBe('partially_paid');
    expect(updates[0]!.filters).toContainEqual(['eq', 'id', 'b1']);
  });

  it('reaches paid when the ledger covers the balance', async () => {
    const { admin, updates } = run([
      { amount_pence: 4000, tip_amount_pence: 0, status: 'succeeded' },
    ]);
    await recomputeBookingPaymentSummary(admin, 'b1');
    expect((updates[0]!.payload as Row).payment_state).toBe('paid');
    expect((updates[0]!.payload as Row).amount_paid_pence).toBe(5000);
  });

  it('a fully refunded ledger with a live deposit lands on deposit_paid, not refunded', async () => {
    const { admin, updates } = run([
      { amount_pence: 4000, tip_amount_pence: 0, status: 'refunded' },
    ]);
    await recomputeBookingPaymentSummary(admin, 'b1');
    expect((updates[0]!.payload as Row).payment_state).toBe('deposit_paid');
    expect((updates[0]!.payload as Row).amount_paid_pence).toBe(1000);
  });

  it('throws when the ledger load fails so webhook callers release their claim', async () => {
    const { admin } = makeAdmin((call) => {
      if (call.table === 'bookings' && call.op === 'select') return { data: bookingRow };
      if (call.table === 'booking_payments') return { data: null, error: { message: 'down' } };
      return { data: null };
    });
    await expect(recomputeBookingPaymentSummary(admin, 'b1')).rejects.toBeTruthy();
  });

  it('skips quietly when the booking no longer exists', async () => {
    const { admin } = makeAdmin((call) => {
      if (call.table === 'bookings') return { data: null };
      throw new Error('should not query further');
    });
    await expect(recomputeBookingPaymentSummary(admin, 'gone')).resolves.toBeUndefined();
  });
});
