import { createClient } from '@/lib/supabase/server';
import { getDashboardStaff, getStaffManagedCalendarIds } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { normalizePublicBaseUrl } from '@/lib/public-base-url';
import { ToastProvider } from '@/components/ui/Toast';
import { EventManagerView } from './EventManagerView';
import { PageFrame } from '@/components/ui/dashboard/PageFrame';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';

export default async function EventManagerPage() {
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
    .select('currency, slug, stripe_connected_account_id')
    .eq('id', staff.venue_id)
    .single();
  const currency = (venue?.currency as string) ?? 'GBP';
  const slug = (venue?.slug as string) ?? '';
  const base = normalizePublicBaseUrl(process.env.NEXT_PUBLIC_BASE_URL);
  const publicBookingUrl = slug ? `${base}/book/${encodeURIComponent(slug)}` : base;
  const linkedPractitionerIds =
    staff.role === 'admin' || !staff.id
      ? []
      : await getStaffManagedCalendarIds(admin, staff.venue_id, staff.id);

  return (
    <ToastProvider>
      <PageFrame maxWidthClass="max-w-5xl">
        <EventManagerView
          venueId={staff.venue_id}
          isAdmin={staff.role === 'admin'}
          linkedPractitionerIds={linkedPractitionerIds}
          currency={currency}
          publicBookingUrl={publicBookingUrl}
          stripeConnected={Boolean((venue as { stripe_connected_account_id?: string | null } | null)?.stripe_connected_account_id)}
        />
      </PageFrame>
    </ToastProvider>
  );
}
