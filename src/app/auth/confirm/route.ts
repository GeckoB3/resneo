import { NextResponse } from 'next/server';
import { getAuthFailurePath, mapAuthErrorMessageToDetail, SET_PASSWORD_PATH } from '@/lib/auth-link';
import { normalizePublicBaseUrl } from '@/lib/public-base-url';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { sanitizeAuthNextPath, resolveAuthNextPath } from '@/lib/safe-auth-redirect';
import { hasPlatformSuperuserJwtRole } from '@/lib/platform-auth';
import { resolvePostLoginDestination, withSetPasswordGateIfNeeded } from '@/lib/post-login-destination';
import { readSignupPendingFromMetadata } from '@/lib/signup-pending-selection';
import { buildAppCallbackUrl, isAppDeepLink, renderAppHandoffPage } from '@/lib/auth/app-deep-link';
import { renderConfirmInterstitial } from '@/lib/auth/confirm-interstitial';

function getBaseUrl(requestUrl: string): string {
  if (process.env.NEXT_PUBLIC_BASE_URL) return normalizePublicBaseUrl(process.env.NEXT_PUBLIC_BASE_URL);
  if (process.env.VERCEL_URL) return normalizePublicBaseUrl(`https://${process.env.VERCEL_URL}`);
  return normalizePublicBaseUrl(new URL(requestUrl).origin);
}

const OTP_TYPES = new Set(['signup', 'invite', 'magiclink', 'recovery', 'email_change']);
type OtpType = 'signup' | 'invite' | 'magiclink' | 'recovery' | 'email_change';

function asOtpType(value: string | null): OtpType | null {
  return value && OTP_TYPES.has(value) ? (value as OtpType) : null;
}

const NO_STORE_HTML = {
  'Content-Type': 'text/html; charset=utf-8',
  // The page holds a single-use credential: never cached, never sent onward.
  'Cache-Control': 'no-store, max-age=0',
  'Referrer-Policy': 'no-referrer',
};

/**
 * GET /auth/confirm - handle OTP / email links (token_hash + type).
 *
 * Supabase email templates may send:
 *   {{ .SiteURL }}/auth/confirm?token_hash=xxx&type=magiclink
 *
 * **The GET spends nothing.** A link with a token renders a small page that posts the
 * token straight back here (see `renderConfirmInterstitial`), and the POST below is what
 * verifies it. Link scanners fetch every URL in inbound mail before the recipient sees it,
 * and until 2026-09-19 that fetch consumed the single-use token, so the customer's own click
 * was told the link had already been used. An app link renders the hand-off page instead,
 * for the same reason.
 *
 * Safe to use as an `emailRedirectTo` target regardless of which shape the template
 * currently produces: a PKCE `code` or an `error` is forwarded to `/auth/callback` (see below).
 *
 * Staff invites from `/api/venue/staff/invite` use PKCE `/auth/callback?next=/auth/set-password` instead;
 * this route still handles invite/magiclink when templates point here without `next`.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get('token_hash');
  const type = asOtpType(searchParams.get('type'));
  const redirectToParam = searchParams.get('redirect_to');

  // The email templates pass the caller's redirect as `&redirect_to=`, because a template
  // cannot put a custom scheme in an href (see lib/auth/app-deep-link.ts) and because
  // appending `?token_hash=` to a redirect that already carries a query string produces a
  // second `?`, which silently swallows the token into the preceding parameter.
  // For web callers that redirect still carries the `next` we care about, so read it out.
  let nextFromRedirect: string | null = null;
  if (redirectToParam && !isAppDeepLink(redirectToParam)) {
    try {
      nextFromRedirect = new URL(redirectToParam).searchParams.get('next');
    } catch {
      nextFromRedirect = null;
    }
  }

  const rawNext = searchParams.get('next') ?? nextFromRedirect;
  /**
   * The caller's next, or null when the link carried none. Kept separate from
   * `fallbackNext` below, which exists for failure redirects and therefore has a
   * default. Passing that default into `resolvePostLoginDestination` as `rawNext`
   * laundered it into a caller-provided choice: its explicit-/dashboard branch
   * honoured it unconditionally, so a magic link with no `next` sent a pure customer
   * to /dashboard, whose venue guards then funnelled them into /signup/business-type.
   * With null, the resolver's own role-based fall-throughs decide (a guest-only
   * account lands on /account, a dual-role account gets the chooser).
   */
  const callerNext = rawNext != null && rawNext !== '' ? resolveAuthNextPath(rawNext) : null;
  const fallbackNext =
    callerNext ??
    (type === 'invite' || type === 'recovery' ? SET_PASSWORD_PATH : sanitizeAuthNextPath(null));
  const base = getBaseUrl(request.url);

  // Hand off to the mobile app before verifying anything: the token is single-use, and the
  // app has to be the one to spend it. Verifying here would consume the link and leave the
  // app with nothing. Only the app's own scheme is ever bounced to.
  //
  // Recovery links are the exception: they complete on the web even when the app requested
  // them. App build 1.0.7's callback screen loses a race on recovery links: creating the
  // session unmounts the (auth) group mid-exchange, its cleanup flips the screen's `active`
  // flag, and the routing to set-password is skipped, so the user is signed in with their
  // password unchanged. That build cannot be fixed from here, and this route cannot know
  // the tapping user's app version, so recovery goes through the web verify below, which
  // forces /auth/set-password. Revisit once builds at or below 1.0.7 no longer matter.
  if (tokenHash && type && type !== 'recovery' && isAppDeepLink(redirectToParam)) {
    const deepLink = buildAppCallbackUrl(tokenHash, type);
    if (deepLink) {
      return new NextResponse(renderAppHandoffPage(deepLink, `${base}/login`), { status: 200, headers: NO_STORE_HTML });
    }
  }

  if (tokenHash && type) {
    return new NextResponse(
      renderConfirmInterstitial({
        action: `${base}/auth/confirm`,
        tokenHash,
        type,
        next: callerNext,
        signInUrl: `${base}/login`,
      }),
      { status: 200, headers: NO_STORE_HTML },
    );
  }

  return forwardOrFail(searchParams, base, fallbackNext);
}

