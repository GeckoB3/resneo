import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProcessingTimeBlock, ServiceVariant } from '@/types/booking-models';
import {
  parseProcessingTimeBlocksFromDb,
  processingTimeBlocksSchema,
  validateProcessingTimeBlocks,
} from '@/lib/appointments/processing-time';

/**
 * One variant in a request body. `id` is optional and only used to preserve an existing row
 * when the dashboard saves a service. `name` is required; numeric ranges mirror parent service
 * limits in `appointment-services/route.ts`.
 */
export const variantInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional().nullable(),
  duration_minutes: z.number().int().min(5).max(480),
  buffer_minutes: z.number().int().min(0).max(120).optional(),
  price_pence: z.number().int().min(0).optional().nullable(),
  deposit_pence: z.number().int().min(0).optional().nullable(),
  sort_order: z.number().int().optional(),
  is_active: z.boolean().optional(),
  processing_time_blocks: processingTimeBlocksSchema.optional(),
});

export type VariantInput = z.infer<typeof variantInputSchema>;

export const variantsArraySchema = z.array(variantInputSchema).max(40);

/**
 * Map a DB row to the shared `ServiceVariant` shape (used by catalog responses and dashboard).
 */
export function mapVariantRow(row: Record<string, unknown>): ServiceVariant {
  return {
    id: row.id as string,
    venue_id: row.venue_id as string,
    service_item_id: (row.service_item_id as string | null) ?? null,
    appointment_service_id: (row.appointment_service_id as string | null) ?? null,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    duration_minutes: row.duration_minutes as number,
    buffer_minutes: (row.buffer_minutes as number) ?? 0,
    price_pence: (row.price_pence as number | null) ?? null,
    deposit_pence: (row.deposit_pence as number | null) ?? null,
    sort_order: (row.sort_order as number) ?? 0,
    is_active: row.is_active !== false,
    created_at: (row.created_at as string) ?? new Date().toISOString(),
    processing_time_blocks: parseProcessingTimeBlocksFromDb(row.processing_time_blocks),
  };
}

/**
 * Reconcile the full set of variants for a parent service: rows the request still
 * carries are UPDATED in place, genuinely removed rows are deleted, new ones are
 * inserted.
 *
 * This used to delete every row and re-insert, which looked harmless because the
 * dashboard edits variants as one block. It was not. `bookings.service_variant_id`
 * is `ON DELETE SET NULL`, so every save of a variant-bearing service -- even one
 * that only changed the service's colour -- orphaned the variant pointer on all of
 * that service's existing bookings, past and future. Emails then resolved the
 * variant live, found nothing, and quoted the parent's name and price instead of
 * the option the guest actually booked.
 *
 * Validation runs BEFORE any mutation for the same reason: a rejected edit used to
 * return after the delete had already committed, leaving the service with zero
 * variants and silently turning it into a single-offering service.
 *
 * Note that deleting a variant the request genuinely dropped still nulls its
 * bookings' pointer. That is the intended meaning of removing an option, unlike
 * the accidental churn above.
 *
 * `parent` selects which FK to populate; the DB CHECK constraint enforces exactly
 * one is set.
 */
export async function replaceServiceVariants(params: {
  admin: SupabaseClient;
  venueId: string;
  parent:
    | { kind: 'service_item'; service_item_id: string }
    | { kind: 'appointment_service'; appointment_service_id: string };
  variants: VariantInput[];
}): Promise<
  | { ok: true; variants: ServiceVariant[] }
  /** `invalid` is the caller's input (answer 400), otherwise the write failed (500). */
  | { ok: false; error: string; invalid?: boolean }
