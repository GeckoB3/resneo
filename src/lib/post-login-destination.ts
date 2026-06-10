import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveAuthNextPath, isPublicBookingAuthReturnPath } from '@/lib/safe-auth-redirect';
import { SET_PASSWORD_PATH } from '@/lib/auth-link';
import { resolveVenueSubscriptionEntitlement } from '@/lib/billing/subscription-entitlement';

export interface PostLoginDestinationInput {
  admin: SupabaseClient;
  userId: string;
  userEmail: string;
  rawNext: string | null | undefined;
  /** From JWT / app_metadata — superusers never go to customer account by default. */
  isPlatformSuperuser: boolean;
  /** External sales agents route to /sales by default. */
  isSalesAgent?: boolean;
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
    isSalesAgent = false,
    needsSetPassword: _needsSetPassword,
  } = input;

  const next = resolveAuthNextPath(rawNext ?? undefined);

  if (isPlatformSuperuser) {
    return next.startsWith('/super') ? next : '/super';
  }

  if (isSalesAgent) {
    return next.startsWith('/sales') ? next : '/sales';
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
      .select('id, venue_id')
      .eq('user_id', userId)
      .is('revoked_at', null)
      .limit(5),
    admin
      .from('staff')
      .select('id, venue_id')
      .ilike('email', emailNorm)
      .is('revoked_at', null)
      .limit(5),
  ]);

  const staffIdSet = new Set<string>();
  const venueIdSet = new Set<string>();
  for (const r of [...(staffByUser ?? []), ...(staffByEmail ?? [])]) {
    staffIdSet.add(r.id);
    const venueId = (r as { venue_id?: string | null }).venue_id;
    if (venueId) venueIdSet.add(venueId);
  }
  const hasStaff = staffIdSet.size > 0;
  const venueIds = [...venueIdSet];

  // Detect guests by user_id OR by email — the claim_user_account RPC backfills
  // unlinked guest rows on every login, but we belt-and-brace here so a brand-
  // new login (where the claim hasn't fully propagated yet, or where the user
  // changed email) still routes through the dual-role chooser.
  //
  // In the same round-trip, load billing state for any venue the user staffs so we can
  // detect an active (paying / trialing / past-due / complimentary) subscription. This is
  // what lets a user who just paid — but hasn't finished onboarding — reach their venue on
  // the next login instead of being stranded on the customer dashboard.
  const [guestByUser, guestByEmail, venueBillingRes] = await Promise.all([
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
    venueIds.length
      ? admin
          .from('venues')
          .select(
            'id, plan_status, billing_access_source, subscription_current_period_end, pricing_tier',
          )
          .in('id', venueIds)
      : Promise.resolve({ data: [] }),
  ]);

  const hasGuest =
    ((guestByUser.count ?? 0) > 0) || ((guestByEmail.count ?? 0) > 0);

  type VenueBillingRow = {
    plan_status?: string | null;
    billing_access_source?: string | null;
    subscription_current_period_end?: string | null;
    pricing_tier?: string | null;
  };
  const venueBillingRows = ((venueBillingRes as { data?: VenueBillingRow[] | null }).data ?? []);
  // "Active subscription" = anything other than a fully expired/cancelled subscription
  // (active, trialing, scheduled-cancel-in-paid-window, past_due, or superuser-complimentary).
  const hasActiveSubscription = venueBillingRows.some(
    (v) =>
      resolveVenueSubscriptionEntitlement({
        plan_status: v.plan_status,
        billing_access_source: v.billing_access_source,
        subscription_current_period_end: v.subscription_current_period_end,
        pricing_tier: v.pricing_tier,
      }).kind !== 'expired_cancelled',
  );

  const pref = (profile as { default_login_destination?: string | null } | null)
    ?.default_login_destination;

  // An active subscription routes the user to their venue surface. We send them to /dashboard,
  // which the dashboard layout forwards to /onboarding (or /signup/booking-models) while
  // onboarding is incomplete — so "onboarding flow or venue dashboard, as appropriate" is
  // handled by the existing entry guards. The exception is a user who is ALSO a venue customer:
  // they keep the dual-role chooser, honouring an explicit profile preference when one is set.
  if (hasActiveSubscription) {
    if (hasGuest) {
      if (pref === 'account') return '/account';
      if (pref === 'dashboard') return '/dashboard';
      return '/auth/choose-destination';
    }
    return '/dashboard';
  }

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
