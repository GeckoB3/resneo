import { createClient } from '@/lib/supabase/browser';

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
 * @param next Internal path to land on afterwards (sanitised server-side).
 */
export async function signOutCleanly(next = '/login'): Promise<void> {
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
    await supabase.auth.signOut();
  } catch {
    /* The signed-out route signs out server-side as a fallback. */
  }

  window.location.replace(`/auth/signed-out?next=${encodeURIComponent(next)}`);
}
