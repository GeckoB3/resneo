import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/venue-route-client', () => ({
  createVenueRouteClient: vi.fn(),
}));

vi.mock('@/lib/venue-auth', () => ({
  getVenueStaff: vi.fn(),
  requireAdmin: (staff: { role?: string } | null) => staff !== null && staff.role === 'admin',
}));

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdminClient: vi.fn(),
}));

vi.mock('@/lib/stripe', () => ({
  stripe: { refunds: { create: vi.fn() } },
}));

vi.mock('@/lib/booking/staff-booking-access', () => ({
  loadStaffAccessibleBooking: vi.fn(),
  linkedGrantAllowsMutation: vi.fn().mockReturnValue(true),
}));

vi.mock('@/lib/booking/card-hold-charge', () => ({
  chargeCardHoldNoShowFee: vi.fn(),
  applyCardHoldChargeRefund: vi.fn().mockResolvedValue({ applied: true }),
}));

vi.mock('@/lib/booking/card-hold-release', () => ({
  releaseCardHoldsForBookings: vi.fn().mockResolvedValue({
    releasedBookingIds: [],
    deletedCustomerIds: [],
  }),
}));

vi.mock('@/lib/linked-accounts/audit', () => ({
  recordBookingWriteAudit: vi.fn(),
}));

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
import {
  chargeCardHoldNoShowFee,
  applyCardHoldChargeRefund,
} from '@/lib/booking/card-hold-charge';
import { releaseCardHoldsForBookings } from '@/lib/booking/card-hold-release';
import { recordBookingWriteAudit } from '@/lib/linked-accounts/audit';
import {
  sendCardHoldRequestNotifications,
  sendDepositRequestNotifications,
} from '@/lib/communications/send-templated';
import { POST } from './route';

const mockCreateVenueRouteClient = vi.mocked(createVenueRouteClient);
const mockGetVenueStaff = vi.mocked(getVenueStaff);
const mockGetAdmin = vi.mocked(getSupabaseAdminClient);
const mockLoadBooking = vi.mocked(loadStaffAccessibleBooking);
const mockCharge = vi.mocked(chargeCardHoldNoShowFee);
const mockRefundApply = vi.mocked(applyCardHoldChargeRefund);
const mockRelease = vi.mocked(releaseCardHoldsForBookings);
const mockAudit = vi.mocked(recordBookingWriteAudit);
const mockSendCardRequest = vi.mocked(sendCardHoldRequestNotifications);
const mockSendDepositRequest = vi.mocked(sendDepositRequestNotifications);
const mockRefundCreate = vi.mocked(stripe.refunds.create);

const BOOKING_ID = 'b0000000-0000-4000-8000-000000000001';
const VENUE_ID = 'a0000000-0000-4000-8000-000000000001';

type Row = Record<string, unknown>;

function bookingRow(overrides?: Row): Row {
  return {
    id: BOOKING_ID,
    venue_id: VENUE_ID,
    guest_id: 'g1',
    status: 'No-Show',
    deposit_status: 'Card Held',
    deposit_amount_pence: null,
    stripe_payment_intent_id: null,
    booking_date: '2026-07-01',
    booking_time: '18:00:00',
    party_size: 2,
    booking_model: 'table_reservation',
    ...overrides,
  };
}

function holdRow(overrides?: Row): Row {
  return {
    id: 'h1',
    stripe_connected_account_id: 'acct_snapshot',
    stripe_payment_method_id: 'pm_1',
    fee_pence: 2500,
    charge_payment_intent_id: null,
    charged_pence: null,
    charged_at: null,
    released_at: null,
    late_cancellation_at: null,
    ...overrides,
  };
}

