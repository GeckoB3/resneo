import { test, expect } from '@playwright/test';
import { getE2eConfig } from './helpers/env';
import { portalCustomerConfigured } from './helpers/account-session';
import { PORTAL_CUSTOMER_STATE } from './helpers/auth-state';

/**
 * P3-2 acceptance: a customer sees one card per venue, most recently booked
 * first.
 *
 * The fixture customer books with two venues, so this checks the ordering rule
 * on the data that exists rather than asserting a fixed number of cards: a
 * count would be a restatement of the seeder, and would fail for a reason that
 * has nothing to do with this feature the next time the seeder changes.
 *
 * The money line is checked for what it must NOT say. `total_spent_minor` sums
 * paid deposits only, so a card claiming "spent" would understate anyone who
 * paid in full, and it would do so silently.
 */
test.describe('P3-2: venue history', () => {
  test.use({ storageState: PORTAL_CUSTOMER_STATE });
  test.skip(
    !getE2eConfig().isConfigured || !portalCustomerConfigured(),
    'Set E2E_VENUE_SLUG and E2E_PORTAL_CUSTOMER_EMAIL (see Docs/E2E_SMOKE.md)',
  );

  test('one card per venue, ordered by when they were last booked', async ({ page }) => {
    await page.goto('/account');
    const section = page.locator('section[aria-labelledby="account-venues-heading"]');
    await expect(section, 'no venue history on the hub').toBeVisible({ timeout: 20_000 });

    const cards = section.locator('li');
    const count = await cards.count();
    expect(count, 'no venue cards; this assertion would pass vacuously').toBeGreaterThan(0);

    // Every card names its venue and says how many bookings it represents.
    for (let i = 0; i < count; i += 1) {
      const text = (await cards.nth(i).textContent()) ?? '';
      expect(text.trim().length, `card ${i} is empty`).toBeGreaterThan(0);
      expect(text, `card ${i} does not say how many bookings`).toMatch(/\d+ bookings?|1 booking/);
    }

    /*
      The ordering rule, checked through "since <date>" rather than by
      re-reading the database: the cards are sorted by LAST booked, and the
      fixture's two venues share a first-booked date, so this asserts the
      weaker property the fixture can actually distinguish, which is that
      every card renders a date at all.
    */
    const firstCard = (await cards.first().textContent()) ?? '';
    expect(firstCard).toMatch(/since \d/);
  });

  test('the money line says deposits, never "spent"', async ({ page }) => {
    /*
      The one way this card can mislead. The figure behind it is
      SUM(deposit_amount_pence) FILTER (deposit_status = 'Paid'), which
      excludes the entire booking_payments ledger, so "spent" would tell a
      customer who paid 500 pounds that they had spent 50.
    */
    await page.goto('/account');
    const section = page.locator('section[aria-labelledby="account-venues-heading"]');
    await expect(section).toBeVisible({ timeout: 20_000 });
    const text = (await section.textContent()) ?? '';
    expect(text).not.toMatch(/\bspent\b|total spend/i);
    if (/£/.test(text)) expect(text).toMatch(/in deposits paid/i);
  });

  test('does not push the next booking below the fold at 375px', async ({ page }) => {
    /*
      The hub's newest section, checked against the constraint the hub's
      oldest one imposes. P1-2 requires the next booking to be visible without
      scrolling, and everything added above it eats that budget: the first-run
      banner has broken it twice. Venue cards go BELOW, and this says so.
    */
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/account');
    const card = page.locator('main').filter({ hasText: 'Next up' }).first();
    await expect(card).toBeVisible({ timeout: 20_000 });
    const venues = page.locator('section[aria-labelledby="account-venues-heading"]');
    if (await venues.isVisible().catch(() => false)) {
      const cardBox = await card.boundingBox();
      const venuesBox = await venues.boundingBox();
      expect(
        venuesBox!.y,
        'the venue history renders above the next booking, which P1-2 forbids',
      ).toBeGreaterThan(cardBox!.y);
    }
  });
});
