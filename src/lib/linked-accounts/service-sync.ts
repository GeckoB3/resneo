/**
 * Members' service copies follow the origin's scheduling shape.
 *
 * A copy made by the combined-page tick (§7.7.2) records the origin it came from
 * (`service_items.synced_from_service_id`) and starts `linked`. While the two venues share
 * a live collective, the origin's duration, buffer, processing periods and variants are
 * written to the copy whenever the origin is saved. Price, deposit, description, photo,
 * colour, heading, booking window, add-on groups and compliance requirements are never
 * synced: they are the member's own. A member's edit to a synced field detaches the copy
 * (`customised`); the host may re-sync it or stop it following (`independent`).
 *
 * Copies that existed before this shipped are `independent` and are not linked
 * retroactively (owner's decision, 2026-09-09). See Docs/collective-service-sync-plan.md.
 *
 * Every database write here is FAIL-SOFT: the origin's own save has already succeeded and
 * a partner venue's problem must never undo it or fail it. Failures are logged per copy and
 * the next copy still runs; the manager shows a copy that missed a sync as "update
 * available", and a manual re-sync repairs it.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProcessingTimeBlock } from '@/types/booking-models';
import { canonicalServiceShape, parseProcessingTimeBlocksFromDb } from '@/lib/appointments/processing-time';
import { invalidateCollectiveCatalogMemo } from '@/lib/linked-accounts/collective-venue';

export type ServiceSyncState = 'independent' | 'linked' | 'customised';

type Row = Record<string, unknown>;

/** The `service_items` columns that follow the origin. Everything else is the member's own. */
export const SYNCED_SERVICE_FIELDS = ['duration_minutes', 'buffer_minutes', 'processing_time_blocks'] as const;

/** Identity and parent pointers a NEW variant must not carry over from the origin's row. */
const VARIANT_COLUMNS_NOT_COPIED = new Set(['id', 'venue_id', 'service_item_id', 'appointment_service_id', 'created_at', 'updated_at']);

const UNDEFINED_COLUMN = '42703';
const SCHEMA_CACHE_MISS = 'PGRST204';

/** True when the database lacks the sync columns (migration 20270209120000 not applied). */
export function isMissingSyncColumnError(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === UNDEFINED_COLUMN || error.code === SCHEMA_CACHE_MISS) return true;
  const m = error.message ?? '';
  return /synced_from_service_id|sync_state|synced_at/.test(m) && /column|schema cache/i.test(m);
}

export interface ServiceShape {
  duration_minutes: number;
  buffer_minutes: number;
  processing_time_blocks: Array<{ start_minute: number; duration_minutes: number }>;
  variants: Array<{
    nameKey: string;
    duration_minutes: number;
    buffer_minutes: number;
    processing_time_blocks: Array<{ start_minute: number; duration_minutes: number }>;
  }>;
}

