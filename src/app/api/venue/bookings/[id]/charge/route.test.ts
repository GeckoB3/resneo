import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/venue-route-client', () => ({
  createVenueRouteClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
  })),
}));

vi.mock('@/lib/venue-auth', () => ({
  getVenueStaff: vi.fn(),
  requireAdmin: (staff: { role?: string } | null) => staff !== null && staff?.role === 'admin',
}));

vi.mock('@/lib/booking/staff-booking-access', () => ({
  loadStaffAccessibleBooking: vi.fn(),
  linkedGrantAllowsMutation: (
    grant: { act?: string } | null,
    isOwnVenue: boolean,
  ) => isOwnVenue || grant?.act === 'edit_existing' || grant?.act === 'create_edit_cancel',
}));

vi.mock('@/lib/stripe', () => ({
  stripe: {
    paymentIntents: { create: vi.fn() },
    refunds: { create: vi.fn() },
  },
}));

vi.mock('@/lib/booking/payment-summary', () => ({
  resolveBookingTotalPenceFromRow: vi.fn(),
  computeLiveAmountPaidPence: vi.fn(),
  recomputeBookingPaymentSummary: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/linked-accounts/audit', () => ({
  recordBookingWriteAudit: vi.fn().mockResolvedValue(undefined),
}));

import { stripe } from '@/lib/stripe';
import { getVenueStaff } from '@/lib/venue-auth';
import { loadStaffAccessibleBooking } from '@/lib/booking/staff-booking-access';
import {
  computeLiveAmountPaidPence,
  recomputeBookingPaymentSummary,
  resolveBookingTotalPenceFromRow,
} from '@/lib/booking/payment-summary';
import { POST } from './route';

const mockPiCreate = vi.mocked(stripe.paymentIntents.create);
const mockRefundCreate = vi.mocked(stripe.refunds.create);
const mockGetVenueStaff = vi.mocked(getVenueStaff);
const mockLoadBooking = vi.mocked(loadStaffAccessibleBooking);
const mockResolveTotal = vi.mocked(resolveBookingTotalPenceFromRow);
const mockLiveAmountPaid = vi.mocked(computeLiveAmountPaidPence);
const mockRecompute = vi.mocked(recomputeBookingPaymentSummary);

type Row = Record<string, unknown>;
type RecordedCall = {
  table: string;
  op: 'select' | 'update' | 'insert';
  payload?: unknown;
  filters: Array<[string, string, unknown]>;
};

/** Responder-driven fake for staff.db (venues + booking_payments). */
function makeDb(responder: (call: RecordedCall) => { data?: unknown; error?: unknown }) {
  const calls: RecordedCall[] = [];
  const db = {
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
      builder.maybeSingle = () => Promise.resolve(normalise(responder(call)));
      builder.then = (
        resolve: (v: unknown) => unknown,
        reject?: (e: unknown) => unknown,
      ) => Promise.resolve(normalise(responder(call))).then(resolve, reject);
      return builder;
    },
  };
  const normalise = (res: { data?: unknown; error?: unknown }) => ({
    data: res.data ?? null,
    error: res.error ?? null,
  });
  return { db, calls };
}

// Valid v4 UUIDs — zod's .uuid() enforces the version/variant nibbles.
const ATTEMPT = '11111111-2222-4333-8444-555555555555';
const PAYMENT_ID = '99999999-8888-4777-a666-555555555555';

const baseBooking = (): Row => ({
  id: 'b1',
  venue_id: 'v1',
  booking_model: 'unified_scheduling',
  practitioner_id: null,
  appointment_service_id: null,
  // Deliberately STALE (the live figure below is 1000): the route must derive
  // paid-so-far from computeLiveAmountPaidPence, never from this column — a
  // deposit paid after the last recompute is missing from it (overcharge bug).
  amount_paid_pence: 0,
  deposit_status: 'Paid',
  deposit_amount_pence: 1000,
  booking_total_price_pence: null,
  service_variant_id: 'sv1',
  addons_total_price_pence: 0,
  status: 'Confirmed',
});

