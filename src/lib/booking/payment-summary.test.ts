import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  depositPaidContributionPence,
  deriveBookingPaymentState,
  loadVisitPaymentPicture,
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

  it('scopes the variant lookup to the owning venue when known', async () => {
    const { admin, calls } = makeAdmin((call) => {
      if (call.table === 'service_variants') return { data: { price_pence: 4200 } };
      throw new Error(`unexpected table ${call.table}`);
    });
    await resolveBookingTotalPenceFromRow(admin, {
      booking_total_price_pence: null,
      service_variant_id: 'variant-1',
      addons_total_price_pence: 0,
      venue_id: 'v9',
    });
    expect(calls[0]?.filters).toContainEqual(['eq', 'venue_id', 'v9']);
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

describe('loadVisitPaymentPicture (§5.7 visit-scoped settlement)', () => {
  const anchor = {
    id: 'b1',
    venue_id: 'v1',
    group_booking_id: null as string | null,
    booking_total_price_pence: null,
    service_variant_id: 'sv1',
    addons_total_price_pence: 0,
    deposit_status: 'Paid',
    deposit_amount_pence: 1000,
  };

  it('a standalone booking: paid deposit + succeeded ledger, no sibling query', async () => {
    const tables: string[] = [];
    const { admin } = makeAdmin((call) => {
      tables.push(call.table);
      if (call.table === 'service_variants') return { data: [{ id: 'sv1', price_pence: 5000 }] };
      if (call.table === 'booking_payments') {
        return {
          data: [
            { booking_id: 'b1', amount_pence: 2000, tip_amount_pence: 0, status: 'succeeded' },
            { booking_id: 'b1', amount_pence: 999, tip_amount_pence: 0, status: 'pending' },
          ],
        };
      }
      throw new Error(`unexpected table ${call.table}`);
    });
    const visit = await loadVisitPaymentPicture(admin, anchor);
    expect(tables).not.toContain('bookings'); // no sibling lookup without a group
    expect(visit.bookingIds).toEqual(['b1']);
    expect(visit.totalPence).toBe(5000);
    expect(visit.amountPaidPence).toBe(3000); // deposit 1000 + succeeded 2000
    expect(visit.balanceDuePence).toBe(2000);
    expect(visit.paymentState).toBe('partially_paid');
  });

  it('a visit sums every sibling row and every sibling payment', async () => {
    const { admin } = makeAdmin((call) => {
      if (call.table === 'bookings') {
        return {
          data: [
            { ...anchor, group_booking_id: 'grp-1' },
            {
              id: 'b2',
              venue_id: 'v1',
              group_booking_id: 'grp-1',
              service_variant_id: 'sv2',
              addons_total_price_pence: 500,
              deposit_status: 'Not Required',
              deposit_amount_pence: null,
            },
          ],
        };
      }
      if (call.table === 'service_variants') {
        return { data: [{ id: 'sv1', price_pence: 3000 }, { id: 'sv2', price_pence: 6000 }] };
      }
      if (call.table === 'booking_payments') {
        return {
          data: [{ booking_id: 'b2', amount_pence: 500, tip_amount_pence: 0, status: 'succeeded' }],
        };
      }
      throw new Error(`unexpected table ${call.table}`);
    });
    const visit = await loadVisitPaymentPicture(admin, { ...anchor, group_booking_id: 'grp-1' });
    expect(visit.bookingIds).toEqual(['b1', 'b2']);
    // visit total = (3000) + (6000 + 500 addons) = 9500
    expect(visit.totalPence).toBe(9500);
    expect(visit.anchorTotalPence).toBe(3000); // this row only
    expect(visit.amountPaidPence).toBe(1500); // deposit 1000 + sibling payment 500
    expect(visit.balanceDuePence).toBe(8000);
    // Per-row ledger attribution keeps revenue sums from double counting.
    expect(visit.ledger.perBooking.get('b2')?.balancePaidPence).toBe(500);
    expect(visit.ledger.perBooking.get('b1')?.balancePaidPence).toBe(0);
  });

  it('an unresolvable line makes the WHOLE visit total unknown (never silently understated)', async () => {
    const { admin } = makeAdmin((call) => {
      if (call.table === 'bookings') {
        return {
          data: [
            { ...anchor, group_booking_id: 'grp-1' },
            { id: 'b2', venue_id: 'v1', group_booking_id: 'grp-1', service_variant_id: null, addons_total_price_pence: 0 },
          ],
        };
      }
      if (call.table === 'service_variants') return { data: [{ id: 'sv1', price_pence: 3000 }] };
      if (call.table === 'booking_payments') return { data: [] };
      throw new Error(`unexpected table ${call.table}`);
    });
    const visit = await loadVisitPaymentPicture(admin, { ...anchor, group_booking_id: 'grp-1' });
    expect(visit.totalPence).toBeNull();
    expect(visit.balanceDuePence).toBeNull();
  });

  it('scopes siblings to the venue so a group id can never reach across venues', async () => {
    const { admin, calls } = makeAdmin((call) => {
      if (call.table === 'bookings') return { data: [{ ...anchor, group_booking_id: 'grp-1' }] };
      if (call.table === 'service_variants') return { data: [{ id: 'sv1', price_pence: 3000 }] };
      if (call.table === 'booking_payments') return { data: [] };
      throw new Error(`unexpected table ${call.table}`);
    });
    await loadVisitPaymentPicture(admin, { ...anchor, group_booking_id: 'grp-1' }, { venueId: 'v9' });
    const siblingCall = calls.find((c) => c.table === 'bookings');
    expect(siblingCall?.filters).toContainEqual(['eq', 'venue_id', 'v9']);
  });

  it('a cancelled sibling is not owed for', async () => {
    const { admin } = makeAdmin((call) => {
      if (call.table === 'bookings') {
        return {
          data: [
            { ...anchor, group_booking_id: 'grp-1', status: 'Confirmed' },
            {
              id: 'b2',
              venue_id: 'v1',
              group_booking_id: 'grp-1',
              service_variant_id: 'sv2',
              status: 'Cancelled',
            },
          ],
        };
      }
      if (call.table === 'service_variants') return { data: [{ id: 'sv1', price_pence: 3000 }] };
      if (call.table === 'booking_payments') return { data: [] };
      throw new Error(`unexpected table ${call.table}`);
    });
    const visit = await loadVisitPaymentPicture(admin, { ...anchor, group_booking_id: 'grp-1' });
    expect(visit.bookingIds).toEqual(['b1']);
    expect(visit.totalPence).toBe(3000);
  });

  it('deposit contribution ignores non-Paid statuses', () => {
    expect(depositPaidContributionPence({ deposit_status: 'Waived', deposit_amount_pence: 500 })).toBe(0);
    expect(depositPaidContributionPence({ deposit_status: 'Refunded', deposit_amount_pence: 500 })).toBe(0);
    expect(depositPaidContributionPence({ deposit_status: 'Paid', deposit_amount_pence: 500 })).toBe(500);
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
      if (call.table === 'booking_payments') {
        return { data: ledger.map((r) => ({ booking_id: 'b1', ...r })) };
      }
      if (call.table === 'service_variants') {
        return { data: [{ id: 'variant-1', price_pence: variantPrice }] };
      }
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

  it('fans out across the visit: per-row amounts, visit-level state (§5.7)', async () => {
    // A visit payment of 8000 is anchored to b1. Each row's amount_paid_pence
    // stays its OWN (so revenue sums never double count), while payment_state
    // is the visit's, because the visit is settled as one unit.
    const siblings: Row[] = [
      { ...bookingRow, group_booking_id: 'grp-1' },
      {
        id: 'b2',
        venue_id: 'v1',
        group_booking_id: 'grp-1',
        service_variant_id: 'variant-2',
        addons_total_price_pence: 0,
        deposit_status: 'Not Required',
        deposit_amount_pence: null,
      },
    ];
    const updates: RecordedCall[] = [];
    const { admin } = makeAdmin((call) => {
      if (call.table === 'bookings' && call.op === 'select') {
        return { data: call.filters.some(([, k]) => k === 'group_booking_id') ? siblings : siblings[0] };
      }
      if (call.table === 'service_variants') {
        return { data: [{ id: 'variant-1', price_pence: 4500 }, { id: 'variant-2', price_pence: 4000 }] };
      }
      if (call.table === 'booking_payments') {
        return { data: [{ booking_id: 'b1', amount_pence: 8000, tip_amount_pence: 0, status: 'succeeded' }] };
      }
      if (call.table === 'bookings' && call.op === 'update') {
        updates.push(call);
        return { data: null };
      }
      throw new Error(`unexpected ${call.op} on ${call.table}`);
    });

    await recomputeBookingPaymentSummary(admin, 'b1');

    // Both rows updated.
    expect(updates).toHaveLength(2);
    const byId = (bid: string) =>
      updates.find((u) => u.filters.some(([, k, v]) => k === 'id' && v === bid))!.payload as Row;
    // visit total = (4500 + 500) + 4000 = 9000; paid = deposit 1000 + 8000 = 9000 → paid.
    expect(byId('b1').payment_state).toBe('paid');
    expect(byId('b2').payment_state).toBe('paid');
    // Per-row attribution: b1 holds its deposit + the anchored payment; b2 none.
    expect(byId('b1').amount_paid_pence).toBe(9000);
    expect(byId('b2').amount_paid_pence).toBe(0);
  });
});
