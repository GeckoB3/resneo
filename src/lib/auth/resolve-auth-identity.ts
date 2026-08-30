import type { SupabaseClient } from '@supabase/supabase-js';

export interface AuthIdentity {
  id: string;
  email: string | null;
  appMetadata: Record<string, unknown>;
  userMetadata: Record<string, unknown>;
}

function parseClaims(claims: Record<string, unknown>): AuthIdentity | null {
  const id = typeof claims.sub === 'string' ? claims.sub : null;
  if (!id) return null;
  const email = typeof claims.email === 'string' ? claims.email : null;
  const appMetadata =
    claims.app_metadata && typeof claims.app_metadata === 'object'
      ? (claims.app_metadata as Record<string, unknown>)
      : {};
  const userMetadata =
    claims.user_metadata && typeof claims.user_metadata === 'object'
      ? (claims.user_metadata as Record<string, unknown>)
      : {};
  return { id, email, appMetadata, userMetadata };
}

function parseUser(user: {
  id: string;
  email?: string | null;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
}): AuthIdentity {
  return {
    id: user.id,
    email: user.email ?? null,
    appMetadata: user.app_metadata ?? {},
    userMetadata: user.user_metadata ?? {},
  };
}

/**
 * Resolve the authenticated user from JWT claims (local JWKS verify) when possible,
 * falling back to `getUser()` only when claims cannot be read.
 */
export async function resolveAuthIdentity(supabase: SupabaseClient): Promise<AuthIdentity | null> {
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  if (!claimsError && claimsData?.claims) {
    const parsed = parseClaims(claimsData.claims as Record<string, unknown>);
    if (parsed) return parsed;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return parseUser(user);
}

/**
 * Ask the AUTH SERVER whether this identity is still real.
 *
 * `resolveAuthIdentity` above prefers `getClaims()`, which verifies the JWT
 * LOCALLY against the project's key. That is the right default (it is fast and
 * needs no round trip) but it cannot see revocation: a session that has been
 * signed out elsewhere, or whose refresh token GoTrue has revoked, keeps
 * producing valid claims until the access token expires.
 *
 * That gap caused a redirect LOOP, not a bad page. Middleware trusted the
 * claims and treated the caller as signed in; `/account`'s layout used
 * `getUser()`, was told there was no user, and redirected to `/login`; and
 * middleware then bounced them straight back to `/account` because the claims
 * still looked fine. Neither side was wrong on its own terms, and the customer
 * got `ERR_TOO_MANY_REDIRECTS` where they should have got a sign-in form.
 *
 * **Fails OPEN on an unreachable auth server, and CLOSED on a rejected
 * session.** A 4xx is GoTrue saying "this session is gone", which is exactly
 * what must be believed. A 5xx or a network error is GoTrue being unavailable,
 * and treating that as a mass sign-out would turn an auth blip into everybody
 * losing their session.
 */
export async function confirmAuthIdentity(
  supabase: SupabaseClient,
  identity: AuthIdentity,
): Promise<{ metadata: Record<string, unknown>; confirmed: boolean }> {
  const { data, error } = await supabase.auth.getUser();
  const user = data?.user ?? null;
  if (user) {
    const metadata =
      user.user_metadata && typeof user.user_metadata === 'object'
        ? (user.user_metadata as Record<string, unknown>)
        : identity.userMetadata;
    return { metadata, confirmed: true };
  }
  const status = error?.status ?? 0;
  const rejected = status >= 400 && status < 500;
  return { metadata: identity.userMetadata, confirmed: !rejected };
}

