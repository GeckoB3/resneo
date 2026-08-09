import { expect, type Page } from '@playwright/test';
import { fillStripePaymentElement } from './stripe-payment';

export interface BookAppointmentOptions {
  venueSlug: string;
  serviceName: string;
  guestEmail: string;
  practitionerName?: RegExp | string;
}

/**
 * Watches for the booking id the create call returns, so a spec can assert the
 * booking really was written rather than only that the screen changed.
 */
export function captureBookingId(page: Page): () => string | undefined {
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
  return () => bookingId;
}

/** Dismisses the cookie banner when it is up, declining anything non-essential. */
export async function declineCookiesIfPresent(page: Page): Promise<void> {
  const decline = page.getByRole('button', { name: /^decline$/i });
  if (await decline.isVisible().catch(() => false)) {
    await decline.click();
  }
}

/**
 * Picks the first day the calendar marks bookable, then a free time on it.
 *
 * `preferIndex` exists because the fixtures are shared: runs on different
 * branches can hit the same database at the same time, and two of them racing
 * for the same first slot is the likeliest way this suite flakes. Specs that
 * do not care which time they get take a later one. Falls back to the last
 * available time when the day is thinner than that.
 */
export async function pickAvailableSlot(page: Page, preferIndex = 0): Promise<void> {
  const availableDay = page.getByRole('button', { name: /has availability/i }).first();
  await availableDay.waitFor({ state: 'visible', timeout: 60_000 });
  await availableDay.click();

  const slots = page.locator('.ap-time-slot:not(.ap-time-slot-selected)');
  await slots.first().waitFor({ state: 'visible', timeout: 30_000 });
  const count = await slots.count();
  await slots.nth(Math.min(preferIndex, count - 1)).click();
}

/**
 * Fills the guest details form and pays the deposit, ending on the confirmation
 * screen. Shared by every booking spec so they exercise one checkout path.
 */
export async function completeDetailsAndPay(page: Page, guestEmail: string): Promise<void> {
  await page.getByLabel('First name').fill('E2E');
  await page.getByLabel('Surname').fill('Smoke');
  await page.getByLabel('Email').fill(guestEmail);
  await page.locator('#details-phone').fill('07700900123');
  const terms = page.getByRole('checkbox');
  await terms.check();
  await page.getByRole('button', { name: /continue to payment/i }).click();

  await page.getByRole('button', { name: /pay deposit|pay now/i }).waitFor({ timeout: 30_000 });
  await fillStripePaymentElement(page);

  await page.getByRole('button', { name: /pay deposit|pay now/i }).click();

  await expect(page.getByRole('heading', { name: /confirmed/i })).toBeVisible({ timeout: 60_000 });
}

/**
 * Public book → pay deposit → confirmed. Returns booking id captured from POST /api/booking/create.
 */
export async function bookAppointmentWithDeposit(
  page: Page,
  opts: BookAppointmentOptions,
): Promise<string> {
  const bookingId = captureBookingId(page);

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

  await pickAvailableSlot(page);
  await completeDetailsAndPay(page, opts.guestEmail);

  await expect
    .poll(bookingId, { timeout: 15_000, message: 'Expected booking_id from POST /api/booking/create' })
    .toBeTruthy();

  return bookingId()!;
}
