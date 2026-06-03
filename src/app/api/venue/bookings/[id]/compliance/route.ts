import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';
import { requireCompliancePlan } from '@/lib/compliance/auth';
import {
  bookingDatetime,
  loadAndResolveServiceRequirements,
  type ResolvedRequirement,
} from '@/lib/compliance/resolve-requirements';
import { listComplianceRecords } from '@/lib/compliance/records-service';

interface RouteCtx {
  params: { id: string } | Promise<{ id: string }>;
}

function serializeResolved(r: ResolvedRequirement) {
  const serializeRecord = (rec: ResolvedRequirement['matchingRecord']) =>
    rec
      ? {
          id: rec.id,
          status: rec.status,
          result: rec.result,
          captured_at: rec.captured_at.toISOString(),
          expires_at: rec.expires_at ? rec.expires_at.toISOString() : null,
          captured_by_staff_id: rec.captured_by_staff_id,
        }
      : null;
  return {
    requirement: {
      id: r.requirement.id,
      compliance_type_id: r.requirement.compliance_type_id,
      compliance_type_name: r.requirement.compliance_type_name,
      enforcement: r.requirement.enforcement,
      lock_period_hours: r.requirement.lock_period_hours,
      type_is_active: r.requirement.type_is_active,
    },
    state: r.state,
    lock_blocked: r.lockBlocked,
    matching_record: serializeRecord(r.matchingRecord),
    latest_record: serializeRecord(r.latestRecord),
  };
}

/** GET /api/venue/bookings/[id]/compliance — resolved requirement state + the guest's records. */
export async function GET(_request: NextRequest, ctx: RouteCtx) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    const gate = await requireCompliancePlan(staff);
    if (!gate.ok) return gate.response;

    const { id } = await Promise.resolve(ctx.params);
    const { data: booking } = await staff.db
      .from('bookings')
      .select('id, guest_id, booking_date, booking_time, appointment_service_id, service_item_id')
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();
    if (!booking) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 });

    const b = booking as {
      guest_id: string | null;
      booking_date: string;
      booking_time: string | null;
      appointment_service_id: string | null;
      service_item_id: string | null;
    };

    const resolution = await loadAndResolveServiceRequirements(staff.db, {
      venueId: staff.venue_id,
      guestId: b.guest_id,
      appointmentServiceId: b.appointment_service_id,
      serviceItemId: b.service_item_id,
      bookingDatetime: bookingDatetime(b.booking_date, b.booking_time),
    });

    const records = b.guest_id
      ? await listComplianceRecords(staff.db, staff.venue_id, { guestId: b.guest_id })
      : [];

    return NextResponse.json({
      applicable: resolution.applicable,
      requirements: resolution.resolved.map(serializeResolved),
      records,
    });
  } catch (err) {
    console.error('GET /api/venue/bookings/[id]/compliance failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
