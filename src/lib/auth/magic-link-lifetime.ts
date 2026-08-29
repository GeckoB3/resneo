/**
 * How long a sign-in link lasts, in ONE place (P3-4g).
 *
 * It must equal the project's `otp_expiry` (86400 seconds,
 * `supabase/config.toml:230`), which is configured per project in the hosted
 * dashboard rather than by that file. The plan records that changing it has to
 * update every string stating the lifetime, and until now there were two such
 * strings in two files: the email built inside `send-magic-link/route.ts`, and
 * the "check your inbox" screen in `AuthMagicForm`. Two places is how they come
 * to disagree, and a customer told 24 hours by one and something else by the
 * other has no way to know which is true.
 *
 * Deliberately a plain module with no server imports, so the client form can
 * read it as easily as the route can.
 */

export const MAGIC_LINK_EXPIRY_HOURS = 24;

/** "24 hours", or "1 hour" when it is one. */
export function magicLinkLifetimeLabel(hours: number = MAGIC_LINK_EXPIRY_HOURS): string {
  const whole = Math.max(1, Math.round(hours));
  return whole === 1 ? '1 hour' : `${whole} hours`;
}
