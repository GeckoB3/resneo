import type { SupabaseClient } from '@supabase/supabase-js';
import type { ServiceCategoryRef } from '@/lib/booking/service-categories';

/**
 * A venue's categories in booking-page order, or an empty list when the venue
 * has none.
 *
 * TOLERANT BY DESIGN. The `service_categories` table arrives with migration
 * 20270202120000, which is applied by hand per environment. Until it lands,
 * this query fails, and the caller (the public catalog, the dashboard services
 * list) must keep working with the flat service list it always had rather than
 * take the booking page down. So a query error is logged and treated as "no
 * categories", the same fallback `fetchUnifiedAppointmentCatalog` already uses
 * for a failed calendar read.
 */
export async function fetchServiceCategoryRefs(
  supabase: SupabaseClient,
  venueId: string,
): Promise<ServiceCategoryRef[]> {
  const { data, error } = await supabase
    .from('service_categories')
    .select('id, name, sort_order')
    .eq('venue_id', venueId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) {
    console.warn('[service-categories] service_categories read failed; listing services flat:', error.message);
    return [];
  }
  return ((data ?? []) as Array<{ id: string; name: string; sort_order: number | null }>).map((row) => ({
    id: row.id,
    name: row.name,
    sort_order: row.sort_order ?? 0,
  }));
}

/** Attach each service's category from a fetched list, keyed by `category_id`. */
export function serviceCategoryLookup(
  categories: readonly ServiceCategoryRef[],
): (categoryId: string | null | undefined) => ServiceCategoryRef | null {
  const byId = new Map(categories.map((c) => [c.id, c]));
  return (categoryId) => (categoryId ? byId.get(categoryId) ?? null : null);
}