function setup(opts?: {
  booking?: Row;
  venueRow?: Row | null;
  totalPence?: number | null;
  paymentRow?: Row | null;
  paymentInsertError?: { code: string; message: string } | null;
  role?: 'admin' | 'staff';
}) {
  const venueRow =
    opts?.venueRow === undefined
      ? { in_person_payments_enabled: true, stripe_connected_account_id: 'acct_1' }
      : opts.venueRow;
  const { db, calls } = makeDb((call) => {
    if (call.table === 'venues') return { data: venueRow };
    if (call.table === 'booking_payments' && call.op === 'select') {
      return { data: opts?.paymentRow ?? null };
    }
    if (call.table === 'booking_payments' && call.op === 'insert') {
      return opts?.paymentInsertError ? { error: opts.paymentInsertError } : {};
    }
    if (call.table === 'booking_payments' && call.op === 'update') return {};
    throw new Error(`unexpected ${call.op} on ${call.table}`);
  });

  mockGetVenueStaff.mockResolvedValue({
    id: 'staff-1',
    venue_id: 'v1',
    email: 's@example.com',
    role: opts?.role ?? 'admin',
    db,
  } as unknown as Awaited<ReturnType<typeof getVenueStaff>>);

  mockLoadBooking.mockResolvedValue({
    ok: true,
    ctx: {
      booking: opts?.booking ?? baseBooking(),
      ownerVenueId: 'v1',
      isOwnVenue: true,
      linkedGrant: null,
      linkId: null,
    },
  } as unknown as Awaited<ReturnType<typeof loadStaffAccessibleBooking>>);

  mockResolveTotal.mockResolvedValue(opts?.totalPence === undefined ? 5000 : opts.totalPence);
  // The LIVE paid-so-far figure (paid deposit + succeeded ledger rows).
  mockLiveAmountPaid.mockResolvedValue(1000);

  mockPiCreate.mockResolvedValue({
    id: 'pi_new',
    client_secret: 'cs_test',
  } as unknown as Awaited<ReturnType<typeof mockPiCreate>>);

  return { calls };
}

