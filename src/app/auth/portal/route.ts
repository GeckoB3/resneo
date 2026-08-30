import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { normalizePublicBaseUrl } from '@/lib/public-base-url';
import { safeSameOriginPath } from '@/lib/safe-auth-redirect';
import { mintEntryLink } from '@/lib/auth/entry-link';
import { verifyPortalToken } from '@/lib/auth/portal-token';

/**
 * GET /auth/portal?t=<token> - one-click first entry from a booking email (P3-4c).
 *
 * The confirmation email's account link comes here. It establishes an ORDINARY
 * Supabase session, the same kind a magic link produces, and lands the customer
 * on their booking already signed in.
 *
 * **NOT a limited session.** AD7 specified one, marked in a table, with
 * sensitive routes refusing it. That model is dead and the plan records why:
 * `npm run probe:secure-password-change` shows GoTrue exempts recent logins
 * from `secure_password_change`, and a limited session is by construction a
 * recent login, so the scope boundary could never be held. What bounds this
 * instead is the TOKEN'S WINDOW: 24 hours, matching every other sign-in link on
 * the platform. Inside it, this link is a sign-in link and is exactly as
 * powerful as one. Outside it, it is nothing.
 *
 * The other two bounds are applied where the link is BUILT, not here: only on a
 * customer's first entry, and only when they have no password. This route must
 * not re-check them. A token issued twenty minutes ago to someone who has since
 * set a password is still a valid token, and refusing it would break the flow
 * for the very customer who did the thing the portal asked of them.
 *
 * Every failure lands on a usable sign-in form, never on an error page.
 */

function getBaseUrl(requestUrl: string): string {
  if (process.env.NEXT_PUBLIC_BASE_URL) return normalizePublicBaseUrl(process.env.NEXT_PUBLIC_BASE_URL);
  if (process.env.VERCEL_URL) return normalizePublicBaseUrl(`https://${process.env.VERCEL_URL}`);
  return normalizePublicBaseUrl(new URL(requestUrl).origin);
}

/** Where the portal lives when the link named no particular booking. */
const DEFAULT_NEXT = '/account/bookings';

/**
 * The sign-in form, carrying enough for the customer to finish the job.
 *
 * `/login` rather than `/auth/magic`, which is what AD7 specified, and the
 * difference is the whole of the customer's experience here. `/login` offers a
 * password, a magic link AND forgot-password; `/auth/magic` offers only the
 * magic link. Someone arriving on an expired link may well have set a password
 * since it was issued, and must not have to work out which door is theirs.
 */
function signInFallback(base: string, next: string, email: string | null, reason: string): NextResponse {
  const url = new URL('/login', base);
  url.searchParams.set('redirectTo', next);
  // Prefilled so the customer does not retype an address we already know. The
  // address came in the link, which was itself in their mailbox, so this
  // discloses nothing they did not already hold.
  if (email) url.searchParams.set('email', email);
  // `/login` renders copy from this. Without it the form reads as the link
  // having been broken, and the customer telephones the venue instead.
  url.searchParams.set('reason', reason);
  const res = NextResponse.redirect(url.toString());
  res.headers.set('Cache-Control', 'no-store, max-age=0');
  res.headers.set('Referrer-Policy', 'no-referrer');
  return res;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const base = getBaseUrl(request.url);
  const token = searchParams.get('t');
  const rawEmail = searchParams.get('email');
  const emailForFallback = rawEmail?.trim().toLowerCase() || null;

  /*
    `next` is attacker-controlled, because the whole URL is. Reduced to a
    same-origin path before it is used for anything, including the failure
    redirect, so a crafted link cannot bounce a customer off-site from a page
    that looks like ours.

    `safeSameOriginPath` rather than `sanitizeAuthNextPath`, which is the
    obvious choice and is WRONG here: its built-in fallback is `/dashboard`,
    the STAFF destination, so an absent or hostile `next` would drop a customer
    on a page meant for venue staff. This helper takes the fallback explicitly.
  */
  const next = safeSameOriginPath(searchParams.get('next'), DEFAULT_NEXT);

  const admin = getSupabaseAdminClient();
  const verified = await verifyPortalToken(admin, token);
  if (!verified.ok || !verified.email) {
    // Expired, revoked, unknown, malformed, absent, or a database error: all
    // one destination. The reason is carried for the copy, not for a branch.
    return signInFallback(base, next, emailForFallback, `portal_${verified.reason}`);
  }

  /*
    THE EMAIL COMES FROM THE TOKEN ROW, NEVER FROM THE QUERY STRING.

    This is the one place this route could be catastrophically wrong. The
    session is minted for whatever address is handed to `generateLink`, so
    trusting `?email=` would let anyone pair their own valid token with someone
    else's address and be issued a session as them. The query parameter exists
    only to prefill the sign-in form on the failure path above, where no session
    is minted at all.
  */
  const email = verified.email;

  /*
    The same mechanism as `/auth/confirm` and `POST /api/auth/send-magic-link`:
    mint a one-time link server-side, then verify it on the cookie client so the
    session cookies are set on this response. Do not reach for any other way of
    establishing a session: `verifyOtp` is what sets `email_confirmed_at`, and
    `claim_user_account()` will not link guest rows without it.

    **This also CREATES the account when the address has none**, which is the
    common case and is the point: production has 1,078 guest emails with no
    `auth.users` row, because nothing in the public booking flow makes one.
    So an account appears when somebody actually clicks their link, and never
    speculatively for the thousand who do not.

    **The type must come back from GoTrue, not be assumed**, and this file used
    to assume it. For an address with no user, `generateLink({type:
    'magiclink'})` issues a link whose verification type is `signup`, and
    verifying it as a magiclink returns 403. Entry therefore worked for
    everybody who already had an account and failed for everybody who did not,
    which is exactly backwards, and no test saw it because the fixture customer
    exists. `mintEntryLink` asks instead of assuming.
  */
  const link = await mintEntryLink(admin, email);
  if (!link) return signInFallback(base, next, email, 'portal_error');

  const supabase = await createClient();
  const { error: verifyErr } = await supabase.auth.verifyOtp({
    type: link.verificationType,
    token_hash: link.tokenHash,
  });
  if (verifyErr) {
    console.error('[auth/portal] verifyOtp failed:', verifyErr.message);
    return signInFallback(base, next, email, 'portal_error');
  }

  // Links this user's guest rows at every venue they have booked with. Warned
  // rather than failed: the customer is signed in either way, and a portal that
  // shows fewer bookings than it should is better than one they cannot enter.
  const { error: claimErr } = await supabase.rpc('claim_user_account');
  if (claimErr) console.warn('[auth/portal] claim_user_account:', claimErr.message);

  const res = NextResponse.redirect(`${base}${next}`);
  // The URL carried a credential. Never cached, never sent onward as a referrer.
  res.headers.set('Cache-Control', 'no-store, max-age=0');
  res.headers.set('Referrer-Policy', 'no-referrer');
  return res;
}
