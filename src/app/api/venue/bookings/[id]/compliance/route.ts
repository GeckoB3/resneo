import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { requireCompliancePlanForVenue } from '@/lib/compliance/auth';
import { resolveComplianceReadScope } from '@/lib/compliance/linked-read';
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

/**
 * GET /api/venue/bookings/[id]/compliance — resolved requirement state + the guest's records.
 *
 * The booking may belong to a linked venue (it opened from that venue's column on the
 * caller's diary). Its requirements and records are then the OWNER venue's, read through
 * the link when it shares full details and personal data; see `resolveComplianceReadScope`.
 * The response says so (`linked: true`) so the panel shows them read-only.
 */
export async function GET(request: NextRequest, ctx: RouteCtx) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const { id } = await Promise.resolve(ctx.params);
    // Owner first: the venue filter that used to sit here is what made a linked
    // booking read as "not found".
    const { data: booking } = await getSupabaseAdminClient()
      .from('bookings')
      .select('id, venue_id, guest_id, booking_date, booking_time, appointment_service_id, service_item_id')
      .eq('id', id)
      .maybeSingle();
    if (!booking) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 });

    const b = booking as {
      venue_id: string;
      guest_id: string | null;
      booking_date: string;
      booking_time: string | null;
      appointment_service_id: string | null;
      service_item_id: string | null;
    };

    const {
      data: { user },
    } = await supabase.auth.getUser();
    const scope = await resolveComplianceReadScope({
      staff,
      ownerVenueId: b.venue_id,
      actingUserId: user?.id ?? null,
      resourceType: 'booking',
      resourceId: id,
    });
    if (!scope.ok) return scope.response;

    const gate = await requireCompliancePlanForVenue(scope.db, scope.venueId);
    if (!gate.ok) return gate.response;

    const resolution = await loadAndResolveServiceRequirements(scope.db, {
      venueId: scope.venueId,
      guestId: b.guest_id,
      appointmentServiceId: b.appointment_service_id,
      serviceItemId: b.service_item_id,
      bookingDatetime: bookingDatetime(b.booking_date, b.booking_time),
    });

    const records = b.guest_id
      ? await listComplianceRecords(scope.db, scope.venueId, { guestId: b.guest_id })
      : [];

    return NextResponse.json({
      applicable: resolution.applicable,
      requirements: resolution.resolved.map(serializeResolved),
      records,
      linked: scope.linked,
    });
  } catch (err) {
    console.error('GET /api/venue/bookings/[id]/compliance failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
