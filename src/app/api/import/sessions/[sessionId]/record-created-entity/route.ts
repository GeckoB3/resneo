import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireImportAdmin } from '@/lib/import/auth';
import { getSupabaseAdminClient } from '@/lib/supabase';

/**
 * Logs an `import_records` row for a catalogue entity that the import wizard
 * created via the normal services API (the full "Add service" modal). Without
 * this, undoing the import would leave the service behind, since services made
 * through `/api/venue/appointment-services` are not otherwise tracked by the
 * import. Mirrors the logging `create-reference-entity.ts` does for the inline
 * create path so `run-undo` (which deletes `service_item`/`appointment_service`
 * rows with action 'created') reverses them too.
 */
const bodySchema = z.object({
  entity_id: z.string().uuid(),
  entity_type: z.enum(['service_item', 'appointment_service', 'unified_calendar', 'practitioner']),
});

const ENTITY_TABLE: Record<z.infer<typeof bodySchema>['entity_type'], string> = {
  service_item: 'service_items',
  appointment_service: 'appointment_services',
  unified_calendar: 'unified_calendars',
  practitioner: 'practitioners',
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const ctx = await requireImportAdmin();
  if ('response' in ctx) return ctx.response;
  const { staff } = ctx;
  const { sessionId } = await params;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  const admin = getSupabaseAdminClient();
  const venueId = staff.venue_id;
  const { entity_id, entity_type } = parsed.data;

  // Confirm the session belongs to this venue before writing against it.
  const { data: session } = await admin
    .from('import_sessions')
    .select('id')
    .eq('id', sessionId)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  // Confirm the entity exists and belongs to this venue.
  const table = ENTITY_TABLE[entity_type];
  const { data: entity } = await admin
    .from(table)
    .select('id')
    .eq('id', entity_id)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (!entity) return NextResponse.json({ error: 'Entity not found' }, { status: 404 });

  // Idempotent: don't double-log if called twice for the same entity.
  const { data: existing } = await admin
    .from('import_records')
    .select('id')
    .eq('session_id', sessionId)
    .eq('record_type', entity_type)
    .eq('record_id', entity_id)
    .maybeSingle();
  if (existing) return NextResponse.json({ ok: true, alreadyRecorded: true });

  const { error } = await admin.from('import_records').insert({
    session_id: sessionId,
    venue_id: venueId,
    record_type: entity_type,
    record_id: entity_id,
    action: 'created',
    previous_data: null,
  });
  if (error) {
    console.error('[record-created-entity]', error);
    return NextResponse.json({ error: 'Failed to record created entity' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
