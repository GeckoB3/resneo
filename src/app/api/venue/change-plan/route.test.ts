import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdminClient: vi.fn(),
}));

vi.mock('@/lib/supabase/venue-route-client', () => ({
  createVenueRouteClient: vi.fn(),
}));

vi.mock('@/lib/stripe', () => ({
  stripe: {
    subscriptions: { retrieve: vi.fn(), update: vi.fn() },
    checkout: { sessions: { create: vi.fn() } },
  },
}));

import { getSupabaseAdminClient } from '@/lib/supabase';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { stripe } from '@/lib/stripe';
import { POST } from './route';

const mockGetAdmin = vi.mocked(getSupabaseAdminClient);
const mockRouteClient = vi.mocked(createVenueRouteClient);
const mockRetrieve = vi.mocked(stripe.subscriptions.retrieve);
const mockUpdate = vi.mocked(stripe.subscriptions.update);
const mockCheckout = vi.mocked(stripe.checkout.sessions.create);

const VENUE = {
  id: 'venue-1',
  pricing_tier: 'plus',
  stripe_customer_id: 'cus_123',
  stripe_subscription_id: 'sub_123',
  calendar_count: 2,
  booking_model: 'unified_scheduling',
};

/** Minimal admin client: the staff lookup, the venue lookup, and the venue update. */
function installAdmin(venue: Record<string, unknown> | null = VENUE) {
  const update = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }));
  mockGetAdmin.mockReturnValue({
    from: (table: string) => {
      if (table === 'staff') {
        return {
          select: () => ({
            ilike: () => ({
              limit: async () => ({ data: [{ venue_id: 'venue-1', role: 'admin' }] }),
            }),
          }),
        };
      }
      return {
        select: () => ({ eq: () => ({ single: async () => ({ data: venue }) }) }),
        update,
      };
    },
  } as unknown as ReturnType<typeof getSupabaseAdminClient>);
  return { update };
}

function request(action: string): Request {
  return new Request('http://localhost/api/venue/change-plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRouteClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { email: 'admin@venue.test' } } }) },
  } as unknown as Awaited<ReturnType<typeof createVenueRouteClient>>);
  process.env.STRIPE_APPOINTMENTS_PLUS_PRICE_ID = 'price_plus';
});

describe('POST /api/venue/change-plan: resume_subscription', () => {
  it('clears the pending cancellation when the subscription is still live', async () => {
    const { update } = installAdmin();
    mockRetrieve.mockResolvedValue({
      id: 'sub_123',
      status: 'active',
      cancel_at_period_end: true,
    } as never);
    mockUpdate.mockResolvedValue({
      id: 'sub_123',
      status: 'active',
      items: { data: [{ current_period_end: 1893456000, current_period_start: 1890777600 }] },
    } as never);

    const res = await POST(request('resume_subscription'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith('sub_123', { cancel_at_period_end: false });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ plan_status: 'active' }),
    );
    expect(mockCheckout).not.toHaveBeenCalled();
  });

  it('sends the admin to checkout when the subscription has already been closed', async () => {
    // The reported bug: cancelled outright in Stripe, still inside the paid
    // period, so the venue reads as "cancelling" and the button was offered.
    installAdmin();
    mockRetrieve.mockResolvedValue({
      id: 'sub_123',
      status: 'canceled',
      cancel_at_period_end: false,
      items: { data: [{ current_period_end: 1893456000 }] },
    } as never);
    mockCheckout.mockResolvedValue({ url: 'https://checkout.stripe.test/session' } as never);

    const res = await POST(request('resume_subscription'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.redirect_url).toBe('https://checkout.stripe.test/session');
    // Never attempt the update Stripe would reject.
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('does the same for a subscription that expired before it was ever paid', async () => {
    installAdmin();
    mockRetrieve.mockResolvedValue({ id: 'sub_123', status: 'incomplete_expired' } as never);
    mockCheckout.mockResolvedValue({ url: 'https://checkout.stripe.test/session' } as never);

    const res = await POST(request('resume_subscription'));

    expect((await res.json()).redirect_url).toBe('https://checkout.stripe.test/session');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('says what Stripe said instead of a bare internal error', async () => {
    installAdmin();
    mockRetrieve.mockRejectedValue(
      Object.assign(new Error('No such subscription: sub_123'), {
        type: 'StripeInvalidRequestError',
        statusCode: 404,
      }),
    );

    const res = await POST(request('resume_subscription'));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('No such subscription: sub_123');
  });

  it('still reports an internal error for faults that are not Stripe rejections', async () => {
    installAdmin();
    mockRetrieve.mockRejectedValue(new Error('socket hang up'));

    const res = await POST(request('resume_subscription'));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('Internal server error');
  });

  it('refuses when the venue has no subscription recorded', async () => {
    installAdmin({ ...VENUE, stripe_subscription_id: null });

    const res = await POST(request('resume_subscription'));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('No subscription to resume');
    expect(mockRetrieve).not.toHaveBeenCalled();
  });
});

describe('POST /api/venue/change-plan: resubscribe', () => {
  it('opens checkout on the venue tier', async () => {
    installAdmin();
    mockCheckout.mockResolvedValue({ url: 'https://checkout.stripe.test/plus' } as never);

    const res = await POST(request('resubscribe'));

    expect((await res.json()).redirect_url).toBe('https://checkout.stripe.test/plus');
    expect(mockCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_123',
        mode: 'subscription',
        metadata: expect.objectContaining({ plan: 'plus', action: 'resubscribe' }),
      }),
    );
  });

  it('refuses without a billing customer', async () => {
    installAdmin({ ...VENUE, stripe_customer_id: null });

    const res = await POST(request('resubscribe'));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('No billing customer on file');
  });
});
