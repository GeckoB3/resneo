import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// The route reads STRIPE_WEBHOOK_SECRET at module load; set it before imports.
vi.hoisted(() => {
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_vitest';
});

vi.mock('stripe', () => {
  const StripeMock = class {} as unknown as { webhooks: { constructEvent: ReturnType<typeof vi.fn> } };
  StripeMock.webhooks = { constructEvent: vi.fn() };
  return { default: StripeMock };
});

// Run `after` callbacks inline so the receipt wiring is observable.
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return {
    ...actual,
    after: (fn: () => Promise<void> | void) => {
      void Promise.resolve(fn()).catch(() => {});
    },
  };
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
  sendPaymentReceiptEmail: vi.fn(async () => ({ sent: true })),
}));
vi.mock('@/lib/emails/venue-email-data', () => ({ venueRowToEmailData: vi.fn(() => ({})) }));
vi.mock('@/lib/booking/confirm-deposit-payment', () => ({
  confirmBookingsForSucceededPaymentIntent: vi.fn(),
  confirmBookingsForSucceededSetupIntent: vi.fn(),
  sendDepositPaidBookingComms: vi.fn(),
}));
vi.mock('@/lib/booking/confirm-balance-payment', () => ({
  confirmBalancePaymentFromPaymentIntent: vi.fn(),
  applyBalancePaymentRefundFromWebhook: vi.fn(async () => ({ applied: true, bookingId: 'b1', venueId: 'v1' })),
  markBalancePaymentFailedForPaymentIntent: vi.fn(async () => undefined),
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
import { confirmBookingsForSucceededPaymentIntent } from '@/lib/booking/confirm-deposit-payment';
import {
  applyBalancePaymentRefundFromWebhook,
  confirmBalancePaymentFromPaymentIntent,
  markBalancePaymentFailedForPaymentIntent,
} from '@/lib/booking/confirm-balance-payment';
import { sendPaymentReceiptEmail } from '@/lib/communications/send-templated';
import { POST } from './route';

const constructEventMock = vi.mocked(
  (Stripe as unknown as { webhooks: { constructEvent: ReturnType<typeof vi.fn> } }).webhooks
    .constructEvent,
);
const mockGetAdmin = vi.mocked(getSupabaseAdminClient);
const mockDepositConfirm = vi.mocked(confirmBookingsForSucceededPaymentIntent);
const mockBalanceConfirm = vi.mocked(confirmBalancePaymentFromPaymentIntent);
const mockBalanceRefund = vi.mocked(applyBalancePaymentRefundFromWebhook);
const mockBalanceFailed = vi.mocked(markBalancePaymentFailedForPaymentIntent);
const mockReceipt = vi.mocked(sendPaymentReceiptEmail);

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

function webhookRequest(): NextRequest {
  return new NextRequest('https://site.test/api/webhooks/stripe', {
    method: 'POST',
    body: '{}',
    headers: { 'stripe-signature': 'sig_test' },
  });
}

const BALANCE_META = {
  reserve_ni_purpose: 'appointment_balance',
  booking_id: 'b1',
  venue_id: 'v1',
};

function balanceSucceededEvent(metadata: Record<string, string> = BALANCE_META) {
  return {
    id: 'evt_bal_1',
    type: 'payment_intent.succeeded',
    created: 1751700000,
    account: 'acct_1',
    data: { object: { id: 'pi_bal_1', amount: 4000, amount_received: 4000, metadata } },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockBalanceConfirm.mockResolvedValue({
    applied: true,
    bookingId: 'b1',
    venueId: 'v1',
    amountPence: 4000,
  });
});

describe('webhook: appointment_balance PI routing (§6.4 / §11)', () => {
  it('routes a balance PI to the ledger confirm and NEVER to the deposit-confirmation path', async () => {
    // §11 requirement: the balance PI carries metadata.booking_id, so without
    // the purpose branch it would be misread as a deposit payment and confirm
    // the booking / stamp deposit_status.
    const { admin, calls } = makeAdmin(() => ({ data: [] }));
    mockGetAdmin.mockReturnValue(admin as never);
    constructEventMock.mockReturnValue(balanceSucceededEvent() as never);

    const res = await POST(webhookRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });

    expect(mockBalanceConfirm).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        paymentIntentId: 'pi_bal_1',
        bookingId: 'b1',
        venueId: 'v1',
        amountReceivedPence: 4000,
        connectedAccountId: 'acct_1',
      }),
    );
    // The deposit path must not run, and no booking row may be touched.
    expect(mockDepositConfirm).not.toHaveBeenCalled();
    expect(calls.filter((c) => c.table === 'bookings')).toHaveLength(0);
  });

  it('sends the receipt only when the confirm actually applied', async () => {
    const { admin } = makeAdmin(() => ({ data: [] }));
    mockGetAdmin.mockReturnValue(admin as never);
    constructEventMock.mockReturnValue(balanceSucceededEvent() as never);

    await POST(webhookRequest());
    await new Promise((r) => setTimeout(r, 0)); // let the inline `after` settle
    expect(mockReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: 'b1', venueId: 'v1', amountPaidPence: 4000 }),
    );
  });

  it('does not send a receipt on a replayed event (applied=false)', async () => {
    mockBalanceConfirm.mockResolvedValue({
      applied: false,
      bookingId: 'b1',
      venueId: 'v1',
      amountPence: 4000,
    });
    const { admin } = makeAdmin(() => ({ data: [] }));
    mockGetAdmin.mockReturnValue(admin as never);
    constructEventMock.mockReturnValue(balanceSucceededEvent() as never);

    await POST(webhookRequest());
    await new Promise((r) => setTimeout(r, 0));
    expect(mockReceipt).not.toHaveBeenCalled();
  });

  it('leaves a NON-balance PI on the deposit path (branch does not over-capture)', async () => {
    const { admin } = makeAdmin((call) => {
      if (call.table === 'bookings') {
        return { data: [{ id: 'b1', venue_id: 'v1', guest_id: 'g1', status: 'Pending', deposit_status: 'Pending', source: 'web' }] };
      }
      return { data: [] };
    });
    mockGetAdmin.mockReturnValue(admin as never);
    mockDepositConfirm.mockResolvedValue({ ok: true, alreadyConfirmed: true, confirmedIds: [] } as never);
    constructEventMock.mockReturnValue(
      balanceSucceededEvent({ booking_id: 'b1' }) as never, // no reserve_ni_purpose
    );

    await POST(webhookRequest());
    expect(mockBalanceConfirm).not.toHaveBeenCalled();
    expect(mockDepositConfirm).toHaveBeenCalled();
  });
});

