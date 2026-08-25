import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * PM-1 (August 2026 codebase audit).
 *
 * Recording a cash deposit cancels the open PaymentIntent but used to leave its
 * id on the row. Every cancel path reads "Paid + a PI id" as "refundable at
 * Stripe", so the refund threw and nothing converged: the booking became
 * permanently uncancellable in-product, and the reconciliation cron alerted on
 * it nightly.
 *
 * These pin both halves of the fix: the settle clears the dead reference, and
 * the refund action refuses honestly instead of returning a bare 502.
 */

vi.mock('@/lib/supabase/venue-route-client', () => ({
  createVenueRouteClient: vi.fn(),
}));

vi.mock('@/lib/venue-auth', () => ({
  getVenueStaff: vi.fn(),
  requireAdmin: (staff: { role?: string } | null) => staff !== null && staff.role === 'admin',
}));

vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: vi.fn() }));

vi.mock('@/lib/stripe', () => ({
  stripe: { refunds: { create: vi.fn() }, paymentIntents: { retrieve: vi.fn() } },
}));

vi.mock('@/lib/booking/staff-booking-access', () => ({
  loadStaffAccessibleBooking: vi.fn(),
  linkedGrantAllowsMutation: vi.fn().mockReturnValue(true),
}));

vi.mock('@/lib/booking/cancel-open-deposit-intent', () => ({
  cancelOpenDepositIntentForBookings: vi.fn(),
}));

vi.mock('@/lib/booking/deposit-refund-convergence', () => ({
  classifyDepositRefundFailure: vi.fn(),
}));

vi.mock('@/lib/booking/shared-deposit-refund', () => ({
  planSharedDepositRefund: vi
    .fn()
    .mockResolvedValue({ amountPence: null, refundedBookingIds: [], coversWholeIntent: true, idempotencyKey: 'k' }),
}));

vi.mock('@/lib/booking/card-hold-charge', () => ({
  chargeCardHoldNoShowFee: vi.fn(),
  applyCardHoldChargeRefund: vi.fn().mockResolvedValue({ applied: true }),
}));

vi.mock('@/lib/booking/card-hold-release', () => ({
  releaseCardHoldsForBookings: vi.fn().mockResolvedValue({ releasedBookingIds: [], deletedCustomerIds: [] }),
}));

vi.mock('@/lib/linked-accounts/audit', () => ({ recordBookingWriteAudit: vi.fn() }));
vi.mock('@/lib/booking-short-links', () => ({
  createOrGetPaymentShortLink: vi.fn().mockResolvedValue('https://app.test/b/pay'),
}));
vi.mock('@/lib/communications/send-templated', () => ({
  sendDepositRequestNotifications: vi.fn(),
  sendCardHoldRequestNotifications: vi.fn(),
}));

import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';
import { loadStaffAccessibleBooking } from '@/lib/booking/staff-booking-access';
import { cancelOpenDepositIntentForBookings } from '@/lib/booking/cancel-open-deposit-intent';
import { classifyDepositRefundFailure } from '@/lib/booking/deposit-refund-convergence';
import { POST } from './route';

const mockCreateVenueRouteClient = vi.mocked(createVenueRouteClient);
const mockGetVenueStaff = vi.mocked(getVenueStaff);
const mockGetAdmin = vi.mocked(getSupabaseAdminClient);
const mockLoadBooking = vi.mocked(loadStaffAccessibleBooking);
const mockCancelIntent = vi.mocked(cancelOpenDepositIntentForBookings);
const mockClassify = vi.mocked(classifyDepositRefundFailure);
const mockRefundCreate = vi.mocked(stripe.refunds.create);

const BOOKING_ID = 'b0000000-0000-4000-8000-000000000001';
const VENUE_ID = 'a0000000-0000-4000-8000-000000000001';
const PI_ID = 'pi_cash_settled';

type Row = Record<string, unknown>;

function setup(bookingOverrides: Row) {
  const booking: Row = {
    id: BOOKING_ID,
    venue_id: VENUE_ID,
    guest_id: 'g1',
    status: 'Booked',
    deposit_status: 'Pending',
    deposit_amount_pence: 1500,
    stripe_payment_intent_id: PI_ID,
    booking_date: '2026-09-01',
    booking_time: '10:00:00',
    party_size: 1,
    booking_model: 'appointment',
    ...bookingOverrides,
  };
  const bookingUpdates: Row[] = [];

  mockCreateVenueRouteClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
  } as never);
  mockGetVenueStaff.mockResolvedValue({
    id: 'staff-1',
    venue_id: VENUE_ID,
    email: 'staff@example.com',
    role: 'admin',
    db: {} as never,
  } as never);
  mockLoadBooking.mockResolvedValue({
    ok: true,
    ctx: { booking, ownerVenueId: VENUE_ID, isOwnVenue: true, linkedGrant: null, linkId: null },
  } as never);

  const admin = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'booking_card_holds') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }
      if (table === 'bookings') {
        return {
          update: vi.fn().mockImplementation((payload: Row) => {
            bookingUpdates.push(payload);
            return { eq: vi.fn().mockResolvedValue({ error: null }) };
          }),
        };
      }
      if (table === 'venues') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { name: 'Studio One', stripe_connected_account_id: 'acct_venue' },
            error: null,
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
  mockGetAdmin.mockReturnValue(admin as never);
  return { booking, bookingUpdates };
}

