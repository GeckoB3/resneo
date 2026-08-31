import { test, expect } from '@playwright/test';
import { getE2eConfig } from './helpers/env';
import { portalCustomerConfigured } from './helpers/account-session';
import { PORTAL_CUSTOMER_STATE } from './helpers/auth-state';

/**
 * P4-5's acceptance, against a real account.
 *
 * The leak assertions matter more here than anywhere else in the portal: an
 * export is the one place a projection gets rewritten "just for the file", and
 * the fixture's ledger row deliberately carries a staff note and Stripe ids so
 * there is something real to catch. A clean payload built from clean data
 * would prove nothing.
 */
test.describe('P4-5: data export', () => {
  test.use({ storageState: PORTAL_CUSTOMER_STATE });
  test.skip(
    !getE2eConfig().isConfigured || !portalCustomerConfigured(),
    'Set E2E_VENUE_SLUG and E2E_PORTAL_CUSTOMER_EMAIL (see Docs/E2E_SMOKE.md)',
  );

  test('downloads a complete, self-describing document', async ({ page }) => {
    const res = await page.request.get('/api/account/export');
    expect(res.status(), await res.text()).toBe(200);
    expect(res.headers()['content-disposition']).toMatch(/^attachment; filename=/);

    const doc = await res.json();
    expect(doc.about.exported_at).toBeTruthy();
    expect(doc.account.email).toBeTruthy();
    expect(doc.profile, 'the profile section is missing').toBeTruthy();
    expect(Array.isArray(doc.bookings)).toBe(true);
    expect(doc.bookings.length, 'the fixture customer has bookings').toBeGreaterThan(0);
    expect(doc.payments.length, 'the fixture customer has a payment').toBeGreaterThan(0);
    expect(doc.truncated.bookings).toBe(false);
  });

  test('contains no field the portal does not already show', async ({ page }) => {
    const raw = await (await page.request.get('/api/account/export')).text();
    for (const forbidden of [
      // The payment ledger's internals, seeded with real values.
      'stripe_payment_intent_id',
      'stripe_connected_account_id',
      'staff_id',
      'INTERNAL staff note',
      'do-not-leak',
      // Venue-private guest data the account-safe view excludes.
      'internal_notes',
    ]) {
      expect(raw, `${forbidden} escaped into the export`).not.toContain(forbidden);
    }
  });

  test('an anonymous caller is refused', async ({ browser }) => {
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      expect((await anon.request.get('/api/account/export')).status()).toBe(401);
    } finally {
      await anon.close();
    }
  });

  test('the profile offers the download', async ({ page }) => {
    await page.goto('/account/profile');
    const link = page.getByRole('link', { name: /download my data/i });
    await expect(link).toBeVisible({ timeout: 20_000 });
    await expect(link).toHaveAttribute('href', '/api/account/export');
  });
});