export function normaliseVariantName(name: unknown): string {
  return String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Canonical duration and blocks for a row. The blocks keep their ids (uuids the parser
 * insists on, so a written block must carry one); `bare` is the id-less projection used
 * for comparison.
 */
function blocksShape(raw: unknown, durationMinutes: number): {
  duration: number;
  blocks: ProcessingTimeBlock[];
  bare: Array<{ start_minute: number; duration_minutes: number }>;
} {
  const canon = canonicalServiceShape({ durationMinutes, processingBlocks: parseProcessingTimeBlocksFromDb(raw) });
  const blocks = [...canon.processingBlocks].sort((a, b) => a.start_minute - b.start_minute);
  return {
    duration: canon.durationMinutes,
    blocks,
    bare: blocks.map((b) => ({ start_minute: b.start_minute, duration_minutes: b.duration_minutes })),
  };
}

/**
 * The synced fields of a service and its ACTIVE variants as a comparable value, canonical
 * shape applied, so origin and copy compare on the same footing whatever each row holds.
 */
export function serviceShapeOf(row: Row, variants: readonly Row[]): ServiceShape {
  const svc = blocksShape(row.processing_time_blocks, Number(row.duration_minutes ?? 0));
  return {
    duration_minutes: svc.duration,
    buffer_minutes: Number(row.buffer_minutes ?? 0),
    processing_time_blocks: svc.bare,
    variants: variants
      .filter((v) => v.is_active !== false)
      .map((v) => {
        const shape = blocksShape(v.processing_time_blocks, Number(v.duration_minutes ?? 0));
        return {
          nameKey: normaliseVariantName(v.name),
          duration_minutes: shape.duration,
          buffer_minutes: Number(v.buffer_minutes ?? 0),
          processing_time_blocks: shape.bare,
        };
      })
      .sort((a, b) => a.nameKey.localeCompare(b.nameKey)),
  };
}

export function shapesMatch(a: ServiceShape, b: ServiceShape): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * True when a service PATCH changes a synced field, or changes the shape of
 * the variants. The services form sends the variants with every save, so a
 * provided list only counts when it differs from what is stored.
 */
export function patchTouchesSyncedShape(
  updatePayload: Row,
  variants: { next: readonly Row[]; current: readonly Row[] } | null,
  current: Row,
): boolean {
  if (variants) {
    const before = serviceShapeOf(current, variants.current).variants;
    const after = serviceShapeOf(current, variants.next).variants;
    if (JSON.stringify(before) !== JSON.stringify(after)) return true;
  }
  for (const key of SYNCED_SERVICE_FIELDS) {
    if (!(key in updatePayload)) continue;
    const next = updatePayload[key];
    const prev = current[key];
    if (key === 'processing_time_blocks') {
      const a = blocksShape(next, Number(updatePayload.duration_minutes ?? current.duration_minutes ?? 0)).bare;
      const b = blocksShape(prev, Number(current.duration_minutes ?? 0)).bare;
      if (JSON.stringify(a) !== JSON.stringify(b)) return true;
      continue;
    }
    if (Number(next ?? 0) !== Number(prev ?? 0)) return true;
  }
  return false;
}

export interface VariantSyncPlan {
  /** Matched by name: the synced fields to write. Name and price are left alone. */
  update: Array<{ id: string; fields: Row }>;
  /** At the origin but not the copy: rows to insert, origin price included as the initial copy does. */
  insert: Row[];
  /** At the copy but no longer at the origin: set inactive, never deleted (bookings may point at them). */
  deactivate: string[];
}

/**
 * Reconcile a copy's variants with the origin's, by normalised name. Inactive origin
 * variants are not pushed (a member's active variant of that name is deactivated instead,
 * because the origin no longer offers it).
 */
export function planVariantSync(originVariants: readonly Row[], copyVariants: readonly Row[]): VariantSyncPlan {
  const plan: VariantSyncPlan = { update: [], insert: [], deactivate: [] };
  const copyByName = new Map<string, Row>();
  for (const v of copyVariants) {
    const key = normaliseVariantName(v.name);
    // Prefer an active copy row when two share a name (an old deactivated one may linger).
    const existing = copyByName.get(key);
    if (!existing || (existing.is_active === false && v.is_active !== false)) copyByName.set(key, v);
  }
  const seen = new Set<string>();
  for (const o of originVariants) {
    if (o.is_active === false) continue;
    const key = normaliseVariantName(o.name);
    seen.add(key);
    const canon = blocksShape(o.processing_time_blocks, Number(o.duration_minutes ?? 0));
    const synced: Row = {
      duration_minutes: canon.duration,
      buffer_minutes: Number(o.buffer_minutes ?? 0),
      processing_time_blocks: canon.blocks,
      sort_order: Number(o.sort_order ?? 0),
    };
    const target = copyByName.get(key);
    if (target) {
      plan.update.push({ id: target.id as string, fields: { ...synced, is_active: true } });
      continue;
    }
    const fresh: Row = {};
    for (const [k, v] of Object.entries(o)) if (!VARIANT_COLUMNS_NOT_COPIED.has(k)) fresh[k] = v;
    plan.insert.push({ ...fresh, ...synced, is_active: true });
  }
  for (const v of copyVariants) {
    if (v.is_active === false) continue;
    if (!seen.has(normaliseVariantName(v.name))) plan.deactivate.push(v.id as string);
  }
  return plan;
}

// ---------------------------------------------------------------------------
// Database side
// ---------------------------------------------------------------------------

const SERVICE_SELECT = 'id, venue_id, name, duration_minutes, buffer_minutes, processing_time_blocks, synced_from_service_id, sync_state, synced_at';

async function loadService(admin: SupabaseClient, id: string): Promise<Row | null> {
  const { data, error } = await admin.from('service_items').select(SERVICE_SELECT).eq('id', id).maybeSingle();
  if (error) {
    if (!isMissingSyncColumnError(error)) console.error('[service-sync] service read failed:', error.message, { id });
    return null;
  }
  return (data as Row | null) ?? null;
}

async function loadVariants(admin: SupabaseClient, venueId: string, serviceId: string): Promise<Row[]> {
  const { data, error } = await admin
    .from('service_variants')
    .select('*')
    .eq('venue_id', venueId)
    .eq('service_item_id', serviceId)
    .order('sort_order', { ascending: true });
  if (error) {
    console.error('[service-sync] variants read failed:', error.message, { serviceId });
    return [];
  }
  return (data ?? []) as Row[];
}

/** Both venues are active members of one live collective. */
export async function venuesShareLiveCollective(admin: SupabaseClient, venueA: string, venueB: string): Promise<boolean> {
  if (venueA === venueB) return true;
  const { data, error } = await admin
    .from('venue_collective_members')
    .select('collective_id, venue_id, venue_collectives!inner(status)')
    .in('venue_id', [venueA, venueB])
    .eq('status', 'active')
    .eq('venue_collectives.status', 'active');
  if (error) {
    console.error('[service-sync] membership read failed:', error.message);
    return false;
  }
  const byCollective = new Map<string, Set<string>>();
  for (const row of (data ?? []) as Array<{ collective_id: string; venue_id: string }>) {
    const set = byCollective.get(row.collective_id) ?? new Set<string>();
    set.add(row.venue_id);
    byCollective.set(row.collective_id, set);
  }
  for (const set of byCollective.values()) if (set.has(venueA) && set.has(venueB)) return true;
  return false;
}

/** Copies still following this origin. Empty on a database without the sync columns. */
export async function loadLinkedCopies(admin: SupabaseClient, originServiceId: string): Promise<Row[]> {
  const { data, error } = await admin
    .from('service_items')
    .select(SERVICE_SELECT)
    .eq('synced_from_service_id', originServiceId)
    .eq('sync_state', 'linked');
  if (error) {
    if (!isMissingSyncColumnError(error)) console.error('[service-sync] linked copies read failed:', error.message);
    return [];
  }
  return (data ?? []) as Row[];
}

async function applyShapeToCopy(
  admin: SupabaseClient,
  origin: Row,
  originVariants: Row[],
  copy: Row,
): Promise<boolean> {
  const copyVenueId = copy.venue_id as string;
  const copyId = copy.id as string;
  const originShape = blocksShape(origin.processing_time_blocks, Number(origin.duration_minutes ?? 0));
  const { error: rowErr } = await admin
    .from('service_items')
    .update({
      duration_minutes: originShape.duration,
      buffer_minutes: Number(origin.buffer_minutes ?? 0),
      processing_time_blocks: originShape.blocks,
      sync_state: 'linked',
      synced_at: new Date().toISOString(),
    })
    .eq('id', copyId)
    .eq('venue_id', copyVenueId);
  if (rowErr) {
    console.error('[service-sync] copy row update failed:', rowErr.message, { copyId });
    return false;
  }

  const copyVariants = await loadVariants(admin, copyVenueId, copyId);
  const plan = planVariantSync(originVariants, copyVariants);
  let ok = true;
  for (const u of plan.update) {
    const { error } = await admin.from('service_variants').update(u.fields).eq('id', u.id).eq('venue_id', copyVenueId);
    if (error) {
      ok = false;
      console.error('[service-sync] variant update failed:', error.message, { copyId, variantId: u.id });
    }
  }
  if (plan.insert.length > 0) {
    const rows = plan.insert.map((r) => ({ ...r, venue_id: copyVenueId, service_item_id: copyId }));
    const { error } = await admin.from('service_variants').insert(rows);
    if (error) {
      ok = false;
      console.error('[service-sync] variant insert failed:', error.message, { copyId });
    }
  }
  if (plan.deactivate.length > 0) {
    const { error } = await admin
      .from('service_variants')
      .update({ is_active: false })
      .in('id', plan.deactivate)
      .eq('venue_id', copyVenueId);
    if (error) {
      ok = false;
      console.error('[service-sync] variant deactivate failed:', error.message, { copyId });
    }
  }
  return ok;
}

async function invalidateCollectivesForVenue(admin: SupabaseClient, venueId: string): Promise<void> {
  const { data } = await admin.from('venue_collective_members').select('collective_id').eq('venue_id', venueId).eq('status', 'active');
  for (const row of (data ?? []) as Array<{ collective_id: string }>) invalidateCollectiveCatalogMemo(row.collective_id);
}

/**
 * Write the origin's shape to every copy still following it. Called after the origin's
 * own save has succeeded, typically inside `after()`. Never throws.
 */
export async function syncCopiesOfService(
  admin: SupabaseClient,
  originServiceId: string,
  source: string,
): Promise<{ synced: number; skipped: number; failed: number }> {
  const result = { synced: 0, skipped: 0, failed: 0 };
  try {
    const copies = await loadLinkedCopies(admin, originServiceId);
    if (copies.length === 0) return result;
    const origin = await loadService(admin, originServiceId);
    if (!origin) return result;
    const originVariants = await loadVariants(admin, origin.venue_id as string, originServiceId);
    for (const copy of copies) {
      const live = await venuesShareLiveCollective(admin, origin.venue_id as string, copy.venue_id as string);
      if (!live) {
        result.skipped += 1;
        continue;
      }
      const ok = await applyShapeToCopy(admin, origin, originVariants, copy);
      if (ok) {
        result.synced += 1;
        await invalidateCollectivesForVenue(admin, copy.venue_id as string);
      } else {
        result.failed += 1;
      }
    }
    if (result.synced > 0 || result.failed > 0) {
      console.info(`[service-sync] ${source}: origin ${originServiceId} synced=${result.synced} skipped=${result.skipped} failed=${result.failed}`);
    }
  } catch (err) {
    console.error('[service-sync] sync failed:', err instanceof Error ? err.message : String(err), { originServiceId, source });
  }
  return result;
}

/**
 * The manual re-sync of one copy from the manager. `force` takes a `customised` copy back
 * to `linked`; without it a customised copy is left alone.
 */
export async function syncOneCopy(
  admin: SupabaseClient,
  copyServiceId: string,
  opts: { force: boolean; source: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const copy = await loadService(admin, copyServiceId);
  if (!copy) return { ok: false, error: 'Service not found.' };
  const originId = (copy.synced_from_service_id as string | null) ?? null;
  if (!originId) return { ok: false, error: 'This service is not a copy of another venue’s service.' };
  const state = (copy.sync_state as ServiceSyncState) ?? 'independent';
  if (state === 'customised' && !opts.force) {
    return { ok: false, error: 'This copy has been customised at its venue. Confirm to replace those changes.' };
  }
  const origin = await loadService(admin, originId);
  if (!origin) return { ok: false, error: 'The origin service no longer exists.' };
  const live = await venuesShareLiveCollective(admin, origin.venue_id as string, copy.venue_id as string);
  if (!live) return { ok: false, error: 'The two venues no longer share a live collective.' };
  const originVariants = await loadVariants(admin, origin.venue_id as string, originId);
  const ok = await applyShapeToCopy(admin, origin, originVariants, copy);
  if (!ok) return { ok: false, error: 'The copy could not be fully updated. Check the venue’s service and try again.' };
  await invalidateCollectivesForVenue(admin, copy.venue_id as string);
  console.info(`[service-sync] ${opts.source}: copy ${copyServiceId} re-synced from ${originId}`);
  return { ok: true };
}

/**
 * The host's explicit, per-copy "link to origin and update": an `independent` service at a
 * member venue starts following the offering's origin and takes its shape now. This is
 * the one deliberately retroactive action (owner, 2026-09-09): asked for, one copy at a
 * time, with a confirmation, never automatic. Add-on group links are the caller's, through
 * `ensureAddonGroupLinksForService`, because that lives with the copy machinery.
 */
export async function linkCopyToOrigin(
  admin: SupabaseClient,
  params: { copyServiceId: string; originServiceId: string; source: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { copyServiceId, originServiceId } = params;
  if (copyServiceId === originServiceId) return { ok: false, error: 'That service is the original.' };
  const copy = await loadService(admin, copyServiceId);
  if (!copy) return { ok: false, error: 'Service sync is not available on this database yet.' };
  const origin = await loadService(admin, originServiceId);
  if (!origin) return { ok: false, error: 'The original service no longer exists.' };
  if (copy.venue_id === origin.venue_id) return { ok: false, error: 'Both services belong to the same venue.' };
  const live = await venuesShareLiveCollective(admin, origin.venue_id as string, copy.venue_id as string);
  if (!live) return { ok: false, error: 'The two venues do not share a live collective.' };
  const { error: linkErr } = await admin
    .from('service_items')
    .update({ synced_from_service_id: originServiceId, sync_state: 'linked' })
    .eq('id', copyServiceId)
    .eq('venue_id', copy.venue_id as string);
  if (linkErr) {
    if (isMissingSyncColumnError(linkErr)) return { ok: false, error: 'Service sync is not available on this database yet.' };
    console.error('[service-sync] link failed:', linkErr.message, { copyServiceId });
    return { ok: false, error: 'Could not link the service.' };
  }
  const originVariants = await loadVariants(admin, origin.venue_id as string, originServiceId);
  const ok = await applyShapeToCopy(admin, origin, originVariants, copy);
  if (!ok) return { ok: false, error: 'The service was linked but could not be fully updated. Use Update now to retry.' };
  await invalidateCollectivesForVenue(admin, copy.venue_id as string);
  console.info(`[service-sync] ${params.source}: ${copyServiceId} linked to ${originServiceId} and updated`);
  return { ok: true };
}

/** Stop a copy following its origin. Its settings are left exactly as they are. */
export async function detachCopy(admin: SupabaseClient, copyServiceId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await admin
    .from('service_items')
    .update({ sync_state: 'independent' })
    .eq('id', copyServiceId)
    .neq('sync_state', 'independent')
    .select('id');
  if (error) {
    if (isMissingSyncColumnError(error)) return { ok: false, error: 'Service sync is not available on this database yet.' };
    return { ok: false, error: 'Could not update the service.' };
  }
  if (!data || data.length === 0) return { ok: false, error: 'This service is not following another venue’s service.' };
  return { ok: true };
}

export interface ServiceSyncView {
  state: ServiceSyncState;
  /** The recorded origin, else the offering's origin the caller supplied for an independent copy. */
  originServiceId: string | null;
  originVenueId: string | null;
  /**
   * Whether the copy's scheduling shape matches its origin's. Null when no origin can be
   * read. For an `independent` copy this is drift information only: nothing follows.
   */
  inStep: boolean | null;
}

/**
 * Sync state and drift for a set of services (any venue), for the combined-page manager.
 * Empty on a database without the sync columns, so the manager shows no chips there.
 *
 * `originOverrides` names the offering's origin service for copies that record none
 * (independent, pre-sync copies), so the manager can say whether they have diverged.
 */
export async function loadServiceSyncViews(
  admin: SupabaseClient,
  serviceIds: readonly string[],
  originOverrides?: ReadonlyMap<string, string>,
): Promise<Map<string, ServiceSyncView>> {
  const out = new Map<string, ServiceSyncView>();
  if (serviceIds.length === 0) return out;
  const { data, error } = await admin.from('service_items').select(SERVICE_SELECT).in('id', [...serviceIds]);
  if (error) {
    if (!isMissingSyncColumnError(error)) console.error('[service-sync] views read failed:', error.message);
    return out;
  }
  const rows = (data ?? []) as Row[];
  const effectiveOriginId = (r: Row): string | null =>
    (r.synced_from_service_id as string | null) ?? originOverrides?.get(r.id as string) ?? null;
  const originIds = [...new Set(rows.map(effectiveOriginId).filter((v): v is string => Boolean(v)))];
  const origins = new Map<string, Row>();
  if (originIds.length > 0) {
    const { data: originRows } = await admin.from('service_items').select(SERVICE_SELECT).in('id', originIds);
    for (const o of (originRows ?? []) as Row[]) origins.set(o.id as string, o);
  }
  // Variants for every row that needs a comparison, grouped by venue (one query per venue).
  const compareIds = new Set<string>();
  for (const r of rows) {
    const originId = effectiveOriginId(r);
    if (originId && originId !== r.id) {
      compareIds.add(r.id as string);
      compareIds.add(originId);
    }
  }
  const variantsByService = new Map<string, Row[]>();
  if (compareIds.size > 0) {
    const { data: variantRows } = await admin.from('service_variants').select('*').in('service_item_id', [...compareIds]);
    for (const v of (variantRows ?? []) as Row[]) {
      const key = v.service_item_id as string;
      const list = variantsByService.get(key) ?? [];
      list.push(v);
      variantsByService.set(key, list);
    }
  }
  for (const r of rows) {
    const state = (r.sync_state as ServiceSyncState) ?? 'independent';
    const originId = effectiveOriginId(r);
    const origin = originId && originId !== r.id ? origins.get(originId) ?? null : null;
    let inStep: boolean | null = null;
    if (origin) {
      inStep = shapesMatch(
        serviceShapeOf(origin, variantsByService.get(origin.id as string) ?? []),
        serviceShapeOf(r, variantsByService.get(r.id as string) ?? []),
      );
    }
    out.set(r.id as string, {
      state,
      originServiceId: originId,
      originVenueId: origin ? (origin.venue_id as string) : null,
      inStep,
    });
  }
  return out;
}

/** The blocks an origin's shape gives a copy; exported for tests. */
export function processingBlocksForSync(raw: unknown, durationMinutes: number): ProcessingTimeBlock[] {
  return blocksShape(raw, durationMinutes).blocks;
}
