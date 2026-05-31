import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { DaySheetView } from './DaySheetView';
import { SwRegister } from './sw-register';
import { getDashboardStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { ToastProvider } from '@/components/ui/Toast';
import type { BookingModel } from '@/types/booking-models';
import { isUnifiedSchedulingVenue } from '@/lib/booking/unified-scheduling';
import {
  activeModelsToLegacyEnabledModels,
  getDefaultBookingModelFromActive,
  resolveActiveBookingModels,
} from '@/lib/booking/active-models';
import { isLinkFeatureVenue } from '@/lib/linked-accounts/eligibility';

export default async function DaySheetPage() {
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
    .select('table_management_enabled, booking_model, currency, enabled_models, active_booking_models, pricing_tier')
    .eq('id', venueId)
    .single();

  if (venue?.table_management_enabled) {
    redirect('/dashboard/floor-plan');
  }

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

  if (isUnifiedSchedulingVenue(bookingModel)) {
    redirect('/dashboard/calendar');
  }

  const linkFeature = isLinkFeatureVenue({
    pricing_tier: (venue as { pricing_tier?: string | null } | null)?.pricing_tier ?? null,
    booking_model: (venue?.booking_model as string | null) ?? null,
  });

  return (
    <div className="p-3 md:p-6 lg:p-8">
      <div className="mx-auto max-w-5xl">
        <SwRegister />
        <ToastProvider>
          <DaySheetView
            venueId={venueId}
            currency={(venue?.currency as string) ?? 'GBP'}
            bookingModel={bookingModel}
            enabledModels={enabledModels}
            linkFeature={linkFeature}
          />
        </ToastProvider>
      </div>
    </div>
  );
}
