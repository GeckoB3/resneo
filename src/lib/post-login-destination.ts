import type { SupabaseClient } from '@supabase/supabase-js';
import { sanitizeAuthNextPath } from '@/lib/safe-auth-redirect';
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

  const next = sanitizeAuthNextPath(rawNext ?? undefined);

  if (isPlatformSuperuser) {
    return next.startsWith('/super') ? next : '/super';
  }

  const explicitAccount = next === '/account' || next.startsWith('/account/');
  const explicitDashboard = next === '/dashboard' || next.startsWith('/dashboard/');
  const explicitOnboarding = next === '/onboarding' || next.startsWith('/onboarding/');

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

  const { count: guestLinkCount } = await admin
    .from('guests')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);

  const hasGuest = (guestLinkCount ?? 0) > 0;

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
