import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdminClient: vi.fn(),
}));

import { getSupabaseAdminClient } from '@/lib/supabase';
import { generateBookingShortLinkCode, createOrGetBookingShortLink } from '@/lib/booking-short-links';
import { makeRecordingDb, PG_ERRORS } from '@/lib/testing/recording-supabase';

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

  /**
   * 23505 has TWO causes here and the old loop only handled one (G4a, P0-3).
   *
   * `booking_short_links` has a primary key on `code` AND a partial unique
   * index on (booking_id, purpose) WHERE revoked_at IS NULL. The loop used to
   * assume every 23505 was a `code` collision and retried with a fresh random
   * code, which for the second cause collides identically all twelve times and
   * then throws. That throw was unguarded inside the account list's per-row
   * Promise.all, so a customer lost their entire booking history to a manage
   * link they never clicked.
   */
  describe('23505 on insert', () => {
    /**
     * Drives the real call sequence: active lookup (has a `gt` on expires_at),
     * then the stale lookup, then insert, then any post-23505 re-select.
     */
    function setup(opts: { raceWinner: string | null; failInserts: number }) {
      let bareSelects = 0;
      const db = makeRecordingDb((call) => {
        if (call.table !== 'booking_short_links') return undefined;
        if (call.op === 'insert') return { data: null, error: null };
        if (call.filters.some((f) => f[0] === 'gt')) return { data: null, error: null };
        bareSelects += 1;
        // The first bare select is the stale-row lookup, before any insert.
        if (bareSelects === 1) return { data: null, error: null };
        return { data: opts.raceWinner ? { code: opts.raceWinner } : null, error: null };
      });
      db.inject((c) => c.op === 'insert', PG_ERRORS.uniqueViolation, { times: opts.failInserts });
      mockAdmin.mockReturnValue(db.db as never);
      return db;
    }

    const args = {
      venueId: '00000000-0000-4000-8000-000000000001',
      bookingId: '00000000-0000-4000-8000-000000000002',
      purpose: 'manage' as const,
    };

    it('returns the row a concurrent caller won, instead of colliding twelve times', async () => {
      // Every insert fails, exactly as it would against the (booking_id,
      // purpose) index. Before the fix this threw; a fresh `code` cannot help.
      const db = setup({ raceWinner: 'winner', failInserts: 99 });

      await expect(createOrGetBookingShortLink(args)).resolves.toBe('https://pub.test/b/winner');

      // One insert, one re-select. It does not grind through the retry budget.
      expect(db.queryCount({ table: 'booking_short_links', op: 'insert' })).toBe(1);
    });

    it('still retries a genuine `code` collision with a fresh code', async () => {
      // No winning row means the collision was against some OTHER booking's
      // code, and a new random code is the right answer.
      const db = setup({ raceWinner: null, failInserts: 1 });

      const url = await createOrGetBookingShortLink(args);
      expect(url).toMatch(/^https:\/\/pub\.test\/b\/[0-9A-Za-z]{6}$/);
      expect(db.queryCount({ table: 'booking_short_links', op: 'insert' })).toBe(2);

      // The two attempts used different codes; retrying with the same one
      // would be an infinite collision.
      const codes = db.calls
        .filter((c) => c.op === 'insert')
        .map((c) => (c.payload as { code: string }).code);
      expect(new Set(codes).size).toBe(2);
    });
  });
});
