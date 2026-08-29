import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizePublicBaseUrl } from '@/lib/public-base-url';
import { issuePortalToken } from '@/lib/auth/portal-token';
import { accountBookingsMagicLinkUrl } from '@/lib/emails/account-portal-links';

/**
 * The "your bookings" link a transactional email carries (P3-4d, AD7 descoped).
 *
 * For a customer who has never been able to get into the portal, this is a
 * one-click sign-in link. For everybody else it is the link they get today,
 * which asks them to request a magic link.
 *
 * **The eligibility rule is one condition, and it is the whole of what bounds
 * this feature.** The plan named three levers; two of them collapse into a
 * single reliable fact once you look at the data.
 *
 *   - TTL: 24 hours, enforced by the token itself.
 *   - "First entry only" and "no password set": BOTH are answered by whether an
 *     `auth.users` row exists for this address. Nothing in the public booking
 *     flow creates one, so an account exists precisely when the customer has
 *     signed in at least once. Measured on production 2026-08-29: of 6,290
 *     guest rows only 317 carry a `user_id`, 1,078 distinct guest emails have
 *     no auth user at all, and ZERO guests are unclaimed while a user for their
 *     address exists.
 *
 * So "has no account" means "has never been in the portal", exactly, with no
 * new column to maintain and nothing that can drift. It is also §5.3's rule
 * ("acceptable for the very first booking; not for subsequent bookings") in the
 * form the data actually supports: once they click one of these, an account
 * exists and they never get another.
 *
 * **It fails to today's link on every doubt.** A lookup error, a missing
 * address, a token that could not be minted: all of them return the ordinary
 * magic-link URL. The worst outcome of this function is the status quo.
 */

export interface AccountEntryLinkParams {
  email: string | null | undefined;
  /** Lands the customer on this booking rather than the list, when known. */
  bookingId?: string | null;
}

/**
 * @returns a URL for the email, or null when the base URL is not configured
 *   and no link can be built at all.
 */
export async function resolveAccountEntryLink(
  admin: SupabaseClient,
  params: AccountEntryLinkParams,
): Promise<string | null> {
  const email = params.email?.trim().toLowerCase();
  const fallback = () => accountBookingsMagicLinkUrl(email ?? null);
  if (!email) return fallback();

  const base = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  if (!base) return fallback();

  let eligible: boolean;
  try {
    eligible = !(await accountExistsFor(admin, email));
  } catch (err) {
    console.error('[account-entry-link] eligibility check failed:', err);
    return fallback();
  }
  if (!eligible) return fallback();

  const token = await issuePortalToken(admin, {
    email,
    bookingId: params.bookingId ?? null,
  });
  if (!token) return fallback();

  const url = new URL('/auth/portal', normalizePublicBaseUrl(base));
  url.searchParams.set('t', token);
  /*
    Carried for the FAILURE path only: `/auth/portal` prefills the sign-in form
    with it when the token has expired. The route never mints a session for this
    address, only for the one recorded against the token, and a test there pins
    that. It is the same address the email is being sent to, so it discloses
    nothing to its recipient.
  */
  url.searchParams.set('email', email);
  if (params.bookingId) {
    url.searchParams.set('next', `/account/bookings/${params.bookingId}`);
  }
  return url.toString();
}

/**
 * Does this address already have an account?
 *
 * Asked through `guests.user_id` rather than by listing `auth.users`, because
 * the admin user API has no lookup by email and paging it on every confirmation
 * email would be absurd. Production has zero guests that are unclaimed while a
 * user for their address exists, so the two questions have the same answer, and
 * `claim_user_account()` is what keeps them that way: it stamps `user_id` on
 * every guest row for the address the moment anybody signs in.
 */
async function accountExistsFor(admin: SupabaseClient, email: string): Promise<boolean> {
  const { data, error } = await admin
    .from('guests')
    .select('user_id')
    .ilike('email', email)
    .not('user_id', 'is', null)
    .limit(1);

  if (error) throw new Error(error.message);
  return Array.isArray(data) && data.length > 0;
}
