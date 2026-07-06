import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const afterCallbacks = vi.hoisted(() => [] as Array<() => Promise<void> | void>);

vi.mock('next/server', () => ({
  after: vi.fn((fn: () => Promise<void> | void) => {
    afterCallbacks.push(fn);
  }),
}));

vi.mock('@/lib/stripe', () => ({
  stripe: {
    paymentIntents: { create: vi.fn() },
    setupIntents: { create: vi.fn() },
    customers: { create: vi.fn(), del: vi.fn() },
  },
}));

vi.mock('@/lib/booking-short-links', () => ({
  createOrGetBookingShortLink: vi.fn(),
  createOrGetPaymentShortLink: vi.fn(),
}));

vi.mock('@/lib/communications/send-templated', () => ({
  sendBookingConfirmationNotifications: vi.fn(),
  sendCardHoldRequestNotifications: vi.fn(),
  sendDepositRequestNotifications: vi.fn(),
}));

import { stripe } from '@/lib/stripe';
import { createOrGetBookingShortLink, createOrGetPaymentShortLink } from '@/lib/booking-short-links';
import {
  sendBookingConfirmationNotifications,
  sendCardHoldRequestNotifications,
  sendDepositRequestNotifications,
} from '@/lib/communications/send-templated';
import { renderCardHoldConsentText } from '@/lib/booking/card-hold-terms';
import { applyStaffBookingPaymentAndComms } from './staff-booking-payment-comms';

const mockCustomerCreate = vi.mocked(stripe.customers.create);
const mockCustomerDel = vi.mocked(stripe.customers.del);
const mockSetupIntentCreate = vi.mocked(stripe.setupIntents.create);
const mockPaymentIntentCreate = vi.mocked(stripe.paymentIntents.create);
const mockPaymentShortLink = vi.mocked(createOrGetPaymentShortLink);
const mockBookingShortLink = vi.mocked(createOrGetBookingShortLink);
const mockSendCardHold = vi.mocked(sendCardHoldRequestNotifications);
const mockSendDeposit = vi.mocked(sendDepositRequestNotifications);
const mockSendConfirmation = vi.mocked(sendBookingConfirmationNotifications);

const BOOKING_ID = 'b0000000-0000-0000-0000-000000000001';
const VENUE_ID = 'a0000000-0000-0000-0000-000000000001';

function makeAdmin() {
  const holdInsert = vi.fn().mockResolvedValue({ error: null });
  const bookingsUpdateEq = vi.fn().mockResolvedValue({ error: null });
  const bookingsUpdate = vi.fn(() => ({ eq: bookingsUpdateEq }));
  const admin = {
    from: vi.fn((table: string) => {
      if (table === 'booking_card_holds') return { insert: holdInsert };
      if (table === 'bookings') return { update: bookingsUpdate };
      throw new Error(`unexpected table ${table}`);
    }),
  };
  return { admin, holdInsert, bookingsUpdate };
}

function fakeRequest(): NextRequest {
  return { nextUrl: { origin: 'https://app.test' } } as unknown as NextRequest;
}

function baseParams(admin: unknown) {
  return {
    admin: admin as never,
    request: fakeRequest(),
    venueId: VENUE_ID,
    venueName: 'The Copper Room',
    venueAddress: '1 High St',
    venueProfileEmail: 'venue@example.com',
    venueReplyToEmail: null,
    stripeConnectedAccountId: 'acct_1',
    bookingId: BOOKING_ID,
    guestName: 'Sam Guest',
    guestEmail: 'sam@example.com',
    guestPhone: '+447700900123',
    booking_date: '2026-07-10',
    booking_time: '18:30',
    party_size: 2,
    special_requests: null,
    dietary_notes: null,
    emailExtras: { booking_model: 'class_session' as const },
    logContext: 'test booking',
  };
}

async function flushAfter() {
  for (const fn of afterCallbacks.splice(0)) {
    await fn();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  afterCallbacks.length = 0;
  process.env.NEXT_PUBLIC_BASE_URL = 'https://app.test';
});

