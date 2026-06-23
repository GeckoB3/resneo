import type { SupabaseClient } from '@supabase/supabase-js';
import type { BookingModel } from '@/types/booking-models';
import { createEntityForBookingImport } from '@/lib/import/create-reference-entity';
import { denormalizeReferenceOntoBookingRows } from '@/lib/import/denormalize-booking-rows';

/** Entity types a booking reference can resolve to. */
export type ResolvedEntityType =
  | 'service_item'
  | 'appointment_service'
  | 'unified_calendar'
  | 'practitioner'
  | 'event_session'
  | 'class_instance';

export type ReferenceResolutionOp = {
  action: 'map' | 'skip' | 'create';
  resolved_entity_id?: string | null;
  resolved_entity_type?: ResolvedEntityType | null;
  /** create: label for the new entity (defaults to the reference's raw value). */
  create_label?: string | null;
  create_duration_minutes?: number | null;
  create_price_pence?: number | null;
};

export type ImportReferenceRow = {
  id: string;
  reference_type: string;
  raw_value: string;
  ai_suggested_entity_id?: string | null;
};

/** Confirms a candidate entity belongs to the venue before we attach bookings to it. */
async function entityBelongsToVenue(
  admin: SupabaseClient,
  venueId: string,
  type: ResolvedEntityType,
  id: string,
): Promise<boolean> {
  if (type === 'class_instance') {
    const { data: ci } = await admin
      .from('class_instances')
      .select('class_type_id')
      .eq('id', id)
      .maybeSingle();
    if (!ci) return false;
    const { data: ct } = await admin
      .from('class_types')
      .select('id')
      .eq('id', (ci as { class_type_id: string }).class_type_id)
      .eq('venue_id', venueId)
      .maybeSingle();
    return Boolean(ct);
  }
  const table =
    type === 'service_item' ? 'service_items'
    : type === 'appointment_service' ? 'appointment_services'
    : type === 'unified_calendar' ? 'unified_calendars'
    : type === 'practitioner' ? 'practitioners'
    : 'event_sessions';
  const { data } = await admin
    .from(table)
    .select('id')
    .eq('id', id)
    .eq('venue_id', venueId)
    .maybeSingle();
  return Boolean(data);
}

export type ApplyReferenceResult =
  | { ok: true; createdEntity: { id: string; type: string } | null }
  | { ok: false; status: number; error: string };

/**
 * Applies one resolution (map / create / skip) to a booking reference: creates the
 * catalogue entity when asked, verifies map targets belong to the venue, updates the
 * `import_booking_references` row, and denormalises the resolved id onto matching
 * booking rows. Shared by the single-reference PATCH route and the bulk route so both
 * behave identically. The caller is responsible for refreshing
 * `references_resolved` once after a batch.
 */
export async function applyReferenceResolution(params: {
  admin: SupabaseClient;
  sessionId: string;
  venueId: string;
  bookingModel: BookingModel;
  ref: ImportReferenceRow;
  op: ReferenceResolutionOp;
}): Promise<ApplyReferenceResult> {
  const { admin, sessionId, venueId, bookingModel, ref, op } = params;

  let resolvedId: string | null = null;
  let resolvedType: ResolvedEntityType | null = null;
  let createdId: string | null = null;
  let createdType: string | null = null;

  if (op.action === 'skip') {
    resolvedId = null;
    resolvedType = null;
  } else if (op.action === 'create') {
    if (ref.reference_type !== 'service' && ref.reference_type !== 'staff') {
      return { ok: false, status: 400, error: 'Create is only supported for service or staff references' };
    }
    const label = op.create_label?.trim() || ref.raw_value;
    try {
      const created = await createEntityForBookingImport({
        admin,
        venueId,
        bookingModel,
        referenceType: ref.reference_type as 'service' | 'staff',
        name: label,
        sessionId,
        durationMinutes: op.create_duration_minutes ?? null,
        pricePence: op.create_price_pence ?? null,
      });
      createdId = created.id;
      createdType = created.entityType;
      resolvedId = created.id;
      resolvedType = created.entityType;
    } catch (e) {
      return { ok: false, status: 400, error: e instanceof Error ? e.message : 'Failed to create entity' };
    }
  } else {
    resolvedId = op.resolved_entity_id ?? ref.ai_suggested_entity_id ?? null;
    resolvedType = op.resolved_entity_type ?? null;
    if (!resolvedId || !resolvedType) {
      return { ok: false, status: 400, error: 'resolved_entity_id and resolved_entity_type required for map' };
    }
    const valid = await entityBelongsToVenue(admin, venueId, resolvedType, resolvedId);
    if (!valid) {
      return { ok: false, status: 400, error: `Invalid ${resolvedType.replace(/_/g, ' ')}` };
    }
  }

  const { error: upErr } = await admin
    .from('import_booking_references')
    .update({
      resolution_action: op.action,
      resolved_entity_id: resolvedId,
      resolved_entity_type: resolvedType,
      created_entity_id: createdId,
      created_entity_type: createdType,
      is_resolved: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', ref.id)
    .eq('session_id', sessionId)
    .eq('venue_id', venueId);

  if (upErr) {
    console.error('[applyReferenceResolution] update', upErr);
    return { ok: false, status: 500, error: 'Failed to update reference' };
  }

  await denormalizeReferenceOntoBookingRows(
    admin,
    sessionId,
    venueId,
    {
      reference_type: ref.reference_type,
      raw_value: ref.raw_value,
      resolution_action: op.action === 'create' ? 'map' : op.action,
      resolved_entity_id: resolvedId,
      resolved_entity_type: resolvedType,
    },
    bookingModel,
  );

  return { ok: true, createdEntity: createdId ? { id: createdId, type: createdType! } : null };
}
