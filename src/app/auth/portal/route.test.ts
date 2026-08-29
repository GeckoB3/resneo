/**
 * P3-4c: one-click first entry.
 *
 * The route mints a real session, so the rows below are mostly about the two
 * ways that can be wrong:
 *
 *   1. minting one for the WRONG PERSON. The session is issued for whatever
 *      address reaches `generateLink`, and the URL carries an `email` parameter
 *      for the failure path. Trusting it would let anyone pair their own valid
 *      token with someone else's address and be handed a session as them. That
 *      is the single catastrophic mistake available here.
 *   2. minting one when it should not. Expired, revoked, unknown and malformed
 *      tokens must all end at a sign-in form with no session created.
 *
 * The rest is about the customer not being stranded: every failure lands
 * somewhere they can finish the job, carrying the booking they were going to.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => ({
  /** What `verifyPortalToken` says about the token in the URL. */
  verification: { ok: true, userId: 'user-1', reason: 'valid' } as {
    ok: boolean;
    userId: string | null;
    reason: string;
  },
  /** The user the TOKEN resolves to, which is the only trustworthy source. */
  userById: { user: { email: 'real@owner.test' } } as { user: { email: string } | null } | null,
  userByIdError: null as { message: string } | null,
  generateLinkError: null as { message: string } | null,
  verifyOtpError: null as { message: string } | null,
  claimError: null as { message: string } | null,
  /** Every address `generateLink` was asked to mint a session for. */
  mintedFor: [] as string[],
  verifiedHashes: [] as string[],
  claimed: 0,
}));

vi.mock('@/lib/auth/portal-token', () => ({
  verifyPortalToken: async () => hoisted.verification,
}));

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdminClient: () => ({
    auth: {
      admin: {
        getUserById: async () => ({
          data: hoisted.userById,
          error: hoisted.userByIdError,
        }),
        generateLink: async ({ email }: { email: string }) => {
          hoisted.mintedFor.push(email);
          return hoisted.generateLinkError
            ? { data: null, error: hoisted.generateLinkError }
            : { data: { properties: { hashed_token: `hash-for-${email}` } }, error: null };
        },
      },
    },
  }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      verifyOtp: async ({ token_hash }: { token_hash: string }) => {
        hoisted.verifiedHashes.push(token_hash);
        return { error: hoisted.verifyOtpError };
      },
    },
    rpc: async (fn: string) => {
      if (fn === 'claim_user_account') hoisted.claimed += 1;
      return { error: hoisted.claimError };
    },
  }),
}));

const BASE = 'http://localhost:3000';

async function get(query: string) {
  const { GET } = await import('./route');
  const res = await GET(new Request(`${BASE}/auth/portal${query}`));
  return { res, location: new URL(res.headers.get('location') ?? BASE) };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_BASE_URL = BASE;
  hoisted.verification = { ok: true, userId: 'user-1', reason: 'valid' };
  hoisted.userById = { user: { email: 'real@owner.test' } };
  hoisted.userByIdError = null;
  hoisted.generateLinkError = null;
  hoisted.verifyOtpError = null;
  hoisted.claimError = null;
  hoisted.mintedFor = [];
  hoisted.verifiedHashes = [];
  hoisted.claimed = 0;
});

describe('a valid token', () => {
  it('signs the customer in and lands them on the booking', async () => {
    const { res, location } = await get('?t=tok&next=%2Faccount%2Fbookings%2Fbk-1');
    expect(res.status).toBe(307);
    expect(location.pathname).toBe('/account/bookings/bk-1');
    expect(hoisted.verifiedHashes).toEqual(['hash-for-real@owner.test']);
  });

  it('MINTS FOR THE TOKEN’S OWNER, never for the address in the URL', async () => {
    /*
      The catastrophic mistake this route could make. `?email=` exists to
      prefill the sign-in form when the token fails; if it reached
      `generateLink`, anyone holding a valid token of their own could pair it
      with somebody else's address and be issued a session as them.
    */
    await get('?t=tok&email=attacker%40evil.test');
    expect(hoisted.mintedFor).toEqual(['real@owner.test']);
    expect(hoisted.mintedFor).not.toContain('attacker@evil.test');
  });

  it('links the customer’s guest rows', async () => {
    // `verifyOtp` is what sets `email_confirmed_at`, without which
    // `claim_user_account()` will not link anything.
    await get('?t=tok');
    expect(hoisted.claimed).toBe(1);
  });

  it('still signs them in when linking fails', async () => {
    // A portal showing fewer bookings than it should beats one they cannot
    // enter at all.
    hoisted.claimError = { message: 'boom' };
    const { location } = await get('?t=tok');
    expect(location.pathname).toBe('/account/bookings');
  });

  it('defaults to the bookings list when the link named no booking', async () => {
    const { location } = await get('?t=tok');
    expect(location.pathname).toBe('/account/bookings');
  });

  it('refuses to be an open redirect', async () => {
    // The whole URL is attacker-controlled, so `next` is too.
    const { location } = await get('?t=tok&next=https%3A%2F%2Fevil.test%2Fsteal');
    expect(location.origin).toBe(BASE);
    expect(location.pathname).not.toContain('evil.test');
  });

  it('tells caches and referrers nothing, because the URL held a credential', async () => {
    const { res } = await get('?t=tok');
    expect(res.headers.get('Cache-Control')).toMatch(/no-store/);
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
  });
});

