import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { resolveVenueMode } from '@/lib/venue-mode';
import { isUnifiedSchedulingVenue, venueUsesUnifiedAppointmentData } from '@/lib/booking/unified-scheduling';
import { getUnifiedAvailableSlots } from '@/lib/unified-availability';
import { withScheduleFailClosed } from '@/lib/availability/schedule-unavailable-response';
import { nextResponseIfPublicBookingBlockedForVenue } from '@/lib/booking/light-plan-public-block';
import { z } from 'zod';

const querySchema = z.object({
  calendar_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  service_item_id: z.string().uuid(),
  venue_id: z.string().uuid(),
  /** Resource calendars: fix duration (minutes) instead of expanding min–max grid. */
  duration_minutes: z.coerce.number().int().min(5).max(1440).optional(),
});

/**
 * GET /api/booking/unified-availability?venue_id=&calendar_id=&date=&service_item_id=
 * Public: guest booking page slot list for unified scheduling venues.
 */
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const parsed = querySchema.safeParse({
      calendar_id: sp.get('calendar_id'),
      date: sp.get('date'),
      service_item_id: sp.get('service_item_id'),
      venue_id: sp.get('venue_id'),
      duration_minutes: sp.get('duration_minutes') ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid query parameters' }, { status: 400 });
    }

    const { venue_id, calendar_id, date, service_item_id, duration_minutes } = parsed.data;
    const supabase = getSupabaseAdminClient();
    const blocked = await nextResponseIfPublicBookingBlockedForVenue(supabase, venue_id);
    if (blocked) return blocked;

    const venueMode = await resolveVenueMode(supabase, venue_id);
    if (
      !isUnifiedSchedulingVenue(venueMode.bookingModel) &&
      !venueUsesUnifiedAppointmentData(venueMode.bookingModel, venueMode.enabledModels)
    ) {
      return NextResponse.json({ error: 'Venue does not use unified scheduling' }, { status: 400 });
    }

    /**
     * Stage 7: fail closed rather than open.
     *
     * If any schedule read inside the engine failed, the list below was built without one of
     * its inputs and may offer a time the venue is not open for. Say so instead, and let the
     * guest retry. The engine is unchanged; only what this route does with a known-incomplete
     * answer has changed.
     */
    return withScheduleFailClosed(async () => {
      const slots = await getUnifiedAvailableSlots({
        supabase,
        venueId: venue_id,
        calendarId: calendar_id,
        date,
        serviceItemId: service_item_id,
        durationMinutesOverride: duration_minutes,
      });
      return NextResponse.json({ slots });
    });
  } catch (err) {
    console.error('[unified-availability] GET failed:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
