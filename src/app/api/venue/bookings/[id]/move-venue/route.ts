import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { moveBookingToCollectiveVenue } from '@/lib/linked-accounts/move-booking';

const bodySchema = z.object({
  calendar_id: z.string().uuid(),
  booking_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  booking_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
});

/**
 * POST /api/venue/bookings/[id]/move-venue { calendar_id, booking_date, booking_time }: move a
 * booking to a calendar at another venue of the same collective (D46 revised 2026-09-16). The other
 * venue gets the booking; the original is cancelled quietly; the client gets one message. A booking
 * with a deposit, card hold, payment or completed form is refused (409) with the reason.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Choose a calendar, a date and a time.' }, { status: 400 });
    }
    const { id } = await params;
    const result = await moveBookingToCollectiveVenue(getSupabaseAdminClient(), staff, user?.id ?? null, {
      bookingId: id,
      calendarId: parsed.data.calendar_id,
      bookingDate: parsed.data.booking_date,
      bookingTime: parsed.data.booking_time,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, ...(result.code ? { code: result.code } : {}) },
        { status: result.status },
      );
    }
    return NextResponse.json({
      ok: true,
      booking_id: result.bookingId,
      venue_id: result.venueId,
      venue_name: result.venueName,
      guest_notified: result.guestNotified,
    });
  } catch (err) {
    console.error('POST /api/venue/bookings/[id]/move-venue failed:', err);
    return NextResponse.json({ error: 'The booking could not be moved. Please try again.' }, { status: 500 });
  }
}
