import { LEGACY_PASSES_ROUTES, passesHref } from './passes/passes-tabs';

/**
 * Every portal route the rebuild retires, and where it goes (P1-5, P1-3).
 *
 * `next.config.ts` builds its `redirects()` table from this, so the list here
 * is the routing table rather than a description of one. Retiring a route means
 * adding a row, not adding a page: P1-5 measured why, and the note on
 * `LEGACY_PASSES_ROUTES` records it. In short, a `redirect()` inside the
 * streaming account layout is answered as a 200 plus a client-side hop after
 * hydration, so it costs a full authenticated render of a page whose only job
 * is to leave.
 *
 * **On fragments, and why two of these carry one.** A URL fragment is never
 * sent to the server, so no redirect can "preserve" one it cannot see. Per RFC
 * 7231 §7.1.2 the client re-applies its own fragment to the target only when
 * `Location` carries none; a fragment in `Location` wins. So a destination that
 * names the anchor it wants is the only way to land on it, and the plan's
 * earlier `/account/security#password` to `/account/profile#security` would
 * have destroyed the anchor it claimed to preserve. `#password` and
 * `#payment-methods` below are the ids on the sections themselves.
 *
 * All of these are **307, not 308**. A 308 is the tidier statement of intent,
 * but browsers cache it per URL with no expiry and nothing we ship can clear
 * it: get a destination wrong once and every customer who touched the URL is
 * pinned to it until they clear their browsing data. A 307 costs one cheap
 * request on a URL nothing in the product links to any more. Promoting them is
 * a one-word change once the structure has stopped moving.
 */
export interface RetiredAccountRoute {
  /** The path being retired. */
  from: string;
  /** Where it lands, path plus any query and fragment. */
  to: string;
  /** Why, in one line, for whoever reads the config. */
  why: string;
}

/**
 * The four P1-3 retires, on top of P1-5's five.
 *
 * Events and resources become a filter rather than a page, because they were
 * two lists holding part of the answer to "what have I booked". They land on
 * the unfiltered time range on purpose: the pages they replace showed only
 * upcoming rows, and the list can now show a customer the event they went to
 * last month, which the old page could not.
 */
const P1_3_ROUTES: ReadonlyArray<RetiredAccountRoute> = [
  {
    from: '/account/events',
    to: '/account/bookings?model=event',
    why: 'Events are a type filter over one bookings list, not a second list.',
  },
  {
    from: '/account/resources',
    to: '/account/bookings?model=resource',
    why: 'Resources are a type filter over one bookings list, not a third list.',
  },
  {
    from: '/account/payment-methods',
    to: '/account/profile#payment-methods',
    why: 'Saved cards are a section of the profile, not a destination of their own.',
  },
  {
    from: '/account/security',
    to: '/account/profile#password',
    why: 'Password, sessions and deletion are sections of the profile.',
  },
];

export const RETIRED_ACCOUNT_ROUTES: ReadonlyArray<RetiredAccountRoute> = [
  ...LEGACY_PASSES_ROUTES.map(({ from, tab }) => ({
    from,
    to: passesHref(tab),
    why: `Consolidated into the ${tab} tab of /account/passes.`,
  })),
  ...P1_3_ROUTES,
];
