import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getDashboardStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { isLinkFeatureVenue } from '@/lib/linked-accounts/eligibility';
import { formatIsoDateInTimeZone } from '@/lib/date/format-iso-date-in-timezone';
import { PageFrame } from '@/components/ui/dashboard/PageFrame';
import { PageHeader } from '@/components/ui/dashboard/PageHeader';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { LinkedCalendarView } from '@/components/linked-accounts/LinkedCalendarView';

export default async function LinkedCalendarPage() {
  const supabase = await createClient();
  const staff = await getDashboardStaff(supabase);
  if (!staff.venue_id) {
    redirect('/dashboard');
  }

  const admin = getSupabaseAdminClient();
  const { data: venue } = await admin
    .from('venues')
    .select('pricing_tier, booking_model, timezone')
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

  // §16.1 #12 — venue-local "today" so the default day is correct far from UTC.
  const venueToday = formatIsoDateInTimeZone(
    new Date(),
    (venue?.timezone as string | null) || 'Europe/London',
  );

  return (
    <PageFrame maxWidthClass="max-w-6xl" className="space-y-6">
      <PageHeader
        eyebrow="Linked accounts"
        title="Linked calendars"
        subtitle="Bookings in venues your venue is linked with. Linked-in calendars are shown in a muted style; a lock means you cannot edit that booking."
      />
      <SectionCard elevated>
        <SectionCard.Body>
          <LinkedCalendarView initialDate={venueToday} />
        </SectionCard.Body>
      </SectionCard>
    </PageFrame>
  );
}
