import { test, expect } from '@playwright/test';
import { getE2eConfig, getStaffFirstE2eConfig } from './helpers/env';
import {
  captureBookingId,
  completeDetailsAndPay,
  declineCookiesIfPresent,
  pickAvailableSlot,
} from './helpers/book-appointment';

const e2e = getE2eConfig();
const staffFirst = getStaffFirstE2eConfig();

/** The picker's own hook: its heading is shared with the calendar step. */
const STAFF_PICK = '[data-testid="staff-pick-step"]';

test.describe('Staff-first smoke: choose a person, then their services', () => {
  test.skip(
    !staffFirst.isConfigured,
    'Set E2E_STAFF_FIRST_VENUE_SLUG and seed the fixture (see Docs/E2E_SMOKE.md)',
  );

  test.beforeEach(async ({ page }) => {
    await page.goto(`/book/${staffFirst.venueSlug}`);
    await declineCookiesIfPresent(page);
    await page.getByRole('button', { name: /book an appointment/i }).click();
    await page.locator(STAFF_PICK).waitFor({ state: 'visible', timeout: 30_000 });
  });

  test('asks who before what, and lists only that person at their own price', async ({ page }) => {
    // Nothing about services until a person is chosen.
    await expect(page.getByRole('heading', { name: /select a service/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: staffFirst.calendarA })).toBeVisible();
    await expect(page.getByRole('button', { name: staffFirst.calendarB })).toBeVisible();

    await page.getByRole('button', { name: staffFirst.calendarA }).click();
    await expect(page.getByRole('heading', { name: /select a service/i })).toBeVisible();

    // The other calendar's exclusive service is not this person's to sell.
    await expect(
      page.getByRole('button', { name: staffFirst.exclusiveServiceName }),
    ).toHaveCount(0);

    // Their own price, exactly, rather than a "from" folded across the team.
    const shared = page.getByRole('button', { name: staffFirst.sharedServiceName });
    await expect(shared).toBeVisible();
    await expect(shared).toContainText('£30.00');
    await expect(shared).not.toContainText('From');
  });

  test('offers the other person their own service', async ({ page }) => {
    await page.getByRole('button', { name: staffFirst.calendarB }).click();
    await expect(
      page.getByRole('button', { name: staffFirst.exclusiveServiceName }),
    ).toBeVisible();
  });

  test('back from the service list returns to the picker', async ({ page }) => {
    await page.getByRole('button', { name: staffFirst.calendarA }).click();
    await expect(page.getByRole('heading', { name: /select a service/i })).toBeVisible();

    await page.getByRole('button', { name: /^back$/i }).click();

    await expect(page.locator(STAFF_PICK)).toBeVisible();
    await expect(page.getByRole('button', { name: staffFirst.calendarB })).toBeVisible();
  });

  test('books a service with options and extras, pays, and lands on the confirmation', async ({
    page,
  }) => {
    const bookingId = captureBookingId(page);
    const guestEmail = `e2e-staff-first+${Date.now()}@reserveni.test`;

    await page.getByRole('button', { name: staffFirst.calendarA }).click();
    await expect(page.getByRole('heading', { name: /select a service/i })).toBeVisible();
    await page.getByRole('button', { name: staffFirst.optionsServiceName }).click();

    // Options then extras, in that order, and no calendar step in between.
    await expect(page.getByRole('heading', { name: /choose your option/i })).toBeVisible();
    await page.locator('.appointment-public .space-y-2 button').first().click();
    await expect(page.getByRole('heading', { name: /add extras to your booking/i })).toBeVisible();
    await page.getByRole('button', { name: /^continue$/i }).click();

    await expect(page.getByRole('heading', { name: /date and time/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /who would you like to see/i })).toHaveCount(0);

    // A later time than the default fixture takes, so parallel runs on shared
    // fixtures do not fight over the same slot.
    await pickAvailableSlot(page, 2);
    await page.getByRole('button', { name: /continue to details/i }).click();
    await completeDetailsAndPay(page, guestEmail);

    await expect
      .poll(bookingId, {
        timeout: 15_000,
        message: 'Expected booking_id from POST /api/booking/create',
      })
      .toBeTruthy();
  });
});

test.describe('Staff-first smoke: surfaces that keep the default order', () => {
  test.skip(
    !staffFirst.isConfigured || !e2e.isConfigured,
    'Needs both fixture venues (see Docs/E2E_SMOKE.md)',
  );

  test('a per-practitioner link still opens on the services', async ({ page }) => {
    await page.goto(`/book/${staffFirst.venueSlug}/e2e-alex`);
    await declineCookiesIfPresent(page);

    await expect(page.getByRole('heading', { name: /select a service/i })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator(STAFF_PICK)).toHaveCount(0);
  });

  test('the default fixture is unaffected by the other venue\'s setting', async ({ page }) => {
    await page.goto(`/book/${e2e.venueSlug}`);
    await declineCookiesIfPresent(page);
    await page.getByRole('button', { name: /book an appointment/i }).click();

    await expect(page.getByRole('heading', { name: /select a service/i })).toBeVisible();
    await expect(page.locator(STAFF_PICK)).toHaveCount(0);
  });
});
