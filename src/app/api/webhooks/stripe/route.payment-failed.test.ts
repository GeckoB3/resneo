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
vi.mock('@/lib/communications/staff-push-notification', () => ({
  sendStaffPush: vi.fn(async () => undefined),
}));
vi.mock('@/lib/emails/venue-email-data', () => ({ venueRowToEmailData: vi.fn(() => ({})) }));
vi.mock('@/lib/booking/confirm-deposit-payment', () => ({
  confirmBookingsForSucceededPaymentIntent: vi.fn(),
  confirmBookingsForSucceededSetupIntent: vi.fn(),
  sendDepositPaidBookingComms: vi.fn(),
}));
vi.mock('@/lib/booking/confirm-balance-payment', () => ({
  confirmBalancePaymentFromPaymentIntent: vi.fn(),
  applyBalancePaymentRefundFromWebhook: vi.fn(),
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
import { sendStaffPush } from '@/lib/communications/staff-push-notification';
import { sendCommunication } from '@/lib/communications';
import { confirmBookingsForSucceededPaymentIntent } from '@/lib/booking/confirm-deposit-payment';
import { POST } from './route';

const constructEventMock = vi.mocked(
  (Stripe as unknown as { webhooks: { constructEvent: ReturnType<typeof vi.fn> } }).webhooks
    .constructEvent,
);
const mockGetAdmin = vi.mocked(getSupabaseAdminClient);
const mockStaffPush = vi.mocked(sendStaffPush);
const mockSendCommunication = vi.mocked(sendCommunication);
const mockDepositConfirm = vi.mocked(confirmBookingsForSucceededPaymentIntent);

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
      for (const op of ['eq', 'in', 'is', 'gte', 'lte', 'lt', 'not'] as const) {
        builder[op] = chain((k, v) => call.filters.push([op, k as string, v]));
      }
      builder.order = chain(() => {});
      builder.limit = chain(() => {});
      builder.single = async () => {
        const r = responder(call);
        const rows = Array.isArray(r.data) ? r.data : r.data ? [r.data] : [];
        return { data: rows[0] ?? null, error: r.error ?? null };
      };
      builder.maybeSingle = builder.single;
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
    headers: { 'stripe-signature': 'sig' },
  });
}

const FAILED_ROW = {
  id: 'b1',
  venue_id: 'venue-1',
  guest_id: 'g1',
  status: 'Pending',
  booking_date: '2026-08-14',
  booking_time: '11:15:00',
  guest_first_name: 'Mia',
  guest_last_name: 'Graydon',
};

