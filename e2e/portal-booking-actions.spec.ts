import { test, expect } from '@playwright/test';
import { getE2eConfig } from './helpers/env';
import { portalCustomerConfigured } from './helpers/account-session';
import { EMPTY_STORAGE_STATE, PORTAL_CUSTOMER_STATE } from './helpers/auth-state';

/**
 * P2-1 against the real database (AD1, AD8).
 *
 * `actions.test.ts` proves the adapter with a recording double. What it cannot
 * prove is the half that lives in Postgres: `bookings_account_safe` is a view
 * whose own WHERE clause resolves `auth.uid()`, and P0-6 records that hosted
 * Supabase grants `anon` and `authenticated` OUTSIDE the migration history. A
 * mocked ownership read passes whether or not the caller can actually select
 * from that view on staging.
 *
 * **Nothing here mutates a booking.** Cancel, reschedule and confirm all change
 * state, and the fixture venue's bookings are shared with the specs that assert
 * on the list. The refusal paths are safe to exercise for real precisely
 * because they refuse, and they are the ones carrying the security property.
 */

const e2e = getE2eConfig();
const SKIP_REASON = 'Set E2E_VENUE_SLUG and E2E_PORTAL_CUSTOMER_EMAIL (see Docs/E2E_SMOKE.md)';

/** A well-formed id that belongs to nobody. */
const ABSENT_ID = '99999999-9999-4999-8999-999999999999';

const ACTIONS = [
  { path: 'cancel', method: 'POST' as const },
  { path: 'confirm', method: 'POST' as const },
  { path: 'reschedule', method: 'POST' as const },
  { path: 'reschedule-options', method: 'GET' as const },
];

test.describe('P2-1: session-authenticated booking actions', () => {
  test.use({ storageState: PORTAL_CUSTOMER_STATE });
  test.skip(!e2e.isConfigured || !portalCustomerConfigured(), SKIP_REASON);

  /** One of the signed-in customer's real bookings. */
  async function ownBookingId(page: import('@playwright/test').Page): Promise<string> {
    await page.goto('/account/bookings');
    await page.getByRole('link', { name: 'Details' }).first().click();
    await expect(page).toHaveURL(/\/account\/bookings\/[0-9a-f-]{36}/);
    return new URL(page.url()).pathname.split('/').pop()!;
  }

  test('reschedule-options answers for a real booking, through the real view', async ({ page }) => {
    const id = await ownBookingId(page);

    const res = await page.request.get(`/api/account/bookings/${id}/reschedule-options`);
    expect(res.status(), 'the account-safe view refused the caller its own booking').toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.booking_id).toBe(id);
    expect(typeof body.can_reschedule).toBe('boolean');
    expect(body.venue).toBeTruthy();
    // The fixture is an appointment, so the venue's own timezone should have
    // come back rather than the fallback that a failed venue read would leave.
    expect(String((body.venue as Record<string, unknown>).timezone)).toMatch(/\//);
    expect(res.headers()['cache-control']).toBe('no-store');
  });

  test('every action returns 404 for a booking that is not the caller\'s', async ({ page }) => {
    // The security property, against real RLS and real grants. A 403 here would
    // confirm to anyone walking ids that the id is real.
    for (const { path, method } of ACTIONS) {
      const url = `/api/account/bookings/${ABSENT_ID}/${path}`;
      const res =
        method === 'GET'
          ? await page.request.get(url)
          : await page.request.post(url, { data: {} });

      expect(res.status(), `${path} answered ${res.status()}`).toBe(404);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.code, path).toBe('NOT_FOUND');
    }
  });

  test('the v1 aliases are the same handlers, not a second implementation', async ({ page }) => {
    const id = await ownBookingId(page);

    const account = await page.request.get(`/api/account/bookings/${id}/reschedule-options`);
    const v1 = await page.request.get(`/api/v1/me/bookings/${id}/reschedule-options`);

    expect(v1.status()).toBe(account.status());
    expect(await v1.json()).toEqual(await account.json());
  });

  test('an anonymous caller gets 401, not a redirect to the login page', async ({ browser }) => {
    /*
      A context with NO session, which takes saying so explicitly.

      `browser.newContext()` INHERITS this describe's `use` options, including
      `storageState: PORTAL_CUSTOMER_STATE`, so the first version of this test
      was signed in without meaning to be. It got a 404 and read like the API
      returning the wrong status to an anonymous caller; it was the service
      correctly telling an authenticated customer that no such booking is
      theirs. `EMPTY_STORAGE_STATE` exists for exactly this.

      The assertion on the BODY is what keeps the two 404s apart. Status alone
      could not tell "signed out" from "not yours" if this ever regresses.
    */
    const context = await browser.newContext({
      baseURL: e2e.baseURL,
      // Spread rather than passed straight through: the shared constant is
      // `as const`, so its arrays are readonly and Playwright's option type
      // wants mutable ones.
      storageState: { cookies: [...EMPTY_STORAGE_STATE.cookies], origins: [...EMPTY_STORAGE_STATE.origins] },
    });
    try {
      const res = await context.request.get(
        `${e2e.baseURL}/api/account/bookings/${ABSENT_ID}/reschedule-options`,
        { maxRedirects: 0 },
      );
      const body = (await res.json()) as Record<string, unknown>;
      expect(res.status(), `answered ${res.status()} with ${JSON.stringify(body)}`).toBe(401);
      expect(body.error).toBe('Unauthorised');
      expect(body.code).toBe('UNAUTHENTICATED');
    } finally {
      await context.close();
    }
  });
});
