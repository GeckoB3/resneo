import type { SupabaseClient } from '@supabase/supabase-js';
import { normalisePhoneUk, type NormalisedPhone } from '@/lib/import/normalize';

/**
 * Returns the phone value safe to use as a dedup key.
 * When `normalisePhoneUk` could not normalise the input, it sets `warning: true`
 * and `e164` to the raw string. Using that raw value as a lookup key produces
 * silent duplicates against guests stored in E.164. Treat unsupported phones as
 * `null` for matching purposes; the raw value can still be stored elsewhere.
 */
export function phoneForMatching(ph: NormalisedPhone | null | undefined): string | null {
  if (!ph) return null;
  if (ph.warning) return null;
  return ph.e164;
}

/**
 * Normalises an arbitrary stored phone value using the same UK rules used for
 * import rows, so equality checks match across both sides.
 */
export function matchablePhone(raw: string | null | undefined): string | null {
  return phoneForMatching(normalisePhoneUk(raw));
}

/**
 * Loads every guest's email/phone for a venue, paged in chunks of 1000 to bypass
 * Supabase's default row cap. Returns sets sized to detect duplicates against
 * incoming import rows.
 */
export async function loadVenueGuestEmailsAndPhones(
  admin: SupabaseClient,
  venueId: string,
): Promise<{ emails: Set<string>; phones: Set<string> }> {
  const emails = new Set<string>();
  const phones = new Set<string>();
  const PAGE_SIZE = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await admin
      .from('guests')
      .select('email, phone')
      .eq('venue_id', venueId)
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      console.error('[guest-lookup] failed paginating guests', error.message);
      break;
    }
    const rows = (data ?? []) as Array<{ email: string | null; phone: string | null }>;
    for (const r of rows) {
      if (r.email) emails.add(r.email.toLowerCase());
      const norm = matchablePhone(r.phone);
      if (norm) phones.add(norm);
    }
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return { emails, phones };
}

/**
 * Case-insensitive guest lookup by email. We always store imported emails as
 * lowercase, but historic guests created elsewhere in the app may have stored
 * mixed-case emails — `eq('email', value)` would miss them and trigger a unique
 * constraint failure on insert.
 */
export async function findGuestByEmailCi<T extends Record<string, unknown>>(
  admin: SupabaseClient,
  venueId: string,
  email: string,
  selectColumns: string,
): Promise<T | null> {
  const { data, error } = await admin
    .from('guests')
    .select(selectColumns)
    .eq('venue_id', venueId)
    .ilike('email', email)
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) {
    console.error('[guest-lookup] email lookup failed', error.message);
    return null;
  }
  const row = (data ?? [])[0];
  return (row ?? null) as unknown as T | null;
}

/**
 * Deterministic phone lookup: `guests.phone` has no unique constraint, so
 * `.maybeSingle()` errors and returns null when duplicates exist. We use
 * `limit(1)` and pick the oldest row.
 */
export async function findGuestByPhone<T extends Record<string, unknown>>(
  admin: SupabaseClient,
  venueId: string,
  phone: string,
  selectColumns: string,
): Promise<T | null> {
  const { data, error } = await admin
    .from('guests')
    .select(selectColumns)
    .eq('venue_id', venueId)
    .eq('phone', phone)
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) {
    console.error('[guest-lookup] phone lookup failed', error.message);
    return null;
  }
  const row = (data ?? [])[0];
  return (row ?? null) as unknown as T | null;
}

/**
 * Same-name guest lookup with strict guards. Returns the guest id only when
 * there is **exactly one** candidate with the given first+last; otherwise
 * returns null so the caller can choose to create a new guest rather than risk
 * attaching a booking to the wrong person.
 */
export async function findGuestIdByExactName(
  admin: SupabaseClient,
  venueId: string,
  firstName: string | null,
  lastName: string | null,
): Promise<{ id: string; ambiguous: boolean } | null> {
  if (!firstName && !lastName) return null;
  let query = admin.from('guests').select('id').eq('venue_id', venueId).limit(2);
  if (firstName) query = query.eq('first_name', firstName);
  else query = query.is('first_name', null);
  if (lastName) query = query.eq('last_name', lastName);
  else query = query.is('last_name', null);
  const { data, error } = await query;
  if (error) {
    console.error('[guest-lookup] name lookup failed', error.message);
    return null;
  }
  const rows = (data ?? []) as Array<{ id: string }>;
  if (rows.length === 0) return null;
  if (rows.length > 1) return { id: rows[0]!.id, ambiguous: true };
  return { id: rows[0]!.id, ambiguous: false };
}
