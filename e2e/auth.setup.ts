import { test as setup, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'fs';
import { portalCustomerConfigured, signInAsPortalCustomer } from './helpers/account-session';
import { AUTH_STATE_DIR, EMPTY_STORAGE_STATE, PORTAL_CUSTOMER_STATE } from './helpers/auth-state';

/**
 * The Playwright auth layer (P0-1d). There was none: no `storageState`, no
 * setup project, one chromium project, and `global-setup.ts` only validated
 * env.
 *
 * WHY A SETUP PROJECT AND NOT `globalSetup`. Signing in needs the app running,
 * and `globalSetup` is not guaranteed to run after the `webServer` is up. A
 * setup project is an ordinary test: the server is up, `baseURL` resolves,
 * traces and screenshots work when it fails, and a failure marks every
 * dependent project as not-run instead of leaving each spec to fail on its own
 * in a way that looks like a product bug.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not replace the sign-in test.
 * `account-portal.spec.ts` still signs in through the real `/auth/confirm`
 * route once per run, because that path exercises `verifyOtp`,
 * `claim_user_account()` and the post-login destination logic, and a harness
 * that reused a cookie for everything would stop covering it. This project
 * exists so the OTHER tests do not each pay for it again.
 */

setup('authenticate the portal customer', async ({ page }) => {
  mkdirSync(AUTH_STATE_DIR, { recursive: true });

  if (!portalCustomerConfigured()) {
    // Write an empty state rather than nothing. A missing storageState path is
    // a hard run-level failure in Playwright, which would turn "this fixture is
    // not configured" into a broken run for the specs that correctly skip.
    writeFileSync(PORTAL_CUSTOMER_STATE, JSON.stringify(EMPTY_STORAGE_STATE, null, 2));
    setup.skip(true, 'E2E_PORTAL_CUSTOMER_EMAIL is not set (see Docs/E2E_SMOKE.md)');
    return;
  }

  await signInAsPortalCustomer(page);

  // Prove the session actually works before saving it. Without this a stale or
  // half-established session is saved happily and every dependent spec fails
  // later, somewhere that looks like a product defect rather than a harness one.
  await page.goto('/account/bookings');
  await expect(
    page.getByRole('heading', { name: 'Your bookings' }),
    'the saved session must be able to reach an authenticated page',
  ).toBeVisible();
  expect(new URL(page.url()).pathname, 'sign-in bounced back to the login page').not.toBe('/login');

  await page.context().storageState({ path: PORTAL_CUSTOMER_STATE });
});
