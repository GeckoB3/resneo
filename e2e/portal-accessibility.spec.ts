import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { getE2eConfig } from './helpers/env';
import { portalCustomerConfigured } from './helpers/account-session';
import { PORTAL_CUSTOMER_STATE } from './helpers/auth-state';

/**
 * P0-8 acceptance, the parts a machine can decide.
 *
 * None of this tooling existed: no axe, no pa11y, no lighthouse anywhere in
 * package.json. Earlier drafts of the plan asserted "axe reports zero AA
 * violations" as an acceptance criterion without noticing that nothing could
 * run it, which is why the plan now says the tooling has to be budgeted. This
 * file plus `@axe-core/playwright` is that budget spent.
 *
 * It needs P0-1d's saved session: every route under `/account` redirects to
 * `/login` without one, and axe would then have reported on the login page and
 * passed.
 */

const e2e = getE2eConfig();

/**
 * The five surviving routes, matching P0-5's and P0-8's scoping. P1-3 and P1-5
 * turn nine of the thirteen into one-line redirects, so auditing all thirteen
 * would spend most of the run on pages about to stop existing.
 */
const SURVIVING_ROUTES: Array<{ path: string; title: string; readyHeading?: string }> = [
  { path: '/account', title: 'My account' },
  { path: '/account/bookings', title: 'Your bookings' },
  {
    path: '/account/passes',
    title: 'Passes and plans',
    // The one route where waiting is not optional. Its panel is a client
    // section behind Suspense, and its `loading.tsx` deliberately renders no
    // heading (the heading belongs to whichever tab resolves), so without this
    // axe would audit a skeleton carrying no controls and report clean. That
    // an h1 exists at all is therefore the readiness signal here, which is the
    // opposite of the other routes: their skeletons print the real heading on
    // purpose, so waiting for it would prove nothing.
    readyHeading: 'Class credits',
  },
  { path: '/account/profile', title: 'Profile and preferences' },
  { path: '/account/security', title: 'Security and data' },
];

test.describe('portal accessibility', () => {
  test.use({ storageState: PORTAL_CUSTOMER_STATE });
  test.skip(
    !e2e.isConfigured || !portalCustomerConfigured(),
    'Set E2E_VENUE_SLUG and E2E_PORTAL_CUSTOMER_EMAIL (see Docs/E2E_SMOKE.md)',
  );

  for (const route of SURVIVING_ROUTES) {
    test(`axe reports no A or AA violations on ${route.path}`, async ({ page }) => {
      await page.goto(route.path);
      // Guard against the failure that would make this whole file worthless: a
      // redirect to /login, where axe would audit a page nobody asked about
      // and report clean.
      expect(new URL(page.url()).pathname, 'not signed in; axe would audit /login').toBe(route.path);
      if (route.readyHeading) {
        await expect(page.getByRole('heading', { name: route.readyHeading, level: 1 })).toBeVisible();
      }

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      expect(
        results.violations.map((v) => `${v.id} (${v.nodes.length}): ${v.help}`),
        'axe found WCAG A/AA violations',
      ).toEqual([]);
    });
  }

  test('the booking detail page has no A or AA violations', async ({ page }) => {
    await page.goto('/account/bookings');
    await page.getByRole('link', { name: 'Details' }).first().click();
    await expect(page).toHaveURL(/\/account\/bookings\/[0-9a-f-]{36}/);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });

  test('each surviving route has its own page title (WCAG 2.4.2)', async ({ page }) => {
    // Without a per-route `metadata`, Next falls back to the root layout's
    // title and every portal page announces the same thing, so a screen-reader
    // user cannot tell from the announcement which page they landed on.
    const seen = new Map<string, string>();
    for (const route of SURVIVING_ROUTES) {
      await page.goto(route.path);
      const title = await page.title();
      expect(title, `${route.path} should carry its own title`).toContain(route.title);
      expect(seen.has(title), `${route.path} shares a title with ${seen.get(title)}`).toBe(false);
      seen.set(title, route.path);
    }
  });

  test('the skip link is the FIRST tab stop and moves focus to main', async ({ page }) => {
    // WCAG 2.4.1. The sticky header and account nav put roughly fifteen links
    // ahead of the content, so without this a keyboard user tabbed through all
    // of them on every navigation.
    await page.goto('/account/bookings');
    await page.keyboard.press('Tab');

    const focused = page.locator(':focus');
    await expect(focused).toHaveText('Skip to main content');

    await page.keyboard.press('Enter');
    // Focus must MOVE, not just the viewport: otherwise the next Tab returns
    // the user to the nav they just skipped.
    await expect(page.locator(':focus')).toHaveAttribute('id', 'account-main');
  });

  test('aria-current marks the active nav item and the active filter tab', async ({ page }) => {
    await page.goto('/account/bookings');
    // The nav marked the active item by colour alone.
    await expect(page.locator('nav[aria-label="Account sections"] [aria-current="page"]')).toHaveText(
      'Bookings',
    );

    await page.goto('/account/bookings?filter=past');
    // `true` rather than `page`: a filter is not a separate page.
    await expect(page.locator('[aria-current="true"]')).toHaveText('Past');
  });

  test('every link and button meets the 24px target floor (WCAG 2.5.8)', async ({ page }) => {
    await page.goto('/account/bookings');
    // Wait for the real content, and specifically for something the SKELETON
    // does not have. P0-5's loading.tsx renders the same PageHeader on purpose,
    // to avoid a layout shift, so waiting for the heading matches the skeleton
    // and `main` still holds no controls. The filter links only exist once the
    // page itself has rendered. The vacuity guard below caught both mistakes.
    await expect(page.getByRole('link', { name: 'Past' })).toBeVisible();
    const controls = page.locator('main a, main button');
    const count = await controls.count();
    expect(count, 'no controls found; this test would pass vacuously').toBeGreaterThan(3);

    const undersized: string[] = [];
    for (let i = 0; i < count; i++) {
      const control = controls.nth(i);
      if (!(await control.isVisible())) continue;
      const box = await control.boundingBox();
      if (!box) continue;
      if (box.height < 24 || box.width < 24) {
        undersized.push(`${(await control.textContent())?.trim()} (${box.width}x${box.height})`);
      }
    }
    expect(undersized, 'controls under 24 by 24 CSS px').toEqual([]);
  });
});