function makeRequest(body: Row) {
  return new NextRequest(`https://app.test/api/venue/bookings/${BOOKING_ID}/deposit`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

const routeParams = { params: Promise.resolve({ id: BOOKING_ID }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('record_cash clears the dead deposit intent (PM-1)', () => {
  it('nulls stripe_payment_intent_id when the settle actually killed the intent', async () => {
    mockCancelIntent.mockResolvedValue({ deadPaymentIntentIds: [PI_ID] });
    const { bookingUpdates } = setup({});

    const res = await POST(makeRequest({ action: 'record_cash', amount_pence: 1500 }), routeParams);

    expect(res.status).toBe(200);
    expect(bookingUpdates).toHaveLength(1);
    expect(bookingUpdates[0]).toMatchObject({
      deposit_status: 'Paid',
      deposit_amount_pence: 1500,
      stripe_payment_intent_id: null,
    });
  });

  it('keeps the intent id when a group sibling still owes it', async () => {
    // The helper leaves a shared intent alive while another row still owes it,
    // and reports nothing dead. Discarding the reference here would strand the
    // sibling's refund, so the row must keep it.
    mockCancelIntent.mockResolvedValue({ deadPaymentIntentIds: [] });
    const { bookingUpdates } = setup({});

    const res = await POST(makeRequest({ action: 'record_cash', amount_pence: 1500 }), routeParams);

    expect(res.status).toBe(200);
    expect(bookingUpdates[0]).toMatchObject({ deposit_status: 'Paid' });
    expect(bookingUpdates[0]).not.toHaveProperty('stripe_payment_intent_id');
  });

  it('keeps the intent id when Stripe could not be reached to confirm the cancel', async () => {
    // The helper swallows Stripe failures. An unconfirmed intent must never be
    // discarded: it might still take the guest's money.
    mockCancelIntent.mockResolvedValue({ deadPaymentIntentIds: [] });
    const { bookingUpdates } = setup({ deposit_status: 'Failed' });

    const res = await POST(makeRequest({ action: 'record_cash', amount_pence: 1500 }), routeParams);

    expect(res.status).toBe(200);
    expect(bookingUpdates[0]).not.toHaveProperty('stripe_payment_intent_id');
  });

  it('does not clear a DIFFERENT booking-unrelated intent reported dead', async () => {
    mockCancelIntent.mockResolvedValue({ deadPaymentIntentIds: ['pi_someone_else'] });
    const { bookingUpdates } = setup({});

    await POST(makeRequest({ action: 'record_cash', amount_pence: 1500 }), routeParams);

    expect(bookingUpdates[0]).not.toHaveProperty('stripe_payment_intent_id');
  });
});

describe('refund on a cash-settled deposit (PM-1)', () => {
  it('refuses with a 409 explaining the money was not taken online, not a bare 502', async () => {
    mockRefundCreate.mockRejectedValue(new Error('cannot refund a canceled PaymentIntent'));
    mockClassify.mockResolvedValue('nothing_to_refund');
    const { bookingUpdates } = setup({ deposit_status: 'Paid' });

    const res = await POST(makeRequest({ action: 'refund' }), routeParams);

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'not_refundable_online' });
    // Nothing moved, so the row must not be stamped 'Refunded'.
    expect(bookingUpdates).toHaveLength(0);
  });

  it('still 502s on a genuine refund failure', async () => {
    mockRefundCreate.mockRejectedValue(new Error('stripe down'));
    mockClassify.mockResolvedValue('failed');
    const { bookingUpdates } = setup({ deposit_status: 'Paid' });

    const res = await POST(makeRequest({ action: 'refund' }), routeParams);

    expect(res.status).toBe(502);
    expect(bookingUpdates).toHaveLength(0);
  });

  it('converges and stamps Refunded when the charge was already refunded', async () => {
    mockRefundCreate.mockRejectedValue({ code: 'charge_already_refunded' });
    mockClassify.mockResolvedValue('refunded');
    const { bookingUpdates } = setup({ deposit_status: 'Paid' });

    const res = await POST(makeRequest({ action: 'refund' }), routeParams);

    expect(res.status).toBe(200);
    expect(bookingUpdates[0]).toMatchObject({ deposit_status: 'Refunded' });
  });
});
