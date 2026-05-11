import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { buildDashboardHomePayload } from '@/lib/dashboard/dashboard-home-payload';
import { computeSetupStatus } from '@/lib/venue/compute-setup-status';
import { DashboardHomeClient } from './DashboardHomeClient';

export default async function DashboardHomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirectTo=/dashboard');

  const staff = await getVenueStaff(supabase);
  if (!staff) redirect('/login?redirectTo=/dashboard');

  const admin = getSupabaseAdminClient();
  let initialData;
  try {
    initialData = await buildDashboardHomePayload(admin, staff);
  } catch (e) {
    console.error('[dashboard home] build payload failed:', e);
    return (
      <div className="flex flex-col items-center justify-center p-16 text-center">
        <p className="text-sm font-medium text-slate-700">Unable to load dashboard</p>
        <p className="mt-1 text-xs text-slate-500">Please try refreshing the page.</p>
      </div>
    );
  }

  const setupStatusFromServer = staff.role === 'admin' ? await computeSetupStatus(staff) : null;

  return (
    <DashboardHomeClient
      initialData={initialData}
      setupStatusFromServer={setupStatusFromServer}
      disableClientSetupFetch
      venueId={staff.venue_id}
    />
  );
}
