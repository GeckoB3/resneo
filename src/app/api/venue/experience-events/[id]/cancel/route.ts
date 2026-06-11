import { NextRequest, NextResponse, after } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { requireVenueExposesSecondaryModel } from '@/lib/booking/require-venue-secondary-model';
import { cancelStaffBookingWithNotify } from '@/lib/booking/staff-cancel-booking';
import { z } from 'zod';

const bodySchema = z.object({
  confirm: z.literal(true),
});

/**
 * POST /api/venue/experience-events/[id]/cancel - admin only.
 * Deactivates the event and cancels all active ticket bookings with refunds + comms per venue policy.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    if (!requireAdmin(staff)) return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });

    const admin = getSupabaseAdminClient();
    const modelGate = await requireVenueExposesSecondaryModel(admin, staff.venue_id, 'event_ticket');
    if (!modelGate.ok) return modelGate.response;

    const json = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request: confirm must be true' }, { status: 400 });
    }

    const { id: eventId } = await params;
    const venueId = staff.venue_id;

    const { data: eventRow, error: evErr } = await admin
      .from('experience_events')
      .select('id, venue_id, name, is_active')
      .eq('id', eventId)
      .maybeSingle();

    if (evErr || !eventRow || eventRow.venue_id !== venueId) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    const { error: patchErr } = await admin
      .from('experience_events')
      .update({ is_active: false })
      .eq('id', eventId)
      .eq('venue_id', venueId);

    if (patchErr) {
      console.error('POST /experience-events/[id]/cancel: deactivate failed:', patchErr);
      return NextResponse.json({ error: 'Failed to cancel event' }, { status: 500 });
    }

    const { data: bookingRows, error: bookErr } = await admin
      .from('bookings')
      .select('id, group_booking_id, status')
      .eq('venue_id', venueId)
      .eq('experience_event_id', eventId)
      .in('status', ['Pending', 'Booked', 'Confirmed', 'Seated']);

    if (bookErr) {
      console.error('POST /experience-events/[id]/cancel: list bookings failed:', bookErr);
      return NextResponse.json({ error: 'Failed to list bookings' }, { status: 500 });
    }

    const rows = bookingRows ?? [];
    const seenGroups = new Set<string>();
    let cancelledCount = 0;
    let notifications = 0;
    let refundFailures = 0;

    const prefix = `The venue has cancelled "${eventRow.name as string}".`;

    for (const row of rows) {
      const gid = (row as { group_booking_id?: string | null }).group_booking_id;
      if (gid) {
        if (seenGroups.has(gid)) continue;
        seenGroups.add(gid);
      }

      const bid = (row as { id: string }).id;
      const result = await cancelStaffBookingWithNotify(admin, staff.db, venueId, bid, {
        refundMessagePrefix: prefix,
        actorId: staff.id,
      });

      if (result.cancelled) {
        cancelledCount += 1;
        if (result.scheduleNotification) {
          notifications += 1;
          const work = result.scheduleNotification;
          after(async () => {
            await work();
          });
        }
      } else if (result.refundFailed) {
        refundFailures += 1;
      }
    }

    if (refundFailures > 0 && cancelledCount === 0) {
      return NextResponse.json(
        {
          error:
            'Refund could not be processed for one or more bookings. No bookings were cancelled — please try again or refund manually in Stripe.',
          code: 'REFUND_FAILED',
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,
      event_id: eventId,
      bookings_cancelled: cancelledCount,
      notifications_scheduled: notifications,
      ...(refundFailures > 0 ? { refund_failures: refundFailures } : {}),
    });
  } catch (err) {
    console.error('POST /api/venue/experience-events/[id]/cancel failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
