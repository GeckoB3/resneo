import type { SupabaseClient } from '@supabase/supabase-js';
import { readPreferenceNamespace } from './notification-preferences';

/**
 * The account-level email preferences, finally read by something (P0-14, G21).
 *
 * WHAT WAS WRONG. `/account/profile` offered two toggles, saved them, and
 * nothing anywhere read either one. A customer could switch off marketing
 * email, see it persist across a reload, and keep receiving it. That is a
 * consumer-trust problem rather than a missing feature, which is why the plan
 * pulled it forward out of Phase 4.
 *
 * TWO LAYERS, NOT ONE, for marketing. `guests.marketing_opt_out` is per venue:
 * a customer can decline one salon's promotions and accept another's. The
 * preference here is per ACCOUNT and covers every venue at once. Both are
 * honoured, and either one suppressing is enough, because a customer who has
 * said no in either place has said no.
 *
 * SECURITY NOTICES ARE NEVER SUPPRESSED. Sign-in links, password changes and
 * account-deletion notices are how someone finds out their account is being
 * used by somebody else. A preference that could switch those off would be a
 * setting whose worst case is that an attacker turns it on.
 */

/** What a platform-originated email is for. Only `operational` is suppressible. */
export type PlatformEmailKind = 'operational' | 'security';

/**
 * The customer namespace of `notification_preferences`, for one account.
 *
 * Exported so the per-channel filter in the comms service reads the column
 * through the SAME function this module's consent checks use. Two readers of
 * one free-form jsonb column is how a namespacing change gets applied to one
 * of them, and the other keeps quietly reading defaults.
 */
export async function readCustomerPrefs(
  admin: Pick<SupabaseClient, 'from'>,
  userId: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await admin
    .from('user_profiles')
    .select('notification_preferences')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    // Fail OPEN, deliberately. This gates transactional and marketing email;
    // failing closed on a transient read error silently stops a customer's
    // mail, and silence is the one failure nobody reports.
    console.error('[customer-email-consent] preference read failed:', error.message);
    return {};
  }
  return readPreferenceNamespace(
    (data as { notification_preferences?: unknown } | null)?.notification_preferences,
    'customer',
  );
}

/**
 * May this account be sent MARKETING email?
 *
 * Defaults to false when unset: marketing is opt-in, and the profile toggle
 * reads `marketing_email === true` for the same reason.
 */
export async function accountAllowsMarketingEmail(
  admin: Pick<SupabaseClient, 'from'>,
  userId: string,
): Promise<boolean> {
  const prefs = await readCustomerPrefs(admin, userId);
  return prefs.marketing_email === true;
}

/**
 * May this account be sent a platform-originated email of this kind?
 *
 * `security` is always true and takes no read, so an outage cannot delay a
 * sign-in link. `operational` defaults to true when unset, matching the
 * profile UI, which treats anything but an explicit `false` as on.
 */
export async function accountAllowsPlatformEmail(
  admin: Pick<SupabaseClient, 'from'>,
  userId: string,
  kind: PlatformEmailKind,
): Promise<boolean> {
  if (kind === 'security') return true;
  const prefs = await readCustomerPrefs(admin, userId);
  return prefs.operational_email !== false;
}

/**
 * The account that owns a guest row, or null when the guest is not linked.
 *
 * A guest with no account has no account-level preference to honour, so the
 * per-venue `marketing_opt_out` is the whole answer for them.
 */
export async function accountUserIdForGuest(
  admin: Pick<SupabaseClient, 'from'>,
  guestId: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from('guests')
    .select('user_id')
    .eq('id', guestId)
    .maybeSingle();
  if (error) {
    console.error('[customer-email-consent] guest lookup failed:', error.message);
    return null;
  }
  return (data as { user_id?: string | null } | null)?.user_id ?? null;
}
