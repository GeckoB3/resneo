/**
 * Referral code generation + persistence.
 *
 * Format: SLUG-XXXX, e.g. GREENWAY-X4F2. Upper-case A-Z/0-9 with a 4-char
 * random suffix from an unambiguous alphabet (no I/O/0/1).
 *
 * The DB has UNIQUE(code) so collisions are retried at the call site.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

const SUFFIX_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_SLUG_LEN = 20;
const MAX_ATTEMPTS = 10;

export function slugifyForReferralCode(name: string | null | undefined): string {
  const raw = (name ?? '').trim();
  const upper = raw.toUpperCase();
  const cleaned = upper
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const trimmed = cleaned.slice(0, MAX_SLUG_LEN).replace(/-+$/g, '');
  if (!trimmed) return 'VENUE';
  return trimmed;
}

export function randomReferralSuffix(): string {
  let out = '';
  for (let i = 0; i < 4; i++) {
    const idx = Math.floor(Math.random() * SUFFIX_ALPHABET.length);
    out += SUFFIX_ALPHABET[idx];
  }
  return out;
}

export function buildCandidateReferralCode(venueName: string | null | undefined): string {
  return `${slugifyForReferralCode(venueName)}-${randomReferralSuffix()}`;
}

interface EnsureReferralCodeOptions {
  admin: SupabaseClient;
  venueId: string;
  venueName: string | null | undefined;
}

interface EnsureReferralCodeResult {
  code: string;
  /** True if a new row was inserted; false if one already existed. */
  created: boolean;
}

/**
 * Idempotently ensure a referral_codes row exists for the venue.
 * Safe to call from multiple paths (signup-complete API + checkout webhook + lazy on dashboard load).
 */
export async function ensureReferralCodeForVenue(
  opts: EnsureReferralCodeOptions,
): Promise<EnsureReferralCodeResult | null> {
  const { admin, venueId, venueName } = opts;

  // Fast path: row exists.
  const { data: existing, error: selErr } = await admin
    .from('referral_codes')
    .select('code')
    .eq('venue_id', venueId)
    .maybeSingle();

  if (selErr) {
    console.error('[ensureReferralCodeForVenue] select failed', { venueId, error: selErr.message });
    return null;
  }

  if (existing?.code) {
    return { code: existing.code, created: false };
  }

  // Insert with retry on unique_violation against `code` (collision in suffix).
  // UNIQUE(venue_id) means a race between two concurrent ensures will only insert one row;
  // the loser hits a unique_violation on venue_id, after which we re-SELECT the winner.
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = buildCandidateReferralCode(venueName);
    const { data: inserted, error: insErr } = await admin
      .from('referral_codes')
      .insert({ venue_id: venueId, code: candidate })
      .select('code')
      .maybeSingle();

    if (!insErr && inserted?.code) {
      return { code: inserted.code, created: true };
    }

    if (insErr) {
      const msg = insErr.message ?? '';
      // 23505 unique_violation. Postgrest exposes details inconsistently across versions;
      // pattern-match the message as a fallback.
      const isUniqueViolation =
        (insErr as { code?: string }).code === '23505' ||
        /duplicate key value/i.test(msg) ||
        /unique constraint/i.test(msg);

      if (!isUniqueViolation) {
        console.error('[ensureReferralCodeForVenue] insert failed', { venueId, attempt, error: msg });
        return null;
      }

      // Could be a code collision (retry) OR a venue_id collision (another writer won).
      // Re-SELECT to see if a row exists for this venue.
      const { data: again } = await admin
        .from('referral_codes')
        .select('code')
        .eq('venue_id', venueId)
        .maybeSingle();
      if (again?.code) {
        return { code: again.code, created: false };
      }
      // Otherwise fall through and retry with a fresh suffix.
    }
  }

  console.error('[ensureReferralCodeForVenue] exhausted attempts', { venueId });
  return null;
}
