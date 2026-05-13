import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { executeBookingModificationGuestNotification } from '@/lib/booking/send-booking-modification-guest-notification';

/**
 * POST /api/venue/bookings/[id]/guest-modification-notify — send deferred booking modification email/SMS
 * after calendar drag reschedule (guest is notified after Confirm or the defer timer).
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const { id } = await params;
    const admin = getSupabaseAdminClient();

    const { data: booking, error } = await admin
      .from('bookings')
      .select('id')
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();

    if (error || !booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    await executeBookingModificationGuestNotification(admin, staff.venue_id, id);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('POST guest-modification-notify failed:', err);
    return NextResponse.json({ error: 'Could not send notification' }, { status: 500 });
  }
}
