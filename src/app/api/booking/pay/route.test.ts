import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdminClient: vi.fn(),
}));

vi.mock('@/lib/stripe', () => ({
  stripe: {
    setupIntents: { retrieve: vi.fn() },
    paymentIntents: { retrieve: vi.fn() },
  },
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({ ok: true })),
  getClientIp: vi.fn(() => '203.0.113.1'),
}));

import { getSupabaseAdminClient } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';
import { createPaymentLinkToken } from '@/lib/payment-token';
import { GET } from './route';

const mockGetAdmin = vi.mocked(getSupabaseAdminClient);
const mockRetrieveSetupIntent = vi.mocked(stripe.setupIntents.retrieve);
const mockRetrievePaymentIntent = vi.mocked(stripe.paymentIntents.retrieve);

const BOOKING_ID = '11111111-2222-3333-4444-555555555555';

const PENDING_BOOKING = {
  id: BOOKING_ID,
  stripe_payment_intent_id: null as string | null,
  venue_id: 'venue-1',
  status: 'Pending',
  booking_date: '2026-07-10',
  booking_time: '18:30:00',
  party_size: 2,
  deposit_amount_pence: null as number | null,
  guest_email: 'guest@example.com',
  guest_first_name: 'Sam',
  guest_last_name: 'Guest',
  guest_phone: null,
  cancellation_deadline: null,
  guest_id: null,
};

const OPEN_HOLD = {
  stripe_connected_account_id: 'acct_snapshot',
  stripe_setup_intent_id: 'seti_1',
  stripe_payment_method_id: null as string | null,
  fee_pence: 2500,
  released_at: null as string | null,
};

function mockSupabase(opts: {
  booking?: Record<string, unknown> | null;
  hold?: Record<string, unknown> | null;
  holdSiblings?: Array<{ fee_pence: number }> | null;
  venue?: Record<string, unknown> | null;
}) {
  const client = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'bookings') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: opts.booking ?? null, error: null }),
        };
      }
      if (table === 'booking_card_holds') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: opts.hold ?? null, error: null }),
          // Sibling fee query ends on .is('released_at', null)
          is: vi.fn().mockResolvedValue({ data: opts.holdSiblings ?? null, error: null }),
        };
      }
      if (table === 'venues') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: opts.venue ?? null, error: null }),
        };
      }
      if (table === 'guests') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
  mockGetAdmin.mockReturnValue(client as never);
  return client;
}

