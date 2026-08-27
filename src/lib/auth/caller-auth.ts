import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { getSupabaseServerEnv } from '@/lib/supabase/server';

/**
 * Bearer-capable replacements for the auth SDK calls that silently no-op on a
 * cookie-less request (P0-12, closes G27).
 *
 * The trap: `createRouteHandlerClient` carries a mobile caller's token as a
 * GLOBAL Authorization header, which is enough for PostgREST reads and for
 * `auth.getUser()`. But `auth.updateUser()` and `auth.signOut()` read the
 * session from STORAGE, and a Bearer request has no cookie session, so both
 * return without doing anything. Password change, email change, global
 * sign-out and the sign-out inside account deletion were all no-ops for the
 * mobile app, three of them silently: a deleted account kept a working
 * refresh token.
 *
 * Two mechanisms, chosen deliberately:
 *
 * - `updateAuthUserAsCaller` calls GoTrue's own `PUT /auth/v1/user` with the
 *   caller's access token: byte-for-byte what `auth.updateUser` does once it
 *   has a session, so every project-level auth policy behaves identically for
 *   cookie and Bearer callers alike. The admin equivalent
 *   (`admin.updateUserById`) is NOT used for email: it applies the new email
 *   instantly, silently bypassing the double-confirm flow ("Secure email
 *   change") that a session-scoped update triggers.
 * - `signOutCaller` uses `admin.auth.admin.signOut(jwt, scope)`,
 *   which revokes refresh tokens server-side regardless of transport.
 */

/**
 * The caller's raw access token, from the Authorization header (mobile) or the
 * cookie session (web). Null when neither is present; callers should already
 * have 401'd via getUser() by then.
 */
export async function getCallerAccessToken(
  request: Request,
  supabase: SupabaseClient,
): Promise<string | null> {
  const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(\S+)/i)?.[1]?.trim();
  if (bearer) return bearer;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export interface CallerAuthError {
  message: string;
  /** GoTrue's stable error identifier, e.g. 'same_password'. */
  code?: string;
  status: number;
}

/**
 * PUT /auth/v1/user as the caller. `data` shallow-merges into user_metadata,
 * exactly as `auth.updateUser({ data })` does.
 */
export async function updateAuthUserAsCaller(
  accessToken: string,
  attributes: { password?: string; email?: string; data?: Record<string, unknown> },
): Promise<{ error: CallerAuthError | null }> {
  const { supabaseUrl, supabasePublishableKey } = getSupabaseServerEnv();
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    method: 'PUT',
    headers: {
      apikey: supabasePublishableKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(attributes),
    cache: 'no-store',
  });
  if (res.ok) return { error: null };

  const body = (await res.json().catch(() => ({}))) as {
    msg?: string;
    message?: string;
    error_description?: string;
    error_code?: string;
    code?: string | number;
  };
  return {
    error: {
      message: body.msg ?? body.message ?? body.error_description ?? 'Auth update failed',
      code: body.error_code ?? (typeof body.code === 'string' ? body.code : undefined),
      status: res.status,
    },
  };
}

/**
 * Revoke the caller's sessions server-side. 'global' revokes every refresh
 * token the user holds; 'local'/'others' keep GoTrue's narrower semantics.
 */
export async function signOutCaller(
  accessToken: string,
  scope: 'global' | 'local' | 'others',
): Promise<{ error: CallerAuthError | null }> {
  const admin = getSupabaseAdminClient();
  const { error } = await admin.auth.admin.signOut(accessToken, scope);
  if (!error) return { error: null };
  return { error: { message: error.message, code: error.code, status: error.status ?? 500 } };
}

/**
 * Server-side push-registration cleanup for global sign-out and account
 * deletion. The app unregisters its own device on sign-out, but only via an
 * in-memory id that does not survive a relaunch, and nothing at all cleans up
 * when the account is deleted: without this, a deleted account kept a live
 * push registration alongside its live token. Idempotent by construction (a
 * delete of nothing is a no-op), because the app will DELETE the same row
 * itself immediately after a sign-out (§5D.0 B6).
 */
export async function deleteUserDevices(userId: string): Promise<void> {
  const admin = getSupabaseAdminClient();
  const { error } = await admin.from('user_devices').delete().eq('user_id', userId);
  if (error) {
    // Cleanup must never turn a successful sign-out into a 500; the sweep on
    // the next global sign-out retries it.
    console.error('[deleteUserDevices]', userId, error.message);
  }
}
