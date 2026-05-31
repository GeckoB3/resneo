import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { resolveAuthIdentity } from '@/lib/auth/resolve-auth-identity';
import { isPlatformSuperuserFromIdentity } from '@/lib/platform-auth';
import { hasActiveVenueSupportSession } from '@/lib/support-session-server';
import { getDashboardStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { RestaurantSetupWizard } from './RestaurantSetupWizard';

export default async function OnboardingPage() {
  const supabase = await createClient();
  const identity = await resolveAuthIdentity(supabase);

  if (isPlatformSuperuserFromIdentity(identity)) {
    const allowVenueShell = await hasActiveVenueSupportSession(supabase);
    if (!allowVenueShell) redirect('/super');
  }

  const staff = await getDashboardStaff(supabase);
  if (!staff.venue_id) redirect('/dashboard');

  const admin = getSupabaseAdminClient();
  const { data: venue } = await admin
    .from('venues')
    .select('booking_model')
    .eq('id', staff.venue_id)
    .single();

  if (venue?.booking_model && venue.booking_model !== 'table_reservation') {
    redirect('/dashboard');
  }

  return <RestaurantSetupWizard />;
}
