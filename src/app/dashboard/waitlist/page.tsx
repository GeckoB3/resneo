import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getDashboardStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { loadWaitlistVenueCapabilities } from '@/lib/booking/load-waitlist-venue-capabilities';
import { WaitlistPageClient } from './WaitlistPageClient';

export default async function WaitlistPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirectTo=/dashboard/waitlist');

  const staff = await getDashboardStaff(supabase);
  const venueId = staff.venue_id;
  if (!venueId) {
    redirect('/login?redirectTo=/dashboard/waitlist');
  }

  const admin = getSupabaseAdminClient();
  const capabilities = await loadWaitlistVenueCapabilities(admin, venueId);
  if (!capabilities?.showTableWaitlist && !capabilities?.showAppointmentWaitlist) {
    redirect('/dashboard');
  }

  return <WaitlistPageClient capabilities={capabilities} />;
}
