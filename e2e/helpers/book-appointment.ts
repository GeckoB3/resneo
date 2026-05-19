import { expect, type Page } from '@playwright/test';
import { fillStripePaymentElement } from './stripe-payment';

export interface BookAppointmentOptions {
  venueSlug: string;
  serviceName: string;
  guestEmail: string;
  practitionerName?: RegExp | string;
}

/**
 * Public book → pay deposit → confirmed. Returns booking id captured from POST /api/booking/create.
 */
export async function bookAppointmentWithDeposit(
  page: Page,
  opts: BookAppointmentOptions,
): Promise<string> {
  let bookingId: string | undefined;

  page.on('response', async (response) => {
    if (
      response.url().includes('/api/booking/create') &&
      response.request().method() === 'POST' &&
      response.ok()
    ) {
      try {
        const body = (await response.json()) as { booking_id?: string };
        if (body.booking_id) bookingId = body.booking_id;
      } catch {
        /* ignore */
      }
    }
  });

  await page.goto(`/book/${opts.venueSlug}`);

  const bookAppointment = page.getByRole('button', { name: /book an appointment/i });
  if (await bookAppointment.isVisible().catch(() => false)) {
    await bookAppointment.click();
  }

  await page.getByRole('button', { name: opts.serviceName }).click();

  if (await page.getByRole('heading', { name: /who would you like to see/i }).isVisible().catch(() => false)) {
    const prac =
      typeof opts.practitionerName === 'string'
        ? page.getByRole('button', { name: opts.practitionerName })
        : page.getByRole('button', { name: opts.practitionerName ?? /E2E Calendar/i });
    if (await prac.isVisible().catch(() => false)) {
      await prac.click();
    } else {
      await page.locator('.appointment-public .space-y-2 > button').first().click();
    }
  }

  const availableDay = page.getByRole('button', { name: /has availability/i }).first();
  await availableDay.waitFor({ state: 'visible', timeout: 60_000 });
  await availableDay.click();

  const timeSlot = page.locator('.ap-time-slot:not(.ap-time-slot-selected)').first();
  await timeSlot.waitFor({ state: 'visible', timeout: 30_000 });
  await timeSlot.click();

  await page.getByLabel('First name').fill('E2E');
  await page.getByLabel('Surname').fill('Smoke');
  await page.getByLabel('Email').fill(opts.guestEmail);
  await page.locator('#details-phone').fill('07700900123');
  const terms = page.getByRole('checkbox');
  await terms.check();
  await page.getByRole('button', { name: /continue to payment/i }).click();

  await page.getByRole('button', { name: /pay deposit|pay now/i }).waitFor({ timeout: 30_000 });
  await fillStripePaymentElement(page);

  const payButton = page.getByRole('button', { name: /pay deposit|pay now/i });
  await payButton.click();

  await expect(page.getByRole('heading', { name: /confirmed/i })).toBeVisible({ timeout: 60_000 });

  await expect
    .poll(() => bookingId, { timeout: 15_000, message: 'Expected booking_id from POST /api/booking/create' })
    .toBeTruthy();

  return bookingId!;
}
