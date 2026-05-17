import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getDashboardStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { isLinkFeatureVenue } from '@/lib/linked-accounts/eligibility';
import { PageFrame } from '@/components/ui/dashboard/PageFrame';
import { PageHeader } from '@/components/ui/dashboard/PageHeader';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { LinkedCalendarView } from '@/components/linked-accounts/LinkedCalendarView';

export default async function LinkedCalendarPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/login?redirectTo=/dashboard/linked-calendar');
  }

  const staff = await getDashboardStaff(supabase);
  if (!staff.venue_id) {
    redirect('/dashboard');
  }

  const admin = getSupabaseAdminClient();
  const { data: venue } = await admin
    .from('venues')
    .select('pricing_tier, booking_model')
    .eq('id', staff.venue_id)
    .maybeSingle();

  const feature = venue
    ? isLinkFeatureVenue({
        pricing_tier: (venue.pricing_tier as string | null) ?? null,
        booking_model: (venue.booking_model as string | null) ?? null,
      })
    : false;

  if (!feature) {
    redirect('/dashboard');
  }

  return (
    <PageFrame maxWidthClass="max-w-6xl" className="space-y-6">
      <PageHeader
        eyebrow="Linked accounts"
        title="Linked calendars"
        subtitle="Bookings in venues your venue is linked with. Linked-in calendars are shown in a muted style; a lock means you cannot edit that booking."
      />
      <SectionCard elevated>
        <SectionCard.Body>
          <LinkedCalendarView />
        </SectionCard.Body>
      </SectionCard>
    </PageFrame>
  );
}