describe('a token that does not work', () => {
  const REFUSALS = [
    ['expired', { ok: false, userId: null, reason: 'expired' }],
    ['revoked', { ok: false, userId: null, reason: 'revoked' }],
    ['unknown', { ok: false, userId: null, reason: 'unknown' }],
    ['a lookup error', { ok: false, userId: null, reason: 'error' }],
  ] as const;

  for (const [label, verification] of REFUSALS) {
    it(`sends ${label} to a usable sign-in form, minting nothing`, async () => {
      hoisted.verification = { ...verification };
      const { location } = await get('?t=tok&next=%2Faccount%2Fbookings%2Fbk-1');
      expect(location.pathname).toBe('/login');
      expect(hoisted.mintedFor, 'a session was minted for a bad token').toEqual([]);
      expect(hoisted.claimed).toBe(0);
    });
  }

  it('goes to /login rather than /auth/magic, so a password still works', async () => {
    /*
      AD7 specified `/auth/magic`, which offers ONLY a magic link. A customer
      on an expired link may have set a password since it was issued, and
      should not have to work out which door is theirs. `/login` offers the
      password, the magic link and forgot-password together.
    */
    hoisted.verification = { ok: false, userId: null, reason: 'expired' };
    const { location } = await get('?t=tok');
    expect(location.pathname).toBe('/login');
    expect(location.pathname).not.toBe('/auth/magic');
  });

  it('carries the booking through, so signing in still finishes the journey', async () => {
    hoisted.verification = { ok: false, userId: null, reason: 'expired' };
    const { location } = await get('?t=tok&next=%2Faccount%2Fbookings%2Fbk-1');
    expect(location.searchParams.get('redirectTo')).toBe('/account/bookings/bk-1');
  });

  it('prefills the address, so the customer does not retype it', async () => {
    hoisted.verification = { ok: false, userId: null, reason: 'expired' };
    const { location } = await get('?t=tok&email=Guest%40Example.test');
    expect(location.searchParams.get('email')).toBe('guest@example.test');
  });

  it('says WHY, or the form reads as the link being broken', async () => {
    hoisted.verification = { ok: false, userId: null, reason: 'expired' };
    const { location } = await get('?t=tok');
    expect(location.searchParams.get('reason')).toBe('portal_expired');
  });

  it('tells caches and referrers nothing on the way out either', async () => {
    /*
      The FAILURE path needs these as much as the success path: the request
      that arrived still had `?t=` in its URL, and a referrer header sent from
      the sign-in page would carry it onward. An earlier version of this suite
      asserted the headers only on success, and a mutation stripping them from
      the fallback passed.
    */
    hoisted.verification = { ok: false, userId: null, reason: 'expired' };
    const { res } = await get('?t=tok');
    expect(res.headers.get('Cache-Control')).toMatch(/no-store/);
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
  });

  it('sends a missing token to the same place, not to an error page', async () => {
    hoisted.verification = { ok: false, userId: null, reason: 'unknown' };
    const { res, location } = await get('');
    expect(res.status).toBe(307);
    expect(location.pathname).toBe('/login');
  });

  it('does not carry an attacker’s redirect into the fallback either', async () => {
    hoisted.verification = { ok: false, userId: null, reason: 'expired' };
    const { location } = await get('?t=tok&next=https%3A%2F%2Fevil.test');
    expect(location.origin).toBe(BASE);
    expect(location.searchParams.get('redirectTo')).not.toContain('evil.test');
  });
});

describe('the session could not be established', () => {
  it('falls back rather than 500ing when the user cannot be read', async () => {
    hoisted.userById = { user: null };
    const { location } = await get('?t=tok');
    expect(location.pathname).toBe('/login');
    expect(hoisted.mintedFor).toEqual([]);
  });

  it('falls back when the link cannot be minted', async () => {
    hoisted.generateLinkError = { message: 'rate limited' };
    const { location } = await get('?t=tok');
    expect(location.pathname).toBe('/login');
    expect(hoisted.claimed).toBe(0);
  });

  it('falls back when the OTP does not verify', async () => {
    hoisted.verifyOtpError = { message: 'expired' };
    const { location } = await get('?t=tok');
    expect(location.pathname).toBe('/login');
    expect(hoisted.claimed, 'guest rows were linked without a session').toBe(0);
  });

  it('prefills with the OWNER’s address once it is known', async () => {
    // Past the token check the real address is known, so the fallback can use
    // it instead of the one the URL claimed.
    hoisted.generateLinkError = { message: 'nope' };
    const { location } = await get('?t=tok&email=attacker%40evil.test');
    expect(location.searchParams.get('email')).toBe('real@owner.test');
  });
});
