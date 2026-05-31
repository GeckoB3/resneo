import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getDashboardStaff } from '@/lib/venue-auth';

/** Legacy URL: widget settings now live on Settings → Booking Page. */
export default async function WidgetPage() {
  const supabase = await createClient();

  const staff = await getDashboardStaff(supabase);
  if (staff.role !== 'admin') {
    redirect('/dashboard');
  }

  redirect('/dashboard/settings?tab=booking-page#booking-widget');
}
