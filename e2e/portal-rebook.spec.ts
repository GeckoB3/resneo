import { test, expect } from '@playwright/test';
import { getE2eConfig } from './helpers/env';
import { portalCustomerConfigured } from './helpers/account-session';
import { PORTAL_CUSTOMER_STATE } from './helpers/auth-state';

/**
 * P3-1 acceptance: one tap from a past booking, and the same service and
 * practitioner are already chosen.
 *
 * End to end because the claim spans four things that are only true together:
 * the portal knows the practitioner's SLUG (not just the id it stores), the
 * URL composes documented public parameters, the booking page honours
 * `start=time`, and the flow lands on the times rather than back on the list
 * the customer already chose from. Each half passes its own unit tests while
 * the journey is broken.
 *
 * READ-ONLY. It clicks through to the booking page and stops before anything
 * is booked, so it can share the fixture customer with every other portal spec.
 */
test.describe('P3-1: book again', () => {
  test.use({ storageState: PORTAL_CUSTOMER_STATE });
  test.skip(
    !getE2eConfig().isConfigured || !portalCustomerConfigured(),
    'Set E2E_VENUE_SLUG and E2E_PORTAL_CUSTOMER_EMAIL (see Docs/E2E_SMOKE.md)',
  );

  test('a past booking offers Book again, and it carries both choices over', async ({ page }) => {
    await page.goto('/account/bookings?filter=past');
    await expect(page.getByRole('heading', { name: 'Your bookings', level: 1 })).toBeVisible();

    const rebook = page.getByRole('link', { name: 'Book again' }).first();
    await expect(
      rebook,
      'no Book again on any past booking; the seeded fixture has one with a service and a calendar',
    ).toBeVisible({ timeout: 20_000 });

    /*
      Assert the URL before following it. If this ever regresses to a bare
      `/book/<venue>`, the page after it still looks plausible, and the failure
      would read as "the booking flow is broken" rather than "the link stopped
      carrying anything".
    */
    const href = await rebook.getAttribute('href');
    expect(href, 'Book again must name the practitioner and the service').toMatch(
      /^\/book\/[^/]+\/[^/?]+\?service_id=[^&]+&start=time$/,
    );

    await rebook.click();
    await expect(page).toHaveURL(/\/book\//);

    // Who: the locked-practitioner banner. What: the chosen service. When: the
    // only question left, and the step the customer should be looking at.
    await expect(page.getByText(/Booking with/i)).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByRole('heading', { name: /Date and time/i }),
      'landed somewhere other than the times, so the link saved no taps',
    ).toBeVisible({ timeout: 20_000 });
  });
});