function post(body: unknown) {
  const request = { json: async () => body } as unknown as NextRequest;
  return POST(request, { params: Promise.resolve({ id: 'b1' }) });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('charge route — card_present (§6.3c)', () => {
  it('creates a card_present PI on the connected account with the balance and no application fee', async () => {
    const { calls } = setup();
    const res = await post({ method: 'card_present', attempt_id: ATTEMPT });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ payment_intent_id: 'pi_new', client_secret: 'cs_test', amount_pence: 4000 });

    expect(mockPiCreate).toHaveBeenCalledTimes(1);
    const [params, options] = mockPiCreate.mock.calls[0]!;
    expect(params).toMatchObject({
      amount: 4000, // total 5000 − deposit 1000
      currency: 'gbp',
      payment_method_types: ['card_present'],
      capture_method: 'automatic',
      metadata: expect.objectContaining({
        booking_id: 'b1',
        venue_id: 'v1',
        reserve_ni_purpose: 'appointment_balance',
      }),
    });
    // §9 — 0% platform fee guarantee: the key must not exist at all.
    expect(Object.keys(params as object)).not.toContain('application_fee_amount');
    expect(options).toMatchObject({
      stripeAccount: 'acct_1',
      idempotencyKey: `balance:b1:${ATTEMPT}`,
    });

    const insert = calls.find((c) => c.table === 'booking_payments' && c.op === 'insert');
    expect(insert?.payload).toMatchObject({
      booking_id: 'b1',
      venue_id: 'v1',
      stripe_payment_intent_id: 'pi_new',
      method: 'card_present',
      status: 'pending',
      amount_pence: 4000,
      staff_id: 'staff-1',
    });
  });

  it('rejects card_present without an attempt_id', async () => {
    setup();
    const res = await post({ method: 'card_present' });
    expect(res.status).toBe(400);
    expect(mockPiCreate).not.toHaveBeenCalled();
  });

  it('clamps a staff-entered amount to the outstanding balance', async () => {
    setup();
    const res = await post({ method: 'card_present', attempt_id: ATTEMPT, amount_pence: 99_999 });
    expect(res.status).toBe(200);
    expect((await res.json()).amount_pence).toBe(4000);
  });

  it('accepts a smaller staff-entered amount unchanged (partial settlement)', async () => {
    setup();
    const res = await post({ method: 'card_present', attempt_id: ATTEMPT, amount_pence: 500 });
    expect((await res.json()).amount_pence).toBe(500);
  });

  it('unknown price: requires a staff-entered amount and charges exactly it', async () => {
    setup({ totalPence: null });
    const missing = await post({ method: 'card_present', attempt_id: ATTEMPT });
    expect(missing.status).toBe(400);
    expect(mockPiCreate).not.toHaveBeenCalled();

    const withAmount = await post({
      method: 'card_present',
      attempt_id: ATTEMPT,
      amount_pence: 2000,
    });
    expect(withAmount.status).toBe(200);
    expect((await withAmount.json()).amount_pence).toBe(2000);
  });

  it('refuses when nothing is left to pay', async () => {
    setup({ totalPence: 1000 }); // equals amount_paid_pence
    const res = await post({ method: 'card_present', attempt_id: ATTEMPT });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Nothing left to pay.');
  });

  it('derives the balance from the LIVE paid amount, never the stale denormalised column', async () => {
    // Fixture: bookings.amount_paid_pence = 0 (stale) but the live derivation
    // returns 1000 (a deposit paid since the last recompute). Trusting the
    // column would charge £50 instead of £40 — the overcharge bug.
    setup();
    const res = await post({ method: 'card_present', attempt_id: ATTEMPT });
    expect(mockLiveAmountPaid).toHaveBeenCalledWith(
      expect.anything(),
      'b1',
      expect.objectContaining({ deposit_status: 'Paid', deposit_amount_pence: 1000 }),
    );
    expect((await res.json()).amount_pence).toBe(4000); // 5000 − live 1000, not 5000 − stale 0
  });

  it('409s a reused attempt_id with different details instead of masking it as a capability error', async () => {
    setup();
    mockPiCreate.mockRejectedValue(
      Object.assign(new Error('Keys for idempotent requests...'), { type: 'StripeIdempotencyError' }),
    );
    const res = await post({ method: 'card_present', attempt_id: ATTEMPT, amount_pence: 2000 });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain('already started');
  });

  it('treats a 23505 on the ledger insert as an idempotent replay, not an error', async () => {
    setup({ paymentInsertError: { code: '23505', message: 'duplicate key' } });
    const res = await post({ method: 'card_present', attempt_id: ATTEMPT });
    expect(res.status).toBe(200);
  });

  it('equal-amount split payments mint distinct PIs via distinct attempt ids', async () => {
    setup();
    const otherAttempt = 'aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee';
    await post({ method: 'card_present', attempt_id: ATTEMPT, amount_pence: 2000 });
    await post({ method: 'card_present', attempt_id: otherAttempt, amount_pence: 2000 });
    expect(mockPiCreate).toHaveBeenCalledTimes(2);
    const keys = mockPiCreate.mock.calls.map((c) => (c[1] as { idempotencyKey: string }).idempotencyKey);
    expect(keys).toEqual([`balance:b1:${ATTEMPT}`, `balance:b1:${otherAttempt}`]);
  });
});