function setup(opts: {
  role?: 'admin' | 'staff';
  booking?: Row;
  hold?: Row | null;
  isOwnVenue?: boolean;
  linkId?: string | null;
}) {
  const booking = bookingRow(opts.booking);
  const bookingUpdates: Row[] = [];
  const commLogDeletes: Array<{ booking_id: unknown; message_type: unknown }> = [];

  mockCreateVenueRouteClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
  } as never);
  mockGetVenueStaff.mockResolvedValue({
    id: 'staff-1',
    venue_id: VENUE_ID,
    email: 'staff@example.com',
    role: opts.role ?? 'admin',
    db: {} as never,
  } as never);
  mockLoadBooking.mockResolvedValue({
    ok: true,
    ctx: {
      booking,
      ownerVenueId: booking.venue_id as string,
      isOwnVenue: opts.isOwnVenue ?? true,
      linkedGrant: null,
      linkId: opts.linkId ?? null,
    },
  } as never);

  const admin = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'booking_card_holds') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: opts.hold ?? null, error: null }),
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
      if (table === 'guests') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { first_name: 'Jane', last_name: 'Doe', email: 'jane@example.com', phone: '+447700900000' },
            error: null,
          }),
        };
      }
      if (table === 'venues') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              name: 'Studio One',
              address: '1 High St',
              email: 'venue@example.com',
              reply_to_email: null,
              stripe_connected_account_id: 'acct_current_venue',
            },
            error: null,
          }),
        };
      }
      if (table === 'communication_logs') {
        return {
          delete: vi.fn().mockReturnValue({
            eq: vi.fn().mockImplementation(function (this: unknown, k: string, v: unknown) {
              const filters: Row = { [k]: v };
              return {
                eq: vi.fn().mockImplementation((k2: string, v2: unknown) => {
                  commLogDeletes.push({
                    booking_id: filters.booking_id,
                    message_type: k2 === 'message_type' ? v2 : undefined,
                  });
                  return Promise.resolve({ error: null });
                }),
              };
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
  mockGetAdmin.mockReturnValue(admin as never);

  return { admin, booking, bookingUpdates, commLogDeletes };
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
  mockRefundApply.mockResolvedValue({ applied: true });
  mockRelease.mockResolvedValue({ releasedBookingIds: [BOOKING_ID], deletedCustomerIds: [] });
});

describe('charge_no_show_fee (§9.2a)', () => {
  it('is admin-only: staff get 403 admin_only and the engine is never called', async () => {
    setup({ role: 'staff', hold: holdRow() });
    const res = await POST(makeRequest({ action: 'charge_no_show_fee' }), routeParams);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'admin_only' });
    expect(mockCharge).not.toHaveBeenCalled();
  });

  it('calls the engine and returns the spec success shape', async () => {
    setup({ role: 'admin', hold: holdRow() });
    mockCharge.mockResolvedValue({
      ok: true,
      chargedPence: 2000,
      paymentIntentId: 'pi_fee_1',
      pending: false,
    });
    const res = await POST(
      makeRequest({ action: 'charge_no_show_fee', amount_pence: 2000 }),
      routeParams,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      charged_pence: 2000,
      payment_intent_id: 'pi_fee_1',
    });
    expect(mockCharge).toHaveBeenCalledWith(expect.anything(), {
      bookingId: BOOKING_ID,
      venueId: VENUE_ID,
      amountPence: 2000,
      staffId: 'staff-1',
    });
    // Own-venue charge: no cross-venue audit row.
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('maps engine failure codes to spec statuses (402 for card errors, 404/409/400 for guards)', async () => {
    const cases: Array<[string, string, number]> = [
      ['no_card_hold', 'This booking does not have a card on hold.', 404],
      ['not_no_show', 'Mark the booking as a no-show before charging the fee.', 409],
      ['invalid_state', 'x', 409],
      ['hold_released', 'x', 409],
      ['hold_expired', 'x', 409],
      ['no_saved_card', 'x', 409],
      ['invalid_amount', 'x', 400],
      ['card_declined', 'x', 402],
      ['authentication_required', 'x', 402],
    ];
    for (const [code, message, status] of cases) {
      setup({ role: 'admin', hold: holdRow() });
      mockCharge.mockResolvedValue({ ok: false, code, message } as never);
      const res = await POST(makeRequest({ action: 'charge_no_show_fee' }), routeParams);
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({ code, message });
    }
  });

  it('records a cross-venue write audit (edited_booking) on success', async () => {
    setup({ role: 'admin', hold: holdRow(), isOwnVenue: false, linkId: 'link-1' });
    mockCharge.mockResolvedValue({
      ok: true,
      chargedPence: 2500,
      paymentIntentId: 'pi_fee_2',
      pending: false,
    });
    const res = await POST(makeRequest({ action: 'charge_no_show_fee' }), routeParams);
    expect(res.status).toBe(200);
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        linkId: 'link-1',
        actionType: 'edited_booking',
        bookingId: BOOKING_ID,
        actingVenueId: VENUE_ID,
        afterState: { deposit_status: 'Charged', charged_pence: 2500 },
      }),
    );
  });
});

