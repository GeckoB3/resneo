/**
 * Venue-chosen service display order (Dashboard → Services drag order). Lower
 * sort_order first; the pinned-locale name comparison breaks ties so venues that
 * never reordered keep the same alphabetical listing on every surface.
 */
export function compareByVenueServiceOrder(
  a: { sort_order?: number | null; name: string },
  b: { sort_order?: number | null; name: string },
): number {
  return (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name, 'en');
}
