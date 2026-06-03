import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';
import { requireCompliancePlan } from '@/lib/compliance/auth';
import { complianceRecordCaptureSchema } from '@/lib/compliance/zod-schemas';
import {
  captureComplianceRecord,
  listComplianceRecords,
  loadStaffCaptureContext,
} from '@/lib/compliance/records-service';

/** GET /api/venue/compliance/records — list records (filters: guest_id, compliance_type_id, booking_id, status, from, to). */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    const gate = await requireCompliancePlan(staff);
    if (!gate.ok) return gate.response;

    const sp = request.nextUrl.searchParams;
    const records = await listComplianceRecords(staff.db, staff.venue_id, {
      guestId: sp.get('guest_id'),
      complianceTypeId: sp.get('compliance_type_id'),
      bookingId: sp.get('booking_id'),
      status: sp.get('status'),
      fromDate: sp.get('from'),
      toDate: sp.get('to'),
    });
    return NextResponse.json({ records });
  } catch (err) {
    console.error('GET /api/venue/compliance/records failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** POST /api/venue/compliance/records — capture a record (staff in venue). */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    const gate = await requireCompliancePlan(staff);
    if (!gate.ok) return gate.response;

    const body = await request.json().catch(() => null);
    const parsed = complianceRecordCaptureSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    // Guest must belong to the venue.
    const { data: guest } = await staff.db
      .from('guests')
      .select('id')
      .eq('id', parsed.data.guest_id)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();
    if (!guest) return NextResponse.json({ error: 'Guest not found.' }, { status: 404 });

    const context = await loadStaffCaptureContext(staff.db, staff.venue_id, parsed.data.compliance_type_id);
    if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    const userAgent = request.headers.get('user-agent');

    // In-venue self-service (spec §3.1 / improvement plan Phase 3): when the client
    // completes the form themselves on a venue device, validate in PUBLIC mode so
    // staff-only fields are stripped (never shown to the client) and the record is
    // attributed to the client, not the facilitating staff member.
    const isClientSelfComplete = parsed.data.capture_channel === 'client_walkin';

    const result = await captureComplianceRecord(
      staff.db,
      {
        venueId: staff.venue_id,
        guestId: parsed.data.guest_id,
        complianceTypeId: parsed.data.compliance_type_id,
        complianceTypeVersionId: context.value.versionId,
        resultType: context.value.resultType,
        validityPeriodDays: context.value.validityPeriodDays,
        formSchema: context.value.formSchema,
        bookingId: parsed.data.booking_id ?? null,
        captureChannel: parsed.data.capture_channel,
        capturedByStaffId: isClientSelfComplete ? null : staff.id,
        captureIp: ip,
        captureUserAgent: userAgent,
        notes: parsed.data.notes ?? null,
        mode: isClientSelfComplete ? 'public' : 'staff',
        actorType: isClientSelfComplete ? 'client' : 'staff',
      },
      parsed.data.responses,
    );

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, field_errors: result.fieldErrors },
        { status: result.status },
      );
    }
    return NextResponse.json({ record: result.record }, { status: 201 });
  } catch (err) {
    console.error('POST /api/venue/compliance/records failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
