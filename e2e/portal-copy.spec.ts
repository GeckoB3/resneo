import { test, expect } from '@playwright/test';
import { getE2eConfig } from './helpers/env';
import { portalCustomerConfigured } from './helpers/account-session';
import { PORTAL_CUSTOMER_STATE } from './helpers/auth-state';

/**
 * P1-4 acceptance, against the thing the acceptance actually names: rendered
 * portal copy.
 *
 * `portal-consumer-copy.test.ts` reads the source and has to approximate which
 * strings reach a screen. This reads what a customer's browser actually shows.
 * The two catch different things and neither is enough alone: the source sweep
 * sees copy for states this fixture cannot produce (a `past_due` membership, a
 * failed repeat booking), and this sees anything the source extraction misses,
 * including text assembled at runtime from several pieces.
 */

const e2e = getE2eConfig();
const SKIP_REASON = 'Set E2E_VENUE_SLUG and E2E_PORTAL_CUSTOMER_EMAIL (see Docs/E2E_SMOKE.md)';

/** Every surface a signed-in customer can reach without creating anything. */
const SURFACES = [
  '/account',
  '/account/bookings',
  '/account/bookings?filter=upcoming',
  '/account/bookings?filter=past',
  '/account/passes?tab=credits',
  '/account/passes?tab=courses',
  '/account/passes?tab=memberships',
  '/account/passes?tab=recurring',
  '/account/profile',
];

const BANNED = [
  { pattern: /\bstripe\b/i, why: 'names the payment processor' },
  { pattern: /\bconnect(ed)? account\b/i, why: 'Stripe Connect is an implementation detail' },
  { pattern: /\bCDE\b/, why: 'internal shorthand' },
  { pattern: /\bcron\b/i, why: 'names a scheduled job' },
  { pattern: /materialis|materializ/i, why: 'internal word for creating bookings' },
  { pattern: /\bvenue schedule\b/i, why: 'internal name for a job' },
  { pattern: /\bpence\b/i, why: 'prices are shown in pounds' },
  { pattern: /\bledger\b/i, why: 'accounting word' },
];

/**
 * A raw database value is snake_case by construction, so this catches enums
 * nobody thought to list, which is the half a value-by-value check cannot do.
 *
 * Scoped to `main`, so the customer's own email in the header is not a match,
 * and requiring a lowercase letter either side of the underscore so a venue
 * called "Studio_9" would not trip it.
 */
const SNAKE_CASE = /\b[a-z]+_[a-z]+\b/;

/**
 * Wait for the page rather than its skeleton.
 *
 * Every portal loading shape is `role="status"` (`PortalSkeletons.tsx`,
 * `passes/loading.tsx`, the passes panel fallback), and P0-5's skeletons print
 * the real `<h1>` on purpose to avoid a layout shift. So waiting for a heading
 * proves nothing: the first version of this spec did exactly that and read the
 * bookings skeleton's 38 characters of text. Its own vacuity guard caught it,
 * while the sibling test without that guard passed clean on a skeleton, which
 * is the more instructive half. Absence of a status region is the one signal
 * that means "the real content is here" on every route, without naming a
 * locator per page.
 */
async function readyMainText(page: import('@playwright/test').Page, label: string) {
  await expect(page.locator('main h1').first(), label).toBeVisible();
  await expect(
    page.locator('main [role="status"]'),
    `${label} still showing a skeleton`,
  ).toHaveCount(0);
  const text = (await page.locator('main').innerText()) ?? '';
  expect(
    text.length,
    `${label} rendered almost nothing; this would pass vacuously`,
  ).toBeGreaterThan(80);
  return text;
}

test.describe('P1-4: what the portal actually says', () => {
  test.use({ storageState: PORTAL_CUSTOMER_STATE });
  test.skip(!e2e.isConfigured || !portalCustomerConfigured(), SKIP_REASON);

  test('no surface shows implementation vocabulary', async ({ page }) => {
    const offenders: string[] = [];

    for (const path of SURFACES) {
      await page.goto(path);
      const text = await readyMainText(page, path);

      for (const { pattern, why } of BANNED) {
        const hit = text.match(pattern);
        if (hit) offenders.push(`${path}: ${why} ("${hit[0]}")`);
      }
    }

    expect(offenders, `implementation vocabulary on screen:\n${offenders.join('\n')}`).toEqual([]);
  });

  test('no surface shows a raw database value', async ({ page }) => {
    const offenders: string[] = [];
    for (const path of SURFACES) {
      await page.goto(path);
      const text = await readyMainText(page, path);
      for (const line of text.split('\n')) {
        const hit = line.match(SNAKE_CASE);
        if (hit) offenders.push(`${path}: "${hit[0]}" in "${line.trim().slice(0, 90)}"`);
      }
    }
    expect(offenders, `snake_case on screen:\n${offenders.join('\n')}`).toEqual([]);
  });

  test('the booking detail page speaks plainly too', async ({ page }) => {
    // Reached by clicking, since it needs a real id, and it is the one portal
    // page that renders money and a deposit state.
    await page.goto('/account/bookings');
    await page.getByRole('link', { name: 'Details' }).first().click();
    await expect(page).toHaveURL(/\/account\/bookings\/[0-9a-f-]{36}/);

    const text = await readyMainText(page, 'booking detail');
    for (const { pattern, why } of BANNED) {
      expect(pattern.test(text), `booking detail: ${why}`).toBe(false);
    }
    expect(SNAKE_CASE.test(text), 'booking detail shows a raw database value').toBe(false);
  });

  test('the sweep can still see text, and would object to the copy P1-4 removed', async ({
    page,
  }) => {
    // A vacuity guard with teeth: prove the assertions above are reading the
    // page, by finding copy this pass wrote, and prove the patterns fire, by
    // running them over the strings it deleted.
    await page.goto('/account/passes?tab=memberships');
    await expect(page.getByText('Memberships are billed by the venue')).toBeVisible();

    const removed = 'Subscriptions bill on each venue’s Stripe Connect account.';
    expect(BANNED.some(({ pattern }) => pattern.test(removed))).toBe(true);
    expect(SNAKE_CASE.test('past_due')).toBe(true);
  });

  test('the locale setting is gone rather than pretending to work', async ({ page }) => {
    // G22. It was written by this form and read nowhere, under a heading that
    // said it affected how dates are shown.
    await page.goto('/account/profile');
    await expect(page.getByRole('heading', { name: 'Dates and sign-in', level: 2 })).toBeVisible();
    await expect(page.locator('#profile-locale')).toHaveCount(0);
    await expect(page.getByText('Locale', { exact: true })).toHaveCount(0);
    // The setting that DOES work is still there.
    await expect(page.locator('select#profile-timezone')).toBeVisible();
  });
});