/**
 * No token_hash. That means the Supabase template is still sending `{{ .ConfirmationURL }}`,
 * so GoTrue has redirected here with a PKCE `code` (or with `error`/`error_description` for a
 * spent link). Neither can be handled server-side: the PKCE verifier lives in the browser, and
 * `/auth/callback` already renders reason-specific copy for the error params. Hand off to it
 * with the query intact rather than flattening everything to `exchange_failed`.
 *
 * This is what makes `/auth/confirm` safe as an `emailRedirectTo` under *either* template
 * shape, so the template can be switched to `token_hash` independently of this deploy.
 */
function forwardOrFail(searchParams: URLSearchParams, base: string, fallbackNext: string): NextResponse {
  const code = searchParams.get('code');
  const authError = searchParams.get('error') ?? searchParams.get('error_description');
  if (code || authError) {
    const forwarded = new URLSearchParams(searchParams);
    forwarded.set('next', fallbackNext);
    return NextResponse.redirect(`${base}/auth/callback?${forwarded.toString()}`);
  }
  return NextResponse.redirect(`${base}${getAuthFailurePath(fallbackNext, 'exchange_failed')}`);
}

/**
 * POST /auth/confirm - spend the token and establish the session.
 *
 * Reached from the interstitial the GET renders (a form post the page sends itself), or by
 * anything else that already holds the token and wants the cookie session. The body is
 * form-encoded or JSON. Redirects are 303 so the browser follows with a GET; the default
 * 307 would replay the POST at the destination.
 */
export async function POST(request: Request) {
  const body = await readBody(request);
  const tokenHash = body.get('token_hash');
  const type = asOtpType(body.get('type'));
  const rawNext = body.get('next');
  const callerNext = rawNext != null && rawNext !== '' ? resolveAuthNextPath(rawNext) : null;
  const fallbackNext =
    callerNext ??
    (type === 'invite' || type === 'recovery' ? SET_PASSWORD_PATH : sanitizeAuthNextPath(null));
  const base = getBaseUrl(request.url);
  const redirect = (to: string) =>
    NextResponse.redirect(to, {
      status: 303,
      headers: { 'Cache-Control': 'no-store, max-age=0', 'Referrer-Policy': 'no-referrer' },
    });

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) {
      const { error: claimErr } = await supabase.rpc('claim_user_account');
      if (claimErr) {
        console.warn('[auth/confirm] claim_user_account:', claimErr.message);
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.id) {
        return redirect(`${base}${getAuthFailurePath(fallbackNext, 'exchange_failed')}`);
      }

      const meta = user.user_metadata as Record<string, unknown> | undefined;
      const needsSetPassword = meta?.has_set_password === false;
      const isSuper = hasPlatformSuperuserJwtRole(user);

      const admin = getSupabaseAdminClient();
      let destination = await resolvePostLoginDestination({
        admin,
        userId: user.id,
        userEmail: user.email ?? '',
        rawNext: callerNext,
        isPlatformSuperuser: isSuper,
        needsSetPassword,
        pendingSignup: readSignupPendingFromMetadata(meta),
      });

      destination = withSetPasswordGateIfNeeded(destination, needsSetPassword && !isSuper);

      if (isSuper) {
        const pathOnly = destination.split('?')[0] ?? '';
        if (pathOnly !== '/super' && !pathOnly.startsWith('/super/')) {
          destination = '/super';
        }
      }

      // A recovery link is a request to choose a new password, so land there whatever the
      // destination logic decided. Neither existing mechanism covers this case:
      // `resolvePostLoginDestination` does not treat SET_PASSWORD_PATH as an honoured
      // `next`, and `withSetPasswordGateIfNeeded` only fires when `has_set_password` is
      // false, which is never true of someone who already has a password. Without this a
      // reset behaves exactly like a magic link: signed in, dropped on the dashboard, and
      // the password never actually changed.
      if (type === 'recovery' && !destination.startsWith(SET_PASSWORD_PATH)) {
        destination = `${SET_PASSWORD_PATH}?next=${encodeURIComponent(destination)}`;
      }

      return redirect(`${base}${destination}`);
    }
    console.error('Auth confirm failed:', error.message);
    return redirect(`${base}${getAuthFailurePath(fallbackNext, mapAuthErrorMessageToDetail(error.message))}`);
  }

  return redirect(`${base}${getAuthFailurePath(fallbackNext, 'exchange_failed')}`);
}

/** The POST body as a flat map: a form post from the interstitial, or JSON. */
async function readBody(request: Request): Promise<URLSearchParams> {
  const contentType = request.headers.get('content-type') ?? '';
  const out = new URLSearchParams();
  try {
    if (contentType.includes('application/json')) {
      const json = (await request.json()) as Record<string, unknown> | null;
      for (const [k, v] of Object.entries(json ?? {})) if (typeof v === 'string') out.set(k, v);
      return out;
    }
    const form = await request.formData();
    for (const [k, v] of form.entries()) if (typeof v === 'string') out.set(k, v);
  } catch {
    // An unreadable body is an empty one: the caller lands on the sign-in page.
  }
  return out;
}
