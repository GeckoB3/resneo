/**
 * The tab set behind `/account/passes`, and the one place that builds a link
 * into it (P1-5).
 *
 * Shared by the page and by all five legacy routes that redirect here, because
 * the redirects are the risky half of this task and they must not each invent
 * their own query handling. `/account/credits`, `/account/courses` and
 * `/account/memberships` are deep-link targets minted by the class booking
 * flow (`ClassBookingFlow.tsx:767,784,801`) carrying `venue`, `product`,
 * `course`, `plan` and `autostart=1`, and links in that shape are already
 * sitting in inboxes. A redirect that dropped the query string would not
 * error: it would silently land the customer on the right tab with the wrong
 * venue preselected, which is precisely the class of bug P0-15 fixed (G25) and
 * would have re-opened it from the other end.
 *
 * Kept free of React and of `next/*` so both server pages and unit tests can
 * use it directly.
 */

export type PassesTab = 'credits' | 'courses' | 'memberships' | 'recurring';

/**
 * Order is the tab order the customer sees. Credits first because it is the
 * one most customers hold: a balance is bought once and read many times, where
 * a course or a membership is set up once and then mostly left alone.
 */
export const PASSES_TABS: ReadonlyArray<{ id: PassesTab; label: string }> = [
  { id: 'credits', label: 'Credits' },
  { id: 'courses', label: 'Courses' },
  { id: 'memberships', label: 'Memberships' },
  { id: 'recurring', label: 'Recurring' },
];

export const DEFAULT_PASSES_TAB: PassesTab = 'credits';

export const PASSES_PATH = '/account/passes';

/** Search-param values as Next hands them to a server page. */
export type IncomingSearchParams = Record<string, string | string[] | undefined>;

function isPassesTab(value: string): value is PassesTab {
  return PASSES_TABS.some((t) => t.id === value);
}

/**
 * `?tab=` to a tab, falling back to the default rather than 404ing.
 *
 * A shared or hand-edited link with a stale tab name should still show the
 * customer their passes, not an error. Arrays are what Next produces for a
 * repeated param (`?tab=a&tab=b`); the first recognised value wins.
 */
export function parsePassesTab(raw: string | string[] | undefined | null): PassesTab {
  const values = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed && isPassesTab(trimmed)) return trimmed;
  }
  return DEFAULT_PASSES_TAB;
}

/**
 * The `/account/passes` URL for `tab`, carrying every other param through.
 *
 * Any incoming `tab` is dropped: the redirecting route decides the tab, so a
 * legacy link that already carried one (`/account/credits?tab=memberships`)
 * cannot override where `/account/credits` is meant to land. Repeated params
 * are preserved in order, since dropping duplicates would change what the
 * receiving section reads.
 */
export function passesHref(tab: PassesTab, incoming?: IncomingSearchParams): string {
  const params = new URLSearchParams();
  params.set('tab', tab);
  for (const [key, value] of Object.entries(incoming ?? {})) {
    if (key === 'tab' || value == null) continue;
    for (const v of Array.isArray(value) ? value : [value]) params.append(key, v);
  }
  return `${PASSES_PATH}?${params.toString()}`;
}

/**
 * The routes P1-5 retires, and the tab each one lands on.
 *
 * `next.config.ts` builds its `redirects()` table from this, so the list here
 * is the routing table rather than a description of one.
 *
 * **A config redirect, not a `redirect()` in a page.** The plan proposed the
 * latter, matching `src/app/account/layout.tsx:16`, and it was written that way
 * first. Measured against the running server it did work, but not as an HTTP
 * redirect: because the account layout has already begun streaming by the time
 * a page renders, Next answered `/account/credits` with a 200 and moved the
 * customer on the client after hydration. So every stale link paid for a full
 * authenticated render of a page that exists only to leave, and the customer
 * watched the portal chrome appear and then replace itself.
 *
 * `next.config.ts` runs before middleware and before any rendering, and
 * measurement confirmed all three behaviours this task needs:
 *
 *   /account/credits                        -> 307 /account/passes?tab=credits
 *   /account/credits?venue=v&plan=p         -> 307 ...?venue=v&plan=p&tab=credits
 *   /account/recurring?tab=memberships      -> 307 /account/passes?tab=recurring
 *
 * The second is the one that matters: the class booking flow's deep links keep
 * their arguments, so the redirect cannot re-open G25 from the other end. The
 * third is the tab-precedence rule falling out for free, because Next drops an
 * incoming param the destination already names.
 *
 * P1-3 adds four more retired routes and should extend the same block. Note for
 * it that the fragment rule in its own notes still holds here: these
 * destinations carry no fragment, so a client re-applies whatever it arrived
 * with.
 *
 * **307, not 308.** The plan allows either. A 308 is the tidier statement of
 * intent, but browsers cache it per URL with no expiry and nothing we ship can
 * clear it: get a destination wrong once and every customer who touched the URL
 * is pinned to it until they clear their browsing data. A 307 costs one cheap
 * extra request on a legacy URL that, once P1-3 rewrites the nav, nothing in
 * the product links to any more. The portal is four phases from finished, so
 * the reversible option is worth the round trip. Promoting these is a one-word
 * change once the structure has stopped moving.
 */
export const LEGACY_PASSES_ROUTES: ReadonlyArray<{ from: string; tab: PassesTab }> = [
  { from: '/account/credits', tab: 'credits' },
  { from: '/account/courses', tab: 'courses' },
  { from: '/account/memberships', tab: 'memberships' },
  { from: '/account/recurring', tab: 'recurring' },
  // The static "Classes & packs" hub. It was a menu of six links to pages that
  // are now four tabs and two sections elsewhere, so it had nothing left to
  // point at. Credits is where its own list started.
  { from: '/account/classes', tab: 'credits' },
];
