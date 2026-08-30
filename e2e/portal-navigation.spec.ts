import { test, expect } from '@playwright/test';
import { getE2eConfig } from './helpers/env';
import { portalCustomerConfigured } from './helpers/account-session';
import { PORTAL_CUSTOMER_STATE } from './helpers/auth-state';

/**
 * P1-3 acceptance (closes G18).
 *
 * It has to be an e2e. `src/middleware.ts:121,151-159` redirects an
 * unauthenticated `/account*` to `/login`, so a unit test asserting on a
 * response would only ever be asserting a 307 to the login page, and the
 * redirect chains these tests exist to cover would never run.
 */

const e2e = getE2eConfig();
const SKIP_REASON = 'Set E2E_VENUE_SLUG and E2E_PORTAL_CUSTOMER_EMAIL (see Docs/E2E_SMOKE.md)';

/**
 * Every path the portal had before the rebuild, plus the dynamic booking
 * detail route.
 *
 * The plan counts twelve nav destinations and thirteen page routes, the
 * difference being `/account/bookings/[bookingId]`, which is a page but never
 * was a nav item. All thirteen are here because the promise this makes to a
 * customer is about links already in their inbox and their bookmarks, and a
 * link does not care which of the two lists it was on.
 */
const OLD_PATHS = [
  '/account',
  '/account/bookings',
  '/account/events',
  '/account/classes',
  '/account/resources',
  '/account/profile',
  '/account/credits',
  '/account/courses',
  '/account/memberships',
  '/account/recurring',
  '/account/payment-methods',
  '/account/security',
];

const FINAL_NAV = ['Bookings', 'Passes and plans', 'Profile', 'Help'];

