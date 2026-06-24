import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireImportAdmin } from '@/lib/import/auth';
import { applyReferenceResolution, type ImportReferenceRow } from '@/lib/import/resolve-reference';
import { refreshImportReferencesResolved } from '@/lib/import/refresh-references-resolved';
import { resolveVenueMode } from '@/lib/venue-mode';
import { getSupabaseAdminClient } from '@/lib/supabase';

const opSchema = z.object({
  reference_id: z.string().uuid(),
  action: z.enum(['map', 'skip', 'create']),
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
  create_duration_minutes: z.number().int().min(1).max(1440).optional().nullable(),
  create_price_pence: z.number().int().min(0).max(10_000_000).optional().nullable(),
});

const bodySchema = z.object({
  operations: z.array(opSchema).min(1).max(1000),
});

/**
 * Resolve many booking references in one request: bulk "create all unmatched",
 * catalogue-from-bookings creation, accept-all-suggestions, or bulk skip. Each
 * operation is applied independently and resilient — one failure is reported but
 * does not abort the rest. `references_resolved` is refreshed once at the end.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const ctx = await requireImportAdmin();
  if ('response' in ctx) return ctx.response;
  const { staff } = ctx;
  const { sessionId } = await params;

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  const admin = getSupabaseAdminClient();
  const venueId = staff.venue_id;
  const mode = await resolveVenueMode(admin, venueId);

  const ids = [...new Set(parsed.data.operations.map((o) => o.reference_id))];
  const { data: refRows } = await admin
    .from('import_booking_references')
    .select('id, reference_type, raw_value, ai_suggested_entity_id')
    .eq('session_id', sessionId)
    .eq('venue_id', venueId)
    .in('id', ids);

  const refById = new Map<string, ImportReferenceRow>(
    (refRows ?? []).map((r) => [(r as ImportReferenceRow).id, r as ImportReferenceRow]),
  );

  let created = 0;
  let mapped = 0;
  let skipped = 0;
  const errors: { reference_id: string; error: string }[] = [];

  // Sequential: createEntityForBookingImport inserts catalogue rows, and we want
  // deterministic, debuggable behaviour and per-row error isolation over raw speed.
  for (const op of parsed.data.operations) {
    const ref = refById.get(op.reference_id);
    if (!ref) {
      errors.push({ reference_id: op.reference_id, error: 'Reference not found in this session' });
      continue;
    }
    const result = await applyReferenceResolution({
      admin,
      sessionId,
      venueId,
      bookingModel: mode.bookingModel,
      ref,
      op: {
        action: op.action,
        resolved_entity_id: op.resolved_entity_id,
        resolved_entity_type: op.resolved_entity_type,
        create_label: op.create_label,
        create_duration_minutes: op.create_duration_minutes,
        create_price_pence: op.create_price_pence,
      },
    });
    if (!result.ok) {
      errors.push({ reference_id: op.reference_id, error: result.error });
      continue;
    }
    if (op.action === 'create') created += 1;
    else if (op.action === 'map') mapped += 1;
    else skipped += 1;
  }

  const referencesResolved = await refreshImportReferencesResolved(admin, sessionId, venueId);

  return NextResponse.json({
    ok: errors.length === 0,
    created,
    mapped,
    skipped,
    errors,
    references_resolved: referencesResolved,
  });
}
