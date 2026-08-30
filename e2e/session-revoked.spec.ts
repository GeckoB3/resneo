import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { issuePortalToken } from '../src/lib/auth/portal-token';
import { getE2eConfig } from './helpers/env';

/**
 * A REVOKED session must reach the sign-in form, not bounce forever.
 *
 * Two halves of the codebase judged the same session differently.
 * `resolveAuthIdentity` prefers `getClaims()`, which verifies the JWT LOCALLY
 * and therefore cannot see revocation, so middleware kept treating a
 * signed-out-elsewhere session as live until its access token expired.
 * `/account`'s layout uses `getUser()`, was told there was no user, and
 * redirected to `/login`, which middleware bounced straight back. Neither side
 * was wrong on its own terms and the customer got ERR_TOO_MANY_REDIRECTS.
 *
 * **Walks the redirect chain by hand rather than navigating.** A browser
 * `goto` into a redirect loop hangs until the test times out, which reports
 * "timeout" and tells you nothing; following one hop at a time names the two
 * routes that disagree and fails in a second.
 *
 * Uses a THROWAWAY address and deletes it afterwards. Revoking sessions is the
 * point of this test, and doing it to the shared fixture customer would break
 * every other portal spec in the run.
 */
test.skip(!getE2eConfig().isConfigured, 'Set E2E_VENUE_SLUG (see Docs/E2E_SMOKE.md)');

test('a revoked session reaches the sign-in form rather than looping', async ({ page, request }) => {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `portal-loop-${process.pid}-${process.env.E2E_RUN_STAMP ?? 'local'}@example.test`;
  let userId: string | null = null;

  try {
    /*
      1. Sign a browser in, so it holds real unexpired cookies.

      This address has NO auth user, which is also the case P3-4c is for and
      the one that used to fail: `generateLink({type:'magiclink'})` issues a
      `signup` link for a new address, and verifying it as a magiclink 403s.
    */
    await page.goto(`/auth/portal?t=${(await issuePortalToken(admin, { email }))!}`);
    await expect(page, 'one-click entry failed for an address with no account').toHaveURL(/\/account/);

    /*
      2. Revoke every session for the address WITHOUT touching the browser's
         cookies: exactly the state a customer is in after signing out on
         another device, or after a password change.
    */
    const second = (await issuePortalToken(admin, { email }))!;
    const ex = await request.post('/api/v1/auth/portal-token/exchange', { data: { token: second } });
    expect(ex.status(), await ex.text()).toBe(200);
    const { access_token } = await ex.json();
    userId = JSON.parse(Buffer.from(access_token.split('.')[1], 'base64').toString()).sub;
    expect((await admin.auth.admin.signOut(access_token, 'global')).error).toBeNull();

    // 3. Follow the chain. It must SETTLE, and settle on the sign-in form.
    const api = page.context().request;
    const hops: string[] = [];
    let at = '/account';
    let settled = false;
    for (let i = 0; i < 6; i += 1) {
      const res = await api.get(at, { maxRedirects: 0 });
      hops.push(`${at} -> ${res.status()}`);
      const location = res.headers()['location'];
      if (!location) {
        settled = true;
        break;
      }
      const next = location.startsWith('http') ? new URL(location) : new URL(location, 'http://x');
      at = next.pathname + next.search;
    }
    expect(settled, `redirect loop: ${hops.join(' | ')}`).toBe(true);
    expect(at, `settled somewhere other than sign-in: ${hops.join(' | ')}`).toMatch(/^\/login/);
  } finally {
    await admin.from('account_portal_tokens').delete().eq('email', email.toLowerCase());
    if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
  }
});
