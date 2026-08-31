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
 * The four surviving routes with a title of their own, matching P0-5's and
 * P0-8's scoping. P1-5 and P1-3 turned nine of the thirteen into redirects, so
 * this is now the whole portal rather than a sample of it; the booking detail
 * page is the fifth and is audited separately below because it needs an id.
 */
/**
 * `ready` is a heading that exists ONLY on the real page, never on its
 * skeleton. That distinction is the whole point: P0-5's `loading.tsx` files
 * deliberately print the real `PageHeader` to avoid a layout shift, so waiting
 * for an `<h1>` matches the skeleton on most routes and axe would audit a page
 * with no controls on it and report clean.
 */
const SURVIVING_ROUTES: Array<{
  path: string;
  title: string;
  ready?: { name: string; level: 1 | 2 };
}> = [
  { path: '/account', title: 'My account' },
  { path: '/account/bookings', title: 'Your bookings' },
  {
    path: '/account/passes',
    title: 'Passes and plans',
    // Its panel is a client section behind Suspense, and its `loading.tsx`
    // renders no heading at all (the heading belongs to whichever tab
    // resolves). So on this one route an `<h1>` existing IS the signal.
    ready: { name: 'Class credits', level: 1 },
  },
  {
    path: '/account/profile',
    title: 'Profile and preferences',
    // NOT the `<h1>`: `profile/loading.tsx` prints "Profile & preferences"
    // too, so waiting for it would match the skeleton. "Delete account" is the
    // last section on the page and exists only once the real page has
    // rendered, so it proves all nine sections are there for axe to audit,
    // including the three P1-3 folded in.
    ready: { name: 'Delete account', level: 2 },
  },
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
      if (route.ready) {
        await expect(
          page.getByRole('heading', { name: route.ready.name, level: route.ready.level }),
        ).toBeVisible();
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

  /**
   * The URL is NOT the signal that this page is ready to audit.
   *
   * A client-side hop updates the address bar before the tree swaps, and the
   * outgoing `<title>` is removed in a separate DOM operation from the one
   * that inserts the new one. Throttled to 12KB/s, five runs in six caught
   * that gap: `location.pathname` was already the detail page, the document
   * had no `<title>` at all, and `main` still held the bookings list. That is
   * the intermittent `document-title` failure this test used to produce on
   * CI, on commits that passed when re-run.
   *
   * The half that mattered more is the half that looked green. A moment later
   * the same assertion audits `loading.tsx`'s skeleton, on which axe reports
   * nothing, so the passes were vacuous: this never once audited the real
   * page. It does now, and the audit immediately found five AA contrast
   * failures in `DetailTile` that had been sitting behind the skeleton.
   *
   * `portal-copy.spec.ts`'s "an `<h1>` and no `role=status`" is not enough on
   * its own here, and the same throttled run proves it: the address bar can
   * hold the detail URL while the DOM is still the bookings LIST, whose `<h1>`
   * is present and whose skeleton is long gone, so those two waits pass and
   * axe audits the page it navigated away from. Only something the detail view
   * alone renders settles it, and `detail-time` is the tile the reschedule
   * specs already use for exactly this.
   */
  test('the booking detail page has no A or AA violations', async ({ page }) => {
    await page.goto('/account/bookings');
    await page.getByRole('link', { name: 'Details' }).first().click();
    await expect(page).toHaveURL(/\/account\/bookings\/[0-9a-f-]{36}/);
    await expect(
      page.getByTestId('detail-time'),
      'the booking detail view never rendered; axe would audit the list or the skeleton',
    ).toBeVisible();
    await expect(page.locator('main [role="status"]')).toHaveCount(0);

    // WCAG 2.4.2 for this page. The route test below covers only the four
    // routes reachable without an id, so without this the detail page's own
    // title is asserted nowhere.
    await expect(page).toHaveTitle(/Booking details/);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      results.violations.map((v) => `${v.id} (${v.nodes.length}): ${v.help}`),
      'axe found WCAG A/AA violations on the booking detail page',
    ).toEqual([]);
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

    await page.goto('/account/bookings?filter=past&model=event');
    // `true` rather than `page`: a filter is not a separate page.
    //
    // Scoped per group since P1-3. The list has TWO filter rows now, date and
    // type, and each marks its own active pill, so an unscoped
    // `[aria-current="true"]` matches two elements. Asserting both is the
    // point rather than a workaround: the failure this guards against is one
    // row marking the other's selection.
    await expect(page.getByRole('group', { name: 'Filter by date' })).toContainText('Past');
    await expect(
      page.getByRole('group', { name: 'Filter by date' }).locator('[aria-current="true"]'),
    ).toHaveText('Past');
    await expect(
      page.getByRole('group', { name: 'Filter by booking type' }).locator('[aria-current="true"]'),
    ).toHaveText('Events');
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
