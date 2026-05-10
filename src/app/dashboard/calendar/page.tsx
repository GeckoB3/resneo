import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getDashboardStaff, getStaffManagedCalendarIds } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { ToastProvider } from '@/components/ui/Toast';
import { PractitionerCalendarView } from '../practitioner-calendar/PractitionerCalendarView';
import type { BookingModel } from '@/types/booking-models';
import {
  activeModelsToLegacyEnabledModels,
  getDefaultBookingModelFromActive,
  resolveActiveBookingModels,
} from '@/lib/booking/active-models';
import { isVenueScheduleCalendarEligible } from '@/lib/booking/schedule-calendar-eligibility';
import { formatIsoDateInTimeZone } from '@/lib/date/format-iso-date-in-timezone';

export default async function CalendarPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirectTo=/dashboard/calendar');

  const staff = await getDashboardStaff(supabase);
  if (!staff.venue_id) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center p-12">
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-slate-500">No venue linked to your account.</p>
        </div>
      </div>
    );
  }

  const admin = getSupabaseAdminClient();
  const { data: venue } = await admin
    .from('venues')
    .select('currency, booking_model, enabled_models, active_booking_models, pricing_tier, timezone')
    .eq('id', staff.venue_id)
    .single();
  const rawVenueTimezone = (venue as { timezone?: string | null } | null | undefined)?.timezone;
  const venueTimezone =
    typeof rawVenueTimezone === 'string' && rawVenueTimezone.trim() !== ''
      ? rawVenueTimezone.trim()
      : 'Europe/London';
  const calendarTodayIso = formatIsoDateInTimeZone(new Date(), venueTimezone);
  const currency = (venue?.currency as string) ?? 'GBP';
  const activeModels = resolveActiveBookingModels({
    pricingTier: (venue as { pricing_tier?: string | null } | null)?.pricing_tier,
    bookingModel: venue?.booking_model as BookingModel | undefined,
    enabledModels: (venue as { enabled_models?: unknown } | null)?.enabled_models,
    activeBookingModels: (venue as { active_booking_models?: unknown } | null)?.active_booking_models,
  });
  const bookingModel = getDefaultBookingModelFromActive(
    activeModels,
    ((venue?.booking_model as string) ?? 'table_reservation') as BookingModel,
  );
  const enabledModels = activeModelsToLegacyEnabledModels(activeModels, bookingModel);

  if (!isVenueScheduleCalendarEligible(bookingModel, enabledModels)) {
    redirect('/dashboard');
  }

  const linkedPractitionerIds =
    staff.role === 'staff' && staff.id
      ? await getStaffManagedCalendarIds(admin, staff.venue_id, staff.id)
      : [];
  const defaultPractitionerFilter: 'all' | string =
    linkedPractitionerIds.length === 1 ? linkedPractitionerIds[0] : 'all';

  /**
   * All schedule-eligible venues use the shared appointments calendar (`PractitionerCalendarView`) with
   * user-configured calendar columns. Table-only venues are redirected above.
   */
  return (
    <ToastProvider>
      <div className="min-h-0 min-w-0 px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] sm:px-4 md:p-6 md:pb-8 md:pt-6 lg:p-8">
        <div className="mx-auto max-w-[1600px] min-w-0">
          <PractitionerCalendarView
            venueId={staff.venue_id}
            currency={currency}
            defaultPractitionerFilter={defaultPractitionerFilter}
            linkedPractitionerIds={linkedPractitionerIds}
            bookingModel={bookingModel}
            enabledModels={enabledModels}
            calendarTodayIso={calendarTodayIso}
          />
        </div>
      </div>
    </ToastProvider>
  );
}
