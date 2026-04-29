import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { loadAccountSafeGuests } from '@/lib/account/account-bookings';
import { ProfileClient } from './ProfileClient';

type ProfileRow = {
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  locale: string;
  timezone: string;
  default_login_destination: 'account' | 'dashboard' | 'ask' | null;
  notification_preferences: Record<string, unknown>;
};

export default async function AccountProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profileData } = await supabase.from('user_profiles').select('*').eq('id', user!.id).maybeSingle();
  const profile = (profileData ?? {
    display_name: null,
    first_name: null,
    last_name: null,
    phone: null,
    locale: 'en-GB',
    timezone: 'Europe/London',
    default_login_destination: 'ask',
    notification_preferences: {},
  }) as ProfileRow;

  const [relationships, devicesResult] = await Promise.all([
    loadAccountSafeGuests(supabase),
    supabase
      .from('user_devices')
      .select('id, platform, device_name, last_seen_at, created_at')
      .eq('user_id', user!.id)
      .order('last_seen_at', { ascending: false }),
  ]);

  const venueIds = [...new Set(relationships.map((r) => r.venue_id))];
  const { data: venues } =
    venueIds.length > 0
      ? await getSupabaseAdminClient().from('venues').select('id, name').in('id', venueIds)
      : { data: [] as Array<{ id: string; name: string }> };
  const venueMap = new Map((venues ?? []).map((v) => [v.id, v.name]));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Profile &amp; preferences</h1>
        <p className="mt-1 text-sm text-slate-600">
          Manage your ReserveNI identity, notification settings, venue marketing consent, and devices.
        </p>
      </div>
      <ProfileClient
        initialProfile={profile}
        marketingRelationships={relationships.map((r) => ({
          id: r.id,
          venueName: venueMap.get(r.venue_id) ?? 'Venue',
          marketing_consent: r.marketing_consent,
          marketing_consent_at: r.marketing_consent_at,
          marketing_opt_out: r.marketing_opt_out,
        }))}
        devices={(devicesResult.data ?? []) as Array<{
          id: string;
          platform: string;
          device_name: string | null;
          last_seen_at: string | null;
          created_at: string;
        }>}
      />
    </div>
  );
}
