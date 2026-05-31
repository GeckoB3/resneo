import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getDashboardStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { PageFrame } from '@/components/ui/dashboard/PageFrame';
import { venueHasClassCommerceEnabled } from '@/lib/class-commerce/auth';
import { ClassCommerceProductsClient } from './ClassCommerceProductsClient';

export default async function ClassCommerceProductsPage() {
  const supabase = await createClient();

  const staff = await getDashboardStaff(supabase);
  if (!staff.venue_id) {
    redirect('/dashboard/class-timetable');
  }

  // Phase 2 §5.1 — redirect away if the venue is not on an Appointments plan,
  // has not enabled class_session, or has the class_commerce_enabled flag off.
  const admin = getSupabaseAdminClient();
  const allowed = await venueHasClassCommerceEnabled(admin, staff.venue_id);
  if (!allowed) {
    redirect('/dashboard/class-timetable');
  }

  return (
    <PageFrame maxWidthClass="max-w-5xl">
      <ClassCommerceProductsClient venueId={staff.venue_id} />
    </PageFrame>
  );
}
