import { slugFromBusinessName } from '@/lib/venue/slug-from-business-name';

/**
 * Derive a compliance type slug from its name (spec §4.2). Stable identifier:
 * computed once on creation and not changed when the name is later renamed.
 */
export function complianceTypeSlugBase(name: string): string {
  return slugFromBusinessName(name) || 'compliance-type';
}

/**
 * Ensure a slug is unique within a venue by appending `-2`, `-3`, … on collision.
 * `isTaken` is supplied by the caller (a DB existence check scoped to the venue).
 */
export async function ensureUniqueComplianceSlug(
  base: string,
  isTaken: (candidate: string) => Promise<boolean>,
): Promise<string> {
  if (!(await isTaken(base))) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  // Extremely unlikely; fall back to a random suffix to guarantee progress.
  return `${base}-${Date.now().toString(36)}`;
}
