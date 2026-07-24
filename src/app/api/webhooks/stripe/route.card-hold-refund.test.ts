import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// The route reads STRIPE_WEBHOOK_SECRET at module load; set it before imports.
vi.hoisted(() => {
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_vitest';
});

// Signature verification uses the static Stripe.webhooks.constructEvent from
// the 'stripe' package (not the '@/lib/stripe' client instance): mock it so
// the test controls the parsed event directly.
vi.mock('stripe', () => {
  const StripeMock = class {} as unknown as { webhooks: { constructEvent: ReturnType<typeof vi.fn> } };
  StripeMock.webhooks = { constructEvent: vi.fn() };
  return { default: StripeMock };
});

vi.mock('@/lib/stripe', () => ({
  stripe: {
    charges: { retrieve: vi.fn() },
    setupIntents: { retrieve: vi.fn() },
    paymentIntents: { retrieve: vi.fn() },
  },
}));

vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: vi.fn() }));

vi.mock('@/lib/webhooks/stripe-event-idempotency', () => ({
  claimStripeWebhookEvent: vi.fn(async () => 'claimed'),
  markStripeWebhookEventProcessed: vi.fn(async () => undefined),
  releaseStripeWebhookEvent: vi.fn(async () => undefined),
}));

vi.mock('@/lib/communications', () => ({ sendCommunication: vi.fn() }));
vi.mock('@/lib/communications/send-templated', () => ({
  sendCardHoldChargedReceipt: vi.fn(),
}));
vi.mock('@/lib/emails/venue-email-data', () => ({ venueRowToEmailData: vi.fn(() => ({})) }));
vi.mock('@/lib/booking/confirm-deposit-payment', () => ({
  confirmBookingsForSucceededPaymentIntent: vi.fn(),
  confirmBookingsForSucceededSetupIntent: vi.fn(),
  sendDepositPaidBookingComms: vi.fn(),
}));
vi.mock('@/lib/booking/card-hold-charge', () => ({
  applyCardHoldChargeRefund: vi.fn(),
  completeCardHoldChargeFromWebhook: vi.fn(),
  recordCardHoldChargeFailure: vi.fn(),
}));
vi.mock('@/lib/booking/card-hold-release', () => ({
  releaseCardHoldsForBookings: vi.fn(async () => ({ releasedBookingIds: [], deletedCustomerIds: [] })),
}));
vi.mock('@/lib/class-commerce/fulfill-credit-purchase', () => ({
  fulfillClassCreditPurchaseFromPaymentIntent: vi.fn(),
}));
vi.mock('@/lib/class-commerce/fulfill-course-enrollment', () => ({
  fulfillCourseEnrollmentFromPaymentIntent: vi.fn(),
}));
vi.mock('@/lib/class-commerce/sync-membership-from-stripe', () => ({
  syncClassMembershipFromStripeSubscription: vi.fn(),
}));
vi.mock('@/lib/sales/invoice-revenue', () => ({ recordSalesRevenueRefund: vi.fn() }));
vi.mock('@/lib/class-commerce/restore-class-credits', () => ({
  restoreClassCreditsForBooking: vi.fn(),
}));
vi.mock('@/lib/class-commerce/restore-membership-allowance', () => ({
  restoreMembershipAllowanceForBooking: vi.fn(),
}));
vi.mock('@/lib/class-commerce/booking-was-credit-paid', () => ({
  bookingWasCreditPaid: vi.fn(async () => false),
  bookingWasMembershipPaid: vi.fn(async () => false),
}));
vi.mock('@/lib/table-management/lifecycle', () => ({
  applyBookingLifecycleStatusEffects: vi.fn(),
}));

import Stripe from 'stripe';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { applyCardHoldChargeRefund } from '@/lib/booking/card-hold-charge';
import { releaseCardHoldsForBookings } from '@/lib/booking/card-hold-release';
import { POST } from './route';

const constructEventMock = vi.mocked(
  (Stripe as unknown as { webhooks: { constructEvent: ReturnType<typeof vi.fn> } }).webhooks
    .constructEvent,
);
const mockGetAdmin = vi.mocked(getSupabaseAdminClient);

/**
 * Filter-aware scriptable fake supabase, mirroring
 * src/lib/booking/confirm-deposit-payment.test.ts: every query is recorded and
 * answered by applying the recorded eq/in/is filters to in-memory rows, so
 * removing a guard filter from the route changes which rows match.
 */
type RecordedCall = {
  table: string;
  op: 'select' | 'update' | 'insert';
  payload?: unknown;
  filters: Array<[string, string, unknown]>;
};

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
      builder.limit = chain(() => {});
      builder.maybeSingle = async () => {
        const r = responder(call);
        const rows = Array.isArray(r.data) ? r.data : r.data ? [r.data] : [];
        return { data: rows[0] ?? null, error: r.error ?? null };
      };
      builder.single = builder.maybeSingle;
      builder.then = (
        resolve: (value: unknown) => unknown,
        reject: (reason?: unknown) => unknown,
      ) => Promise.resolve(responder(call)).then(resolve, reject);
      return builder;
    },
  };
  return { admin, calls };
}

const rowsMatching = (rows: Array<Record<string, unknown>>, call: RecordedCall) =>
  rows.filter((row) =>
    call.filters.every(([op, key, value]) => {
      if (op === 'eq') return row[key] === value;
      if (op === 'in') return Array.isArray(value) && value.includes(row[key]);
      if (op === 'is') return value === null ? row[key] == null : row[key] === value;
      return true;
    }),
  );

