import { test, expect } from '@playwright/test';
import { getE2eConfig } from './helpers/env';
import { portalCustomerConfigured } from './helpers/account-session';
import { PORTAL_CUSTOMER_STATE } from './helpers/auth-state';

/**
 * P4-2's acceptance, against the real ledger.
 *
 * `booking_payments` has RLS enabled with NO policies, so nothing in the
 * database stops one customer reading another's payments: the only thing that
 * does is the route resolving ownership through `bookings_account_safe` before
 * it touches the ledger as admin. That makes this worth asserting end to end
 * rather than only against a mocked client, because a mock cannot tell you
 * whether the real admin query was actually bounded.
 *
 * The fixture carries a payment row seeded with a staff note and a payment
 * intent id, so the leak assertions have something real to catch.
 */
test.describe('P4-2: payment history', () => {
  test.use({ storageState: PORTAL_CUSTOMER_STATE });
  test.skip(
    !getE2eConfig().isConfigured || !portalCustomerConfigured(),
    'Set E2E_VENUE_SLUG and E2E_PORTAL_CUSTOMER_EMAIL (see Docs/E2E_SMOKE.md)',
  );

  test('a payment recorded by staff is visible to the customer', async ({ page }) => {
    const res = await page.request.get('/api/account/payments');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.payments)).toBe(true);
    expect(
      body.payments.length,
      'no payments for the fixture customer; the seed step should have inserted one',
    ).toBeGreaterThan(0);
  });

  test('the response carries none of the ledger’s internal fields', async ({ page }) => {
    /*
      Asserted on the raw body. The seeded row holds a staff note and a Stripe
      payment intent id, both of which the customer must never see: one is
      written by staff about the customer, the other is ResNeo's plumbing.
    */
    const res = await page.request.get('/api/account/payments');
    const raw = await res.text();
    for (const forbidden of [
      'stripe_payment_intent_id',
      'stripe_connected_account_id',
      'staff_id',
      'metadata',
      'pi_p42_probe',
      'INTERNAL staff note',
      'do-not-leak',
    ]) {
      expect(raw, `${forbidden} reached the customer`).not.toContain(forbidden);
    }
  });

  test('another customer’s booking id returns 404, not an empty list', async ({ page }) => {
    // An empty list would confirm the booking exists. 404 says only that there
    // is no such booking here, which is all a stranger may learn.
    const res = await page.request.get(
      '/api/account/payments?booking_id=00000000-0000-4000-8000-000000000000',
    );
    expect(res.status()).toBe(404);
  });

  test('an anonymous caller is refused', async ({ browser }) => {
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const res = await anon.request.get('/api/account/payments');
      expect(res.status()).toBe(401);
    } finally {
      await anon.close();
    }
  });

  test('the profile page shows the payment, in plain words', async ({ page }) => {
    await page.goto('/account/profile');
    const section = page.locator('section#payments');
    await expect(section).toBeVisible({ timeout: 20_000 });
    // `card_present` is not English (P1-4), and the amount must be money.
    await expect(section).toContainText(/Card in person/i);
    await expect(section).toContainText(/£/);
    await expect(section, 'raw enum leaked into the page').not.toContainText('card_present');
  });
});
