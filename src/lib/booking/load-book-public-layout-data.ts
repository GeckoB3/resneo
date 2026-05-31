import { listBookingPageTeam } from '@/lib/booking/booking-page-team';
import { bookingPageShowsServicesTab, bookingPageShowsTeamTab } from '@/lib/booking/booking-page-tabs';
import { listBookingPageServices } from '@/lib/booking/list-booking-page-services';
import { isUnifiedSchedulingVenue } from '@/lib/booking/unified-scheduling';
import type { BookingPagePublicService } from '@/lib/booking/booking-page-tabs';
import type { VenuePublic } from '@/components/booking/types';
import type { SupabaseClient } from '@supabase/supabase-js';

export async function loadBookPublicLayoutData(
  supabase: SupabaseClient,
  venue: VenuePublic,
): Promise<{
  services: BookingPagePublicService[];
  team: Array<{ id: string; name: string }>;
}> {
  const config = venue.booking_page_config ?? {};
  const isAppointment = isUnifiedSchedulingVenue(venue.booking_model);
  const showServices = isAppointment && bookingPageShowsServicesTab(config);
  const showTeam = isAppointment && bookingPageShowsTeamTab(config);
  const hasTeamProfiles = Object.keys(config.team_profiles ?? {}).length > 0;

  const [services, team] = await Promise.all([
    showServices ? listBookingPageServices(supabase, venue.id) : Promise.resolve([]),
    showTeam && hasTeamProfiles ? listBookingPageTeam(supabase, venue.id) : Promise.resolve([]),
  ]);

  return { services, team };
}
