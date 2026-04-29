/**
 * Pure helpers for guest identity matching (testable without a database).
 */

/** Venue-owned field: keep existing value when set; otherwise accept incoming. */
export function mergeVenueAuthoritativeField(
  existing: string | null | undefined,
  incoming: string | null | undefined,
): string | null {
  const cur = existing?.trim() ? existing.trim() : null;
  const inc = incoming?.trim() ? incoming.trim() : null;
  return cur ?? inc ?? null;
}

/**
 * Public online/widget flows with an email use account-linked semantics:
 * deterministic email match, silent auth user, and no phone-only merge when email is absent.
 */
export function isAccountLinkedPublicMode(silentAuthSignup: boolean, email: string | null): boolean {
  return silentAuthSignup && Boolean(email?.trim());
}
