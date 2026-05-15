import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getDashboardStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { ContactsDashboard } from './ContactsDashboard';
import type { BookingModel, VenueTerminology } from '@/types/booking-models';
import { DEFAULT_TERMINOLOGY } from '@/types/booking-models';
import { isAppointmentDashboardExperience } from '@/lib/booking/unified-scheduling';
import { normalizeEnabledModels } from '@/lib/booking/enabled-models';
import { venueUsesUnifiedAppointmentServiceData } from '@/lib/booking/uses-unified-appointment-data';
import { ToastProvider } from '@/components/ui/Toast';

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
      <div className="mx-auto w-full max-w-lg px-4 py-12 sm:px-6">
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-slate-600">No venue linked to your account.</p>
        </div>
      </div>
    );
  }

  const admin = getSupabaseAdminClient();
  const { data: venueRow, error: venueRowError } = await admin
    .from('venues')
    .select('booking_model, terminology, pricing_tier, currency, enabled_models, timezone, table_management_enabled')
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
  const tableManagementEnabled = Boolean((venueRow as { table_management_enabled?: boolean } | null)?.table_management_enabled);
  const rawTz = (venueRow as { timezone?: string | null } | null)?.timezone?.trim();
  const venueTimezone = rawTz && rawTz.length > 0 ? rawTz : 'Europe/London';
  const appointmentDashboardExperience = isAppointmentDashboardExperience(
    pricingTier,
    bookingModel,
    enabledModels,
  );
  const usesUnifiedServices = await venueUsesUnifiedAppointmentServiceData(admin, venueId);

  return (
    <ToastProvider>
      <div className="min-h-0 min-w-0 px-3 pb-[max(1rem,env(safe-area-inset-bottom,0px))] pt-[max(1rem,env(safe-area-inset-top,0px))] sm:px-4 md:p-6 md:pb-8 md:pt-6 lg:p-8">
        <div className="mx-auto max-w-[1600px] min-w-0">
          <ContactsDashboard
            venueId={venueId}
            currency={currency}
            tableManagementEnabled={tableManagementEnabled}
            terminology={terminology}
            appointmentDashboardExperience={appointmentDashboardExperience}
            isAdmin={staff.role === 'admin'}
            usesUnifiedServices={usesUnifiedServices}
            venueBookingModel={bookingModel}
            venueEnabledBookingModels={enabledModels}
            venueTimezone={venueTimezone}
          />
        </div>
      </div>
    </ToastProvider>
  );
}
