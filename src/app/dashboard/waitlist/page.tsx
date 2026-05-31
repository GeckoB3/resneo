import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getDashboardStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { loadWaitlistVenueCapabilities } from '@/lib/booking/load-waitlist-venue-capabilities';
import { shouldShowWaitlistNav } from '@/lib/booking/waitlist-venue-capabilities';
import { parseVenueFeatureFlags, resolveAppointmentsFeatureFlags } from '@/lib/feature-flags';
import { WaitlistPageClient } from './WaitlistPageClient';

export default async function WaitlistPage() {
  const supabase = await createClient();

  const staff = await getDashboardStaff(supabase);
  const venueId = staff.venue_id;
  if (!venueId) {
    redirect('/login?redirectTo=/dashboard/waitlist');
  }

  const admin = getSupabaseAdminClient();
  const capabilities = await loadWaitlistVenueCapabilities(admin, venueId);
  if (!capabilities) {
    redirect('/dashboard');
  }

  const { data: venueFlagsRow } = await admin
    .from('venues')
    .select('feature_flags')
    .eq('id', venueId)
    .maybeSingle();
  const appointmentWaitlistEnabled = resolveAppointmentsFeatureFlags(
    parseVenueFeatureFlags((venueFlagsRow as { feature_flags?: unknown } | null)?.feature_flags),
  ).waitlist_v2;

  if (!shouldShowWaitlistNav(capabilities, appointmentWaitlistEnabled)) {
    redirect('/dashboard');
  }

  return <WaitlistPageClient venueId={venueId} capabilities={capabilities} />;
}
