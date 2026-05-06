import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdminClient: vi.fn(),
}));

import { getSupabaseAdminClient } from '@/lib/supabase';
import { GET } from './route';

const mockAdmin = vi.mocked(getSupabaseAdminClient);

const BOOKING_ID = '550e8400-e29b-41d4-a716-446655440000';
const VENUE_ID = '660e8400-e29b-41d4-a716-446655440001';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_BASE_URL', 'https://site.test');
  vi.stubEnv('PAYMENT_TOKEN_SECRET', 'unit-test-payment-token-secret-key!!');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function mockChainsForSuccess(purpose: string) {
  const maybeLink = vi.fn().mockResolvedValue({
    data: {
      booking_id: BOOKING_ID,
      purpose,
      venue_id: VENUE_ID,
      access_count: 0,
    },
    error: null,
  });
  const shortSelect = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnValue({ maybeSingle: maybeLink }),
  };

  const maybeBooking = vi.fn().mockResolvedValue({
    data: { id: BOOKING_ID, venue_id: VENUE_ID, status: 'Booked' },
    error: null,
  });
  const bookingSelect = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnValue({ maybeSingle: maybeBooking }),
  };

  const updateMock = vi.fn().mockResolvedValue({ error: null });
  const shortUpdate = {
    update: vi.fn().mockReturnValue({ eq: updateMock }),
  };

  let shortLinkPhase: 'lookup' | 'update' = 'lookup';
  mockAdmin.mockReturnValue({
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'booking_short_links') {
        if (shortLinkPhase === 'lookup') {
          shortLinkPhase = 'update';
          return shortSelect;
        }
        return shortUpdate;
      }
      if (table === 'bookings') return bookingSelect;
      throw new Error(`unexpected table ${table}`);
    }),
  } as never);
}

describe('GET /b/[code]', () => {
  it('redirects to manage URL with HMAC when purpose is manage', async () => {
    mockChainsForSuccess('manage');
    const req = new NextRequest(new URL('https://site.test/b/abc123'));
    const res = await GET(req, { params: Promise.resolve({ code: 'abc123' }) });
    expect(res.status).toBe(307);
    const loc = res.headers.get('location') ?? '';
    expect(loc).toContain(`https://site.test/manage/${BOOKING_ID}`);
    expect(loc).toContain('hmac=');
  });

  it('redirects to confirm URL when purpose is confirm', async () => {
    mockChainsForSuccess('confirm');
    const req = new NextRequest(new URL('https://site.test/b/abc123'));
    const res = await GET(req, { params: Promise.resolve({ code: 'abc123' }) });
    expect(res.status).toBe(307);
    const loc = res.headers.get('location') ?? '';
    expect(loc).toContain(`https://site.test/confirm/${BOOKING_ID}`);
    expect(loc).toContain('hmac=');
  });

  it('redirects to payment path when purpose is payment', async () => {
    mockChainsForSuccess('payment');
    const req = new NextRequest(new URL('https://site.test/b/abc123'));
    const res = await GET(req, { params: Promise.resolve({ code: 'abc123' }) });
    expect(res.status).toBe(307);
    const loc = res.headers.get('location') ?? '';
    expect(loc).toMatch(/^https:\/\/site\.test\/p\/.+/);
  });

  it('redirects to / when short link is missing', async () => {
    const maybeLink = vi.fn().mockResolvedValue({ data: null, error: null });
    const shortSelect = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnValue({ maybeSingle: maybeLink }),
    };
    mockAdmin.mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'booking_short_links') return shortSelect;
        throw new Error(`unexpected table ${table}`);
      }),
    } as never);

    const req = new NextRequest(new URL('https://site.test/b/nope12'));
    const res = await GET(req, { params: Promise.resolve({ code: 'nope12' }) });
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://site.test/');
  });

  it('redirects to / when booking is cancelled', async () => {
    const maybeLink = vi.fn().mockResolvedValue({
      data: {
        booking_id: BOOKING_ID,
        purpose: 'manage',
        venue_id: VENUE_ID,
        access_count: 0,
      },
      error: null,
    });
    const shortSelect = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnValue({ maybeSingle: maybeLink }),
    };
    const maybeBooking = vi.fn().mockResolvedValue({
      data: { id: BOOKING_ID, venue_id: VENUE_ID, status: 'Cancelled' },
      error: null,
    });
    const bookingSelect = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnValue({ maybeSingle: maybeBooking }),
    };

    mockAdmin.mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'booking_short_links') return shortSelect;
        if (table === 'bookings') return bookingSelect;
        throw new Error(`unexpected table ${table}`);
      }),
    } as never);

    const req = new NextRequest(new URL('https://site.test/b/abc123'));
    const res = await GET(req, { params: Promise.resolve({ code: 'abc123' }) });
    expect(res.headers.get('location')).toBe('https://site.test/');
  });
});
