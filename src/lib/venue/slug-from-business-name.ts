/**
 * Derive a public booking-page slug from a business name (onboarding default).
 * Apostrophes are removed, not turned into extra word breaks — e.g. "Andrew's Salon" → `andrews-salon`.
 */
export function slugFromBusinessName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[''\u2019`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug;
}

/** Slug with fallback when the name has no usable characters. */
export function slugFromBusinessNameOrFallback(name: string, fallback: () => string): string {
  const slug = slugFromBusinessName(name);
  return slug || fallback();
}
