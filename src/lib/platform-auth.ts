import type { User } from '@supabase/supabase-js';
import type { AuthIdentity } from '@/lib/auth/resolve-auth-identity';

export const PLATFORM_ROLE_KEY = 'platform_role';
export const PLATFORM_ROLE_VALUE = 'superuser';

/** Set via admin API when a superuser is provisioned through the platform UI (see `platform_superusers`). */
export const PLATFORM_SUPERUSER_REGISTERED_KEY = 'platform_superuser_registered';

function hasRegisteredSuperuserFlag(appMetadata: Record<string, unknown> | undefined): boolean {
  return appMetadata?.[PLATFORM_SUPERUSER_REGISTERED_KEY] === true;
}

/**
 * Comma-separated lowercase emails that are allowed to access the platform dashboard.
 * Defense-in-depth: even if app_metadata is set, the email must also be in this list.
 */
function getAllowedEmails(): Set<string> {
  const raw = process.env.PLATFORM_SUPERUSER_EMAILS ?? '';
  return new Set(
    raw
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Returns true when the Supabase Auth user has `app_metadata.platform_role === "superuser"`
 * AND their email is in the `PLATFORM_SUPERUSER_EMAILS` env allowlist.
 */
/**
 * True when the JWT has `platform_role: superuser` (no email allowlist).
 * Use for client-side default redirects; middleware and `isPlatformSuperuser` still enforce the allowlist
 * or `platform_superuser_registered` flag.
 */
export function hasPlatformSuperuserJwtRole(user: User | null | undefined): boolean {
  if (!user) return false;
  const meta = user.app_metadata ?? {};
  return meta[PLATFORM_ROLE_KEY] === PLATFORM_ROLE_VALUE;
}

export function isPlatformSuperuser(user: User | null | undefined): boolean {
  if (!user) return false;
  return isPlatformSuperuserFromIdentity({
    id: user.id,
    email: user.email ?? null,
    appMetadata: (user.app_metadata ?? {}) as Record<string, unknown>,
    userMetadata: (user.user_metadata ?? {}) as Record<string, unknown>,
  });
}

/** Server-side superuser check without `auth.getUser()` when JWT claims are available. */
export function isPlatformSuperuserFromIdentity(identity: AuthIdentity | null | undefined): boolean {
  if (!identity) return false;
  if (identity.appMetadata[PLATFORM_ROLE_KEY] !== PLATFORM_ROLE_VALUE) return false;

  const email = (identity.email ?? '').toLowerCase().trim();
  if (getAllowedEmails().has(email)) return true;
  return hasRegisteredSuperuserFlag(identity.appMetadata);
}

/**
 * Lightweight check usable in middleware where only JWT claims are available.
 * `appMetadata` is the decoded `app_metadata` object from the JWT.
 */
export function isPlatformRoleInJwt(
  appMetadata: Record<string, unknown> | undefined,
  email: string | undefined,
): boolean {
  if (!appMetadata || appMetadata[PLATFORM_ROLE_KEY] !== PLATFORM_ROLE_VALUE) return false;

  const em = (email ?? '').toLowerCase().trim();
  if (getAllowedEmails().has(em)) return true;
  return hasRegisteredSuperuserFlag(appMetadata);
}
