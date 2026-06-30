import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { requireCompliancePlan } from '@/lib/compliance/auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { COMPLIANCE_BUCKET } from '@/lib/compliance/files';
import { writeComplianceAuditEvent } from '@/lib/compliance/audit';

interface RouteCtx {
  params: { id: string } | Promise<{ id: string }>;
}

/**
 * GET /api/venue/compliance/records/[id]/file?field=<fieldId> — a short-lived signed URL
 * for a captured signature or uploaded file (audit H2). The compliance-files bucket is
 * private with no anon read, so staff have no other way to view the artefact. This route
 * authorises the venue, confirms the requested path is exactly the one stored on THIS
 * record (and under this venue's prefix), then signs it via the admin client.
 */
export async function GET(request: NextRequest, ctx: RouteCtx) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    const gate = await requireCompliancePlan(staff);
    if (!gate.ok) return gate.response;

    const { id } = await Promise.resolve(ctx.params);
    const fieldId = request.nextUrl.searchParams.get('field') ?? '';
    if (!fieldId) return NextResponse.json({ error: 'A field parameter is required.' }, { status: 400 });

    const admin = getSupabaseAdminClient();
    const { data: record } = await admin
      .from('compliance_records')
      .select('id, responses')
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();
    if (!record) return NextResponse.json({ error: 'Record not found.' }, { status: 404 });

    const responses = ((record as { responses?: Record<string, unknown> }).responses ?? {}) as Record<string, unknown>;
    const value = responses[fieldId];
    const storagePath =
      value && typeof value === 'object' ? (value as { storage_path?: unknown }).storage_path : null;
    const fileName = value && typeof value === 'object' ? (value as { file_name?: unknown }).file_name : null;
    // The path must be the one stored on this record AND inside this venue's namespace.
    if (typeof storagePath !== 'string' || !storagePath.startsWith(`venues/${staff.venue_id}/`)) {
      return NextResponse.json({ error: 'No file on this field.' }, { status: 404 });
    }

    const signed = await admin.storage.from(COMPLIANCE_BUCKET).createSignedUrl(storagePath, 120);
    if (signed.error || !signed.data?.signedUrl) {
      console.error('[compliance file download] sign failed:', signed.error?.message);
      return NextResponse.json({ error: 'Could not open the file.' }, { status: 500 });
    }

    // Sensitive-data access is logged on the append-only trail (spec §10.2).
    await writeComplianceAuditEvent(admin, {
      venueId: staff.venue_id,
      eventType: 'record.viewed',
      actorType: 'staff',
      actorStaffId: staff.id,
      complianceRecordId: id,
      metadata: { field_id: fieldId, artifact: true },
    });

    return NextResponse.json({
      url: signed.data.signedUrl,
      expires_in: 120,
      file_name: typeof fileName === 'string' ? fileName : null,
    });
  } catch (err) {
    console.error('GET /api/venue/compliance/records/[id]/file failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
