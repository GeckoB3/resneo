import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { getE2eConfig } from './helpers/env';
import { getPortalCustomerEmail, portalCustomerConfigured } from './helpers/account-session';
import { EMPTY_STORAGE_STATE } from './helpers/auth-state';
import { issuePortalToken } from '../src/lib/auth/portal-token';

/**
 * P3-4c acceptance: one click from a booking email reaches the signed-in portal.
 *
 * This is the only place the whole chain is exercised: token, `generateLink`,
 * `verifyOtp`, the session cookies landing on the response, and the redirect.
 * The route's unit tests mock every one of those, so they prove the decisions
 * and nothing about whether a browser ends up signed in.
 *
 * It starts from an EMPTY storage state and asserts it is signed out first,
 * because a spec that inherited a session would pass without the link doing
 * anything at all.
 *
 * It mints its own token and deletes it afterwards. The token is a real
 * credential for the fixture customer, so it must not be left behind.
 */
const e2e = getE2eConfig();

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function fixtureUserId(): Promise<string> {
  // generateLink returns the user, which saves paging listUsers to find them.
  const { data, error } = await admin().auth.admin.generateLink({
    type: 'magiclink',
    email: getPortalCustomerEmail(),
  });
  if (error || !data?.user?.id) throw new Error(`fixture customer not found: ${error?.message}`);
  return data.user.id;
}

test.describe('P3-4c one-click entry', () => {
  test.use({ storageState: EMPTY_STORAGE_STATE });
  test.skip(!e2e.isConfigured || !portalCustomerConfigured(), 'not configured');

  test('a signed-out browser lands signed in', async ({ page }) => {
    const db = admin();
    const userId = await fixtureUserId();
    const token = await issuePortalToken(db, { userId });
    expect(token, 'token was not issued').toBeTruthy();

    try {
      // Prove we start signed OUT.
      await page.goto('/account/bookings');
      await expect(page).toHaveURL(/\/login/);

      await page.goto(`/auth/portal?t=${encodeURIComponent(token!)}`);
      await expect(page).toHaveURL(/\/account\/bookings/, { timeout: 20_000 });
      await expect(page.getByRole('heading', { name: 'Your bookings' })).toBeVisible();


      /*
        And it is REUSABLE. Corporate link scanners fetch every URL in inbound
        mail before the human sees it, so a token consumed on first fetch would
        hand the customer a dead link. Cookies are cleared first, or the second
        visit would succeed on the session rather than on the token.
      */
      await page.goto('/auth/signed-out').catch(() => {});
      await page.context().clearCookies();
      await page.goto(`/auth/portal?t=${encodeURIComponent(token!)}`);
      await expect(page).toHaveURL(/\/account\/bookings/, { timeout: 20_000 });

    } finally {
      await db.from('account_portal_tokens').delete().eq('user_id', userId);
    }
  });

  test('an unknown token lands on a usable sign-in form', async ({ page }) => {
    await page.goto('/auth/portal?t=not-a-real-token&email=someone%40example.test');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText(/that link has expired/i)).toBeVisible();
    const email = page.getByRole('textbox', { name: /email/i }).first();
    await expect(email).toHaveValue('someone@example.test');

  });
});
