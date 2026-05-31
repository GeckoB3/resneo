import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';
import { BookingsDashboard } from './BookingsDashboard';
import { AppointmentBookingsDashboard } from './AppointmentBookingsDashboard';
import { getDashboardStaff, getStaffManagedCalendarIds } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { ToastProvider } from '@/components/ui/Toast';
import type { BookingModel } from '@/types/booking-models';
import { isAppointmentDashboardExperience, isUnifiedSchedulingVenue } from '@/lib/booking/unified-scheduling';
import { normalizeEnabledModels } from '@/lib/booking/enabled-models';
import { BookingsDashboardSkeleton } from '@/components/ui/dashboard/DashboardSkeletons';

export default async function BookingsPage() {
  const supabase = await createClient();

  const staff = await getDashboardStaff(supabase);
  const venueId = staff.venue_id;

  if (!venueId) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-slate-500">No venue linked to your account.</p>
        </div>
      </div>
    );
  }

  const admin = getSupabaseAdminClient();
  const { data: venue } = await admin
    .from('venues')
    .select('booking_model, currency, enabled_models, pricing_tier')
    .eq('id', venueId)
    .single();
  const bookingModel = (venue?.booking_model as BookingModel) ?? 'table_reservation';
  const enabledModels = normalizeEnabledModels(
    (venue as { enabled_models?: unknown } | null)?.enabled_models,
    bookingModel,
  );
  const currency = (venue?.currency as string) ?? 'GBP';
  const pricingTier = (venue as { pricing_tier?: string | null } | null)?.pricing_tier;
  const isTablePrimaryShell = bookingModel === 'table_reservation';
  const isAppointmentShell =
    !isTablePrimaryShell && isAppointmentDashboardExperience(pricingTier, bookingModel, enabledModels);
  const title =
    isUnifiedSchedulingVenue(bookingModel) && enabledModels.length === 0
      ? 'Appointments'
      : isAppointmentShell || enabledModels.length > 0
        ? 'Bookings'
        : 'Reservations';

  const linkedPractitionerIds =
    isAppointmentShell && staff.role === 'staff' && staff.id
      ? await getStaffManagedCalendarIds(admin, venueId, staff.id)
      : [];
  const defaultAppointmentPractitionerFilter: 'all' | string =
    linkedPractitionerIds.length === 1 ? linkedPractitionerIds[0] : 'all';
  const initialTodayIso = new Date().toISOString().slice(0, 10);

  return (
    <div className="min-h-0 min-w-0 px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] sm:px-4 md:p-6 md:pb-8 md:pt-6 lg:p-8">
      <div className={`mx-auto min-w-0 ${isTablePrimaryShell ? 'max-w-none' : 'max-w-6xl'}`}>
        {!isTablePrimaryShell && !isAppointmentShell ? (
          <h1 className="mb-4 text-xl font-semibold tracking-tight text-slate-900 sm:mb-6 sm:text-2xl">{title}</h1>
        ) : null}
        <ToastProvider>
          <Suspense fallback={<BookingsDashboardSkeleton />}>
            {isAppointmentShell ? (
              <AppointmentBookingsDashboard
                venueId={venueId}
                currency={currency}
                primaryBookingModel={bookingModel}
                enabledModels={enabledModels}
                defaultPractitionerFilter={defaultAppointmentPractitionerFilter}
                linkedPractitionerIds={linkedPractitionerIds}
                initialTodayIso={initialTodayIso}
              />
            ) : (
              <BookingsDashboard
                venueId={venueId}
                currency={currency}
                primaryBookingModel={bookingModel}
                enabledModels={enabledModels}
                initialTodayIso={initialTodayIso}
              />
            )}
          </Suspense>
        </ToastProvider>
      </div>
    </div>
  );
}
