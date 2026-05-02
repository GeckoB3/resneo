import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getDashboardStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { PageFrame } from '@/components/ui/dashboard/PageFrame';
import { ContactsDashboard } from './ContactsDashboard';
import type { BookingModel, VenueTerminology } from '@/types/booking-models';
import { DEFAULT_TERMINOLOGY } from '@/types/booking-models';
import { isAppointmentDashboardExperience } from '@/lib/booking/unified-scheduling';
import { normalizeEnabledModels } from '@/lib/booking/enabled-models';

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

export default async function ContactsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirectTo=/dashboard/contacts');

  const staff = await getDashboardStaff(supabase);
  const venueId = staff.venue_id;

  if (!venueId) {
    return (
      <PageFrame maxWidthClass="max-w-lg">
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-slate-600">No venue linked to your account.</p>
        </div>
      </PageFrame>
    );
  }

  const admin = getSupabaseAdminClient();
  const { data: venueRow, error: venueRowError } = await admin
    .from('venues')
    .select('booking_model, terminology, pricing_tier, currency')
    .eq('id', venueId)
    .single();

  if (venueRowError) {
    console.error('[contacts page] venue load failed:', venueRowError.message);
  }

  const bookingModel = (venueRow?.booking_model as BookingModel | null) ?? 'table_reservation';
  const pricingTier = (venueRow as { pricing_tier?: string | null } | null)?.pricing_tier ?? null;
  const enabledModels = normalizeEnabledModels(
    (venueRow as { enabled_models?: unknown } | null)?.enabled_models,
    bookingModel,
  );
  const terminology = mergeVenueTerminology(bookingModel, venueRow?.terminology);
  const currency = (venueRow as { currency?: string | null } | null)?.currency ?? 'GBP';
  const appointmentDashboardExperience = isAppointmentDashboardExperience(
    pricingTier,
    bookingModel,
    enabledModels,
  );

  return (
    <PageFrame maxWidthClass="max-w-[1400px]" className="space-y-6">
      <ContactsDashboard
        venueId={venueId}
        currency={currency}
        terminology={terminology}
        appointmentDashboardExperience={appointmentDashboardExperience}
        isAdmin={staff.role === 'admin'}
      />
    </PageFrame>
  );
}
