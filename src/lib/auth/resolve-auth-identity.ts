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

/** Load `user_metadata` from Auth when JWT claims omit fields needed for routing. */
export async function resolveAuthUserMetadata(
  supabase: SupabaseClient,
  identity: AuthIdentity,
  options?: { fetchFromServer?: boolean },
): Promise<Record<string, unknown>> {
  if (!options?.fetchFromServer && Object.keys(identity.userMetadata).length > 0) {
    return identity.userMetadata;
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.user_metadata || typeof user.user_metadata !== 'object') {
    return identity.userMetadata;
  }
  return user.user_metadata as Record<string, unknown>;
}
