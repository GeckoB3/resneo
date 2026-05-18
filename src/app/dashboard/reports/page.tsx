import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { ReportsView } from './ReportsView';
import { SmsUsageBanner } from './SmsUsageBanner';
import { getDashboardStaff } from '@/lib/venue-auth';
import type { BookingModel, VenueTerminology } from '@/types/booking-models';
import { DEFAULT_TERMINOLOGY } from '@/types/booking-models';
import { PageFrame } from '@/components/ui/dashboard/PageFrame';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';

function mergeVenueTerminology(model: BookingModel, raw: unknown): VenueTerminology {
  const base = DEFAULT_TERMINOLOGY[model];
  if (!raw || typeof raw !== 'object') return base;
  const t = raw as Partial<VenueTerminology>;
  return {
    client: typeof t.client === 'string' ? t.client : base.client,
    booking: typeof t.booking === 'string' ? t.booking : base.booking,
    staff: typeof t.staff === 'string' ? t.staff : base.staff,
  };
}

export default async function ReportsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirectTo=/dashboard/reports');

  const staff = await getDashboardStaff(supabase);
  if (staff.role !== 'admin') {
    redirect('/dashboard');
  }

  const venueId = staff.venue_id;

  if (!venueId) {
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

  const { data: venueRow, error: venueRowError } = await staff.db
    .from('venues')
    .select('booking_model, terminology, pricing_tier')
    .eq('id', venueId)
    .single();

  if (venueRowError) {
    console.error('[reports page] venue booking_model load failed:', venueRowError.message);
  }

  const bookingModel = (venueRow?.booking_model as BookingModel | null) ?? 'table_reservation';
  const pricingTier = (venueRow as { pricing_tier?: string | null } | null)?.pricing_tier ?? null;
  const terminology = mergeVenueTerminology(bookingModel, venueRow?.terminology);

  return (
    <PageFrame maxWidthClass="max-w-5xl" className="space-y-6">
      <SmsUsageBanner />
      <ReportsView
        bookingModel={bookingModel}
        terminology={terminology}
        venueId={venueId}
        pricingTier={pricingTier}
      />
    </PageFrame>
  );
}
