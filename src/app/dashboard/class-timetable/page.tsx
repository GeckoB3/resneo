import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getDashboardStaff, getStaffManagedCalendarIds } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { ToastProvider } from '@/components/ui/Toast';
import { ClassTimetableView } from './ClassTimetableView';
import { PageFrame } from '@/components/ui/dashboard/PageFrame';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { venueHasClassCommerceEnabled } from '@/lib/class-commerce/auth';

export default async function ClassTimetablePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirectTo=/dashboard/class-timetable');

  const staff = await getDashboardStaff(supabase);
  if (!staff.venue_id) {
    return (
      <PageFrame maxWidthClass="max-w-lg">
        <SectionCard elevated>
          <SectionCard.Body className="py-10 text-center">
            <p className="text-slate-600">No venue linked to your account.</p>
          </SectionCard.Body>
        </SectionCard>
      </PageFrame>
    );
  }

  const admin = getSupabaseAdminClient();
  const { data: venue } = await admin
    .from('venues')
    .select('currency, stripe_connected_account_id')
    .eq('id', staff.venue_id)
    .single();
  const currency = (venue?.currency as string) ?? 'GBP';
  const stripeConnected = Boolean((venue as { stripe_connected_account_id?: string | null } | null)?.stripe_connected_account_id);
  const linkedPractitionerIds =
    staff.role === 'admin' || !staff.id
      ? []
      : await getStaffManagedCalendarIds(admin, staff.venue_id, staff.id);

  const classCommerceEnabled = await venueHasClassCommerceEnabled(admin, staff.venue_id);

  return (
    <ToastProvider>
      <PageFrame maxWidthClass="max-w-6xl">
        <ClassTimetableView
          venueId={staff.venue_id}
          isAdmin={staff.role === 'admin'}
          linkedPractitionerIds={linkedPractitionerIds}
          currency={currency}
          stripeConnected={stripeConnected}
          classCommerceEnabled={classCommerceEnabled}
        />
      </PageFrame>
    </ToastProvider>
  );
}