describe('webhook: balance PI failure/cancel hygiene (§6.4)', () => {
  it('payment_intent.canceled on a balance PI flips the pending ledger row to failed', async () => {
    const { admin, calls } = makeAdmin(() => ({ data: [] }));
    mockGetAdmin.mockReturnValue(admin as never);
    constructEventMock.mockReturnValue({
      id: 'evt_cancel_1',
      type: 'payment_intent.canceled',
      created: 1751700000,
      data: { object: { id: 'pi_bal_1', metadata: BALANCE_META } },
    } as never);

    const res = await POST(webhookRequest());
    expect(res.status).toBe(200);
    expect(mockBalanceFailed).toHaveBeenCalledWith(admin, 'pi_bal_1');
    expect(calls.filter((c) => c.table === 'bookings')).toHaveLength(0);
  });

  it('payment_intent.canceled on an unrelated PI is ignored', async () => {
    const { admin } = makeAdmin(() => ({ data: [] }));
    mockGetAdmin.mockReturnValue(admin as never);
    constructEventMock.mockReturnValue({
      id: 'evt_cancel_2',
      type: 'payment_intent.canceled',
      created: 1751700000,
      data: { object: { id: 'pi_other', metadata: {} } },
    } as never);

    await POST(webhookRequest());
    expect(mockBalanceFailed).not.toHaveBeenCalled();
  });

  it('payment_failed on a balance PI marks the row failed and skips the deposit failure sweep', async () => {
    const { admin, calls } = makeAdmin(() => ({ data: [] }));
    mockGetAdmin.mockReturnValue(admin as never);
    constructEventMock.mockReturnValue({
      id: 'evt_fail_1',
      type: 'payment_intent.payment_failed',
      created: 1751700000,
      data: { object: { id: 'pi_bal_1', metadata: BALANCE_META, last_payment_error: { code: 'card_declined' } } },
    } as never);

    const res = await POST(webhookRequest());
    expect(res.status).toBe(200);
    expect(mockBalanceFailed).toHaveBeenCalledWith(admin, 'pi_bal_1');
    // The generic deposit-failure sweep queries bookings; it must not run.
    expect(calls.filter((c) => c.table === 'bookings')).toHaveLength(0);
  });
});

describe('webhook: charge.refunded on a balance PI (§6.4)', () => {
  const refundEvent = (amountRefunded: number) => ({
    id: `evt_ref_${amountRefunded}`,
    type: 'charge.refunded',
    created: 1751700000,
    account: 'acct_1',
    data: { object: { id: 'ch_1', payment_intent: 'pi_bal_1', amount: 4000, amount_refunded: amountRefunded } },
  });

  it('a FULL refund flips the ledger row and never touches bookings.deposit_status', async () => {
    const { admin, calls } = makeAdmin((call) => {
      if (call.table === 'booking_card_holds') return { data: [] };
      if (call.table === 'booking_payments') return { data: [{ id: 'pay-1' }] };
      return { data: [] };
    });
    mockGetAdmin.mockReturnValue(admin as never);
    constructEventMock.mockReturnValue(refundEvent(4000) as never);

    const res = await POST(webhookRequest());
    expect(res.status).toBe(200);
    expect(mockBalanceRefund).toHaveBeenCalledWith(admin, 'pi_bal_1');
    // The generic deposit-refund flip must not run for a balance PI.
    expect(calls.filter((c) => c.table === 'bookings')).toHaveLength(0);
  });

  it('a PARTIAL refund leaves the ledger untouched (v1 refunds are full-only)', async () => {
    const { admin } = makeAdmin((call) => {
      if (call.table === 'booking_card_holds') return { data: [] };
      if (call.table === 'booking_payments') return { data: [{ id: 'pay-1' }] };
      return { data: [] };
    });
    mockGetAdmin.mockReturnValue(admin as never);
    constructEventMock.mockReturnValue(refundEvent(1000) as never);

    const res = await POST(webhookRequest());
    expect(res.status).toBe(200);
    expect(mockBalanceRefund).not.toHaveBeenCalled();
  });
});
