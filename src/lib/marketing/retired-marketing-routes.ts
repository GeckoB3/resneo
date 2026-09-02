/**
 * Marketing pages that no longer exist, and where a stale link should land.
 *
 * `next.config.ts` builds its `redirects()` table from this list alongside the
 * portal's `RETIRED_ACCOUNT_ROUTES`, and the account table's guard test scopes
 * itself to `/account/` sources so the two can coexist.
 *
 * Temporary (307) rather than permanent, for the same reason the portal table
 * gives: a browser caches a 308 per URL with no expiry, so if a retired page
 * ever comes back, everyone who once followed the old link stays pinned to the
 * redirect. The Restaurant plan is retired for now, not necessarily forever.
 */
export interface RetiredMarketingRoute {
  /** The path that used to exist. */
  from: string;
  /** Where it lands. */
  to: string;
  /** Why, in one line. */
  why: string;
}

export const RETIRED_MARKETING_ROUTES: RetiredMarketingRoute[] = [
  {
    from: '/restaurant',
    to: '/solutions',
    why: 'The Restaurant plan is no longer sold; the solutions hub is the nearest page that still exists.',
  },
];
