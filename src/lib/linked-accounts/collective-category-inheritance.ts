import type { SupabaseClient } from '@supabase/supabase-js';
import type { ServiceCategoryRef } from '@/lib/booking/service-categories';
import { loadVenueCatalogueData, type VenueCatalogueData } from './catalogue';
import {
  cleanCategoryName,
  COLLECTIVE_CATEGORY_NAME_MAX,
  ensureCollectiveCategory,
  fetchCollectiveCategoryRefs,
  normaliseCategoryName,
  pickInheritedCategoryName,
} from './collective-categories';

/**
 * How a combined page gets its headings without the host curating them by hand.
 *
 * An offering is built from member venues' services, and those services usually
 * already sit under a category at their own venue. When an offering is created
 * (single add, bulk add) the heading of the same name is found or created on the
 * combined page and the offering filed under it. Pages that existed before this
 * feature get the same pass once, on the host's next visit
 * (`seedCollectiveCategoriesOnce`), and the host can ask for it again at any time
 * (`sync_categories`) for offerings still without a heading.
 *
 * The host's own hand edits always win: only offerings WITHOUT a heading are ever
 * touched, and nothing here renames or removes a heading.
 */

interface SourceRef {
  venueId: string;
  sourceServiceId: string;
}

interface Candidate {
  venueId: string;
  categoryName: string | null;
  /** The category's position at its own venue, so headings are created in that order. */
  categorySortOrder: number;
}

async function loadHostVenueId(admin: SupabaseClient, collectiveId: string): Promise<string | null> {
  const { data } = await admin
    .from('venue_collectives')
    .select('host_venue_id')
    .eq('id', collectiveId)
    .maybeSingle();
  return ((data as { host_venue_id?: string | null } | null)?.host_venue_id as string | null) ?? null;
}

async function venueData(
  admin: SupabaseClient,
  venueId: string,
  cache: Map<string, VenueCatalogueData>,
): Promise<VenueCatalogueData> {
  let data = cache.get(venueId);
  if (!data) {
    data = await loadVenueCatalogueData(admin, venueId);
    cache.set(venueId, data);
  }
  return data;
}

/** The category each source service carries at its own venue. */
async function candidatesFor(
  admin: SupabaseClient,
  sources: readonly SourceRef[],
  cache: Map<string, VenueCatalogueData>,
): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (const src of sources) {
    const data = await venueData(admin, src.venueId, cache);
    const category = data.services.get(src.sourceServiceId)?.category ?? null;
    out.push({
      venueId: src.venueId,
      categoryName: category?.name ?? null,
      categorySortOrder: category?.sort_order ?? 0,
    });
  }
  return out;
}

/**
 * File one offering under the heading its source services carry at their own
 * venues, creating the heading if the page lacks it. No-op when no source is
 * categorised. Returns the heading used.
 */
export async function inheritCategoryForOffering(
  admin: SupabaseClient,
  collectiveId: string,
  itemId: string,
  sources: readonly SourceRef[],
): Promise<ServiceCategoryRef | null> {
  if (sources.length === 0) return null;
  const [host, candidates] = await Promise.all([
    loadHostVenueId(admin, collectiveId),
    candidatesFor(admin, sources, new Map()),
  ]);
  const name = pickInheritedCategoryName(candidates, host);
  if (!name) return null;
  const ref = await ensureCollectiveCategory(admin, collectiveId, name);
  if (!ref) return null;
  const { error } = await admin
    .from('collective_service_items')
    .update({ category_id: ref.id })
    .eq('id', itemId)
    .eq('collective_id', collectiveId);
  if (error) {
    console.error('[collective-categories] could not file the offering under its heading:', error);
    return null;
  }
  return ref;
}

/**
 * Every active offering without a heading inherits one from its providers' source
 * services. New headings are created host venue first, then in the member venues'
 * own category order, so a page seeded from one venue mirrors that venue's menu.
 */
