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

function getBaseUrl(requestUrl: string): string {
  if (process.env.NEXT_PUBLIC_BASE_URL) return normalizePublicBaseUrl(process.env.NEXT_PUBLIC_BASE_URL);
  if (process.env.VERCEL_URL) return normalizePublicBaseUrl(`https://${process.env.VERCEL_URL}`);
  return normalizePublicBaseUrl(new URL(requestUrl).origin);
}

/**
 * GET /auth/confirm - handle OTP / email links (token_hash + type).
 *
 * Supabase email templates may send:
 *   {{ .SiteURL }}/auth/confirm?token_hash=xxx&type=magiclink
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
  const type = searchParams.get('type') as
    | 'signup'
    | 'invite'
    | 'magiclink'
    | 'recovery'
    | 'email_change'
    | null;
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
  const fallbackNext =
    rawNext != null && rawNext !== ''
      ? resolveAuthNextPath(rawNext)
      : type === 'invite' || type === 'recovery'
        ? SET_PASSWORD_PATH
        : sanitizeAuthNextPath(null);
  const base = getBaseUrl(request.url);

  // Hand off to the mobile app before verifying anything: the token is single-use, and the
  // app has to be the one to spend it. Verifying here would consume the link and leave the
  // app with nothing. Only the app's own scheme is ever bounced to.
  if (tokenHash && type && isAppDeepLink(redirectToParam)) {
    const deepLink = buildAppCallbackUrl(tokenHash, type);
    if (deepLink) {
      return new NextResponse(renderAppHandoffPage(deepLink, `${base}/login`), {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          // The URL holds a single-use credential: never cached, never sent onward.
          'Cache-Control': 'no-store, max-age=0',
          'Referrer-Policy': 'no-referrer',
        },
      });
    }
  }

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
        return NextResponse.redirect(`${base}${getAuthFailurePath(fallbackNext, 'exchange_failed')}`);
      }

      const meta = user.user_metadata as Record<string, unknown> | undefined;
      const needsSetPassword = meta?.has_set_password === false;
      const isSuper = hasPlatformSuperuserJwtRole(user);

      const admin = getSupabaseAdminClient();
      let destination = await resolvePostLoginDestination({
        admin,
        userId: user.id,
        userEmail: user.email ?? '',
        rawNext: fallbackNext,
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

      return NextResponse.redirect(`${base}${destination}`);
    }
    console.error('Auth confirm failed:', error.message);
    return NextResponse.redirect(`${base}${getAuthFailurePath(fallbackNext, mapAuthErrorMessageToDetail(error.message))}`);
  }

  // No token_hash. That means the Supabase template is still sending `{{ .ConfirmationURL }}`,
  // so GoTrue has redirected here with a PKCE `code` (or with `error`/`error_description` for a
  // spent link). Neither can be handled server-side: the PKCE verifier lives in the browser, and
  // `/auth/callback` already renders reason-specific copy for the error params. Hand off to it
  // with the query intact rather than flattening everything to `exchange_failed`.
  //
  // This is what makes `/auth/confirm` safe as an `emailRedirectTo` under *either* template
  // shape, so the template can be switched to `token_hash` independently of this deploy.
  const code = searchParams.get('code');
  const authError = searchParams.get('error') ?? searchParams.get('error_description');
  if (code || authError) {
    const forwarded = new URLSearchParams(searchParams);
    forwarded.set('next', fallbackNext);
    return NextResponse.redirect(`${base}/auth/callback?${forwarded.toString()}`);
  }

  return NextResponse.redirect(`${base}${getAuthFailurePath(fallbackNext, 'exchange_failed')}`);
}
