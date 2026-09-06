import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { executeBookingModificationGuestNotification } from '@/lib/booking/send-booking-modification-guest-notification';
import {
  linkedGrantAllowsMutation,
  loadStaffAccessibleBooking,
} from '@/lib/booking/staff-booking-access';

/**
 * POST /api/venue/bookings/[id]/guest-modification-notify — send the deferred booking
 * modification email/SMS after a calendar drag reschedule (the guest is notified when
 * staff press Notify, or when the follow-up timer runs out).
 *
 * Scoped the way the PATCH that deferred the message is scoped (R26): the booking may sit
 * on a linked venue's calendar, in which case the link must carry an edit grant, the same
 * grant the move itself needed. The message is the owner venue's (its templates, its
 * channels, its sender details), so the sender receives the booking's venue id, never the
 * caller's. Before R26 this route filtered on the caller's venue and answered 404 for a
 * partner's booking, so a linked move never emailed the guest.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const { id } = await params;

    const loaded = await loadStaffAccessibleBooking(staff, id);
    if (!loaded.ok) {
      return NextResponse.json({ error: loaded.error }, { status: loaded.status });
    }
    const { ownerVenueId, isOwnVenue, linkedGrant } = loaded.ctx;
    if (!linkedGrantAllowsMutation(linkedGrant, isOwnVenue)) {
      return NextResponse.json(
        { error: 'This link does not allow messaging guests on the other venue’s bookings.' },
        { status: 403 },
      );
    }

    const admin = getSupabaseAdminClient();
    const result = await executeBookingModificationGuestNotification(admin, ownerVenueId, id);

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('POST guest-modification-notify failed:', err);
    return NextResponse.json({ error: 'Could not send notification' }, { status: 500 });
  }
}