export async function inheritCategoriesForUncategorisedOfferings(
  admin: SupabaseClient,
  collectiveId: string,
): Promise<{ assigned: number }> {
  const { data: itemRows } = await admin
    .from('collective_service_items')
    .select('id')
    .eq('collective_id', collectiveId)
    .eq('status', 'active')
    .is('category_id', null);
  const itemIds = (itemRows ?? []).map((r) => r.id as string);
  if (itemIds.length === 0) return { assigned: 0 };

  const { data: providerRows } = await admin
    .from('collective_service_providers')
    .select('item_id, venue_id, source_service_id')
    .in('item_id', itemIds)
    .eq('status', 'active');
  const sourcesByItem = new Map<string, SourceRef[]>();
  for (const raw of providerRows ?? []) {
    const itemId = raw.item_id as string;
    const list = sourcesByItem.get(itemId) ?? [];
    const src = { venueId: raw.venue_id as string, sourceServiceId: raw.source_service_id as string };
    if (!list.some((s) => s.venueId === src.venueId && s.sourceServiceId === src.sourceServiceId)) {
      list.push(src);
    }
    sourcesByItem.set(itemId, list);
  }

  const host = await loadHostVenueId(admin, collectiveId);
  const cache = new Map<string, VenueCatalogueData>();
  const plan: Array<{ itemId: string; name: string; fromHost: boolean; sortOrder: number }> = [];
  for (const itemId of itemIds) {
    const sources = sourcesByItem.get(itemId) ?? [];
    if (sources.length === 0) continue;
    const candidates = await candidatesFor(admin, sources, cache);
    const name = pickInheritedCategoryName(candidates, host);
    if (!name) continue;
    const chosen =
      candidates.find((c) => c.categoryName && cleanCategoryName(c.categoryName) === name) ?? null;
    plan.push({
      itemId,
      name,
      fromHost: chosen?.venueId === host,
      sortOrder: chosen?.categorySortOrder ?? 0,
    });
  }
  if (plan.length === 0) return { assigned: 0 };

  // Create the headings in a sensible order before filing anything under them.
  const distinct = new Map<string, { name: string; fromHost: boolean; sortOrder: number }>();
  for (const p of plan) {
    const key = normaliseCategoryName(p.name);
    const prev = distinct.get(key);
    if (!prev || (p.fromHost && !prev.fromHost) || (p.fromHost === prev.fromHost && p.sortOrder < prev.sortOrder)) {
      distinct.set(key, { name: p.name, fromHost: p.fromHost, sortOrder: p.sortOrder });
    }
  }
  const ordered = [...distinct.values()].sort(
    (a, b) => Number(b.fromHost) - Number(a.fromHost) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'en'),
  );
  const refByKey = new Map<string, ServiceCategoryRef>();
  for (const entry of ordered) {
    const ref = await ensureCollectiveCategory(admin, collectiveId, entry.name.slice(0, COLLECTIVE_CATEGORY_NAME_MAX));
    if (ref) refByKey.set(normaliseCategoryName(entry.name), ref);
  }

  let assigned = 0;
  for (const p of plan) {
    const ref = refByKey.get(normaliseCategoryName(p.name));
    if (!ref) continue;
    const { error } = await admin
      .from('collective_service_items')
      .update({ category_id: ref.id })
      .eq('id', p.itemId)
      .eq('collective_id', collectiveId);
    if (!error) assigned += 1;
  }
  return { assigned };
}

/**
 * The one-time pass for pages that predate headings. Runs on the host's first
 * visit after the migration, only when the page has no headings of its own, and
 * records that it ran so a host who later removes every heading is not overruled.
 * Silently does nothing until the migration has been applied.
 */
export async function seedCollectiveCategoriesOnce(admin: SupabaseClient, collectiveId: string): Promise<void> {
  const { data, error } = await admin
    .from('venue_collectives')
    .select('categories_seeded_at')
    .eq('id', collectiveId)
    .maybeSingle();
  if (error || !data) return;
  if ((data as { categories_seeded_at?: string | null }).categories_seeded_at) return;
  const existing = await fetchCollectiveCategoryRefs(admin, collectiveId);
  if (existing.length === 0) {
    await inheritCategoriesForUncategorisedOfferings(admin, collectiveId);
  }
  await admin
    .from('venue_collectives')
    .update({ categories_seeded_at: new Date().toISOString() })
    .eq('id', collectiveId);
}

// ---------------------------------------------------------------------------
// Host actions on headings (PATCH /api/venue/collectives/[id]/catalogue)
// ---------------------------------------------------------------------------

export const COLLECTIVE_CATEGORY_ACTIONS = [
  'create_category',
  'rename_category',
  'delete_category',
  'reorder_categories',
  'reorder_items',
  'sync_categories',
] as const;
export type CollectiveCategoryAction = (typeof COLLECTIVE_CATEGORY_ACTIONS)[number];

export function isCollectiveCategoryAction(action: string): action is CollectiveCategoryAction {
  return (COLLECTIVE_CATEGORY_ACTIONS as readonly string[]).includes(action);
}

export interface CollectiveCategoryActionInput {
  action: CollectiveCategoryAction;
  categoryId?: string | null;
  categoryName?: string;
  categoryIds?: string[];
  itemIds?: string[];
}

type ActionResult = { ok: true } | { ok: false; error: string; status: number };

