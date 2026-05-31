import { createClient } from '@/lib/supabase/server';
import { getDashboardStaff, getStaffManagedCalendarIds } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { AppointmentServicesView } from './AppointmentServicesView';
import { PageFrame } from '@/components/ui/dashboard/PageFrame';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';

export default async function AppointmentServicesPage() {
  const supabase = await createClient();

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

  let linkedPractitionerIds: string[] = [];
  if (staff.role !== 'admin' && staff.id) {
    linkedPractitionerIds = await getStaffManagedCalendarIds(admin, staff.venue_id, staff.id);
  }

  return (
    <PageFrame maxWidthClass="max-w-4xl">
      <AppointmentServicesView
        isAdmin={staff.role === 'admin'}
        linkedPractitionerIds={linkedPractitionerIds}
        currency={currency}
        stripeConnected={stripeConnected}
      />
    </PageFrame>
  );
}
