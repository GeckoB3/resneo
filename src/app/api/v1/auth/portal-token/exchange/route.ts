import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { mintEntryLink } from '@/lib/auth/entry-link';
import { verifyPortalToken } from '@/lib/auth/portal-token';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { NO_STORE_HEADERS } from '@/lib/api/error-codes';

const schema = z.object({
  token: z.string().min(1).max(512),
});

/**
 * POST /api/v1/auth/portal-token/exchange - first entry for a native client (P3-4i).
 *
 * `/auth/portal` establishes a session by setting COOKIES, which a native
 * client cannot consume. This is the same exchange returning the session as
 * JSON instead: same token, same `generateLink` + `verifyOtp` mechanism, same
 * 24-hour window, so there is one entry model with two transports rather than
 * two mechanisms to keep in step.
 *
 * **It must build its own Supabase client, and this is the whole subtlety.**
 * `createClient()` and `createRouteHandlerClient()` bind Supabase's storage to
 * the cookie jar, and `getSupabaseClient()` is a module-level singleton with
 * `persistSession` on. Any of the three would have `verifyOtp` WRITE the
 * session somewhere instead of handing it back, and on the singleton it would
 * leak across requests in a server process. A fresh client with
 * `persistSession: false` is what makes `verifyOtp` return the session object.
 *
 * **It does not run `claim_user_account()`.** The app already calls it over
 * PostgREST after every sign-in (`providers/AuthProvider.tsx:218`,
 * `app/(auth)/callback.tsx:70`), best-effort and non-blocking, and the RPC is
 * granted to `authenticated`. Adding it here would be a second caller of
 * something already handled, and `Docs/MOBILE_API.md` records it as a client
 * obligation instead.
 */
export async function POST(request: NextRequest) {
  /*
    Rate limited by IP. The token is 256 bits so guessing is not the threat;
    what this bounds is somebody replaying a token they have obtained to mint
    sessions in bulk, and the cost of a failed attempt to everyone else.
  */
  const limit = checkRateLimit(getClientIp(request), 'portal-token-exchange', 20, 15 * 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Too many attempts. Try again shortly.', code: 'RATE_LIMITED' },
      { status: 429, headers: { ...NO_STORE_HEADERS, 'Retry-After': String(limit.retryAfterSec) } },
    );
  }

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', code: 'VALIDATION_FAILED' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const admin = getSupabaseAdminClient();
  const verified = await verifyPortalToken(admin, parsed.data.token);
  if (!verified.ok || !verified.email) {
    /*
      One answer for expired, revoked, unknown and malformed. The reason is
      logged, not returned: a client that could tell "expired" from "never
      existed" could probe which tokens have been issued.
    */
    console.warn('[v1/portal-token/exchange] refused:', verified.reason);
    /*
      `UNAUTHENTICATED`, not a token-specific code. P0-11 froze the error union
      and it has no `INVALID_TOKEN`; inventing one here would put a member on
      the contract that no consumer knows and that the pin would then hold
      forever. What the client has to do is identical to any other 401: ask for
      a fresh link. The 401 literal differs from the union's one canonical
      "Unauthorised" because this is a bad CREDENTIAL rather than a missing
      one, and telling the customer to get a new link is the actionable half.
    */
    return NextResponse.json(
      { error: 'That sign-in link is no longer valid. Ask for a new one.', code: 'UNAUTHENTICATED' },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anon = (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    ''
  ).trim();
  if (!url || !anon) {
    console.error('[v1/portal-token/exchange] Supabase URL or anon key missing');
    return NextResponse.json(
      { error: 'Could not sign you in. Please try again.', code: 'INTERNAL_ERROR' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  /*
    Creates the account when the address has none, which is the common case:
    nothing in the public booking flow makes one (P3-4d). `mintEntryLink`
    reports the verification type GoTrue ISSUED, which for a new address is
    `signup` rather than the `magiclink` that was asked for; assuming the
    latter here broke entry for exactly the population it was built for.
  */
  const link = await mintEntryLink(admin, verified.email);
  if (!link) {
    return NextResponse.json(
      { error: 'Could not sign you in. Please try again.', code: 'INTERNAL_ERROR' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  const stateless = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: verifiedOtp, error: otpErr } = await stateless.auth.verifyOtp({
    type: link.verificationType,
    token_hash: link.tokenHash,
  });
  const session = verifiedOtp?.session;
  if (otpErr || !session?.access_token || !session?.refresh_token) {
    console.error('[v1/portal-token/exchange] verifyOtp failed:', otpErr?.message);
    return NextResponse.json(
      { error: 'Could not sign you in. Please try again.', code: 'INTERNAL_ERROR' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  /*
    The refresh token is REQUIRED, not optional. `setSession` on the client
    rejects a session without one, so returning only an access token would
    hand the app something it cannot install. AD7 records this as settled.
  */
  return NextResponse.json(
    {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at ?? null,
    },
    { headers: NO_STORE_HEADERS },
  );
}
