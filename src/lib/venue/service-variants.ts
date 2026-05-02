import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ServiceVariant } from '@/types/booking-models';

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
  };
}

/**
 * Replace the full set of variants for a parent service. We delete-then-insert because
 * variants are edited as a single block in the dashboard and the relation is small (≤40).
 *
 * `parent` selects which FK to populate; the DB CHECK constraint enforces exactly one is set.
 */
export async function replaceServiceVariants(params: {
  admin: SupabaseClient;
  venueId: string;
  parent:
    | { kind: 'service_item'; service_item_id: string }
    | { kind: 'appointment_service'; appointment_service_id: string };
  variants: VariantInput[];
}): Promise<{ ok: true; variants: ServiceVariant[] } | { ok: false; error: string }> {
  const { admin, venueId, parent, variants } = params;

  const filterColumn =
    parent.kind === 'service_item' ? 'service_item_id' : 'appointment_service_id';
  const parentId =
    parent.kind === 'service_item' ? parent.service_item_id : parent.appointment_service_id;

  const delRes = await admin
    .from('service_variants')
    .delete()
    .eq('venue_id', venueId)
    .eq(filterColumn, parentId);

  if (delRes.error) {
    console.error('replaceServiceVariants delete failed:', delRes.error);
    return { ok: false, error: 'Failed to clear existing variants' };
  }

  if (variants.length === 0) {
    return { ok: true, variants: [] };
  }

  const rows = variants.map((v, idx) => ({
    venue_id: venueId,
    service_item_id: parent.kind === 'service_item' ? parent.service_item_id : null,
    appointment_service_id:
      parent.kind === 'appointment_service' ? parent.appointment_service_id : null,
    name: v.name.trim(),
    description: (v.description ?? null) || null,
    duration_minutes: v.duration_minutes,
    buffer_minutes: v.buffer_minutes ?? 0,
    price_pence: v.price_pence ?? null,
    deposit_pence: v.deposit_pence ?? null,
    sort_order: v.sort_order ?? idx,
    is_active: v.is_active ?? true,
  }));

  const insRes = await admin.from('service_variants').insert(rows).select();
  if (insRes.error) {
    console.error('replaceServiceVariants insert failed:', insRes.error);
    return { ok: false, error: 'Failed to save variants' };
  }
  const saved = ((insRes.data ?? []) as Record<string, unknown>[]).map(mapVariantRow);
  return { ok: true, variants: saved };
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
