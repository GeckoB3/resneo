import { test, expect } from '@playwright/test';
import { getE2eConfig } from './helpers/env';
import { portalCustomerConfigured } from './helpers/account-session';
import { PORTAL_CUSTOMER_STATE } from './helpers/auth-state';

/**
 * The portal at 375px (P0-1d).
 *
 * This spec exists so the mobile project is not an empty box that reports
 * green. P1-2 and P1-3 write their acceptance criteria against this width and
 * P0-8's axe pass runs here too; a project that has never executed a test
 * proves nothing about whether it works, and "the project exists" is exactly
 * the kind of claim that turns out to be false the first time someone relies
 * on it.
 *
 * What it asserts is deliberately narrow and structural rather than visual: no
 * screenshot baselines, no pixel assertions. Those are P0-7 and P0-8's
 * business, and a baseline committed now would need rewriting by both.
 */

const e2e = getE2eConfig();

test.describe('portal at 375px', () => {
  test.use({ storageState: PORTAL_CUSTOMER_STATE });
  test.skip(
    !e2e.isConfigured || !portalCustomerConfigured(),
    'Set E2E_VENUE_SLUG and E2E_PORTAL_CUSTOMER_EMAIL (see Docs/E2E_SMOKE.md)',
  );

  test('runs at the width the acceptance criteria are written against', async ({ page }) => {
    // If the project's viewport drifts, every criterion written against 375px
    // silently starts being checked at some other width.
    await page.goto('/account/bookings');
    expect(page.viewportSize()?.width).toBe(375);
  });

  test('the bookings list does not scroll sideways', async ({ page }) => {
    // The classic small-screen defect, and one a desktop project cannot see: a
    // fixed-width table or an unwrapped row pushes the page wider than the
    // viewport and the customer has to pan to reach anything on the right.
    await page.goto('/account/bookings');
    await expect(page.getByRole('heading', { name: 'Your bookings' })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, 'the page is wider than the viewport at 375px').toBeLessThanOrEqual(1);
  });

  test('the filter tabs and a booking are reachable and tappable', async ({ page }) => {
    await page.goto('/account/bookings');

    // Reachable: a control that renders off-screen or under another element is
    // not usable, and toBeVisible alone would not catch either.
    const past = page.getByRole('link', { name: 'Past' });
    await expect(past).toBeVisible();
    await past.click();
    await expect(page).toHaveURL(/filter=past/);

    const details = page.getByRole('link', { name: 'Details' }).first();
    await expect(details).toBeVisible();
    await details.click();
    await expect(page).toHaveURL(/\/account\/bookings\/[0-9a-f-]{36}/);
  });

  test('the next booking is visible without scrolling (P1-2)', async ({ page }) => {
    /*
      P1-2's stated acceptance, which until now was measured once by hand and
      never guarded. It is guarded here because P1-3's nav can change the
      answer: the four items fit one row under some font metrics and wrap to
      two under others, and the second row costs 38px of the fold.

      Measured at the time of writing: one row puts the card top at y=366, two
      rows at y=404, both of 812. So the wrap is affordable, and this is the
      test that says so if it ever stops being.
    */
    await page.goto('/account');
    const card = page.locator('main').filter({ hasText: 'Next up' }).first();
    await expect(card, 'the fixture customer should have an upcoming booking').toBeVisible();

    const label = page.getByText('Next up', { exact: true });
    await expect(label).toBeVisible();

    // Nothing has scrolled, and the card's primary action is on screen.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const action = page.getByRole('link', { name: 'View details' });
    const box = await action.boundingBox();
    expect(box, 'the card has no View details link').not.toBeNull();
    expect(
      box!.y + box!.height,
      'the next booking card is below the fold at 375px',
    ).toBeLessThanOrEqual(812);
  });

  test('the detail page and its manage button fit the viewport', async ({ page }) => {
    await page.goto('/account/bookings');
    await page.getByRole('link', { name: 'Details' }).first().click();
    await expect(page).toHaveURL(/\/account\/bookings\/[0-9a-f-]{36}/);

    const manage = page.getByRole('button', { name: 'Manage booking' });
    await expect(manage).toBeVisible();

    const box = await manage.boundingBox();
    expect(box, 'the manage button has no layout box').not.toBeNull();
    // Inside the viewport horizontally, and tall enough to hit with a thumb.
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    expect(box!.height).toBeGreaterThanOrEqual(40);
  });
});