describe('record_cash guard (§9.2d)', () => {
  it('returns 409 invalid_state whenever a hold row exists', async () => {
    const { bookingUpdates } = setup({
      hold: holdRow(),
      booking: { status: 'Booked', deposit_status: 'Card Held' },
    });
    const res = await POST(makeRequest({ action: 'record_cash', amount_pence: 500 }), routeParams);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'invalid_state' });
    expect(bookingUpdates).toHaveLength(0);
  });

  it('still records cash for a non-hold booking', async () => {
    const { bookingUpdates } = setup({
      hold: null,
      booking: { status: 'Booked', deposit_status: 'Pending', deposit_amount_pence: 500 },
    });
    const res = await POST(makeRequest({ action: 'record_cash', amount_pence: 500 }), routeParams);
    expect(res.status).toBe(200);
    expect(bookingUpdates[0]).toMatchObject({ deposit_status: 'Paid', deposit_amount_pence: 500 });
  });
});

describe('waive (§9.2c)', () => {
  it('releases an open UNSAVED hold with reason admin and sets Waived', async () => {
    const { bookingUpdates } = setup({
      hold: holdRow({ stripe_payment_method_id: null }),
      booking: { status: 'Pending', deposit_status: 'Pending' },
    });
    const res = await POST(makeRequest({ action: 'waive' }), routeParams);
    expect(res.status).toBe(200);
    expect(mockRelease).toHaveBeenCalledWith(expect.anything(), [BOOKING_ID], 'admin');
    expect(bookingUpdates[0]).toMatchObject({ deposit_status: 'Waived' });
  });

  it('returns 409 invalid_state for a saved hold (Card Held)', async () => {
    const { bookingUpdates } = setup({
      hold: holdRow(),
      booking: { status: 'No-Show', deposit_status: 'Card Held' },
    });
    const res = await POST(makeRequest({ action: 'waive' }), routeParams);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'invalid_state' });
    expect(mockRelease).not.toHaveBeenCalled();
    expect(bookingUpdates).toHaveLength(0);
  });

  it('returns 409 invalid_state for a charged hold', async () => {
    setup({
      hold: holdRow({ charge_payment_intent_id: 'pi_fee', charged_pence: 2500 }),
      booking: { deposit_status: 'Charged' },
    });
    const res = await POST(makeRequest({ action: 'waive' }), routeParams);
    expect(res.status).toBe(409);
    expect(mockRelease).not.toHaveBeenCalled();
  });
});

describe('send_payment_link (§9.2b)', () => {
  it('sends the card-request comms (not deposit comms) for an open unsaved hold, after deleting prior card-request logs', async () => {
    mockSendCardRequest.mockResolvedValue({
      email: { sent: true },
      sms: { sent: false, reason: 'no_phone' },
    } as never);
    const { commLogDeletes } = setup({
      hold: holdRow({ stripe_payment_method_id: null }),
      booking: { status: 'Pending', deposit_status: 'Pending' },
    });
    const res = await POST(makeRequest({ action: 'send_payment_link' }), routeParams);
    expect(res.status).toBe(200);
    expect(mockSendCardRequest).toHaveBeenCalledTimes(1);
    const args = mockSendCardRequest.mock.calls[0]!;
    expect(args[2]).toBe(VENUE_ID);
    expect(args[3]).toBe('https://app.test/b/pay');
    expect(args[4]).toBe(2500); // the hold's consented fee
    expect(mockSendDepositRequest).not.toHaveBeenCalled();
    expect(commLogDeletes.map((d) => d.message_type).sort()).toEqual([
      'card_hold_request_email',
      'card_hold_request_sms',
    ]);
  });

  it('returns 409 hold_released for a released hold', async () => {
    setup({
      hold: holdRow({ stripe_payment_method_id: null, released_at: '2026-07-01T00:00:00Z' }),
      booking: { status: 'Cancelled', deposit_status: 'Pending' },
    });
    const res = await POST(makeRequest({ action: 'send_payment_link' }), routeParams);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'hold_released' });
    expect(mockSendCardRequest).not.toHaveBeenCalled();
    expect(mockSendDepositRequest).not.toHaveBeenCalled();
  });

  it('returns 409 invalid_state when the card is already saved', async () => {
    setup({ hold: holdRow(), booking: { status: 'Booked', deposit_status: 'Card Held' } });
    const res = await POST(makeRequest({ action: 'send_payment_link' }), routeParams);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'invalid_state' });
  });

  it('keeps deposit comms for non-hold bookings', async () => {
    mockSendDepositRequest.mockResolvedValue({
      email: { sent: true },
      sms: { sent: false, reason: 'no_phone' },
    } as never);
    const { commLogDeletes } = setup({
      hold: null,
      booking: { status: 'Pending', deposit_status: 'Pending', deposit_amount_pence: 1000 },
    });
    const res = await POST(makeRequest({ action: 'send_payment_link' }), routeParams);
    expect(res.status).toBe(200);
    expect(mockSendDepositRequest).toHaveBeenCalledTimes(1);
    expect(mockSendCardRequest).not.toHaveBeenCalled();
    expect(commLogDeletes.map((d) => d.message_type).sort()).toEqual([
      'deposit_request_email',
      'deposit_request_sms',
    ]);
  });
});

