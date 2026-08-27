import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The route that replaces minting a manage link on every list render (P0-3).
 *
 * What matters here is that moving the mint off the read path did not move the
 * ownership check with it: this is a route that hands out a token-bearing link
 * granting cancel-without-login, so it must refuse anything that is not the
 * caller's own booking, and it must not leak whether the booking exists.
 */

const hoisted = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  booking: null as { id: string; venue_id: string } | null,
  loadThrows: false,
  linkThrows: false,
}));

vi.mock('@/lib/supabase/server', () => ({
  createRouteHandlerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: hoisted.user }, error: null }) },
  }),
}));
vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: () => ({}) }));
vi.mock('@/lib/account/account-bookings', () => ({
  loadAccountBookingById: vi.fn(async () => {
    if (hoisted.loadThrows) throw new Error('view unreachable');
    return hoisted.booking;
  }),
}));
vi.mock('@/lib/booking-short-links', () => ({
  createOrGetBookingShortLink: vi.fn(async () => {
    if (hoisted.linkThrows) throw new Error('could not allocate');
    return 'https://pub.test/b/abc123';
  }),
}));

import { POST } from './route';
import { loadAccountBookingById } from '@/lib/account/account-bookings';
import { createOrGetBookingShortLink } from '@/lib/booking-short-links';

function call(id = 'b1') {
  return POST(new Request('http://localhost:3000/x', { method: 'POST' }), {
    params: Promise.resolve({ id }),
  });
}

describe('POST /api/account/bookings/[id]/manage-link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.user = { id: 'user-1' };
    hoisted.booking = { id: 'b1', venue_id: 'v1' };
    hoisted.loadThrows = false;
    hoisted.linkThrows = false;
  });

  it('mints the link for the caller own booking', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ url: 'https://pub.test/b/abc123' });
    expect(createOrGetBookingShortLink).toHaveBeenCalledWith({
      venueId: 'v1',
      bookingId: 'b1',
      purpose: 'manage',
    });
    // Never cached: the response carries a token-bearing URL.
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('refuses an anonymous caller without touching the database', async () => {
    hoisted.user = null;
    const res = await call();
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(loadAccountBookingById).not.toHaveBeenCalled();
    expect(createOrGetBookingShortLink).not.toHaveBeenCalled();
  });

  it('MINTS NOTHING for a booking that is not the caller own', async () => {
    // The account-safe view returns nothing for someone else's booking, which
    // is indistinguishable from one that does not exist. That is the right
    // answer to give: a 403 would confirm the booking is real.
    hoisted.booking = null;
    const res = await call('someone-elses-booking');
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ code: 'NOT_FOUND' });
    expect(createOrGetBookingShortLink).not.toHaveBeenCalled();
  });

  it('reports a link failure as a 500 rather than a broken URL', async () => {
    hoisted.linkThrows = true;
    const res = await call();
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('does not leak an internal error message to the caller', async () => {
    hoisted.loadThrows = true;
    const res = await call();
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toContain('view unreachable');
  });
});
