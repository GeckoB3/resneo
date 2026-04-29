import { NextResponse } from 'next/server';
import { getAuthFailurePath, mapAuthErrorMessageToDetail, SET_PASSWORD_PATH } from '@/lib/auth-link';
import { normalizePublicBaseUrl } from '@/lib/public-base-url';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { sanitizeAuthNextPath } from '@/lib/safe-auth-redirect';
import { hasPlatformSuperuserJwtRole } from '@/lib/platform-auth';
import { resolvePostLoginDestination, withSetPasswordGateIfNeeded } from '@/lib/post-login-destination';

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
  const rawNext = searchParams.get('next');
  const fallbackNext =
    rawNext != null && rawNext !== ''
      ? sanitizeAuthNextPath(rawNext)
      : type === 'invite' || type === 'recovery'
        ? SET_PASSWORD_PATH
        : sanitizeAuthNextPath(null);
  const base = getBaseUrl(request.url);

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
      });

      destination = withSetPasswordGateIfNeeded(destination, needsSetPassword && !isSuper);

      if (isSuper) {
        const pathOnly = destination.split('?')[0] ?? '';
        if (pathOnly !== '/super' && !pathOnly.startsWith('/super/')) {
          destination = '/super';
        }
      }

      return NextResponse.redirect(`${base}${destination}`);
    }
    console.error('Auth confirm failed:', error.message);
    return NextResponse.redirect(`${base}${getAuthFailurePath(fallbackNext, mapAuthErrorMessageToDetail(error.message))}`);
  }

  return NextResponse.redirect(`${base}${getAuthFailurePath(fallbackNext, 'exchange_failed')}`);
}