function payRequest(): NextRequest {
  const token = createPaymentLinkToken(BOOKING_ID);
  return new NextRequest(`https://site.test/api/booking/pay?t=${encodeURIComponent(token)}`);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/booking/pay (setup mode, spec 7.7)', () => {
  it('returns setup mode for a Pending booking with an open unsaved hold', async () => {
    mockSupabase({
      booking: PENDING_BOOKING,
      hold: OPEN_HOLD,
      holdSiblings: [{ fee_pence: 2500 }],
      // Venue account differs from the hold snapshot; the snapshot must win.
      venue: { name: 'The Copper Room', stripe_connected_account_id: 'acct_current', address: '1 High St' },
    });
    mockRetrieveSetupIntent.mockResolvedValue({ client_secret: 'seti_1_secret_abc' } as never);

    const res = await GET(payRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.payment_mode).toBe('setup');
    expect(json.client_secret).toBe('seti_1_secret_abc');
    expect(json.stripe_account_id).toBe('acct_snapshot');
    expect(json.card_hold_fee_pence).toBe(2500);
    expect(json.deposit_amount_pence).toBeNull();
    expect(json.venue_name).toBe('The Copper Room');
    expect(json.booking_id).toBe(BOOKING_ID);
    expect(json.booking_time).toBe('18:30');
    expect(mockRetrieveSetupIntent).toHaveBeenCalledWith('seti_1', { stripeAccount: 'acct_snapshot' });
    expect(mockRetrievePaymentIntent).not.toHaveBeenCalled();
  });

  it('sums sibling hold fees sharing the SetupIntent into the unit total', async () => {
    mockSupabase({
      booking: PENDING_BOOKING,
      hold: OPEN_HOLD,
      holdSiblings: [{ fee_pence: 2500 }, { fee_pence: 2500 }, { fee_pence: 1000 }],
      venue: { name: 'The Copper Room', stripe_connected_account_id: 'acct_current', address: null },
    });
    mockRetrieveSetupIntent.mockResolvedValue({ client_secret: 'seti_1_secret_abc' } as never);

    const res = await GET(payRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.card_hold_fee_pence).toBe(6000);
  });

  it('does not 500 when the venue current account is missing (uses the hold snapshot)', async () => {
    mockSupabase({
      booking: PENDING_BOOKING,
      hold: OPEN_HOLD,
      holdSiblings: [{ fee_pence: 2500 }],
      venue: { name: 'The Copper Room', stripe_connected_account_id: null, address: null },
    });
    mockRetrieveSetupIntent.mockResolvedValue({ client_secret: 'seti_1_secret_abc' } as never);

    const res = await GET(payRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.payment_mode).toBe('setup');
    expect(json.stripe_account_id).toBe('acct_snapshot');
  });

  it('404s with "already secured" when the hold has a saved payment method', async () => {
    mockSupabase({
      booking: { ...PENDING_BOOKING, status: 'Booked' },
      hold: { ...OPEN_HOLD, stripe_payment_method_id: 'pm_1' },
    });

    const res = await GET(payRequest());
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('This booking is already secured.');
  });

  it('404s generically when the hold is released', async () => {
    mockSupabase({
      booking: PENDING_BOOKING,
      hold: { ...OPEN_HOLD, released_at: '2026-07-04T00:00:00Z', release_reason: 'cancelled' },
    });

    const res = await GET(payRequest());
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Booking not found or already completed');
  });

  it('404s generically when Pending with neither a PI nor a hold', async () => {
    mockSupabase({ booking: PENDING_BOOKING, hold: null });

    const res = await GET(payRequest());
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Booking not found or already completed');
  });

  it('404s generically when not Pending and there is no hold (deposit path unchanged)', async () => {
    mockSupabase({
      booking: { ...PENDING_BOOKING, status: 'Booked', stripe_payment_intent_id: 'pi_1' },
      hold: null,
    });

    const res = await GET(payRequest());
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Booking not found or already completed');
  });
});

describe('GET /api/booking/pay (payment mode unchanged)', () => {
  it('returns payment mode with the deposit PI on the venue current account', async () => {
    mockSupabase({
      booking: { ...PENDING_BOOKING, stripe_payment_intent_id: 'pi_1', deposit_amount_pence: 1500 },
      venue: { name: 'The Copper Room', stripe_connected_account_id: 'acct_current', address: null },
    });
    mockRetrievePaymentIntent.mockResolvedValue({ client_secret: 'pi_1_secret_abc' } as never);

    const res = await GET(payRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.payment_mode).toBe('payment');
    expect(json.client_secret).toBe('pi_1_secret_abc');
    expect(json.stripe_account_id).toBe('acct_current');
    expect(json.deposit_amount_pence).toBe(1500);
    expect(mockRetrievePaymentIntent).toHaveBeenCalledWith('pi_1', { stripeAccount: 'acct_current' });
    expect(mockRetrieveSetupIntent).not.toHaveBeenCalled();
  });

  it('500s when the venue has no connected account in payment mode', async () => {
    mockSupabase({
      booking: { ...PENDING_BOOKING, stripe_payment_intent_id: 'pi_1', deposit_amount_pence: 1500 },
      venue: { name: 'The Copper Room', stripe_connected_account_id: null, address: null },
    });

    const res = await GET(payRequest());
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Venue payment not configured');
  });
});
