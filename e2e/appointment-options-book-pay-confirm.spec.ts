import { test, expect } from '@playwright/test';
import { getE2eConfig } from './helpers/env';
import {
  captureBookingId,
  completeDetailsAndPay,
  declineCookiesIfPresent,
  pickAvailableSlot,
} from './helpers/book-appointment';

const e2e = getE2eConfig();

/**
 * The default (service-first) order through a service that has both options and
 * extras. The original smoke books a plain service, so nothing end-to-end
 * covered those two steps, which are exactly the ones the staff-first work
 * rewired.
 */
test.describe('Service-first smoke: options and extras', () => {
  test.skip(!e2e.isConfigured, 'Set E2E_VENUE_SLUG and fixture venue (see Docs/E2E_SMOKE.md)');

  test('books service, option, extras, person, time, and pays', async ({ page }) => {
    const bookingId = captureBookingId(page);
    const guestEmail = `e2e-options+${Date.now()}@reserveni.test`;

    await page.goto(`/book/${e2e.venueSlug}`);
    await declineCookiesIfPresent(page);
    await page.getByRole('button', { name: /book an appointment/i }).click();

    // Service first, with no picker ahead of it.
    await expect(page.getByRole('heading', { name: /select a service/i })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('[data-testid="staff-pick-step"]')).toHaveCount(0);
    await page.getByRole('button', { name: e2e.optionsServiceName }).click();

    await expect(page.getByRole('heading', { name: /choose your option/i })).toBeVisible();
    await page.locator('.appointment-public .space-y-2 button').first().click();

    await expect(page.getByRole('heading', { name: /add extras to your booking/i })).toBeVisible();
    await page.getByRole('button', { name: /^continue$/i }).click();

    // The person comes after the options in this order, not before.
    await expect(page.getByRole('heading', { name: /who would you like to see/i })).toBeVisible();
    await page.locator('.appointment-public .space-y-2 > button').first().click();

    await expect(page.getByRole('heading', { name: /date and time/i })).toBeVisible();
    await pickAvailableSlot(page, 1);
    await page.getByRole('button', { name: /continue to details/i }).click();
    await completeDetailsAndPay(page, guestEmail);

    await expect
      .poll(bookingId, {
        timeout: 15_000,
        message: 'Expected booking_id from POST /api/booking/create',
      })
      .toBeTruthy();
  });

  test('back from the times unwinds through the extras, not past them', async ({ page }) => {
    await page.goto(`/book/${e2e.venueSlug}`);
    await declineCookiesIfPresent(page);
    await page.getByRole('button', { name: /book an appointment/i }).click();
    await page.getByRole('button', { name: e2e.optionsServiceName }).click();

    await expect(page.getByRole('heading', { name: /choose your option/i })).toBeVisible();
    await page.locator('.appointment-public .space-y-2 button').first().click();
    await expect(page.getByRole('heading', { name: /add extras to your booking/i })).toBeVisible();
    await page.getByRole('button', { name: /^continue$/i }).click();
    await expect(page.getByRole('heading', { name: /who would you like to see/i })).toBeVisible();

    await page.getByRole('button', { name: /^back$/i }).click();
    await expect(page.getByRole('heading', { name: /add extras to your booking/i })).toBeVisible();

    await page.getByRole('button', { name: /^back$/i }).click();
    await expect(page.getByRole('heading', { name: /choose your option/i })).toBeVisible();

    await page.getByRole('button', { name: /^back$/i }).click();
    await expect(page.getByRole('heading', { name: /select a service/i })).toBeVisible();
  });
});
