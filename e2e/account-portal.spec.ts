import { test, expect } from '@playwright/test';
import { getE2eConfig } from './helpers/env';
import { portalCustomerConfigured, signInAsPortalCustomer } from './helpers/account-session';

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

test.describe('P0-1 portal smoke: sign in, view bookings, open detail', () => {
  test.skip(
    !e2e.isConfigured || !portalCustomerConfigured(),
    'Set E2E_VENUE_SLUG and E2E_PORTAL_CUSTOMER_EMAIL (see Docs/E2E_SMOKE.md)',
  );

  test('signs in via the real confirm route and lands signed in', async ({ page }) => {
    await signInAsPortalCustomer(page);
    // A guest-only account resolves to /account. If destination logic changes this,
    // the helper has already asserted we are not on an auth failure path; this pins
    // the customer-facing landing so an accidental staff-dashboard resolution fails.
    await expect(page).toHaveURL(/\/account(\/|$|\?)/);
  });

  test('shows bookings from both venues in one list', async ({ page }) => {
    await signInAsPortalCustomer(page);
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
    await signInAsPortalCustomer(page);
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
});
