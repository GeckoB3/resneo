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
 * How far forward `pickAvailableSlot` will page looking for a bookable day.
 *
 * Two hops covers the case it exists for, a month running out under the
 * suite's own bookings near its end, without turning "the fixture has no
 * availability" into a silent crawl into next year.
 */
const MAX_MONTH_HOPS = 2;

/**
 * How long a freshly opened month gets to show a bookable day before it counts
 * as having none. It only has to cover a render, or a fetch and a render: the
 * calendar call answers in a few hundred milliseconds, and this is spent only
 * on months that really are empty, at most twice.
 */
const MONTH_SETTLE_MS = 5_000;

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
  // `gridcell`, not `button`. The day cells ARE <button> elements, but
  // `ResourceCalendarMonth` puts them inside grid semantics, which re-maps their implicit
  // role, so `getByRole('button')` never matches and the wait times out on a calendar that
  // is rendering available days perfectly well. The label itself comes from
  // `ResourceCalendarMonth`'s aria-label (`<ymd>, has availability`).
  const availableDay = page.getByRole('gridcell', { name: /has availability/i }).first();
  const monthIsEmpty = page.getByText(/No bookable days this month/i);
  const grid = page.getByRole('grid', { name: /choose a date/i });

  /*
    The calendar opens on the CURRENT month, and this used to wait sixty
    seconds for a bookable day in it and then give up. On 2026-08-31 that came
    true: four booking specs earlier in the same CI run took the last slots on
    the 31st, and by the time `portal-reschedule` ran the month held one
    selectable day with no times left. The page said what to do next, "No
    bookable days this month. Try another month.", and the helper could not
    read it.

    It bites on the last day of any month, hardest late in the day, and it
    heals itself at midnight, which is the dangerous part: a re-run the next
    morning is green and the bug is still there for the 30th.

    So page forward like the customer would. On ARRIVAL the DOM answers
    honestly: the month is loading, `aria-busy` is on and the empty message is
    suppressed under `!loading`, so "a day, or that message" is a real answer.

    After a hop it does not. The heading changes the instant the button is
    clicked, while `availableDates` is still the outgoing month's, and an empty
    set renders that same message whether the month has nothing or has not
    loaded yet. Reading the verdict there called every month empty and burned
    all the hops in two seconds. Asking the calendar's own response instead
    hangs, because the component caches months it has already fetched and a hop
    back into one fires no request at all. Both were caught by running this
    against the real fixture rather than reasoning about it.

    What survives both is a bounded wait for the day cell itself: a month that
    has one shows it well inside the budget whether it was cached or fetched,
    and a month that has none cannot produce one however long it is given.

    Hops are bounded too, because a fixture with no availability at all is a
    fault this suite should report rather than page past.
  */
  await expect(
    availableDay.or(monthIsEmpty).first(),
    'the calendar neither offered a day nor said the month was empty',
  ).toBeVisible({ timeout: 60_000 });

  for (let hop = 0; !(await availableDay.isVisible()); hop++) {
    if (hop === MAX_MONTH_HOPS) {
      throw new Error(
        `No bookable day in ${MAX_MONTH_HOPS + 1} months from the one the calendar opened on. ` +
          'That is a fixture with no availability, not a calendar to page through.',
      );
    }

    const before = await grid.getAttribute('aria-label');
    await page.getByRole('button', { name: 'Next month' }).click();
    await expect(grid).not.toHaveAttribute('aria-label', before ?? '');
    await availableDay.waitFor({ state: 'visible', timeout: MONTH_SETTLE_MS }).catch(() => {});
  }

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
  // The flow gained a "Review your services" step between picking a time and the details
  // form, where a guest can add another treatment to the same visit. Conditional rather
  // than assumed: not every entry point routes through it, and a spec that hard-required
  // it would break the moment one of them stopped.
  const continueToDetails = page.getByRole('button', { name: /continue to details/i });
  if (await continueToDetails.isVisible().catch(() => false)) {
    await continueToDetails.click();
  }

  // The banner is anchored to the bottom of the viewport and overlaps the pay button on
  // shorter pages, so clear it before the form rather than after.
  await declineCookiesIfPresent(page);

  // By placeholder and name, not by label. `DetailsStep` renders two variants and the
  // public one bypasses `FormField`, so its inputs get no `id` and the `<label>` above each
  // field is not associated with it: `getByLabel` matches nothing. The component's own unit
  // tests use `getByPlaceholderText` for the same reason. (The missing association is a real
  // accessibility gap in the public booking form, not just a test problem.)
  await page.getByPlaceholder('First name').fill('E2E');
  await page.getByPlaceholder('Surname').fill('Smoke');
  await page.locator('input[name="email"]').fill(guestEmail);
  // Not the 07700 900xxx drama range: the field parses what is typed against the country
  // selector beside it, and rejects that range as unparseable, reporting "Phone is required"
  // while still displaying the digits. `AppointmentBookingFlow.flow-order.test.tsx:1049`
  // records the same trap and uses this London number, so keep the two in step.
  await page.locator('#details-phone').fill('02071234567');
  // Name the checkbox: the form has two (marketing opt-in and terms), so a bare
  // getByRole('checkbox') is a strict-mode violation, and ticking the wrong one would
  // consent this guest to marketing.
  await page.locator('input[name="acceptTerms"]').check();
  await page.getByRole('button', { name: /continue to payment/i }).click();

  await page.getByRole('button', { name: /pay deposit|pay now/i }).waitFor({ timeout: 30_000 });
  await fillStripePaymentElement(page);

  await page.getByRole('button', { name: /pay deposit|pay now/i }).click();

  // Race the confirmation against the payment error, rather than waiting 60s for a heading
  // that a rejected payment will never render. A silent timeout says only "no confirmation";
  // this says what Stripe actually objected to, which is the difference between diagnosing
  // a CI-only failure from the log and having to reproduce it.
  const confirmed = page.getByRole('heading', { name: /confirmed/i });
  const paymentError = page.getByTestId('payment-error');
  await Promise.race([
    confirmed.waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {}),
    paymentError.waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {}),
  ]);
  if (await paymentError.isVisible().catch(() => false)) {
    throw new Error(`Payment was rejected: ${(await paymentError.textContent())?.trim()}`);
  }

  await expect(confirmed).toBeVisible({ timeout: 60_000 });
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
