import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireImportAdmin } from '@/lib/import/auth';
import { applyReferenceResolution } from '@/lib/import/resolve-reference';
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
    .select('id, reference_type, raw_value, ai_suggested_entity_id')
    .eq('id', referenceId)
    .eq('session_id', sessionId)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (refErr || !refRow) {
    return NextResponse.json({ error: 'Reference not found' }, { status: 404 });
  }

  const result = await applyReferenceResolution({
    admin,
    sessionId,
    venueId,
    bookingModel: mode.bookingModel,
    ref: refRow as {
      id: string;
      reference_type: string;
      raw_value: string;
      ai_suggested_entity_id?: string | null;
    },
    op: {
      action: parsed.data.resolution_action,
      resolved_entity_id: parsed.data.resolved_entity_id,
      resolved_entity_type: parsed.data.resolved_entity_type,
      create_label: parsed.data.create_label,
      create_duration_minutes: parsed.data.create_duration_minutes,
      create_price_pence: parsed.data.create_price_pence,
    },
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  await refreshImportReferencesResolved(admin, sessionId, venueId);

  return NextResponse.json({ ok: true, created_entity: result.createdEntity });
}
