import { test, expect } from '@playwright/test';
import { getE2eConfig } from './helpers/env';
import { buildConfirmPagePath } from './helpers/manage-link';
import { bookAppointmentWithDeposit } from './helpers/book-appointment';

const e2e = getE2eConfig();

test.describe('P0.4 appointment smoke: book → pay → confirm link', () => {
  test.skip(!e2e.isConfigured, 'Set E2E_VENUE_SLUG and fixture venue (see Docs/E2E_SMOKE.md)');

  test('guest books with deposit, pays, and opens confirm link', async ({ page }) => {
    const guestEmail = `e2e-smoke+${Date.now()}@reserveni.test`;

    const bookingId = await bookAppointmentWithDeposit(page, {
      venueSlug: e2e.venueSlug,
      serviceName: e2e.serviceName,
      guestEmail,
      practitionerName: /E2E Calendar/i,
    });

    if (!e2e.paymentTokenSecret) {
      throw new Error('PAYMENT_TOKEN_SECRET is required for confirm link step');
    }

    const confirmPath = buildConfirmPagePath(bookingId, e2e.paymentTokenSecret);
    await page.goto(confirmPath);

    await expect(page.getByRole('heading', { name: e2e.venueName })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(e2e.serviceName, { exact: false })).toBeVisible();
  });
});
