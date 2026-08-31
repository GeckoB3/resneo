import type { SupabaseClient } from '@supabase/supabase-js';

export interface AccountProfileRow {
  id: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  locale: string;
  timezone: string;
  default_login_destination: 'account' | 'dashboard' | 'ask' | null;
  notification_preferences: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * The signed-in customer's own profile row.
 *
 * **One query, not three.** The hub, the bookings list and the profile page
 * each ran their own `user_profiles` select, which is the shape C1 exists to
 * stop: a page doing work no route shares, so the mobile app cannot reach the
 * same answer without somebody re-implementing it.
 *
 * Read on the SESSION client, so RLS is the thing deciding whose row this is
 * rather than an `eq` the caller has to remember. `select('*')` because
 * `GET /api/account/profile` already returns exactly that to this customer,
 * and a narrower list here would be a second projection to keep in step.
 */
export async function loadAccountProfile(
  session: SupabaseClient,
  userId: string,
): Promise<AccountProfileRow | null> {
  const { data, error } = await session
    .from('user_profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    /*
      THROWS rather than returning null, because null already means "this
      account has no profile row" and one value cannot carry both answers. A
      route that returned 200 with `profile: null` on a read error would tell
      a client the customer has no profile, which is the same defect P4-1
      fixed for compliance forms.

      Callers choose: the route lets it reach its catch and answers 500, and a
      page that would rather render without the row catches it explicitly.
    */
    console.error('[loadAccountProfile] read failed:', error.message);
    throw new Error('Failed to load profile');
  }
  return (data as AccountProfileRow | null) ?? null;
}