> {
  const { admin, venueId, parent, variants } = params;

  const filterColumn =
    parent.kind === 'service_item' ? 'service_item_id' : 'appointment_service_id';
  const parentId =
    parent.kind === 'service_item' ? parent.service_item_id : parent.appointment_service_id;

  // Validate everything first: nothing below runs if any option is invalid.
  const normalizedBlocks: ProcessingTimeBlock[][] = [];
  for (const v of variants) {
    const chk = validateProcessingTimeBlocks(
      parseProcessingTimeBlocksFromDb(v.processing_time_blocks ?? []),
      v.duration_minutes,
    );
    if (!chk.ok) {
      return {
        ok: false,
        invalid: true,
        error: `Option "${v.name.trim()}": ${chk.error ?? 'Invalid processing time'}`,
      };
    }
    normalizedBlocks.push(chk.normalized ?? []);
  }

  const { data: existingRows, error: existingErr } = await admin
    .from('service_variants')
    .select('id')
    .eq('venue_id', venueId)
    .eq(filterColumn, parentId);

  if (existingErr) {
    console.error('replaceServiceVariants load failed:', existingErr);
    return { ok: false, error: 'Failed to load existing variants' };
  }

  const existingIds = new Set(((existingRows ?? []) as { id: string }[]).map((r) => r.id));

  /** Only an id we already own may be reused; anything else gets a fresh row. */
  const keepIds = new Set<string>();
  for (const v of variants) {
    if (v.id && existingIds.has(v.id)) keepIds.add(v.id);
  }

  const fieldsFor = (v: VariantInput, idx: number) => ({
    name: v.name.trim(),
    description: (v.description ?? null) || null,
    duration_minutes: v.duration_minutes,
    buffer_minutes: v.buffer_minutes ?? 0,
    price_pence: v.price_pence ?? null,
    deposit_pence: v.deposit_pence ?? null,
    sort_order: v.sort_order ?? idx,
    is_active: v.is_active ?? true,
    processing_time_blocks: normalizedBlocks[idx] ?? [],
  });

  for (const [idx, v] of variants.entries()) {
    if (!v.id || !keepIds.has(v.id)) continue;
    const { error } = await admin
      .from('service_variants')
      .update(fieldsFor(v, idx))
      .eq('id', v.id)
      .eq('venue_id', venueId)
      .eq(filterColumn, parentId);
    if (error) {
      console.error('replaceServiceVariants update failed:', error);
      return { ok: false, error: 'Failed to save variants' };
    }
  }

  const toInsert = variants
    .map((v, idx) => ({ v, idx }))
    .filter(({ v }) => !v.id || !keepIds.has(v.id))
    .map(({ v, idx }) => ({
      venue_id: venueId,
      service_item_id: parent.kind === 'service_item' ? parent.service_item_id : null,
      appointment_service_id:
        parent.kind === 'appointment_service' ? parent.appointment_service_id : null,
      ...fieldsFor(v, idx),
    }));

  if (toInsert.length > 0) {
    const { error } = await admin.from('service_variants').insert(toInsert);
    if (error) {
      console.error('replaceServiceVariants insert failed:', error);
      return { ok: false, error: 'Failed to save variants' };
    }
  }

  // Deleted last, so a failure above cannot leave the service short of options.
  const removedIds = [...existingIds].filter((id) => !keepIds.has(id));
  if (removedIds.length > 0) {
    const { error } = await admin
      .from('service_variants')
      .delete()
      .eq('venue_id', venueId)
      .eq(filterColumn, parentId)
      .in('id', removedIds);
    if (error) {
      console.error('replaceServiceVariants delete failed:', error);
      return { ok: false, error: 'Failed to remove old variants' };
    }
  }

  const { data: savedRows, error: savedErr } = await admin
    .from('service_variants')
    .select('*')
    .eq('venue_id', venueId)
    .eq(filterColumn, parentId)
    .order('sort_order', { ascending: true });

  if (savedErr) {
    console.error('replaceServiceVariants reload failed:', savedErr);
    return { ok: false, error: 'Failed to save variants' };
  }

  return { ok: true, variants: ((savedRows ?? []) as Record<string, unknown>[]).map(mapVariantRow) };
}

/**
 * Fetch a single variant and confirm it belongs to the venue + parent service. Used by booking
 * APIs to validate the `variant_id` in a request before applying its overrides.
 *
 * Returns `null` when missing, inactive, or attached to a different venue / parent service.
 * The caller should reject the request with a 400 in that case.
 */
export async function loadActiveVariantForService(params: {
  admin: SupabaseClient;
  venueId: string;
  serviceId: string;
  variantId: string;
}): Promise<ServiceVariant | null> {
  const { admin, venueId, serviceId, variantId } = params;
  const { data, error } = await admin
    .from('service_variants')
    .select('*')
    .eq('id', variantId)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (error) {
    console.error('loadActiveVariantForService failed:', error);
    return null;
  }
  if (!data) return null;
  const variant = mapVariantRow(data as Record<string, unknown>);
  if (!variant.is_active) return null;
  if (
    variant.service_item_id !== serviceId &&
    variant.appointment_service_id !== serviceId
  ) {
    return null;
  }
  return variant;
}

/**
 * Load all variants (active + inactive) for a list of parent service ids in either schema.
 * Returns a Map keyed by parent id so callers can attach `variants` to each service.
 */
export async function loadVariantsForServices(params: {
  admin: SupabaseClient;
  venueId: string;
  schema: 'service_item' | 'appointment_service';
  parentIds: string[];
}): Promise<Map<string, ServiceVariant[]>> {
  const { admin, venueId, schema, parentIds } = params;
  const result = new Map<string, ServiceVariant[]>();
  if (parentIds.length === 0) return result;

  const filterColumn = schema === 'service_item' ? 'service_item_id' : 'appointment_service_id';
  const { data, error } = await admin
    .from('service_variants')
    .select('*')
    .eq('venue_id', venueId)
    .in(filterColumn, parentIds)
    .order('sort_order', { ascending: true });

  if (error) {
    console.error('loadVariantsForServices failed:', error);
    return result;
  }

  for (const raw of (data ?? []) as Record<string, unknown>[]) {
    const variant = mapVariantRow(raw);
    const parentId =
      schema === 'service_item' ? variant.service_item_id : variant.appointment_service_id;
    if (!parentId) continue;
    const list = result.get(parentId) ?? [];
    list.push(variant);
    result.set(parentId, list);
  }

  return result;
}
