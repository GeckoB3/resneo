import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { getE2eConfig } from './helpers/env';
import { portalCustomerConfigured, getPortalCustomerEmail } from './helpers/account-session';
import { PORTAL_CUSTOMER_STATE } from './helpers/auth-state';

/**
 * P4-4's acceptance: see a waitlist place, and leave it.
 *
 * Worth doing against the real table because ownership here is by EMAIL rather
 * than by a foreign key: `waitlist_entries` has no guest id, since an entry is
 * made before any booking exists and often by somebody with no account. A
 * mocked client cannot tell you that the real filter matched the real column.
 *
 * The stranger's row is seeded alongside the customer's so the cross-user
 * cancel has a REAL row to fail against. A 404 for an id that never existed
 * would prove nothing.
 */
const STRANGER_EMAIL = 'someone-else@resneo-e2e.invalid';

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

test.describe('P4-4: waitlist', () => {
  test.use({ storageState: PORTAL_CUSTOMER_STATE });
  test.skip(
    !getE2eConfig().isConfigured || !portalCustomerConfigured(),
    'Set E2E_VENUE_SLUG and E2E_PORTAL_CUSTOMER_EMAIL (see Docs/E2E_SMOKE.md)',
  );

  test('lists the customer’s own places and nobody else’s', async ({ page }) => {
    const res = await page.request.get('/api/account/waitlist');
    expect(res.status()).toBe(200);
    const { entries } = await res.json();
    expect(Array.isArray(entries)).toBe(true);
    expect(
      entries.length,
      'no waitlist entries; the seed step should have inserted one',
    ).toBeGreaterThan(0);

    // The stranger's row is on the same venue and the same table.
    const db = admin();
    const { data: theirs } = await db
      .from('waitlist_entries')
      .select('id')
      .eq('guest_email', STRANGER_EMAIL);
    const mine = new Set(entries.map((e: { id: string }) => e.id));
    for (const row of theirs ?? []) {
      expect(mine.has(row.id), 'another customer’s waitlist entry was listed').toBe(false);
    }
  });

  test('returns none of the contact details back', async ({ page }) => {
    // The customer already knows their own phone number; every field returned
    // is one more to keep correct, and one more that can leak.
    const raw = await (await page.request.get('/api/account/waitlist')).text();
    for (const field of ['guest_phone', 'guest_email', 'notes']) {
      expect(raw, `${field} was returned`).not.toContain(field);
    }
  });

  test('cancelling ANOTHER customer’s entry returns 404 and changes nothing', async ({ page }) => {
    const db = admin();
    const { data: theirs } = await db
      .from('waitlist_entries')
      .select('id, status')
      .eq('guest_email', STRANGER_EMAIL)
      .limit(1);
    const target = theirs?.[0];
    expect(target, 'the stranger fixture row is missing').toBeTruthy();

    const res = await page.request.delete(`/api/account/waitlist/${target!.id}`);
    expect(res.status(), 'a stranger’s entry was not refused with 404').toBe(404);

    const { data: after } = await db
      .from('waitlist_entries')
      .select('status')
      .eq('id', target!.id)
      .maybeSingle();
    expect(after?.status, 'the stranger’s row was modified').toBe(target!.status);
  });

  test('the customer can leave their own waitlist', async ({ page }) => {
    const db = admin();
    const email = getPortalCustomerEmail().toLowerCase();
    // A fresh row, so the test does not depend on what earlier runs left.
    const { data: venue } = await db
      .from('venues')
      .select('id')
      .eq('slug', process.env.E2E_VENUE_SLUG!)
      .single();
    const { data: made } = await db
      .from('waitlist_entries')
      .insert({
        venue_id: venue!.id,
        waitlist_kind: 'appointment',
        party_size: 1,
        status: 'waiting',
        desired_date: '2026-09-25',
        guest_first_name: 'E2E',
        guest_last_name: 'Portal',
        guest_email: email,
        guest_phone: '+447700900125',
      })
      .select('id')
      .single();

    const res = await page.request.delete(`/api/account/waitlist/${made!.id}`);
    expect(res.status(), await res.text()).toBe(200);

    const { data: after } = await db
      .from('waitlist_entries')
      .select('status')
      .eq('id', made!.id)
      .maybeSingle();
    expect(after?.status).toBe('cancelled');

    // And leaving twice is refused rather than silently succeeding.
    expect((await page.request.delete(`/api/account/waitlist/${made!.id}`)).status()).toBe(409);
  });

  test('an anonymous caller is refused', async ({ browser }) => {
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      expect((await anon.request.get('/api/account/waitlist')).status()).toBe(401);
    } finally {
      await anon.close();
    }
  });

  test('the bookings page shows the waitlist place', async ({ page }) => {
    await page.goto('/account/bookings');
    const section = page.locator('section[aria-labelledby="waitlist-heading"]');
    await expect(section).toBeVisible({ timeout: 20_000 });
    await expect(section).toContainText(/Waiting for/i);
    await expect(section.getByRole('button', { name: /leave waitlist/i }).first()).toBeVisible();
  });
});
