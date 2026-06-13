import { createClient } from '@/lib/supabase/browser';

/**
 * Best-effort budget for the client-side `signOut()` network call before we
 * give up waiting and hard-navigate anyway. See the note in {@link signOutCleanly}.
 */
const CLIENT_SIGN_OUT_TIMEOUT_MS = 1500;

/**
 * Sign out and tear the browser session down hard. Plain `signOut()` +
 * `router.push()` leaves three account-switch leak vectors behind:
 *
 * 1. The day-sheet service worker's Cache Storage (bookings/day-sheet API
 *    responses keyed by URL only) survives logout, so the next account on the
 *    same browser can be shown the previous account's data when a fetch fails.
 * 2. Soft SPA navigation keeps the page eligible for the back/forward cache,
 *    which can revive a pre-logout dashboard with the old account's data.
 * 3. localStorage / IndexedDB state written during the session lingers.
 *
 * So: purge Cache Storage here (works in every browser), sign out, then HARD
 * navigate through /auth/signed-out, whose response carries
 * `Clear-Site-Data: "cache", "storage"` for a spec-level flush in browsers
 * that support it, before redirecting to `next`.
 *
 * **Mobile reliability.** `supabase.auth.signOut()` first makes a network
 * request to revoke the session and only *then* clears the local cookies. On a
 * flaky mobile connection that request can hang, and because the redirect used
 * to sit behind `await signOut()`, the button appeared to do nothing until the
 * user reloaded by hand (the revoke had usually still reached the server, so a
 * manual refresh showed them logged out). The `/auth/signed-out` route is the
 * authoritative teardown — it signs out server-side (revoking the session and
 * clearing the auth cookies) and sends `Clear-Site-Data` — so the client call
 * here is best effort only. We race it against a short timeout and ALWAYS
 * hard-navigate, whether or not it finished.
 *
 * @param next Internal path to land on afterwards (sanitised server-side).
 */
export async function signOutCleanly(next = '/login'): Promise<void> {
  const target = `/auth/signed-out?next=${encodeURIComponent(next)}`;

  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch {
    /* Cache Storage unavailable (permissions/private mode) — Clear-Site-Data still runs. */
  }

  try {
    const supabase = createClient();
    // Best effort: revoke client-side, but never let a slow or dropped request
    // (common on mobile) hold the redirect hostage. The /auth/signed-out route
    // signs out server-side regardless, so move on once the timeout wins.
    const clientSignOut = Promise.resolve(supabase.auth.signOut()).catch(() => {
      /* The signed-out route signs out server-side as a fallback. */
    });
    await Promise.race([
      clientSignOut,
      new Promise<void>((resolve) => {
        setTimeout(resolve, CLIENT_SIGN_OUT_TIMEOUT_MS);
      }),
    ]);
  } catch {
    /* The signed-out route signs out server-side as a fallback. */
  }

  window.location.replace(target);
}
