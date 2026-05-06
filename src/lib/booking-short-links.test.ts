import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdminClient: vi.fn(),
}));

import { getSupabaseAdminClient } from '@/lib/supabase';
import { generateBookingShortLinkCode, createOrGetBookingShortLink } from '@/lib/booking-short-links';

const mockAdmin = vi.mocked(getSupabaseAdminClient);

/** Active row lookup: select … gt(expires) … maybeSingle */
function chainForActiveLookup(maybeSingleResult: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(maybeSingleResult);
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnValue({ maybeSingle }),
  };
}

/** Stale row lookup: select … is(revoked) … maybeSingle (no gt on expires) */
function chainForStaleLookup(maybeSingleResult: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(maybeSingleResult);
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnValue({ maybeSingle }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_BASE_URL', 'https://pub.test');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('generateBookingShortLinkCode', () => {
  it('returns 6 base62 chars by default', () => {
    const c = generateBookingShortLinkCode();
    expect(c).toHaveLength(6);
    expect(c).toMatch(/^[0-9A-Za-z]{6}$/);
  });

  it('supports custom length', () => {
    const c = generateBookingShortLinkCode(8);
    expect(c).toHaveLength(8);
    expect(c).toMatch(/^[0-9A-Za-z]{8}$/);
  });
});

describe('createOrGetBookingShortLink', () => {
  it('reuses existing code when an active row exists', async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const activeChain = chainForActiveLookup({
      data: { code: 'reuseX', expires_at: future },
      error: null,
    });

    mockAdmin.mockReturnValue({
      from: vi.fn().mockImplementation((t: string) => {
        if (t === 'booking_short_links') return activeChain;
        throw new Error(`unexpected table ${t}`);
      }),
    } as never);

    const url = await createOrGetBookingShortLink({
      venueId: '00000000-0000-4000-8000-000000000001',
      bookingId: '00000000-0000-4000-8000-000000000002',
      purpose: 'manage',
    });

    expect(url).toBe('https://pub.test/b/reuseX');
  });

  it('inserts a new row when none exists and returns /b URL', async () => {
    const activeChain = chainForActiveLookup({ data: null, error: null });
    const staleChain = chainForStaleLookup({ data: null, error: null });
    const mockInsert = vi.fn().mockResolvedValue({ error: null });

    let shortCalls = 0;
    mockAdmin.mockReturnValue({
      from: vi.fn().mockImplementation((t: string) => {
        if (t !== 'booking_short_links') throw new Error(`unexpected table ${t}`);
        shortCalls++;
        if (shortCalls === 1) return activeChain;
        if (shortCalls === 2) return staleChain;
        return { insert: mockInsert };
      }),
    } as never);

    const url = await createOrGetBookingShortLink({
      venueId: '00000000-0000-4000-8000-000000000001',
      bookingId: '00000000-0000-4000-8000-000000000002',
      purpose: 'confirm',
    });

    expect(url).toMatch(/^https:\/\/pub\.test\/b\/[0-9A-Za-z]{6}$/);
    expect(mockInsert).toHaveBeenCalledTimes(1);
    const insertArg = mockInsert.mock.calls[0]![0] as Record<string, unknown>;
    expect(insertArg).toMatchObject({
      venue_id: '00000000-0000-4000-8000-000000000001',
      booking_id: '00000000-0000-4000-8000-000000000002',
      purpose: 'confirm',
    });
    expect(String(insertArg.code)).toHaveLength(6);
  });

  it('renews expiry on existing expired row instead of inserting', async () => {
    const activeChain = chainForActiveLookup({ data: null, error: null });
    const staleChain = chainForStaleLookup({
      data: { code: 'sameCd' },
      error: null,
    });
    const eqMock = vi.fn().mockResolvedValue({ error: null });
    const updateChain = {
      update: vi.fn().mockReturnValue({ eq: eqMock }),
    };

    let shortCalls = 0;
    mockAdmin.mockReturnValue({
      from: vi.fn().mockImplementation((t: string) => {
        if (t !== 'booking_short_links') throw new Error(`unexpected table ${t}`);
        shortCalls++;
        if (shortCalls === 1) return activeChain;
        if (shortCalls === 2) return staleChain;
        return updateChain;
      }),
    } as never);

    const url = await createOrGetBookingShortLink({
      venueId: '00000000-0000-4000-8000-000000000001',
      bookingId: '00000000-0000-4000-8000-000000000002',
      purpose: 'manage',
    });

    expect(url).toBe('https://pub.test/b/sameCd');
    expect(updateChain.update).toHaveBeenCalled();
    expect(eqMock).toHaveBeenCalledWith('code', 'sameCd');
  });

  it('retries insert on unique violation (23505) then succeeds', async () => {
    const activeChain = chainForActiveLookup({ data: null, error: null });
    const staleChain = chainForStaleLookup({ data: null, error: null });
    const mockInsert = vi
      .fn()
      .mockResolvedValueOnce({ error: { code: '23505', message: 'dup' } })
      .mockResolvedValueOnce({ error: null });

    let shortCalls = 0;
    mockAdmin.mockReturnValue({
      from: vi.fn().mockImplementation((t: string) => {
        if (t !== 'booking_short_links') throw new Error(`unexpected table ${t}`);
        shortCalls++;
        if (shortCalls === 1) return activeChain;
        if (shortCalls === 2) return staleChain;
        return { insert: mockInsert };
      }),
    } as never);

    const url = await createOrGetBookingShortLink({
      venueId: '00000000-0000-4000-8000-000000000001',
      bookingId: '00000000-0000-4000-8000-000000000002',
      purpose: 'manage',
    });

    expect(url).toMatch(/^https:\/\/pub\.test\/b\/[0-9A-Za-z]{6}$/);
    expect(mockInsert).toHaveBeenCalledTimes(2);
  });
});
