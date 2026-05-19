import type { SupabaseClient } from '@supabase/supabase-js';
import type { BookingModel } from '@/types/booking-models';
import {
  resolveWaitlistVenueCapabilities,
  type WaitlistVenueCapabilities,
} from '@/lib/booking/waitlist-venue-capabilities';

export async function loadWaitlistVenueCapabilities(
  admin: SupabaseClient,
  venueId: string,
): Promise<WaitlistVenueCapabilities | null> {
  const { data: venue, error } = await admin
    .from('venues')
    .select('pricing_tier, booking_model, enabled_models, active_booking_models, onboarding_completed')
    .eq('id', venueId)
    .maybeSingle();

  if (error) {
    console.error('loadWaitlistVenueCapabilities: venue fetch failed', { venueId, message: error.message });
    return null;
  }
  if (!venue) return null;

  return resolveWaitlistVenueCapabilities({
    pricingTier: (venue as { pricing_tier?: string | null }).pricing_tier,
    bookingModel: (venue as { booking_model?: BookingModel | null }).booking_model,
    enabledModels: (venue as { enabled_models?: unknown }).enabled_models,
    activeBookingModels: (venue as { active_booking_models?: unknown }).active_booking_models,
    onboardingCompleted: (venue as { onboarding_completed?: boolean | null }).onboarding_completed ?? true,
  });
}
