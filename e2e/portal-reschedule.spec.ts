import { test, expect } from '@playwright/test';
import { getE2eConfig } from './helpers/env';
import { bookAppointmentWithDeposit } from './helpers/book-appointment';
import { getPortalCustomerEmail, portalCustomerConfigured } from './helpers/account-session';
import { PORTAL_CUSTOMER_STATE } from './helpers/auth-state';

/**
 * P2-3 acceptance: a signed-in customer reschedules from the portal.
 *
 * It mirrors `guest-self-reschedule.spec.ts`, which does the same thing from
 * the emailed manage link, and the two together are the point: both surfaces
 * mount the same `GuestBookingDetailView` over the same DTO, so the only thing
 * that differs is WHERE the save goes. That difference is the whole of P2-3
 * and it is invisible in a component test, because both paths render the same
 * button and only the network call underneath tells them apart.
 *
 * **It books its own appointment first, and that is not incidental.**
 * `portal-booking-actions.spec.ts` records why the fixture customer's existing
 * bookings must not be mutated: the list specs assert on them. A reschedule is
 * a mutation, so this spec pays for a fresh booking rather than borrowing one.
 *
 * The booking is made while signed in as the fixture customer and with their
 * email, which is what attaches it to their account: `bookings_account_safe`
 * resolves ownership through `guests.user_id = auth.uid()`, so a booking made
 * under any other address would be invisible in the portal and this spec would
 * fail at the detail page rather than at the thing it is testing.
 */

const e2e = getE2eConfig();

test.describe('P2-3: reschedule from the customer portal', () => {
  test.use({ storageState: PORTAL_CUSTOMER_STATE });
  test.skip(
    !e2e.isConfigured || !portalCustomerConfigured(),
    'Set E2E_VENUE_SLUG and E2E_PORTAL_CUSTOMER_EMAIL (see Docs/E2E_SMOKE.md)',
  );

  test('a signed-in customer moves their own appointment', async ({ page }) => {
    const bookingId = await bookAppointmentWithDeposit(page, {
      venueSlug: e2e.venueSlug,
      serviceName: e2e.serviceName,
      guestEmail: getPortalCustomerEmail(),
      practitionerName: /E2E Calendar/i,
    });

    await page.goto(`/account/bookings/${bookingId}`);

    /*
      Fail HERE, with this message, if the booking did not attach to the
      account. Otherwise the next line's missing button reads as "P2-3 did not
      ship the control", which is a day spent looking in the wrong place.
    */
    await expect(
      page.getByText(e2e.venueName, { exact: false }),
      'the new booking is not visible in the portal, so it did not attach to the fixture customer',
    ).toBeVisible({ timeout: 20_000 });

    const timeTile = page.getByTestId('detail-time');
    const timeBefore = (await timeTile.textContent())?.trim() ?? '';
    expect(timeBefore).toMatch(/^\d{2}:\d{2}$/);

    // The control P2-4 deliberately withheld from this actor until a route
    // existed to answer it.
    await page.getByRole('button', { name: /change appointment/i }).click();
    await page.getByRole('button', { name: e2e.serviceName }).click();

    // `gridcell`, not `button`: see the note in helpers/book-appointment.ts.
    const days = page.getByRole('gridcell', { name: /has availability/i });
    const dayCount = await days.count();
    if (dayCount > 1) {
      await days.nth(1).click();
    } else if (dayCount === 1) {
      await days.first().click();
    }

    const slots = page.locator('.ap-time-slot');
    const slotCount = await slots.count();
    await slots.nth(slotCount > 1 ? 1 : 0).click();

    const continueToDetails = page.getByRole('button', { name: /continue to details/i });
    if (await continueToDetails.isVisible().catch(() => false)) {
      await continueToDetails.click();
    }

    /*
      The assertion that the request went to the ACCOUNT route.

      Without it this spec passes on a portal that quietly posts to
      `/api/confirm`, because a token actor and a session actor render an
      identical page: the only observable difference is the URL underneath.
      That is exactly the bug P2-3 exists to prevent, so it is asserted rather
      than inferred from the page changing.
    */
    const saveRequest = page.waitForRequest(
      (req) =>
        req.method() === 'POST' && /\/api\/account\/bookings\/[^/]+\/reschedule$/.test(req.url()),
      { timeout: 30_000 },
    );

    const saveChanges = page.getByRole('button', { name: /save appointment changes/i });
    await saveChanges.waitFor({ state: 'visible', timeout: 30_000 });
    await saveChanges.click();

    const request = await saveRequest;
    expect(new URL(request.url()).pathname).toBe(`/api/account/bookings/${bookingId}/reschedule`);

    await expect(
      page.getByRole('heading', { name: /appointment updated/i }),
    ).toBeVisible({ timeout: 30_000 });

    // The summary above the flow must follow the change, or a customer reads
    // "your changes have been saved" directly beneath the time they left.
    await expect(timeTile).not.toHaveText(timeBefore, { timeout: 15_000 });
    await expect(timeTile).toHaveText(/^\d{2}:\d{2}$/);
  });
});
