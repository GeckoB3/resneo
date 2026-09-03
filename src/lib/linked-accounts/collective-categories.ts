import type { SupabaseClient } from '@supabase/supabase-js';
import { compareCategoryRefs, type ServiceCategoryRef } from '@/lib/booking/service-categories';

/**
 * Category headings on a combined (collective) booking page. Pure helpers plus
 * the two small reads and writes on `collective_service_categories`; the
 * inheritance from member venues lives in collective-category-inheritance.ts.
 * See Docs/service-categories-plan.md, "Combined pages".
 */

export const COLLECTIVE_CATEGORY_NAME_MAX = 80;

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = '23505';

/** The comparison key the database's unique index uses: trimmed, single-spaced, lower-cased. */
export function normaliseCategoryName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** A name ready to store: trimmed and single-spaced, case kept. */
export function cleanCategoryName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

/**
 * A combined page's headings in display order, or none.
 *
 * TOLERANT: the table arrives with migration 20270202130000, applied by hand per
 * environment. Until it lands this read fails and the page must still render, so
 * a failed query is logged and treated as "no headings", the same fallback the
 * venue loader uses.
 */
export async function fetchCollectiveCategoryRefs(
  admin: SupabaseClient,
  collectiveId: string,
): Promise<ServiceCategoryRef[]> {
  const { data, error } = await admin
    .from('collective_service_categories')
    .select('id, name, sort_order')
    .eq('collective_id', collectiveId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) {
    console.warn(
      '[collective-categories] collective_service_categories read failed; listing offerings flat:',
      error.message,
    );
    return [];
  }
  return ((data ?? []) as Array<{ id: string; name: string; sort_order: number | null }>).map((row) => ({
    id: row.id,
    name: row.name,
    sort_order: row.sort_order ?? 0,
  }));
}

/**
 * Find the heading with this name (case and spacing ignored), creating it at the
 * end of the list when the page has none. Returns null only when the insert fails
 * for a reason other than a concurrent create of the same name.
 */
export async function ensureCollectiveCategory(
  admin: SupabaseClient,
  collectiveId: string,
  name: string,
): Promise<ServiceCategoryRef | null> {
  const cleaned = cleanCategoryName(name).slice(0, COLLECTIVE_CATEGORY_NAME_MAX);
  if (!cleaned) return null;
  const key = normaliseCategoryName(cleaned);
  const existing = await fetchCollectiveCategoryRefs(admin, collectiveId);
  const hit = existing.find((c) => normaliseCategoryName(c.name) === key);
  if (hit) return hit;

  const nextSort = existing.length > 0 ? Math.max(...existing.map((c) => c.sort_order)) + 1 : 0;
  const { data, error } = await admin
    .from('collective_service_categories')
    .insert({ collective_id: collectiveId, name: cleaned, sort_order: nextSort })
    .select('id, name, sort_order')
    .single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      // Lost a race with another create of the same name; it exists now.
      const again = await fetchCollectiveCategoryRefs(admin, collectiveId);
      return again.find((c) => normaliseCategoryName(c.name) === key) ?? null;
    }
    console.error('[collective-categories] create failed:', error);
    return null;
  }
  return {
    id: data.id as string,
    name: data.name as string,
    sort_order: (data.sort_order as number | null) ?? 0,
  };
}

/** A category id from the host must be one of this page's; null means none. */
export async function resolveCollectiveCategoryId(
  admin: SupabaseClient,
  collectiveId: string,
  raw: string | null | undefined,
): Promise<{ ok: true; categoryId: string | null } | { ok: false; error: string }> {
  if (raw == null) return { ok: true, categoryId: null };
  const { data, error } = await admin
    .from('collective_service_categories')
    .select('id')
    .eq('id', raw)
    .eq('collective_id', collectiveId)
    .maybeSingle();
  if (error || !data) {
    return { ok: false, error: 'That category no longer exists. Refresh the page and try again.' };
  }
  return { ok: true, categoryId: data.id as string };
}

/**
 * Which member-venue category an offering should inherit. Each candidate is one
 * provider's source service: the venue it belongs to and that service's category
 * name at its own venue (null when it has none). The host's own services win, so
 * the host sees its own headings first; otherwise the first categorised source.
 */
export function pickInheritedCategoryName(
  candidates: ReadonlyArray<{ venueId: string; categoryName: string | null }>,
  hostVenueId: string | null,
): string | null {
  const named = candidates.filter((c) => c.categoryName && c.categoryName.trim());
  if (named.length === 0) return null;
  const host = hostVenueId ? named.find((c) => c.venueId === hostVenueId) : undefined;
  return cleanCategoryName((host ?? named[0]!).categoryName!);
}

export interface CombinedCatalogueSortKey {
  name: string;
  category: ServiceCategoryRef | null;
  /** Host-curated position (`display_order`). */
  displayOrder: number;
  /** The member venues' own service order, lowest across providers. */
  sourceOrder: number;
}

/**
 * Combined page order: heading first (uncategorised last), then the host's own
 * display order, then the member venues' service order, then name. With no
 * headings this is exactly the order combined pages always had.
 */
export function compareCombinedCatalogueItems(a: CombinedCatalogueSortKey, b: CombinedCatalogueSortKey): number {
  if (a.category && b.category) {
    if (a.category.id !== b.category.id) return compareCategoryRefs(a.category, b.category);
  } else if (a.category) {
    return -1;
  } else if (b.category) {
    return 1;
  }
  return (
    a.displayOrder - b.displayOrder ||
    a.sourceOrder - b.sourceOrder ||
    a.name.localeCompare(b.name, 'en')
  );
}