const filterValue = (call: RecordedCall, key: string) =>
  call.filters.find(([, k]) => k === key)?.[2];

function refundedRequest(): NextRequest {
  return new NextRequest('https://site.test/api/webhooks/stripe', {
    method: 'POST',
    body: '{}',
    headers: { 'stripe-signature': 'sig_test' },
  });
}

const refundedEvent = {
  id: 'evt_refund_1',
  type: 'charge.refunded',
  created: 1751700000,
  data: {
    object: {
      id: 'ch_1',
      payment_intent: 'pi_unit_1',
      amount: 2000,
      amount_refunded: 2000,
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/webhooks/stripe charge.refunded on a mixed payment_with_setup unit (spec 8.6.6)', () => {
  it('flips only the money row to Refunded and leaves the sibling Card Held row and its hold untouched', async () => {
    // One PI shared by the whole capture unit: a money row (deposit paid) and
    // a card-hold row (deposit_amount_pence NULL, open hold). Refunding the
    // money part must not stamp the hold sibling 'Refunded'.
    const bookings: Array<Record<string, unknown>> = [
      {
        id: 'b-money',
        stripe_payment_intent_id: 'pi_unit_1',
        deposit_status: 'Paid',
        venue_id: 'venue-1',
        guest_id: 'g1',
        status: 'Booked',
      },
      {
        id: 'b-held',
        stripe_payment_intent_id: 'pi_unit_1',
        deposit_status: 'Card Held',
        venue_id: 'venue-1',
        guest_id: 'g1',
        status: 'Booked',
      },
    ];
    const holds: Array<Record<string, unknown>> = [
      {
        id: 'h1',
        booking_id: 'b-held',
        venue_id: 'venue-1',
        charged_pence: null,
        charge_payment_intent_id: null,
        released_at: null,
      },
    ];

    const { admin, calls } = makeAdmin((call) => {
      if (call.table === 'booking_card_holds' && call.op === 'select') {
        return { data: rowsMatching(holds, call), error: null };
      }
      // In-person balance ledger (§6.4): this PI is not a balance payment.
      if (call.table === 'booking_payments' && call.op === 'select') {
        return { data: [], error: null };
      }
      if (call.table === 'bookings' && call.op === 'select') {
        return { data: rowsMatching(bookings, call), error: null };
      }
      if (call.table === 'bookings' && call.op === 'update') {
        const matched = rowsMatching(bookings, call);
        for (const row of matched) Object.assign(row, call.payload as Record<string, unknown>);
        return { data: matched.map((r) => ({ id: r.id })), error: null };
      }
      throw new Error(`unexpected call ${call.table} ${call.op}`);
    });
    mockGetAdmin.mockReturnValue(admin as never);
    constructEventMock.mockReturnValue(refundedEvent as never);

    const res = await POST(refundedRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });

    // The generic flip targeted the money row ONLY.
    const refundFlip = calls.find((c) => c.table === 'bookings' && c.op === 'update');
    expect(refundFlip).toBeTruthy();
    expect(refundFlip?.payload).toMatchObject({ deposit_status: 'Refunded' });
    expect(filterValue(refundFlip!, 'id')).toEqual(['b-money']);

    expect(bookings[0]).toMatchObject({ id: 'b-money', deposit_status: 'Refunded' });
    // The sibling hold row keeps its live hold and 'Card Held' status.
    expect(bookings[1]).toMatchObject({ id: 'b-held', deposit_status: 'Card Held', status: 'Booked' });
    expect(releaseCardHoldsForBookings).not.toHaveBeenCalled();
    // No hold carries this PI as a fee charge, so the fee branch never fires.
    expect(applyCardHoldChargeRefund).not.toHaveBeenCalled();
  });

  it('does nothing to bookings when every row in the unit has a hold (hold-only unit refund)', async () => {
    const bookings: Array<Record<string, unknown>> = [
      {
        id: 'b-held',
        stripe_payment_intent_id: 'pi_unit_1',
        deposit_status: 'Card Held',
        venue_id: 'venue-1',
        guest_id: 'g1',
        status: 'Booked',
      },
    ];
    const holds: Array<Record<string, unknown>> = [
      {
        id: 'h1',
        booking_id: 'b-held',
        venue_id: 'venue-1',
        charged_pence: null,
        charge_payment_intent_id: null,
        released_at: null,
      },
    ];

    const { admin, calls } = makeAdmin((call) => {
      if (call.table === 'booking_card_holds' && call.op === 'select') {
        return { data: rowsMatching(holds, call), error: null };
      }
      // In-person balance ledger (§6.4): this PI is not a balance payment.
      if (call.table === 'booking_payments' && call.op === 'select') {
        return { data: [], error: null };
      }
      if (call.table === 'bookings' && call.op === 'select') {
        return { data: rowsMatching(bookings, call), error: null };
      }
      throw new Error(`unexpected call ${call.table} ${call.op}`);
    });
    mockGetAdmin.mockReturnValue(admin as never);
    constructEventMock.mockReturnValue(refundedEvent as never);

    const res = await POST(refundedRequest());
    expect(res.status).toBe(200);

    expect(calls.filter((c) => c.table === 'bookings' && c.op === 'update')).toHaveLength(0);
    expect(bookings[0]).toMatchObject({ id: 'b-held', deposit_status: 'Card Held' });
  });
});
