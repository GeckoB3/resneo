import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Phase 3 §6.4 — returns the set of venue IDs where the user has any class
 * commerce relationship: a credit balance, an active/historical membership, a
 * course enrollment, a recurring rule, or a class booking via a linked guest row.
 *
 * Account catalog endpoints scope their "purchase catalog" to this set so we
 * don't enumerate every venue on the platform to a logged-in user.
 *
 * Pass `extraVenueIds` (e.g. the `?venue=` deep-link from the public booking
 * page) so a brand-new buyer can still see the product they came to buy.
 */
export async function getClassCommerceVenuesForUser(
  admin: SupabaseClient,
  userId: string,
  extraVenueIds: string[] = [],
): Promise<string[]> {
  const venueIds = new Set<string>();

  const collect = (rows: unknown[] | null | undefined) => {
    for (const r of rows ?? []) {
      const v = (r as { venue_id?: string | null }).venue_id;
      if (v) venueIds.add(v);
    }
  };

  const [balances, memberships, enrollments, recurring, guests] = await Promise.all([
    admin.from('user_class_credit_balances').select('venue_id').eq('user_id', userId),
    admin.from('class_memberships').select('venue_id').eq('user_id', userId),
    admin.from('class_course_enrollments').select('venue_id').eq('user_id', userId),
    admin.from('class_recurring_reservations').select('venue_id').eq('user_id', userId),
    admin.from('guests').select('venue_id').eq('user_id', userId),
  ]);

  collect(balances.data);
  collect(memberships.data);
  collect(enrollments.data);
  collect(recurring.data);
  collect(guests.data);

  for (const id of extraVenueIds) {
    if (id) venueIds.add(id);
  }

  return Array.from(venueIds);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Pulls `venue` from a request URL's search params and returns it when it is a
 * UUID. Returns null for any other shape — never trust raw query-string values.
 */
export function extraVenueIdsFromUrl(url: string): string[] {
  try {
    const u = new URL(url);
    const value = u.searchParams.get('venue');
    if (!value) return [];
    return UUID_RE.test(value) ? [value] : [];
  } catch {
    return [];
  }
}
