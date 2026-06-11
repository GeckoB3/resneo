import { NextRequest, NextResponse, after } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { requireVenueExposesSecondaryModel } from '@/lib/booking/require-venue-secondary-model';
import { removeCalendarBlockForClassInstance } from '@/lib/class-instances/instructor-calendar-block';
import { cancelStaffBookingWithNotify } from '@/lib/booking/staff-cancel-booking';
import { z } from 'zod';

const bodySchema = z.object({
  confirm: z.literal(true),
  cancel_reason: z.string().max(500).optional(),
});

/**
 * POST /api/venue/class-instances/[id]/cancel - admin only.
 * Marks the instance cancelled and cancels active bookings with refunds + comms per policy.
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
    const modelGate = await requireVenueExposesSecondaryModel(admin, staff.venue_id, 'class_session');
    if (!modelGate.ok) return modelGate.response;

    const json = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request: confirm must be true' }, { status: 400 });
    }

    const { id: instanceId } = await params;
    const venueId = staff.venue_id;

    const { data: inst, error: instErr } = await admin
      .from('class_instances')
      .select('id, instance_date, start_time, class_type_id')
      .eq('id', instanceId)
      .maybeSingle();

    if (instErr || !inst) {
      return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
    }

    const { data: classType, error: ctErr } = await admin
      .from('class_types')
      .select('name')
      .eq('id', inst.class_type_id as string)
      .eq('venue_id', venueId)
      .maybeSingle();

    if (ctErr || !classType) {
      return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
    }

    const { error: patchErr } = await admin
      .from('class_instances')
      .update({
        is_cancelled: true,
        cancel_reason: parsed.data.cancel_reason ?? null,
      })
      .eq('id', instanceId);

    if (patchErr) {
      console.error('POST class-instances/[id]/cancel: patch failed:', patchErr);
      return NextResponse.json({ error: 'Failed to cancel instance' }, { status: 500 });
    }

    await removeCalendarBlockForClassInstance(admin, instanceId);

    const { data: bookingRows, error: bookErr } = await admin
      .from('bookings')
      .select('id, group_booking_id, status')
      .eq('venue_id', venueId)
      .eq('class_instance_id', instanceId)
      .in('status', ['Pending', 'Booked', 'Confirmed', 'Seated']);

    if (bookErr) {
      console.error('POST class-instances/[id]/cancel: list bookings failed:', bookErr);
      return NextResponse.json({ error: 'Failed to list bookings' }, { status: 500 });
    }

    const rows = bookingRows ?? [];
    const seenGroups = new Set<string>();
    let cancelledCount = 0;
    let notifications = 0;
    let refundFailures = 0;

    const dateStr = String(inst.instance_date);
    const className = classType.name as string;
    const prefix = `The venue has cancelled "${className}" on ${dateStr}.`;

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
      class_instance_id: instanceId,
      bookings_cancelled: cancelledCount,
      notifications_scheduled: notifications,
      ...(refundFailures > 0 ? { refund_failures: refundFailures } : {}),
    });
  } catch (err) {
    console.error('POST /api/venue/class-instances/[id]/cancel failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
