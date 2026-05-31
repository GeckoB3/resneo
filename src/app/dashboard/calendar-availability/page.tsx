import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getDashboardStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { AppointmentAvailabilitySettings } from '@/app/dashboard/availability/AppointmentAvailabilitySettings';
import type { BookingModel } from '@/types/booking-models';
import {
  activeModelsToLegacyEnabledModels,
  getDefaultBookingModelFromActive,
  resolveActiveBookingModels,
} from '@/lib/booking/active-models';
import { shouldShowAppointmentAvailabilitySettings } from '@/lib/booking/schedule-calendar-eligibility';
import { AppointmentAvailabilitySkeleton } from '@/components/ui/dashboard/DashboardSkeletons';

export default async function CalendarAvailabilitySettingsPage() {
  const supabase = await createClient();

  const staff = await getDashboardStaff(supabase);
  if (!staff.venue_id) {
    redirect('/dashboard');
  }

  const admin = getSupabaseAdminClient();
  const { data: venue } = await admin
    .from('venues')
    .select('booking_model, enabled_models, active_booking_models, pricing_tier')
    .eq('id', staff.venue_id)
    .single();
  const activeModels = resolveActiveBookingModels({
    pricingTier: (venue as { pricing_tier?: string | null } | null)?.pricing_tier,
    bookingModel: venue?.booking_model as BookingModel | undefined,
    enabledModels: (venue as { enabled_models?: unknown } | null)?.enabled_models,
    activeBookingModels: (venue as { active_booking_models?: unknown } | null)?.active_booking_models,
  });
  const bookingModel = getDefaultBookingModelFromActive(
    activeModels,
    (venue?.booking_model as BookingModel) ?? 'table_reservation',
  );
  const enabledModels = activeModelsToLegacyEnabledModels(activeModels, bookingModel);

  if (!shouldShowAppointmentAvailabilitySettings(bookingModel, enabledModels)) {
    redirect('/dashboard');
  }

  const isAdmin = staff.role === 'admin';

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <div className="mx-auto max-w-4xl">
        <Suspense fallback={<AppointmentAvailabilitySkeleton />}>
          <AppointmentAvailabilitySettings isAdmin={isAdmin} currentStaffId={staff.id} />
        </Suspense>
      </div>
    </div>
  );
}