test.describe('P1-3: one navigation system', () => {
  test.use({ storageState: PORTAL_CUSTOMER_STATE });
  test.skip(!e2e.isConfigured || !portalCustomerConfigured(), SKIP_REASON);

  test('every path the portal ever had still resolves', async ({ page }) => {
    // Includes the dynamic route, which needs a real id.
    await page.goto('/account/bookings');
    await page.getByRole('link', { name: 'Details' }).first().click();
    await expect(page).toHaveURL(/\/account\/bookings\/[0-9a-f-]{36}/);
    const detailPath = new URL(page.url()).pathname;

    const dead: string[] = [];
    for (const path of [...OLD_PATHS, detailPath]) {
      const res = await page.goto(path);
      const status = res?.status() ?? 0;
      const landed = new URL(page.url()).pathname;
      // Landing on /login would mean the session died mid-run, and every
      // assertion after it would be about a page nobody asked for.
      if (status >= 400 || landed === '/login') {
        dead.push(`${path} -> ${status} ${landed}`);
      }
    }
    expect(dead, 'paths that no longer resolve').toEqual([]);
  });

  test('the nav is four items, and the same four everywhere', async ({ page }) => {
    for (const path of ['/account', '/account/bookings', '/account/passes', '/account/profile']) {
      await page.goto(path);
      const items = page.locator('nav[aria-label="Account sections"] a');
      // The fixture customer is a plain customer, so no dashboard link. If the
      // fixture ever gains staff membership this is the assertion that says so
      // rather than silently counting five as a pass.
      await expect(items, path).toHaveText(FINAL_NAV);
    }
  });

  test('every nav item is on screen at 375px', async ({ page }) => {
    // Roughly eight of the old twelve items were off-screen here with no cue
    // that they existed, which is half of what G18 was about.
    //
    // This asserted only `scrollWidth - clientWidth` at first, and passed on
    // Windows while failing in CI by 3px: the items fit a 375px row under one
    // platform's font metrics and not the other's. The row wraps now, so that
    // measurement can no longer fail for anyone, which also means it can no
    // longer carry the test on its own. What matters to a customer is that no
    // item is hidden, so that is what is checked, and it holds whether the
    // items land on one row or two.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/account/bookings');
    await expect(page.getByRole('heading', { name: 'Your bookings', level: 1 })).toBeVisible();

    const row = page.locator('nav[aria-label="Account sections"] > div > div');
    expect(
      await row.evaluate((el) => el.scrollWidth - el.clientWidth),
      'the account nav row overflows sideways at 375px',
    ).toBeLessThanOrEqual(1);

    // The page as a whole must not scroll sideways either, which is the thing
    // a customer actually feels.
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
      'the page scrolls sideways at 375px',
    ).toBeLessThanOrEqual(1);

    const items = page.locator('nav[aria-label="Account sections"] a');
    const count = await items.count();
    expect(count, 'no nav items found; this test would pass vacuously').toBe(FINAL_NAV.length);

    const clipped: string[] = [];
    for (let i = 0; i < count; i++) {
      const item = items.nth(i);
      const label = (await item.textContent())?.trim() ?? '';
      if (!(await item.isVisible())) {
        clipped.push(`${label} (not visible)`);
        continue;
      }
      const box = await item.boundingBox();
      if (!box) {
        clipped.push(`${label} (no box)`);
        continue;
      }
      if (box.x < 0 || box.x + box.width > 375 + 1) {
        clipped.push(`${label} (${Math.round(box.x)}..${Math.round(box.x + box.width)} of 375)`);
      }
    }
    expect(clipped, 'nav items cut off at 375px').toEqual([]);
  });

  test('and at 320px, where the row has to wrap on every platform', async ({ page }) => {
    // 375px is the acceptance width, but whether the items fit it on one row
    // depends on the font metrics of whoever is running the test. 320px is
    // narrow enough that they cannot fit anywhere, so this is the case that
    // exercises the wrap on Windows as well as on CI. Without it, the wrapping
    // path would only ever be covered on the machine that already failed.
    await page.setViewportSize({ width: 320, height: 812 });
    await page.goto('/account/bookings');
    await expect(page.getByRole('heading', { name: 'Your bookings', level: 1 })).toBeVisible();

    const rows = await page
      .locator('nav[aria-label="Account sections"] a')
      .evaluateAll((els) => new Set(els.map((el) => Math.round(el.getBoundingClientRect().top))).size);
    expect(rows, 'the nav did not wrap at 320px, so something is clipped').toBeGreaterThan(1);

    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
      'the page scrolls sideways at 320px',
    ).toBeLessThanOrEqual(1);

    for (const label of FINAL_NAV) {
      await expect(
        page.locator('nav[aria-label="Account sections"]').getByRole('link', { name: label }),
        label,
      ).toBeVisible();
    }
  });

  test('the hub offers at most six ways on, and no longer repeats the nav', async ({ page }) => {
    await page.goto('/account');
    const shortcuts = page.locator('section[aria-labelledby="account-shortcuts-heading"] a');
    const count = await shortcuts.count();
    expect(count, 'no shortcuts found; this test would pass vacuously').toBeGreaterThan(0);
    expect(count, 'the hub is a menu again').toBeLessThanOrEqual(6);
  });

  test('the wordmark goes to the hub, since Overview is no longer an item', async ({ page }) => {
    await page.goto('/account/profile');
    await page.getByRole('link', { name: /ResNeo account overview/i }).click();
    await expect(page).toHaveURL(/\/account$/);
  });

  test('events and resources become type filters on one bookings list', async ({ page }) => {
    await page.goto('/account/events');
    expect(new URL(page.url()).pathname).toBe('/account/bookings');
    await expect(page.getByRole('heading', { name: 'Your bookings', level: 1 })).toBeVisible();
    await expect(page.locator('[aria-current="true"]').filter({ hasText: 'Events' })).toBeVisible();

    await page.goto('/account/resources');
    await expect(
      page.locator('[aria-current="true"]').filter({ hasText: 'Resources' }),
    ).toBeVisible();
  });

  test('the two filter dimensions do not clear each other', async ({ page }) => {
    // Narrowing to a type and then to a time range used to be impossible,
    // because each was its own page. Now they are two rows of pills over one
    // list, and the failure mode is that clicking one silently resets the
    // other.
    await page.goto('/account/bookings?model=event');
    await page.getByRole('link', { name: 'Past', exact: true }).click();
    // Waited for, not read straight after the click: these pills are Next
    // `<Link>`s doing a client-side navigation, so `page.url()` on the next
    // line is still the old URL. The first version of this test read `filter`
    // as null for exactly that reason and blamed the product.
    await expect(page).toHaveURL(/[?&]filter=past/);

    const url = new URL(page.url());
    expect(url.searchParams.get('model')).toBe('event');
    expect(url.searchParams.get('filter')).toBe('past');
  });

  test('payments and security are sections of the profile, reached by anchor', async ({ page }) => {
    for (const [from, anchor, heading] of [
      ['/account/payment-methods', 'payment-methods', 'Saved payment methods'],
      ['/account/security', 'password', 'Password'],
    ] as const) {
      await page.goto(from);
      const url = new URL(page.url());
      expect(url.pathname, from).toBe('/account/profile');
      // The fragment is not sent to the server, so this is asserting what the
      // browser did with the one the Location header carried.
      expect(url.hash, from).toBe(`#${anchor}`);
      await expect(page.getByRole('heading', { name: heading, level: 2 })).toBeVisible();
      // And the anchor is a real element, not just a string in the URL.
      await expect(page.locator(`#${anchor}`)).toBeVisible();
    }
  });

  test('the profile page still offers everything the two retired pages did', async ({ page }) => {
    await page.goto('/account/profile');
    for (const name of [
      'Contact details',
      'Notification preferences',
      'Devices',
      'Saved payment methods',
      'Password',
      'Sessions',
      'Delete account',
    ]) {
      await expect(page.getByRole('heading', { name, level: 2 }), name).toBeVisible();
    }
    // The controls that actually do something, not just their headings.
    await expect(page.getByRole('button', { name: 'Sign out everywhere' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Request account deletion' })).toBeVisible();
  });
});
