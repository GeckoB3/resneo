import { test, expect } from '@playwright/test';

/**
 * The tripwire for P0-1d's central decision: `storageState` is opted into per
 * file, never set on a project.
 *
 * Most of this suite is the PUBLIC booking flow. If someone moves the saved
 * session onto the `chromium` project's `use` block, every one of those specs
 * silently starts running as a signed-in customer, which is a different code
 * path: prefilled guest details, a different route through the form, and an
 * account association on the booking. They would keep passing while testing
 * something nobody wrote them to test.
 *
 * That failure is invisible without an assertion, because a signed-in run of a
 * public spec looks exactly like a signed-out one in the report. So this spec
 * checks the default context is anonymous, and it deliberately does NOT
 * `test.use` anything.
 */

test.describe('default browser context is signed out', () => {
  test('carries no Supabase session cookie', async ({ context, page }) => {
    // Cookies are per-origin, so visit the app before reading them.
    await page.goto('/');
    const cookies = await context.cookies();
    const authCookies = cookies.filter((c) => /^sb-.*-auth-token/.test(c.name));
    expect(
      authCookies.map((c) => c.name),
      'a project-level storageState has leaked into the public specs',
    ).toEqual([]);
  });

  test('an authenticated route still redirects to sign in', async ({ page }) => {
    // The behavioural half: absent cookies could also mean the cookie name
    // changed, which this would not catch on its own.
    await page.goto('/account/bookings');
    expect(new URL(page.url()).pathname).toBe('/login');
  });

  test('the membership return page RENDERS without a cookie (C9)', async ({ page }) => {
    // The C9 acceptance. Hosted Checkout used to return the customer to
    // /account/memberships?checkout=success, which the test above shows
    // redirects to /login: in an app webview with no cookie a completed
    // subscription purchase read as a failure. The replacement return_url has
    // to be a page an anonymous viewer can actually see.
    const res = await page.goto('/membership/complete');
    expect(res?.status()).toBe(200);
    expect(new URL(page.url()).pathname, 'the return page must not bounce to /login').toBe(
      '/membership/complete',
    );
    await expect(page.getByRole('heading', { name: 'Your card is confirmed' })).toBeVisible();
  });
});
