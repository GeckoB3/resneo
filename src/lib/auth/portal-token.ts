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

/**
 * TWENTY-FOUR HOURS, matching `otp_expiry` and therefore every other sign-in
 * link on this platform.
 *
 * P3-4a shipped this as 30 days, which was AD7's figure for a token that only
 * established a LIMITED session. P3-4c makes it establish a FULL one, so the
 * window is the whole of what bounds it: within the window, whoever holds the
 * confirmation email holds the account. A booking confirmation is forwarded,
 * printed and kept for years in a way a requested sign-in link is not, and 30
 * days of that is a different proposition from 24 hours.
 *
 * Named in HOURS deliberately. As `PORTAL_TOKEN_TTL_DAYS` a later reader could
 * restore 30 believing it a tuning knob; the unit now says it is not.
 */
export const PORTAL_TOKEN_TTL_HOURS = 24;

export interface PortalTokenVerification {
  ok: boolean;
  /**
   * The address this token signs in, and the ONLY identity the caller may act
   * on. Present for every valid token.
   */
  email: string | null;
  /** Set only when the token was issued to somebody who already had an account. */
  userId: string | null;
  /** Why it was refused, for logging. Never shown to the person holding it. */
  reason: 'valid' | 'unknown' | 'expired' | 'revoked' | 'error';
}

/**
 * Mint a token and store its hash. Returns the PLAINTEXT, which exists only in
 * the returned value and in the email that carries it; nothing persists it.
 *
 * **Keyed on the EMAIL, not on an account** (P3-4d). Most of the people these
 * links are for have no `auth.users` row: 1,078 distinct guest emails on
 * production had none, because nothing in the public booking flow creates one.
 * The account is created when somebody actually clicks, by `/auth/portal`.
 * `userId` is optional and recorded only when there already is one, so that
 * every token belonging to an account can still be revoked together.
 */
export async function issuePortalToken(
  admin: SupabaseClient,
  params: { email: string; userId?: string | null; bookingId?: string | null; now?: Date },
): Promise<string | null> {
  const token = generateConfirmToken();
  const now = params.now ?? new Date();
  const expiresAt = new Date(now.getTime() + PORTAL_TOKEN_TTL_HOURS * 60 * 60 * 1000);

  const email = params.email.trim().toLowerCase();
  if (!email) {
    console.error('[portal-token] refused to issue a token for an empty address');
    return null;
  }

  const { error } = await admin.from(TABLE).insert({
    token_hash: hashConfirmToken(token),
    email,
    user_id: params.userId ?? null,
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
    email: null,
    userId: null,
    reason,
  });

  if (typeof token !== 'string' || token.trim() === '') return refused('unknown');

  const { data, error } = await admin
    .from(TABLE)
    .select('token_hash, email, user_id, expires_at, revoked_at')
    .eq('token_hash', hashConfirmToken(token))
    .maybeSingle();

  if (error) {
    console.error('[portal-token] lookup failed:', error.message);
    return refused('error');
  }

  const row = data as {
    token_hash: string;
    email: string | null;
    user_id: string | null;
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

  const email = row.email?.trim().toLowerCase() ?? null;
  // A row identifying nobody cannot sign anybody in. The table's CHECK makes
  // this unreachable; it is here so that a future column change cannot turn it
  // into a session for whoever asks.
  if (!email && !row.user_id) return refused('unknown');

  return { ok: true, email, userId: row.user_id, reason: 'valid' };
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
