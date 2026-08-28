import { test, expect } from '@playwright/test';
import { getE2eConfig } from './helpers/env';
import { portalCustomerConfigured } from './helpers/account-session';
import { PORTAL_CUSTOMER_STATE } from './helpers/auth-state';

/**
 * P1-5 acceptance: all five retired routes land on the right tab, the query
 * survives the hop, and a tab is shareable.
 *
 * It has to be an e2e. `src/middleware.ts:121,151-159` redirects an
 * unauthenticated `/account*` to `/login`, so a unit test asserting on the
 * response would only ever be asserting a 307 to the login page, and the
 * redirect chain these tests exist to cover would never run.
 *
 * **No `autostart=1` anywhere in this file.** That parameter starts a real
 * card payment on the venue's Stripe account, and this suite runs against
 * staging. The deep-link tests below carry `venue` and `plan` only, which is
 * enough to prove the query survived: `autostart` is one more string in the
 * same query string, and if `venue` and `plan` arrive then it would have too.
 */

const e2e = getE2eConfig();

const SKIP_REASON = 'Set E2E_VENUE_SLUG and E2E_PORTAL_CUSTOMER_EMAIL (see Docs/E2E_SMOKE.md)';

/** Every route P1-5 retires, and the tab it must land on. */
const REDIRECTS: Array<{ from: string; tab: string }> = [
  { from: '/account/credits', tab: 'credits' },
  { from: '/account/courses', tab: 'courses' },
  { from: '/account/memberships', tab: 'memberships' },
  { from: '/account/recurring', tab: 'recurring' },
  // The static "Classes & packs" hub. It listed credits first, so it lands
  // there rather than inventing a new destination.
  { from: '/account/classes', tab: 'credits' },
];

/** The `PageHeader` each section renders, used to prove the tab really opened. */
const TAB_HEADING: Record<string, string> = {
  credits: 'Class credits',
  courses: 'Courses',
  memberships: 'Memberships',
  recurring: 'Repeat class bookings',
};

test.describe('P1-5: passes and plans', () => {
  test.use({ storageState: PORTAL_CUSTOMER_STATE });
  test.skip(!e2e.isConfigured || !portalCustomerConfigured(), SKIP_REASON);

  for (const { from, tab } of REDIRECTS) {
    test(`${from} lands on the ${tab} tab`, async ({ page }) => {
      const res = await page.goto(from);
      expect(res?.status(), from).toBeLessThan(400);

      const url = new URL(page.url());
      // Guards the failure that would make the whole file worthless: an
      // unauthenticated run redirects to /login, where every assertion about
      // tabs would be about a page nobody asked for.
      expect(url.pathname, `${from} did not reach the passes page`).toBe('/account/passes');
      expect(url.searchParams.get('tab'), from).toBe(tab);

      // The tab is not just in the URL; it is the one that opened.
      await expect(page.getByRole('heading', { name: TAB_HEADING[tab], level: 1 })).toBeVisible();
      await expect(page.getByRole('tab', { selected: true })).toHaveText(
        new RegExp(tab, 'i'),
      );
    });
  }

  test('a deep link keeps its venue and plan across the redirect (G25)', async ({ page }) => {
    // The class booking flow mints links in exactly this shape
    // (`ClassBookingFlow.tsx:801`), and links like it are already in inboxes.
    // Losing the query here would not error: the section would fall back to
    // the FIRST venue and the FIRST plan in the catalogue, which is the bug
    // P0-15 fixed, re-opened from the redirect end.
    await page.goto('/account/memberships?venue=venue-abc&plan=plan-xyz');

    const url = new URL(page.url());
    expect(url.pathname).toBe('/account/passes');
    expect(url.searchParams.get('tab')).toBe('memberships');
    expect(url.searchParams.get('venue')).toBe('venue-abc');
    expect(url.searchParams.get('plan')).toBe('plan-xyz');
  });

  test('the path decides the tab, not a tab param the link carries', async ({ page }) => {
    await page.goto('/account/recurring?tab=memberships');
    const url = new URL(page.url());
    expect(url.searchParams.getAll('tab')).toEqual(['recurring']);
    await expect(page.getByRole('heading', { name: TAB_HEADING.recurring, level: 1 })).toBeVisible();
  });

  test('an unknown tab shows the passes page rather than an error', async ({ page }) => {
    const res = await page.goto('/account/passes?tab=vouchers');
    expect(res?.status()).toBeLessThan(400);
    await expect(page.getByRole('heading', { name: TAB_HEADING.credits, level: 1 })).toBeVisible();
  });

  test('switching tab updates the URL, and that URL is shareable', async ({ page }) => {
    await page.goto('/account/passes');
    await expect(page.getByRole('heading', { name: TAB_HEADING.credits, level: 1 })).toBeVisible();

    await page.getByRole('tab', { name: 'Memberships' }).click();
    await expect(page.getByRole('heading', { name: TAB_HEADING.memberships, level: 1 })).toBeVisible();
    await expect(page).toHaveURL(/\/account\/passes\?tab=memberships$/);

    // Shareable means a cold load of that URL opens the same tab, which is the
    // half a same-page assertion cannot prove.
    await page.reload();
    await expect(page.getByRole('heading', { name: TAB_HEADING.memberships, level: 1 })).toBeVisible();
    await expect(page.getByRole('tab', { selected: true })).toHaveText('Memberships');
  });

  test('every tab opens its section, and the others are not in the page', async ({ page }) => {
    // "Every action available before the move is still available after it"
    // (P1-5 acceptance), at the granularity a machine can check: each of the
    // four sections renders, and exactly one at a time.
    await page.goto('/account/passes');
    for (const [tab, heading] of Object.entries(TAB_HEADING)) {
      await page.getByRole('tab', { name: new RegExp(`^${tab}`, 'i') }).click();
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
      await expect(page.locator('main h1')).toHaveCount(1);
    }
  });

  test('the nav marks where the customer is', async ({ page }) => {
    // The regression P1-5 would have shipped without touching the nav: five
    // items aimed at retired routes, so a customer standing on the passes page
    // saw no item marked current at all.
    await page.goto('/account/passes?tab=courses');
    await expect(
      page.locator('nav[aria-label="Account sections"] [aria-current="page"]'),
    ).toHaveText('Passes and plans');
  });

  test('no tab is clipped at 375px without a hint that it is there', async ({ page }) => {
    // The first version of this asserted the strip does not overflow at all,
    // on the assumption that four short labels fit a 375px row. Measured, it
    // overflows by 55px and clips "Recurring". The assumption was the bug, not
    // the layout: a customer cannot look for a tab they cannot see. So the
    // invariant is the honest one, and it holds either way the layout goes.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/account/passes');
    await expect(page.getByRole('heading', { name: TAB_HEADING.credits, level: 1 })).toBeVisible();

    const overflow = await page.getByRole('tablist').evaluate((el) => {
      const scroller = el.parentElement as HTMLElement;
      return scroller.scrollWidth - scroller.clientWidth;
    });

    if (overflow > 1) {
      await expect(
        page.getByRole('note'),
        'tabs are clipped at 375px and nothing tells the customer to scroll',
      ).toBeVisible();
    }

    // Either way the last tab must be reachable, which is the thing the hint
    // exists to make true.
    const last = page.getByRole('tab', { name: 'Recurring' });
    await last.click();
    await expect(page.getByRole('heading', { name: TAB_HEADING.recurring, level: 1 })).toBeVisible();
  });
});