describe('applyStaffBookingPaymentAndComms card-hold variant (spec 7.6)', () => {
  it('creates customer + SetupIntent + hold row, returns the link, sends card comms only', async () => {
    const { admin, holdInsert } = makeAdmin();
    mockCustomerCreate.mockResolvedValue({ id: 'cus_1' } as never);
    mockSetupIntentCreate.mockResolvedValue({ id: 'seti_1', client_secret: 's' } as never);
    mockPaymentShortLink.mockResolvedValue('https://app.test/b/abc123');
    mockSendCardHold.mockResolvedValue({
      email: { sent: true },
      sms: { sent: true },
    } as never);

    const result = await applyStaffBookingPaymentAndComms({
      ...baseParams(admin),
      requiresDeposit: false,
      depositAmountPence: 0,
      cardHoldFeePence: 2500,
    });

    expect(result.payment_url).toBe('https://app.test/b/abc123');

    // Dedicated booking-scoped Customer on the connected account (D2).
    expect(mockCustomerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'sam@example.com',
        metadata: expect.objectContaining({
          reserve_ni_purpose: 'card_hold',
          booking_id: BOOKING_ID,
          venue_id: VENUE_ID,
        }),
      }),
      { stripeAccount: 'acct_1' },
    );
    expect(mockSetupIntentCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_1', usage: 'off_session' }),
      { stripeAccount: 'acct_1' },
    );

    // One hold row with the fee and the consent snapshot written at create (7.5).
    expect(holdInsert).toHaveBeenCalledWith([
      expect.objectContaining({
        booking_id: BOOKING_ID,
        venue_id: VENUE_ID,
        stripe_connected_account_id: 'acct_1',
        stripe_customer_id: 'cus_1',
        stripe_setup_intent_id: 'seti_1',
        fee_pence: 2500,
        terms_snapshot: expect.objectContaining({
          version: 2,
          fee_pence: 2500,
          accepted_at: null,
          text: renderCardHoldConsentText('The Copper Room', 2500),
        }),
      }),
    ]);

    // No money moves and no PI exists on the card-hold path.
    expect(mockPaymentIntentCreate).not.toHaveBeenCalled();

    await flushAfter();
    expect(mockSendCardHold).toHaveBeenCalledTimes(1);
    const [holdBooking, , venueIdArg, paymentLink, feePence] = mockSendCardHold.mock.calls[0]!;
    expect(holdBooking).toMatchObject({ id: BOOKING_ID, guest_name: 'Sam Guest' });
    expect(venueIdArg).toBe(VENUE_ID);
    expect(paymentLink).toBe('https://app.test/b/abc123');
    expect(feePence).toBe(2500);
    // Card-hold path never sends deposit-request or confirmation comms.
    expect(mockSendDeposit).not.toHaveBeenCalled();
    expect(mockSendConfirmation).not.toHaveBeenCalled();
  });

  it('throws payment_failed and deletes the customer when the SetupIntent fails', async () => {
    const { admin, holdInsert } = makeAdmin();
    mockCustomerCreate.mockResolvedValue({ id: 'cus_1' } as never);
    mockSetupIntentCreate.mockRejectedValue(new Error('stripe down'));

    await expect(
      applyStaffBookingPaymentAndComms({
        ...baseParams(admin),
        requiresDeposit: false,
        depositAmountPence: 0,
        cardHoldFeePence: 2500,
      }),
    ).rejects.toThrow('payment_failed');

    expect(mockCustomerDel).toHaveBeenCalledWith('cus_1', { stripeAccount: 'acct_1' });
    expect(holdInsert).not.toHaveBeenCalled();
    await flushAfter();
    expect(mockSendCardHold).not.toHaveBeenCalled();
  });

  it('throws payment_failed with customer cleanup when the hold row insert fails', async () => {
    const { admin, holdInsert } = makeAdmin();
    holdInsert.mockResolvedValue({ error: { message: 'nope' } });
    mockCustomerCreate.mockResolvedValue({ id: 'cus_1' } as never);
    mockSetupIntentCreate.mockResolvedValue({ id: 'seti_1', client_secret: 's' } as never);

    await expect(
      applyStaffBookingPaymentAndComms({
        ...baseParams(admin),
        requiresDeposit: false,
        depositAmountPence: 0,
        cardHoldFeePence: 2500,
      }),
    ).rejects.toThrow('payment_failed');

    expect(mockCustomerDel).toHaveBeenCalledWith('cus_1', { stripeAccount: 'acct_1' });
    await flushAfter();
    expect(mockSendCardHold).not.toHaveBeenCalled();
  });

  it('leaves the deposit path untouched when cardHoldFeePence is null', async () => {
    const { admin, holdInsert } = makeAdmin();
    mockPaymentIntentCreate.mockResolvedValue({ id: 'pi_1' } as never);
    mockPaymentShortLink.mockResolvedValue('https://app.test/b/dep111');
    mockSendDeposit.mockResolvedValue({ email: { sent: true }, sms: { sent: true } } as never);

    const result = await applyStaffBookingPaymentAndComms({
      ...baseParams(admin),
      requiresDeposit: true,
      depositAmountPence: 1500,
      cardHoldFeePence: null,
    });

    expect(result.payment_url).toBe('https://app.test/b/dep111');
    expect(mockPaymentIntentCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1500 }),
      { stripeAccount: 'acct_1' },
    );
    expect(mockCustomerCreate).not.toHaveBeenCalled();
    expect(mockSetupIntentCreate).not.toHaveBeenCalled();
    expect(holdInsert).not.toHaveBeenCalled();

    await flushAfter();
    expect(mockSendDeposit).toHaveBeenCalledTimes(1);
    expect(mockSendCardHold).not.toHaveBeenCalled();
  });

  it('runs the confirmation path when neither a hold nor a deposit applies (waived hold)', async () => {
    const { admin, holdInsert, bookingsUpdate } = makeAdmin();
    mockBookingShortLink.mockResolvedValue('https://app.test/b/man111');
    mockSendConfirmation.mockResolvedValue({
      email: { sent: true },
      sms: { sent: true },
    } as never);

    const result = await applyStaffBookingPaymentAndComms({
      ...baseParams(admin),
      requiresDeposit: false,
      depositAmountPence: 0,
      cardHoldFeePence: null,
    });

    expect(result.payment_url).toBeUndefined();
    // Manage token written, no Stripe objects, confirmation comms enqueued.
    expect(bookingsUpdate).toHaveBeenCalled();
    expect(mockCustomerCreate).not.toHaveBeenCalled();
    expect(mockPaymentIntentCreate).not.toHaveBeenCalled();
    expect(holdInsert).not.toHaveBeenCalled();

    await flushAfter();
    expect(mockSendConfirmation).toHaveBeenCalledTimes(1);
    expect(mockSendCardHold).not.toHaveBeenCalled();
    expect(mockSendDeposit).not.toHaveBeenCalled();
  });
});
