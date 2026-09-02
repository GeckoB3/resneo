import { compareByVenueServiceOrder } from '@/lib/booking/service-display-order';

/**
 * Service categories: the headings a venue groups its services under on the
 * booking pages. Pure helpers only; nothing here touches the database, so the
 * booking flow, the public Services tab and the dashboard can all share it.
 * See Docs/service-categories-plan.md.
 */

/** A category as the catalog and the booking pages carry it on each service. */
export interface ServiceCategoryRef {
  id: string;
  name: string;
  /** Position on the booking page, lower first. */
  sort_order: number;
}

/** One heading on a booking page and the services listed under it. */
export interface ServiceCategoryGroup<T> {
  /** `null` for the services that have no category. */
  id: string | null;
  /** Empty when the venue has no categories at all (the list renders flat). */
  name: string;
  services: T[];
}

/** Heading for services left without a category when the venue has categories. */
export const UNCATEGORISED_GROUP_LABEL = 'Other services';

/** Search appears once a menu is long enough that scanning it is slower than typing. */
export const SERVICE_SEARCH_MIN_SERVICES = 6;

export interface CategorisableService {
  id?: string;
  name: string;
  sort_order?: number | null;
  category?: ServiceCategoryRef | null;
}

/** Heading order: position, then name, then id so two equal positions stay stable. */
export function compareCategoryRefs(a: ServiceCategoryRef, b: ServiceCategoryRef): number {
  return a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id);
}

/**
 * Category order first (uncategorised services last), then the venue's own
 * service drag order. A venue with no categories sorts exactly as
 * {@link compareByVenueServiceOrder} did, so nothing moves for them.
 */
export function compareByCategoryThenServiceOrder(
  a: CategorisableService,
  b: CategorisableService,
): number {
  const ca = a.category ?? null;
  const cb = b.category ?? null;
  if (ca && cb) {
    if (ca.id !== cb.id) return compareCategoryRefs(ca, cb);
  } else if (ca) {
    return -1;
  } else if (cb) {
    return 1;
  }
  return compareByVenueServiceOrder(a, b);
}

/** True when at least one service carries a category. */
export function hasServiceCategories(services: readonly CategorisableService[]): boolean {
  return services.some((s) => s.category != null);
}

/**
 * Services grouped under their categories, in booking-page order. When no service
 * has a category the result is a single unnamed group holding every service, so a
 * caller can render that case as the plain list it always was.
 */
export function groupServicesByCategory<T extends CategorisableService>(
  services: readonly T[],
): ServiceCategoryGroup<T>[] {
  const sorted = [...services].sort(compareByCategoryThenServiceOrder);
  if (!hasServiceCategories(sorted)) {
    return [{ id: null, name: '', services: sorted }];
  }
  const groups: ServiceCategoryGroup<T>[] = [];
  const byKey = new Map<string | null, ServiceCategoryGroup<T>>();
  for (const svc of sorted) {
    const key = svc.category?.id ?? null;
    let group = byKey.get(key);
    if (!group) {
      group = { id: key, name: svc.category?.name ?? UNCATEGORISED_GROUP_LABEL, services: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.services.push(svc);
  }
  return groups;
}

/** Lower-cased, accent-stripped, whitespace-collapsed text for matching. */
export function normaliseServiceSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Does a service match what the customer typed? Every word of the query must
 * appear somewhere in the name, the description or the category name, so
 * "gel nails" finds "Gel polish" under "Nails".
 */
export function serviceMatchesSearch(
  svc: { name: string; description?: string | null; category?: ServiceCategoryRef | null },
  query: string,
): boolean {
  const terms = normaliseServiceSearch(query).split(' ').filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = normaliseServiceSearch(
    [svc.name, svc.description ?? '', svc.category?.name ?? ''].join(' '),
  );
  return terms.every((term) => haystack.includes(term));
}

/** Stable DOM id for a category section or panel; safe for `aria-controls`. */
export function serviceCategoryDomId(prefix: string, categoryId: string | null): string {
  return `${prefix}-cat-${categoryId ?? 'other'}`;
}