async function duplicateNameExists(
  admin: SupabaseClient,
  collectiveId: string,
  name: string,
  exceptId: string | null,
): Promise<boolean> {
  const key = normaliseCategoryName(name);
  const existing = await fetchCollectiveCategoryRefs(admin, collectiveId);
  return existing.some((c) => c.id !== exceptId && normaliseCategoryName(c.name) === key);
}

export async function applyCollectiveCategoryAction(
  admin: SupabaseClient,
  collectiveId: string,
  input: CollectiveCategoryActionInput,
): Promise<ActionResult> {
  switch (input.action) {
    case 'create_category': {
      const name = cleanCategoryName(input.categoryName ?? '');
      if (!name) return { ok: false, error: 'Give the category a name.', status: 400 };
      if (await duplicateNameExists(admin, collectiveId, name, null)) {
        return { ok: false, error: `You already have a category called "${name}".`, status: 409 };
      }
      const created = await ensureCollectiveCategory(admin, collectiveId, name);
      if (!created) return { ok: false, error: 'Failed to create the category.', status: 500 };
      return { ok: true };
    }

    case 'rename_category': {
      if (!input.categoryId) return { ok: false, error: 'Missing category id.', status: 400 };
      const name = cleanCategoryName(input.categoryName ?? '');
      if (!name) return { ok: false, error: 'Give the category a name.', status: 400 };
      if (await duplicateNameExists(admin, collectiveId, name, input.categoryId)) {
        return { ok: false, error: `You already have a category called "${name}".`, status: 409 };
      }
      const { data, error } = await admin
        .from('collective_service_categories')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', input.categoryId)
        .eq('collective_id', collectiveId)
        .select('id')
        .maybeSingle();
      if (error) return { ok: false, error: 'Failed to rename the category.', status: 500 };
      if (!data) return { ok: false, error: 'That category no longer exists. Refresh the page and try again.', status: 404 };
      return { ok: true };
    }

    case 'delete_category': {
      if (!input.categoryId) return { ok: false, error: 'Missing category id.', status: 400 };
      const { data, error } = await admin
        .from('collective_service_categories')
        .delete()
        .eq('id', input.categoryId)
        .eq('collective_id', collectiveId)
        .select('id')
        .maybeSingle();
      if (error) return { ok: false, error: 'Failed to delete the category.', status: 500 };
      if (!data) return { ok: false, error: 'That category no longer exists. Refresh the page and try again.', status: 404 };
      return { ok: true };
    }

    case 'reorder_categories': {
      const ids = input.categoryIds ?? [];
      if (ids.length === 0) return { ok: false, error: 'Nothing to reorder.', status: 400 };
      if (new Set(ids).size !== ids.length) {
        return { ok: false, error: 'Something went wrong while saving the order. Refresh the page and try again.', status: 400 };
      }
      const owned = new Set((await fetchCollectiveCategoryRefs(admin, collectiveId)).map((c) => c.id));
      if (ids.some((id) => !owned.has(id))) {
        return { ok: false, error: 'One or more categories were not found. Refresh the page and try again.', status: 400 };
      }
      const results = await Promise.all(
        ids.map((id, idx) =>
          admin
            .from('collective_service_categories')
            .update({ sort_order: idx, updated_at: new Date().toISOString() })
            .eq('id', id)
            .eq('collective_id', collectiveId),
        ),
      );
      if (results.some((r) => r.error)) return { ok: false, error: 'Failed to save the new order.', status: 500 };
      return { ok: true };
    }

    case 'reorder_items': {
      const ids = input.itemIds ?? [];
      if (ids.length === 0) return { ok: false, error: 'Nothing to reorder.', status: 400 };
      if (new Set(ids).size !== ids.length) {
        return { ok: false, error: 'Something went wrong while saving the order. Refresh the page and try again.', status: 400 };
      }
      const { data: rows } = await admin
        .from('collective_service_items')
        .select('id')
        .eq('collective_id', collectiveId)
        .in('id', ids);
      const owned = new Set((rows ?? []).map((r) => r.id as string));
      if (ids.some((id) => !owned.has(id))) {
        return { ok: false, error: 'One or more offerings were not found. Refresh the page and try again.', status: 400 };
      }
      const results = await Promise.all(
        ids.map((id, idx) =>
          admin.from('collective_service_items').update({ display_order: idx }).eq('id', id).eq('collective_id', collectiveId),
        ),
      );
      if (results.some((r) => r.error)) return { ok: false, error: 'Failed to save the new order.', status: 500 };
      return { ok: true };
    }

    case 'sync_categories': {
      await inheritCategoriesForUncategorisedOfferings(admin, collectiveId);
      return { ok: true };
    }

    default:
      return { ok: false, error: 'Unknown action.', status: 400 };
  }
}
