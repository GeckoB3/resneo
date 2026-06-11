import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireImportAdmin } from '@/lib/import/auth';
import { createEntityForBookingImport } from '@/lib/import/create-reference-entity';
import { denormalizeReferenceOntoBookingRows } from '@/lib/import/denormalize-booking-rows';
import { refreshImportReferencesResolved } from '@/lib/import/refresh-references-resolved';
import { resolveVenueMode } from '@/lib/venue-mode';
import { getSupabaseAdminClient } from '@/lib/supabase';

const patchSchema = z.object({
  resolution_action: z.enum(['map', 'skip', 'create']),
  resolved_entity_id: z.string().uuid().optional(),
  resolved_entity_type: z
    .enum([
      'service_item',
      'appointment_service',
      'unified_calendar',
      'practitioner',
      'event_session',
      'class_instance',
    ])
    .optional(),
  create_label: z.string().min(1).max(200).optional(),
  /** Service setup from the import wizard (services only; ignored for staff). */
  create_duration_minutes: z.number().int().min(1).max(1440).optional().nullable(),
  create_price_pence: z.number().int().min(0).max(10_000_000).optional().nullable(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string; referenceId: string }> },
) {
  const ctx = await requireImportAdmin();
  if ('response' in ctx) return ctx.response;
  const { staff } = ctx;
  const { sessionId, referenceId } = await params;

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  const admin = getSupabaseAdminClient();
  const venueId = staff.venue_id;
  const mode = await resolveVenueMode(admin, venueId);

  const { data: refRow, error: refErr } = await admin
    .from('import_booking_references')
    .select('*')
    .eq('id', referenceId)
    .eq('session_id', sessionId)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (refErr || !refRow) {
    return NextResponse.json({ error: 'Reference not found' }, { status: 404 });
  }

  const r = refRow as {
    reference_type: string;
    raw_value: string;
    ai_suggested_entity_id?: string | null;
  };

  const action = parsed.data.resolution_action;
  let resolvedId: string | null = null;
  let resolvedType: string | null = null;
  let createdId: string | null = null;
  let createdType: string | null = null;

  if (action === 'skip') {
    resolvedId = null;
    resolvedType = null;
  } else if (action === 'create') {
    if (r.reference_type !== 'service' && r.reference_type !== 'staff') {
      return NextResponse.json({ error: 'Create is only supported for service or staff references' }, { status: 400 });
    }
    const label = parsed.data.create_label?.trim() ?? r.raw_value;
    const created = await createEntityForBookingImport({
      admin,
      venueId,
      bookingModel: mode.bookingModel,
      referenceType: r.reference_type as 'service' | 'staff',
      name: label,
      sessionId,
      durationMinutes: parsed.data.create_duration_minutes ?? null,
      pricePence: parsed.data.create_price_pence ?? null,
    });
    createdId = created.id;
    createdType = created.entityType;
    resolvedId = created.id;
    resolvedType = created.entityType;
  } else {
    resolvedId = parsed.data.resolved_entity_id ?? r.ai_suggested_entity_id ?? null;
    resolvedType = parsed.data.resolved_entity_type ?? null;
    if (!resolvedId || !resolvedType) {
      return NextResponse.json({ error: 'resolved_entity_id and resolved_entity_type required for map' }, { status: 400 });
    }
    // Verify entity belongs to venue (light checks)
    if (resolvedType === 'service_item') {
      const { data } = await admin
        .from('service_items')
        .select('id')
        .eq('id', resolvedId)
        .eq('venue_id', venueId)
        .maybeSingle();
      if (!data) return NextResponse.json({ error: 'Invalid service' }, { status: 400 });
    } else if (resolvedType === 'appointment_service') {
      const { data } = await admin
        .from('appointment_services')
        .select('id')
        .eq('id', resolvedId)
        .eq('venue_id', venueId)
        .maybeSingle();
      if (!data) return NextResponse.json({ error: 'Invalid appointment service' }, { status: 400 });
    } else if (resolvedType === 'unified_calendar') {
      const { data } = await admin
        .from('unified_calendars')
        .select('id')
        .eq('id', resolvedId)
        .eq('venue_id', venueId)
        .maybeSingle();
      if (!data) return NextResponse.json({ error: 'Invalid calendar' }, { status: 400 });
    } else if (resolvedType === 'practitioner') {
      const { data } = await admin
        .from('practitioners')
        .select('id')
        .eq('id', resolvedId)
        .eq('venue_id', venueId)
        .maybeSingle();
      if (!data) return NextResponse.json({ error: 'Invalid practitioner' }, { status: 400 });
    } else if (resolvedType === 'event_session') {
      const { data } = await admin
        .from('event_sessions')
        .select('id')
        .eq('id', resolvedId)
        .eq('venue_id', venueId)
        .maybeSingle();
      if (!data) return NextResponse.json({ error: 'Invalid event session' }, { status: 400 });
    } else if (resolvedType === 'class_instance') {
      const { data: ci } = await admin.from('class_instances').select('class_type_id').eq('id', resolvedId).maybeSingle();
      if (!ci) return NextResponse.json({ error: 'Invalid class instance' }, { status: 400 });
      const { data: ct } = await admin
        .from('class_types')
        .select('id')
        .eq('id', (ci as { class_type_id: string }).class_type_id)
        .eq('venue_id', venueId)
        .maybeSingle();
      if (!ct) return NextResponse.json({ error: 'Invalid class instance' }, { status: 400 });
    }
  }

  const now = new Date().toISOString();
  const { error: upErr } = await admin
    .from('import_booking_references')
    .update({
      resolution_action: action,
      resolved_entity_id: resolvedId,
      resolved_entity_type: resolvedType,
      created_entity_id: createdId,
      created_entity_type: createdType,
      is_resolved: true,
      updated_at: now,
    })
    .eq('id', referenceId)
    .eq('session_id', sessionId);

  if (upErr) {
    console.error('[PATCH reference]', upErr);
    return NextResponse.json({ error: 'Failed to update reference' }, { status: 500 });
  }

  await denormalizeReferenceOntoBookingRows(admin, sessionId, venueId, {
    reference_type: r.reference_type,
    raw_value: r.raw_value,
    resolution_action: action === 'create' ? 'map' : action,
    resolved_entity_id: resolvedId,
    resolved_entity_type: resolvedType,
  }, mode.bookingModel);

  await refreshImportReferencesResolved(admin, sessionId, venueId);

  return NextResponse.json({ ok: true });
}