function failedEvent(): Record<string, unknown> {
  return {
    id: 'evt_fail_generic',
    type: 'payment_intent.payment_failed',
    created: 1_754_700_000,
    data: {
      object: {
        id: 'pi_1',
        metadata: {},
        last_payment_error: { code: 'card_declined', message: 'declined' },
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('payment_intent.payment_failed (generic deposit branch, plan Phase 2)', () => {
  it('flips rows to Failed, inserts deposit_payment_failed events, pushes staff once per venue', async () => {
    constructEventMock.mockReturnValue(failedEvent() as never);

    const eventInserts: unknown[] = [];
    const { admin } = makeAdmin((call) => {
      if (call.table === 'bookings' && call.op === 'select') {
        return { data: [FAILED_ROW], error: null };
      }
      if (call.table === 'bookings' && call.op === 'update') {
        return { data: null, error: null };
      }
      if (call.table === 'events' && call.op === 'insert') {
        eventInserts.push(call.payload);
        return { data: null, error: null };
      }
      if (call.table === 'venues' && call.op === 'select') {
        return { data: [{ name: 'Venue One', kitchen_email: null }], error: null };
      }
      return { data: [], error: null };
    });
    mockGetAdmin.mockReturnValue(admin as never);

    const res = await POST(webhookRequest());
    expect(res.status).toBe(200);

    expect(eventInserts).toHaveLength(1);
    expect(eventInserts[0]).toEqual([
      expect.objectContaining({
        booking_id: 'b1',
        venue_id: 'venue-1',
        event_type: 'deposit_payment_failed',
        payload: { payment_intent_id: 'pi_1', failure_code: 'card_declined' },
      }),
    ]);

    expect(mockStaffPush).toHaveBeenCalledTimes(1);
    expect(mockStaffPush).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'b1', guest_name: 'Mia Graydon' }),
      { name: 'Venue One' },
      'venue-1',
      'payment_failed',
    );
    // No kitchen_email configured: no custom message.
    expect(mockSendCommunication).not.toHaveBeenCalled();
  });

  it('an events insert failure is best-effort: the webhook still acks 200', async () => {
    constructEventMock.mockReturnValue(failedEvent() as never);

    const { admin } = makeAdmin((call) => {
      if (call.table === 'bookings' && call.op === 'select') {
        return { data: [FAILED_ROW], error: null };
      }
      if (call.table === 'bookings' && call.op === 'update') {
        return { data: null, error: null };
      }
      if (call.table === 'events' && call.op === 'insert') {
        return { data: null, error: { message: 'events table unavailable' } };
      }
      if (call.table === 'venues' && call.op === 'select') {
        return { data: [{ name: 'Venue One', kitchen_email: null }], error: null };
      }
      return { data: [], error: null };
    });
    mockGetAdmin.mockReturnValue(admin as never);

    const res = await POST(webhookRequest());
    expect(res.status).toBe(200);
    expect(mockStaffPush).toHaveBeenCalledTimes(1);
  });
});

describe('payment_intent.succeeded PI-linkage backfill (plan 8.1 companion)', () => {
  it('backfills a NULL stripe_payment_intent_id from metadata before confirming', async () => {
    constructEventMock.mockReturnValue({
      id: 'evt_success_backfill',
      type: 'payment_intent.succeeded',
      created: 1_754_700_000,
      data: {
        object: {
          id: 'pi_9',
          metadata: { booking_id: 'b1' },
          payment_method: 'pm_1',
        },
      },
    } as never);
    mockDepositConfirm.mockResolvedValue({ ok: true, confirmedIds: [], depositOnlyIds: [], alreadyConfirmed: true });

    const backfillCalls: RecordedCall[] = [];
    const { admin } = makeAdmin((call) => {
      if (call.table === 'bookings' && call.op === 'select') {
        return {
          data: [
            {
              id: 'b1',
              venue_id: 'venue-1',
              guest_id: 'g1',
              status: 'Pending',
              deposit_status: 'Pending',
              source: 'booking_page',
              stripe_payment_intent_id: null,
            },
          ],
          error: null,
        };
      }
      if (call.table === 'bookings' && call.op === 'update') {
        backfillCalls.push(call);
        return { data: null, error: null };
      }
      return { data: [], error: null };
    });
    mockGetAdmin.mockReturnValue(admin as never);

    const res = await POST(webhookRequest());
    expect(res.status).toBe(200);

    expect(backfillCalls).toHaveLength(1);
    expect(backfillCalls[0]!.payload).toMatchObject({ stripe_payment_intent_id: 'pi_9' });
    expect(backfillCalls[0]!.filters).toEqual(
      expect.arrayContaining([
        ['in', 'id', ['b1']],
        ['is', 'stripe_payment_intent_id', null],
      ]),
    );
    expect(mockDepositConfirm).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ paymentIntentId: 'pi_9', venueId: 'venue-1' }),
    );
  });

  it('never rewrites an existing linkage', async () => {
    constructEventMock.mockReturnValue({
      id: 'evt_success_no_backfill',
      type: 'payment_intent.succeeded',
      created: 1_754_700_000,
      data: {
        object: { id: 'pi_9', metadata: { booking_id: 'b1' }, payment_method: 'pm_1' },
      },
    } as never);
    mockDepositConfirm.mockResolvedValue({ ok: true, confirmedIds: [], depositOnlyIds: [], alreadyConfirmed: true });

    const updates: RecordedCall[] = [];
    const { admin } = makeAdmin((call) => {
      if (call.table === 'bookings' && call.op === 'select') {
        return {
          data: [
            {
              id: 'b1',
              venue_id: 'venue-1',
              guest_id: 'g1',
              status: 'Pending',
              deposit_status: 'Pending',
              source: 'booking_page',
              stripe_payment_intent_id: 'pi_9',
            },
          ],
          error: null,
        };
      }
      if (call.table === 'bookings' && call.op === 'update') {
        updates.push(call);
        return { data: null, error: null };
      }
      return { data: [], error: null };
    });
    mockGetAdmin.mockReturnValue(admin as never);

    const res = await POST(webhookRequest());
    expect(res.status).toBe(200);
    expect(updates).toHaveLength(0);
  });
});