describe('charge route — gates', () => {
  it('403s the whole endpoint when the venue flag is off (§6.7)', async () => {
    setup({ venueRow: { in_person_payments_enabled: false, stripe_connected_account_id: 'acct_1' } });
    const res = await post({ method: 'cash', amount_pence: 100 });
    expect(res.status).toBe(403);
  });

  it('rejects non-appointment bookings (§6.3 step 3)', async () => {
    setup({ booking: { ...baseBooking(), booking_model: 'table_reservation' } });
    const res = await post({ method: 'cash', amount_pence: 100 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('In-person payment is only available for appointments.');
  });

  it('legacy null booking_model with practitioner + service ids counts as an appointment', async () => {
    setup({
      booking: {
        ...baseBooking(),
        booking_model: null,
        practitioner_id: 'p1',
        appointment_service_id: 'as1',
      },
    });
    const res = await post({ method: 'cash', amount_pence: 100 });
    expect(res.status).toBe(200);
  });

  it('400s when a venue has the flag on but no connected account (card only)', async () => {
    setup({ venueRow: { in_person_payments_enabled: true, stripe_connected_account_id: null } });
    const res = await post({ method: 'card_present', attempt_id: ATTEMPT });
    expect(res.status).toBe(400);
    expect(mockPiCreate).not.toHaveBeenCalled();
  });
});

describe('charge route — cash/external (§6.3b)', () => {
  it('inserts a succeeded ledger row and recomputes the summary', async () => {
    const { calls } = setup();
    const res = await post({ method: 'cash', note: 'paid at desk' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });

    const insert = calls.find((c) => c.table === 'booking_payments' && c.op === 'insert');
    expect(insert?.payload).toMatchObject({
      booking_id: 'b1',
      method: 'cash',
      status: 'succeeded',
      amount_pence: 4000, // defaults to the full balance
      staff_id: 'staff-1',
      note: 'paid at desk',
    });
    expect(mockRecompute).toHaveBeenCalledWith(expect.anything(), 'b1');
    expect(mockPiCreate).not.toHaveBeenCalled();
  });
});

describe('charge route — refund (§6.3a, full-only)', () => {
  const succeededCardRow = (): Row => ({
    id: PAYMENT_ID,
    booking_id: 'b1',
    venue_id: 'v1',
    stripe_connected_account_id: 'acct_SNAP',
    stripe_payment_intent_id: 'pi_paid',
    method: 'card_present',
    status: 'succeeded',
    amount_pence: 4000,
    note: null,
  });

  it('non-admins get a 403 before anything is looked up', async () => {
    setup({ role: 'staff' });
    const res = await post({ action: 'refund', payment_id: PAYMENT_ID });
    expect(res.status).toBe(403);
    expect(mockRefundCreate).not.toHaveBeenCalled();
  });

  it('card rows refund in full on the SNAPSHOTTED account; the webhook owns the ledger flip', async () => {
    const { calls } = setup({ paymentRow: succeededCardRow() });
    mockRefundCreate.mockResolvedValue({} as Awaited<ReturnType<typeof mockRefundCreate>>);
    const res = await post({ action: 'refund', payment_id: PAYMENT_ID });
    expect(res.status).toBe(200);

    // The refunds.create overloads collapse the mocked tuple type; widen it.
    const [params, options] = mockRefundCreate.mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(params).toEqual({ payment_intent: 'pi_paid' }); // full — no amount key
    expect(options).toMatchObject({
      stripeAccount: 'acct_SNAP',
      idempotencyKey: 'refund:pi_paid',
    });
    // No direct ledger write for card refunds — charge.refunded does it.
    expect(calls.some((c) => c.table === 'booking_payments' && c.op === 'update')).toBe(false);
    expect(mockRecompute).not.toHaveBeenCalled();
  });

  it('cash rows reverse directly with no Stripe call, then recompute', async () => {
    const { calls } = setup({
      paymentRow: { ...succeededCardRow(), method: 'cash', stripe_payment_intent_id: null, stripe_connected_account_id: null },
    });
    const res = await post({ action: 'refund', payment_id: PAYMENT_ID });
    expect(res.status).toBe(200);
    expect(mockRefundCreate).not.toHaveBeenCalled();

    const update = calls.find((c) => c.table === 'booking_payments' && c.op === 'update');
    expect(update?.payload).toMatchObject({ status: 'refunded' });
    expect(update?.filters).toContainEqual(['eq', 'status', 'succeeded']);
    expect(mockRecompute).toHaveBeenCalledWith(expect.anything(), 'b1');
  });

  it('409s a row that is not in the succeeded state', async () => {
    setup({ paymentRow: { ...succeededCardRow(), status: 'pending' } });
    const res = await post({ action: 'refund', payment_id: PAYMENT_ID });
    expect(res.status).toBe(409);
    expect(mockRefundCreate).not.toHaveBeenCalled();
  });

  it('treats charge_already_refunded as convergence, not failure', async () => {
    setup({ paymentRow: succeededCardRow() });
    mockRefundCreate.mockRejectedValue(Object.assign(new Error('already'), { code: 'charge_already_refunded' }));
    const res = await post({ action: 'refund', payment_id: PAYMENT_ID });
    expect(res.status).toBe(200);
  });
});
