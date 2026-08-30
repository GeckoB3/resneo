/**
 * P3-4i: first entry for a native client.
 *
 * `/auth/portal` signs a browser in by setting cookies, which an app cannot
 * consume. This returns the same session as JSON. The two dangers are the same
 * as the browser route's, plus one that is specific to this transport:
 *
 *   1. minting a session for the wrong person,
 *   2. minting one for a token that should not work,
 *   3. **writing the session somewhere instead of returning it.** Three of the
 *      four ways to get a Supabase client in this codebase bind storage to the
 *      cookie jar or to a module-level singleton, and any of them would make
 *      `verifyOtp` persist rather than hand back. On the singleton it would
 *      leak across requests in a server process.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const hoisted = vi.hoisted(() => ({
  verification: { ok: true, email: 'owner@example.test', userId: null, reason: 'valid' } as {
    ok: boolean;
    email: string | null;
    userId: string | null;
    reason: string;
  },
  generateLinkError: null as { message: string } | null,
  otpError: null as { message: string } | null,
  session: {
    access_token: 'at-1',
    refresh_token: 'rt-1',
    expires_at: 1893456000,
  } as Record<string, unknown> | null,
  mintedFor: [] as string[],
  /** Options every stateless client was built with. */
  clientOptions: [] as Array<Record<string, unknown>>,
  rateLimitOk: true,
}));

vi.mock('@/lib/auth/portal-token', () => ({
  verifyPortalToken: async () => hoisted.verification,
}));

vi.mock('@/lib/rate-limit', () => ({
  getClientIp: () => '1.2.3.4',
  checkRateLimit: () => ({ ok: hoisted.rateLimitOk, retryAfterSec: 300 }),
}));

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdminClient: () => ({
    auth: {
      admin: {
        generateLink: async ({ email }: { email: string }) => {
          hoisted.mintedFor.push(email);
          return hoisted.generateLinkError
            ? { data: null, error: hoisted.generateLinkError }
            : { data: { properties: { hashed_token: `hash-${email}` } }, error: null };
        },
      },
    },
  }),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: (_url: string, _key: string, opts: Record<string, unknown>) => {
    hoisted.clientOptions.push(opts);
    return {
      auth: {
        verifyOtp: async () => ({
          data: { session: hoisted.session },
          error: hoisted.otpError,
        }),
      },
    };
  },
}));

async function post(body: unknown = { token: 'tok' }) {
  const { POST } = await import('./route');
  const res = await POST(
    new NextRequest('http://localhost:3000/api/v1/auth/portal-token/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { res, json: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
  hoisted.verification = { ok: true, email: 'owner@example.test', userId: null, reason: 'valid' };
  hoisted.generateLinkError = null;
  hoisted.otpError = null;
  hoisted.session = { access_token: 'at-1', refresh_token: 'rt-1', expires_at: 1893456000 };
  hoisted.mintedFor = [];
  hoisted.clientOptions = [];
  hoisted.rateLimitOk = true;
});

describe('a valid token', () => {
  it('returns a session the app can actually install', async () => {
    const { res, json } = await post();
    expect(res.status, JSON.stringify(json)).toBe(200);
    expect(json).toEqual({
      access_token: 'at-1',
      refresh_token: 'rt-1',
      expires_at: 1893456000,
    });
  });

  it('BUILDS A STATELESS CLIENT, so verifyOtp returns rather than persists', async () => {
    /*
      The subtlety of this route. `createClient()` and
      `createRouteHandlerClient()` bind storage to cookies, and
      `getSupabaseClient()` is a singleton with `persistSession` on: with any
      of them the session would be written somewhere instead of handed back,
      and on the singleton it would leak between requests.
    */
    await post();
    expect(hoisted.clientOptions).toHaveLength(1);
    expect(hoisted.clientOptions[0]).toMatchObject({
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  });

  it('mints for the address on the TOKEN, not one supplied by the caller', async () => {
    await post({ token: 'tok', email: 'attacker@evil.test' });
    expect(hoisted.mintedFor).toEqual(['owner@example.test']);
  });

  it('never caches, because the body is a credential', async () => {
    const { res } = await post();
    expect(res.headers.get('Cache-Control')).toMatch(/no-store/);
  });
});

describe('a token that does not work', () => {
  const REFUSALS = ['expired', 'revoked', 'unknown', 'error'] as const;

  for (const reason of REFUSALS) {
    it(`refuses ${reason} with 401 and mints nothing`, async () => {
      hoisted.verification = { ok: false, email: null, userId: null, reason };
      const { res } = await post();
      expect(res.status).toBe(401);
      expect(hoisted.mintedFor).toEqual([]);
    });
  }

  it('answers all four identically, so a caller cannot probe', async () => {
    /*
      Telling "expired" from "never existed" would let somebody holding a list
      of candidate tokens learn which had ever been issued. The reason is
      logged instead.
    */
    const bodies: string[] = [];
    for (const reason of REFUSALS) {
      hoisted.verification = { ok: false, email: null, userId: null, reason };
      const { json } = await post();
      bodies.push(JSON.stringify(json));
    }
    expect(new Set(bodies).size).toBe(1);
  });

  it('uses a code from P0-11’s frozen union', async () => {
    // Inventing `INVALID_TOKEN` would put a member on the contract that no
    // consumer knows and the pin would then hold forever.
    hoisted.verification = { ok: false, email: null, userId: null, reason: 'expired' };
    const { json } = await post();
    expect(json.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a body with no token', async () => {
    const { res, json } = await post({});
    expect(res.status).toBe(400);
    expect(json.code).toBe('VALIDATION_FAILED');
    expect(hoisted.mintedFor).toEqual([]);
  });
});

describe('when a session cannot be built', () => {
  it('refuses rather than returning half a session', async () => {
    // `setSession` on the client rejects a session with no refresh token, so
    // returning one would hand the app something it cannot install.
    hoisted.session = { access_token: 'at-1', refresh_token: null, expires_at: 1 };
    const { res, json } = await post();
    expect(res.status).toBe(500);
    expect(json).not.toHaveProperty('access_token');
  });

  it('refuses when the OTP does not verify', async () => {
    hoisted.otpError = { message: 'expired' };
    const { res } = await post();
    expect(res.status).toBe(500);
  });

  it('refuses when the link cannot be minted', async () => {
    hoisted.generateLinkError = { message: 'rate limited' };
    const { res } = await post();
    expect(res.status).toBe(500);
  });

  it('refuses when Supabase is not configured, rather than throwing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const { res } = await post();
    expect(res.status).toBe(500);
    expect(hoisted.mintedFor, 'a link was minted with no client to verify it').toEqual([]);
  });
});

describe('rate limiting', () => {
  it('refuses in bulk with a Retry-After', async () => {
    hoisted.rateLimitOk = false;
    const { res, json } = await post();
    expect(res.status).toBe(429);
    expect(json.code).toBe('RATE_LIMITED');
    expect(res.headers.get('Retry-After')).toBe('300');
  });

  it('checks the limit BEFORE doing any work', async () => {
    hoisted.rateLimitOk = false;
    await post();
    expect(hoisted.mintedFor).toEqual([]);
    expect(hoisted.clientOptions).toEqual([]);
  });
});
