import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveAuthNextPath, isPublicBookingAuthReturnPath } from '@/lib/safe-auth-redirect';
import { SET_PASSWORD_PATH } from '@/lib/auth-link';

export interface PostLoginDestinationInput {
  admin: SupabaseClient;
  userId: string;
  userEmail: string;
  rawNext: string | null | undefined;
  /** From JWT / app_metadata — superusers never go to customer account by default. */
  isPlatformSuperuser: boolean;
  /** When true, caller should send user to set-password first (caller wraps next). */
  needsSetPassword: boolean;
}

/**
 * Resolves where to send the user after a successful auth session exists.
 * Caller still enforces set-password and superuser guards before/after this.
 */
export async function resolvePostLoginDestination(
  input: PostLoginDestinationInput,
): Promise<string> {
  const {
    admin,
    userId,
    userEmail,
    rawNext,
    isPlatformSuperuser,
    needsSetPassword: _needsSetPassword,
  } = input;

  const next = resolveAuthNextPath(rawNext ?? undefined);

  if (isPlatformSuperuser) {
    return next.startsWith('/super') ? next : '/super';
  }

  // Only treat the resolved `next` as an explicit caller intent when the caller
  // actually passed something. `resolveAuthNextPath('')` defaults to `/dashboard`,
  // and treating that default as "the caller explicitly asked for /dashboard"
  // would skip the dual-role chooser for any user who logged in without a
  // ?next= param (e.g. plain password sign-in from /login).
  const callerProvidedNext = Boolean(rawNext && rawNext.trim());

  const explicitAccount =
    callerProvidedNext && (next === '/account' || next.startsWith('/account/'));
  const explicitDashboard =
    callerProvidedNext && (next === '/dashboard' || next.startsWith('/dashboard/'));
  const explicitOnboarding =
    callerProvidedNext && (next === '/onboarding' || next.startsWith('/onboarding/'));
  const explicitPublicBooking = callerProvidedNext && isPublicBookingAuthReturnPath(next);

  if (explicitPublicBooking) return next;
  if (explicitOnboarding) return next;
  if (explicitAccount || explicitDashboard) return next;

  const emailNorm = userEmail.trim().toLowerCase();

  const [{ data: profile }, { data: staffByUser }, { data: staffByEmail }] = await Promise.all([
    admin.from('user_profiles').select('default_login_destination').eq('id', userId).maybeSingle(),
    admin
      .from('staff')
      .select('id')
      .eq('user_id', userId)
      .is('revoked_at', null)
      .limit(5),
    admin
      .from('staff')
      .select('id')
      .ilike('email', emailNorm)
      .is('revoked_at', null)
      .limit(5),
  ]);

  const staffIdSet = new Set<string>();
  for (const r of [...(staffByUser ?? []), ...(staffByEmail ?? [])]) {
    staffIdSet.add(r.id);
  }
  const hasStaff = staffIdSet.size > 0;

  // Detect guests by user_id OR by email — the claim_user_account RPC backfills
  // unlinked guest rows on every login, but we belt-and-brace here so a brand-
  // new login (where the claim hasn't fully propagated yet, or where the user
  // changed email) still routes through the dual-role chooser.
  const [guestByUser, guestByEmail] = await Promise.all([
    admin
      .from('guests')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId),
    emailNorm
      ? admin
          .from('guests')
          .select('id', { count: 'exact', head: true })
          .ilike('email', emailNorm)
      : Promise.resolve({ count: 0 }),
  ]);

  const hasGuest =
    ((guestByUser.count ?? 0) > 0) || ((guestByEmail.count ?? 0) > 0);

  const pref = (profile as { default_login_destination?: string | null } | null)
    ?.default_login_destination;

  if (pref === 'account') return '/account';
  if (pref === 'dashboard' && hasStaff) return '/dashboard';

  if (hasStaff && !hasGuest) return '/dashboard';
  if (hasGuest && !hasStaff) return '/account';
  if (hasStaff && hasGuest) {
    if (pref === 'ask' || pref === null || pref === undefined) {
      return '/auth/choose-destination';
    }
    return pref === 'dashboard' ? '/dashboard' : '/account';
  }

  return '/account';
}

/**
 * Wrap destination with set-password flow when required.
 */
export function withSetPasswordGateIfNeeded(
  destination: string,
  needsSetPassword: boolean,
): string {
  if (!needsSetPassword) return destination;
  const pathOnly = destination.split('?')[0] ?? '';
  if (pathOnly === SET_PASSWORD_PATH || pathOnly.startsWith(`${SET_PASSWORD_PATH}/`)) {
    return destination;
  }
  return `${SET_PASSWORD_PATH}?next=${encodeURIComponent(destination)}`;
}
