import { createClient } from '@supabase/supabase-js';
import type { Page } from '@playwright/test';

/**
 * Signs a Playwright page in as the portal fixture customer (P0-1a).
 *
 * Mints a magic-link token server-side with `admin.auth.admin.generateLink` and
 * visits `GET /auth/confirm?token_hash=...&type=magiclink`: the same path a real
 * customer's email link takes, so every sign-in also exercises `verifyOtp`,
 * `claim_user_account()` and the post-login destination logic rather than a
 * test-only backdoor. No inbox is involved (generateLink returns the token without
 * sending mail), which is what makes this workable against the hosted staging
 * project where inbucket does not exist.
 *
 * The customer comes from `scripts/seed-e2e-portal-customer.mjs`. Specs should
 * skip when `portalCustomerConfigured()` is false, mirroring how the venue specs
 * gate on E2E_VENUE_SLUG.
 */

export function getPortalCustomerEmail(): string {
  return process.env.E2E_PORTAL_CUSTOMER_EMAIL?.trim() ?? '';
}

export function portalCustomerConfigured(): boolean {
  return Boolean(getPortalCustomerEmail());
}

/**
 * Server-side: mint a fresh token_hash for the fixture customer. Each call issues a
 * new single-use token, so two specs signing in never race over one link.
 */
async function mintSignInTokenHash(email: string): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !secret) {
    throw new Error('[account-session] NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY required');
  }
  const admin = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) {
    throw new Error(`[account-session] generateLink failed for ${email}: ${error.message}`);
  }
  const tokenHash = data.properties?.hashed_token;
  if (!tokenHash) {
    throw new Error('[account-session] generateLink returned no hashed_token');
  }
  return tokenHash;
}

/**
 * Sign the page in as the fixture customer and land wherever the real post-login
 * routing sends them (a guest-only account resolves to /account). Throws if the
 * exchange bounces to an auth failure path, rather than letting a spec proceed
 * signed out and fail somewhere misleading.
 */
export async function signInAsPortalCustomer(page: Page): Promise<void> {
  const email = getPortalCustomerEmail();
  if (!email) {
    throw new Error('[account-session] E2E_PORTAL_CUSTOMER_EMAIL is not set');
  }
  const tokenHash = await mintSignInTokenHash(email);

  await page.goto(
    `/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=magiclink`,
    { waitUntil: 'domcontentloaded' },
  );
  // /auth/confirm 303s; wait for the destination document rather than a fixed path,
  // since resolvePostLoginDestination owns where a customer lands.
  await page.waitForLoadState('domcontentloaded');

  const landed = new URL(page.url()).pathname;
  if (landed.startsWith('/auth/') || landed === '/login') {
    throw new Error(
      `[account-session] sign-in did not establish a session: landed on ${landed}. ` +
        'Has scripts/seed-e2e-portal-customer.mjs been run against this project?',
    );
  }
}
