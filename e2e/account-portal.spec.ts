import { test, expect } from '@playwright/test';
import { getE2eConfig } from './helpers/env';
import { portalCustomerConfigured, signInAsPortalCustomer } from './helpers/account-session';
import { PORTAL_CUSTOMER_STATE } from './helpers/auth-state';

/**
 * Portal smoke (P0-1a/b): sign in as the fixture customer, see bookings, open detail.
 *
 * The one assertion that must never be weakened is the cross-venue one: the same
 * signed-in customer sees bookings from BOTH fixture venues in one list. Cross-venue
 * identity is the portal's distinguishing behaviour, and a regression in it (a guest
 * link lost, a venue filter applied where none belongs) is exactly what this spec
 * exists to catch. Fixture: scripts/seed-e2e-portal-customer.mjs.
 */

const e2e = getE2eConfig();

/** Fixed in scripts/seed-e2e-smoke-venue.mjs, deliberately not configurable there. */
const STAFF_FIRST_VENUE_NAME = 'E2E Staff-First Salon';

const SKIP_REASON = 'Set E2E_VENUE_SLUG and E2E_PORTAL_CUSTOMER_EMAIL (see Docs/E2E_SMOKE.md)';

/**
 * The sign-in path itself, exercised for real, once per run.
 *
 * Deliberately NOT using the saved session (P0-1d): this is the test that
 * covers `/auth/confirm`, `verifyOtp`, `claim_user_account()` and the
 * post-login destination logic. Reusing a cookie here would leave the whole
 * sign-in path untested while every spec still looked green, which is the
 * failure mode an auth harness invites.
 */
test.describe('P0-1 portal smoke: the real sign-in path', () => {
  test.skip(!e2e.isConfigured || !portalCustomerConfigured(), SKIP_REASON);

  test('signs in via the real confirm route and lands signed in', async ({ page }) => {
    await signInAsPortalCustomer(page);
    // A guest-only account resolves to /account. If destination logic changes this,
    // the helper has already asserted we are not on an auth failure path; this pins
    // the customer-facing landing so an accidental staff-dashboard resolution fails.
    await expect(page).toHaveURL(/\/account(\/|$|\?)/);
  });
});

/**
 * Everything else reuses the session the setup project established, so these
 * specs test the portal rather than re-testing sign-in five times.
 */
test.describe('P0-1 portal smoke: view bookings, open detail', () => {
  test.use({ storageState: PORTAL_CUSTOMER_STATE });
  test.skip(!e2e.isConfigured || !portalCustomerConfigured(), SKIP_REASON);

  test('shows bookings from both venues in one list', async ({ page }) => {
    await page.goto('/account/bookings');
    await expect(page.getByRole('heading', { name: 'Your bookings' })).toBeVisible();

    // Cross-venue identity: one customer, two venues, one list.
    await expect(page.getByText(e2e.venueName).first()).toBeVisible();
    await expect(page.getByText(STAFF_FIRST_VENUE_NAME).first()).toBeVisible();

    // The seeded set is deterministic: an upcoming Booked and a past Completed per
    // venue, so the unfiltered list carries at least four Details links.
    const detailLinks = page.getByRole('link', { name: 'Details' });
    expect(await detailLinks.count()).toBeGreaterThanOrEqual(4);
  });

  test('opens a booking detail page', async ({ page }) => {
    await page.goto('/account/bookings');
    await page.getByRole('link', { name: 'Details' }).first().click();

    await expect(page).toHaveURL(/\/account\/bookings\/[0-9a-f-]{36}/);
    // The detail header is the venue name for a plain booking; either fixture venue
    // is acceptable since list order is by date, not venue.
    const heading = page.getByRole('heading', {
      name: new RegExp(`${e2e.venueName}|${STAFF_FIRST_VENUE_NAME}`),
    });
    await expect(heading.first()).toBeVisible();
  });

  test('mints the manage link on intent, not on render (P0-3)', async ({ page }) => {
    // The list used to mint a short link for every row while rendering, so a
    // GET wrote a row per booking. It is now minted by POST when a customer
    // asks, which means the button has to actually work: an anchor with a
    // pre-baked href could not silently break, and a button can.
    // Intercepted rather than observed, because the successful case navigates
    // away and the response body is gone by the time an assertion could read
    // it: the first version of this test failed on exactly that.
    const mintCalls: string[] = [];
    let mintedUrl: string | null = null;
    await page.route('**/manage-link', async (route) => {
      mintCalls.push(route.request().method());
      const response = await route.fetch();
      const body = (await response.json()) as { url?: string };
      mintedUrl = body.url ?? null;
      await route.fulfill({ response });
    });

    // Registered BEFORE the navigation, so a mint during render would be seen.
    await page.goto('/account/bookings');
    await expect(page.getByRole('heading', { name: 'Your bookings' })).toBeVisible();
    expect(mintCalls, 'the bookings list minted a manage link on render').toEqual([]);

    await page.getByRole('link', { name: 'Details' }).first().click();
    await expect(page).toHaveURL(/\/account\/bookings\/[0-9a-f-]{36}/);
    expect(mintCalls, 'the booking detail page minted a manage link on render').toEqual([]);

    await page.getByRole('button', { name: 'Manage booking' }).click();

    // It resolves to the guest manage page, signed with its HMAC.
    await expect(page).toHaveURL(/\/manage\/[0-9a-f-]{36}\?hmac=/);

    // One POST, and a real /b/{code} short link.
    expect(mintCalls).toEqual(['POST']);
    expect(mintedUrl).toMatch(/\/b\/[0-9A-Za-z]{6}$/);
  });

  test('every account surface renders, with the timezone now a picker (P0-2)', async ({ page }) => {
    // P0-2 changed the signature the two hub loaders are called with, and
    // nothing else covers those pages. It also swapped the timezone field from
    // free text to a select, which is the half of G23 a schema test cannot see.
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => {
      // React's dev-only Server Components performance track emits
      // "cannot have a negative time stamp" from performance.measure for some
      // async server components. It is instrumentation, not the page: checked
      // against a production build (next build + next start), where these four
      // routes raise no page errors at all. Everything else still fails here.
      if (/Failed to execute 'measure' on 'Performance'/.test(String(e))) return;
      pageErrors.push(String(e));
    });

    for (const path of [
      '/account/bookings?filter=upcoming',
      '/account/bookings?filter=past',
      '/account/events',
      '/account/resources',
      '/account/profile',
    ]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBeLessThan(400);
      await expect(page.locator('h1').first(), path).toBeVisible();
    }

    await expect(page.locator('select#profile-timezone')).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
});
