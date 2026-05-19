import { test, expect } from '@playwright/test';
import { getE2eConfig } from './helpers/env';
import { bookAppointmentWithDeposit } from './helpers/book-appointment';
import { buildManagePagePath } from './helpers/manage-link';

const e2e = getE2eConfig();

test.describe('P1a.2 guest self-reschedule smoke', () => {
  test.skip(
    !e2e.isConfigured || !e2e.paymentTokenSecret,
    'Set E2E_VENUE_SLUG and PAYMENT_TOKEN_SECRET (see Docs/E2E_SMOKE.md)',
  );

  test('guest reschedules appointment from manage link', async ({ page }) => {
    const guestEmail = `e2e-reschedule+${Date.now()}@reserveni.test`;

    const bookingId = await bookAppointmentWithDeposit(page, {
      venueSlug: e2e.venueSlug,
      serviceName: e2e.serviceName,
      guestEmail,
      practitionerName: /E2E Calendar/i,
    });

    const managePath = buildManagePagePath(bookingId, e2e.paymentTokenSecret);
    await page.goto(managePath);

    await expect(page.getByText(e2e.venueName, { exact: false })).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: /change appointment/i }).click();

    await page.getByRole('button', { name: e2e.serviceName }).click();

    const days = page.getByRole('button', { name: /has availability/i });
    const dayCount = await days.count();
    if (dayCount > 1) {
      await days.nth(1).click();
    } else if (dayCount === 1) {
      await days.first().click();
    }

    const slots = page.locator('.ap-time-slot');
    const slotCount = await slots.count();
    const slotIndex = slotCount > 1 ? 1 : 0;
    await slots.nth(slotIndex).click();

    const saveChanges = page.getByRole('button', { name: /save appointment changes/i });
    await saveChanges.waitFor({ state: 'visible', timeout: 30_000 });
    await saveChanges.click();

    await expect(page.getByText(/appointment has been updated/i)).toBeVisible({ timeout: 30_000 });
  });
});
