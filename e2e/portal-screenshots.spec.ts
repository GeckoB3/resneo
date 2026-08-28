import { test } from '@playwright/test';
import { getE2eConfig } from './helpers/env';
import { portalCustomerConfigured } from './helpers/account-session';
import { PORTAL_CUSTOMER_STATE } from './helpers/auth-state';

/**
 * Portal screenshot capture (P0-7 acceptance check 3).
 *
 * OPT-IN, and deliberately so. The plan asks for a baseline "reviewed once by a
 * named person", and an unreviewed baseline is worse than none: it freezes
 * whatever the last run produced, including a regression, and then reports
 * green forever. So this writes images for a human to compare and asserts
 * nothing itself. Run it before and after a visual change:
 *
 *   E2E_CAPTURE_SCREENSHOTS=1 SHOT_DIR=/tmp/before npx playwright test e2e/portal-screenshots.spec.ts
 *   ...make the change...
 *   E2E_CAPTURE_SCREENSHOTS=1 SHOT_DIR=/tmp/after  npx playwright test e2e/portal-screenshots.spec.ts
 *
 * It captured the P0-7 migration, and it earned its keep on the first run: the
 * disabled "Request account deletion" button had turned from amber to brand
 * blue, because `cn` concatenates classes without resolving Tailwind conflicts
 * and the variant's `disabled:bg-brand-300` was winning. No test in the suite
 * would have noticed.
 *
 * Note what it can and cannot see: a control only appears if the fixture
 * customer's data makes it render. With no course, credit or membership
 * catalogue seeded, those screens are empty states, and the controls on them
 * are covered by `portal-primitives.test.tsx` instead.
 */

const e2e = getE2eConfig();
const DIR = process.env.SHOT_DIR ?? 'test-results/portal-screenshots';

const SCREENS: Array<[string, string]> = [
  ['bookings', '/account/bookings'],
  ['profile', '/account/profile'],
  ['security', '/account/security'],
  // The four commerce screens are tabs since P1-5. Addressed at their new URLs
  // rather than through the redirect, so a broken redirect shows up as a
  // failing test in `portal-passes.spec.ts` instead of as four screenshots
  // that quietly all became the same page.
  ['passes-credits', '/account/passes?tab=credits'],
  ['passes-memberships', '/account/passes?tab=memberships'],
  ['passes-courses', '/account/passes?tab=courses'],
  ['passes-recurring', '/account/passes?tab=recurring'],
  ['payment-methods', '/account/payment-methods'],
];

/** Widths worth a look of their own. 375 is what P1-2 and P1-3 are written against. */
const NARROW_SCREENS: Array<[string, string]> = [['passes-375', '/account/passes']];

test.describe('portal screenshots', () => {
  test.use({ storageState: PORTAL_CUSTOMER_STATE });
  test.skip(
    process.env.E2E_CAPTURE_SCREENSHOTS !== '1' || !e2e.isConfigured || !portalCustomerConfigured(),
    'Set E2E_CAPTURE_SCREENSHOTS=1 to capture (see the file header)',
  );

  test('capture the portal screens', async ({ page }) => {
    test.setTimeout(180_000);
    for (const [name, path] of SCREENS) {
      await page.goto(path);
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.screenshot({ path: `${DIR}/${name}.png`, fullPage: true });
    }
    for (const [name, path] of NARROW_SCREENS) {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(path);
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.screenshot({ path: `${DIR}/${name}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 1280, height: 720 });

    await page.goto('/account/bookings');
    await page.getByRole('link', { name: 'Details' }).first().click();
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.screenshot({ path: `${DIR}/booking-detail.png`, fullPage: true });
    console.log(`[e2e] wrote ${SCREENS.length + NARROW_SCREENS.length + 1} screenshots to ${DIR}`);
  });
});
