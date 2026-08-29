import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { issuePortalToken } from '../src/lib/auth/portal-token';
import { getPortalCustomerEmail } from './helpers/account-session';

/**
 * P3-4i acceptance: a client holding ONLY a Bearer token can complete the whole
 * journey (AD7, §5D).
 *
 * Written as one test rather than four because the point is the CHAIN. Each
 * step's unit tests mock the step before it, so nothing else proves that a
 * session minted by the exchange is one PostgREST will accept, that the token
 * it returns is the same one `/api/v1/me` authenticates, or that logging out
 * actually revokes it.
 *
 * The last assertion is the one worth keeping. Until P0-12, `signOut` on a
 * Bearer request revoked nothing and returned ok; a 401 after logout is the
 * only way to tell a real revocation from that silence.
 *
 * No cookies are used anywhere here, deliberately: `request` is Playwright's
 * bare HTTP client, not the browser context.
 */
test('a client with only a Bearer token can enter, read and sign out', async ({ request }) => {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = getPortalCustomerEmail();
  const token = (await issuePortalToken(admin, { email }))!;
  expect(token).toBeTruthy();

  try {
    // 1. EXCHANGE: token in, session out. No cookies anywhere.
    const ex = await request.post('/api/v1/auth/portal-token/exchange', { data: { token } });
    expect(ex.status(), await ex.text()).toBe(200);
    const session = await ex.json();
    expect(session.access_token).toBeTruthy();
    expect(session.refresh_token, 'setSession rejects a session with no refresh token').toBeTruthy();
    console.log('--- EXCHANGE OK, expires_at', session.expires_at);

    const bearer = { Authorization: `Bearer ${session.access_token}` };

    // 2. LINK guest rows, the way the app does: PostgREST directly.
    const asUser = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: bearer },
    });
    const { error: claimErr } = await asUser.rpc('claim_user_account');
    console.log('--- CLAIM:', claimErr ? `FAILED ${claimErr.message}` : 'OK');
    expect(claimErr).toBeNull();

    // 3. READ its bookings over Bearer.
    const list = await request.get('/api/v1/me/bookings', { headers: bearer });
    console.log('--- BOOKINGS:', list.status());
    expect(list.status()).toBe(200);

    // 4. SIGN OUT for real, then prove the token is dead.
    const out = await request.post('/api/v1/auth/logout', { headers: bearer, data: { scope: 'global' } });
    console.log('--- LOGOUT:', out.status());
    expect(out.status()).toBe(200);

    const after = await request.get('/api/v1/me/bookings', { headers: bearer });
    console.log('--- AFTER LOGOUT:', after.status(), '(401 means revocation was real)');
    expect(after.status()).toBe(401);
  } finally {
    await admin.from('account_portal_tokens').delete().eq('email', email.toLowerCase());
  }
});