describe('release_hold (late-cancellation keeps, §9.3 amended)', () => {
  it('releases a kept hold on a late-cancelled booking with reason admin', async () => {
    const { bookingUpdates } = setup({
      role: 'staff',
      hold: holdRow({ late_cancellation_at: '2026-07-05T10:00:00.000Z' }),
      booking: { status: 'Cancelled', deposit_status: 'Card Held' },
    });
    const res = await POST(makeRequest({ action: 'release_hold' }), routeParams);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(mockRelease).toHaveBeenCalledWith(expect.anything(), [BOOKING_ID], 'admin');
    // deposit_status stays 'Card Held'; the released hold row renders "Card hold ended".
    expect(bookingUpdates).toHaveLength(0);
  });

  it('returns 409 invalid_state for a live booking (protection cannot be switched off mid-booking)', async () => {
    setup({
      hold: holdRow(),
      booking: { status: 'Booked', deposit_status: 'Card Held' },
    });
    const res = await POST(makeRequest({ action: 'release_hold' }), routeParams);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'invalid_state' });
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it('returns 409 invalid_state for a Cancelled booking without the late-cancellation stamp', async () => {
    setup({
      hold: holdRow(),
      booking: { status: 'Cancelled', deposit_status: 'Card Held' },
    });
    const res = await POST(makeRequest({ action: 'release_hold' }), routeParams);
    expect(res.status).toBe(409);
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it('returns 409 invalid_state when there is no open hold', async () => {
    setup({
      hold: holdRow({ released_at: '2026-07-05T12:00:00.000Z', late_cancellation_at: '2026-07-05T10:00:00.000Z' }),
      booking: { status: 'Cancelled', deposit_status: 'Card Held' },
    });
    const res = await POST(makeRequest({ action: 'release_hold' }), routeParams);
    expect(res.status).toBe(409);
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it('returns 409 invalid_state for a charged hold', async () => {
    setup({
      hold: holdRow({
        late_cancellation_at: '2026-07-05T10:00:00.000Z',
        charged_at: '2026-07-06T09:00:00.000Z',
        charged_pence: 2500,
      }),
      booking: { status: 'Cancelled', deposit_status: 'Charged' },
    });
    const res = await POST(makeRequest({ action: 'release_hold' }), routeParams);
    expect(res.status).toBe(409);
    expect(mockRelease).not.toHaveBeenCalled();
  });
});

describe('refund (§9.2e)', () => {
  it('refunds a Charged hold against the hold PI on the SNAPSHOT account and applies the refund state', async () => {
    mockRefundCreate.mockResolvedValue({} as never);
    setup({
      role: 'admin',
      hold: holdRow({ charge_payment_intent_id: 'pi_fee', charged_pence: 2500 }),
      booking: { deposit_status: 'Charged', stripe_payment_intent_id: null },
    });
    const res = await POST(makeRequest({ action: 'refund' }), routeParams);
    expect(res.status).toBe(200);
    expect(mockRefundCreate).toHaveBeenCalledWith(
      { payment_intent: 'pi_fee' },
      { stripeAccount: 'acct_snapshot' }, // NOT the venue row's current account
    );
    expect(mockRefundApply).toHaveBeenCalledWith(expect.anything(), {
      bookingId: BOOKING_ID,
      venueId: VENUE_ID,
      chargedPence: 2500,
    });
  });

  it('is admin-only for charged holds', async () => {
    setup({
      role: 'staff',
      hold: holdRow({ charge_payment_intent_id: 'pi_fee', charged_pence: 2500 }),
      booking: { deposit_status: 'Charged' },
    });
    const res = await POST(makeRequest({ action: 'refund' }), routeParams);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'admin_only' });
    expect(mockRefundCreate).not.toHaveBeenCalled();
  });

  it('returns 409 invalid_state for a hold booking that is not Charged', async () => {
    setup({ hold: holdRow(), booking: { deposit_status: 'Card Held' } });
    const res = await POST(makeRequest({ action: 'refund' }), routeParams);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'invalid_state' });
    expect(mockRefundCreate).not.toHaveBeenCalled();
  });
});
