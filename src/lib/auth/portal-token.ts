import type { SupabaseClient } from '@supabase/supabase-js';
import {
  generateConfirmToken,
  hashConfirmToken,
  verifyConfirmToken,
} from '@/lib/confirm-token';

/**
 * One-click portal entry tokens (P3-4a, AD7).
 *
 * The account link in a transactional email carries one of these. P3-4c
 * exchanges it for a real Supabase session; this module only mints, verifies
 * and revokes.
 *
 * **It reuses `confirm-token.ts` rather than growing a second scheme.** That
 * module is already the house hashed-token pattern with ten call sites, and
 * `Docs/Resneo_User_Accounts_Reference.md` §5.2 has a standing rule against
 * parallel token schemes. AD7 is the documented exception to that rule, and it
 * is an exception about STORAGE (a table, so revocation is possible), not
 * about the primitives.
 *
 * **The table is service-role only.** Every function here takes an admin
 * client, and none of them is safe to expose to a client: the caller holds
 * every live entry token for every customer.
 */

const TABLE = 'account_portal_tokens';

/** AD7: 30 days. Long enough that a link in a month-old email still works. */
export const PORTAL_TOKEN_TTL_DAYS = 30;

export interface PortalTokenVerification {
  ok: boolean;
  userId: string | null;
  /** Why it was refused, for logging. Never shown to the person holding it. */
  reason: 'valid' | 'unknown' | 'expired' | 'revoked' | 'error';
}

/**
 * Mint a token and store its hash. Returns the PLAINTEXT, which exists only in
 * the returned value and in the email that carries it; nothing persists it.
 */
export async function issuePortalToken(
  admin: SupabaseClient,
  params: { userId: string; bookingId?: string | null; now?: Date },
): Promise<string | null> {
  const token = generateConfirmToken();
  const now = params.now ?? new Date();
  const expiresAt = new Date(now.getTime() + PORTAL_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  const { error } = await admin.from(TABLE).insert({
    token_hash: hashConfirmToken(token),
    user_id: params.userId,
    scope: 'limited',
    issued_for_booking_id: params.bookingId ?? null,
    expires_at: expiresAt.toISOString(),
  });

  if (error) {
    // Null rather than a throw: the callers are comms paths, and an email that
    // goes out with the ordinary sign-in link is a far better outcome than one
    // that does not go out at all.
    console.error('[portal-token] could not issue:', error.message);
    return null;
  }
  return token;
}

/**
 * Check a token. **Reads only.**
 *
 * NO WRITE HAPPENS HERE, and that is a requirement rather than an efficiency.
 * Corporate link scanners fetch every URL in inbound mail before the human
 * sees it, so anything that consumed or counted a use would break the link for
 * the customer who was sent it. The token is reusable within its window by
 * design; `verifyPortalToken` called twenty times returns the same answer
 * twenty times and leaves the row untouched.
 *
 * Fails CLOSED on every uncertainty, including a read error.
 */
export async function verifyPortalToken(
  admin: SupabaseClient,
  token: string | null | undefined,
  now: Date = new Date(),
): Promise<PortalTokenVerification> {
  const refused = (reason: PortalTokenVerification['reason']): PortalTokenVerification => ({
    ok: false,
    userId: null,
    reason,
  });

  if (typeof token !== 'string' || token.trim() === '') return refused('unknown');

  const { data, error } = await admin
    .from(TABLE)
    .select('token_hash, user_id, expires_at, revoked_at')
    .eq('token_hash', hashConfirmToken(token))
    .maybeSingle();

  if (error) {
    console.error('[portal-token] lookup failed:', error.message);
    return refused('error');
  }

  const row = data as {
    token_hash: string;
    user_id: string;
    expires_at: string;
    revoked_at: string | null;
  } | null;
  if (!row) return refused('unknown');

  /*
    Re-verified against the stored hash rather than trusted because the query
    matched. The `.eq` above is what FOUND the row; this is what accepts it,
    in constant time, through the same helper every other token in this
    codebase is checked with. It costs one comparison and means a lookup that
    ever became fuzzy, through a rewritten query or a case-insensitive
    collation, could not turn into an acceptance.
  */
  if (!verifyConfirmToken(token, row.token_hash)) return refused('unknown');

  if (row.revoked_at) return refused('revoked');
  const expiresAt = Date.parse(row.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) return refused('expired');

  return { ok: true, userId: row.user_id, reason: 'valid' };
}

/**
 * Revoke every token issued for one booking (AD7: "revoked once the related
 * booking is more than 30 days past", and immediately when a booking is
 * cancelled by someone who should not still hold a live link).
 *
 * Marks rather than deletes, so "was this revoked, or did it never exist" stays
 * answerable when a customer asks why their link stopped working.
 *
 * Already-revoked rows are left alone rather than re-stamped, so the timestamp
 * keeps saying when revocation actually happened.
 */
export async function revokePortalTokensForBooking(
  admin: SupabaseClient,
  bookingId: string,
  now: Date = new Date(),
): Promise<number> {
  const { data, error } = await admin
    .from(TABLE)
    .update({ revoked_at: now.toISOString() })
    .eq('issued_for_booking_id', bookingId)
    .is('revoked_at', null)
    .select('token_hash');

  if (error) {
    console.error('[portal-token] could not revoke for booking:', error.message);
    return 0;
  }
  return (data as unknown[] | null)?.length ?? 0;
}
