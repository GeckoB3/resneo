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

    // `gridcell`, not `button`: see the note in helpers/book-appointment.ts. With the wrong
    // role this returned 0 and the block below silently skipped picking a day rather than
    // failing, so the spec carried on against an unchanged date.
    const days = page.getByRole('gridcell', { name: /has availability/i });
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

    // Capture what the summary shows BEFORE the change, so the assertion after it proves a
    // refresh happened without hardcoding a time the fixture might not offer.
    const timeTile = page.getByTestId('detail-time');
    const timeBefore = (await timeTile.textContent())?.trim() ?? '';
    expect(timeBefore).toMatch(/^\d{2}:\d{2}$/);

    // The reschedule flow routes through the same "Review your services" step as booking,
    // where a guest can add another treatment before committing. The save button only
    // appears past it. Conditional, for the same reason as in helpers/book-appointment.ts.
    const continueToDetails = page.getByRole('button', { name: /continue to details/i });
    if (await continueToDetails.isVisible().catch(() => false)) {
      await continueToDetails.click();
    }

    const saveChanges = page.getByRole('button', { name: /save appointment changes/i });
    await saveChanges.waitFor({ state: 'visible', timeout: 30_000 });
    await saveChanges.click();

    // Match the confirmation panel's real copy. It reads "Appointment Updated" with
    // "Your changes have been saved." beneath; the older "appointment has been updated"
    // wording no longer appears anywhere, so the assertion failed on a reschedule that
    // had in fact succeeded.
    await expect(
      page.getByRole('heading', { name: /appointment updated/i }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/your changes have been saved/i)).toBeVisible();

    // The summary above the flow must follow the change. It used to keep the old time,
    // because the flow only told its host about a save through the staff-only "Done"
    // footer, so a guest saw "Your changes have been saved" directly beneath the time they
    // had just moved away from.
    await expect(timeTile).not.toHaveText(timeBefore, { timeout: 15_000 });
    await expect(timeTile).toHaveText(/^\d{2}:\d{2}$/);
  });
});
