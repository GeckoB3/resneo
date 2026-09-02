import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import nextConfig from '../../../next.config';
import { RETIRED_ACCOUNT_ROUTES } from './retired-routes';
import { RETIRED_MARKETING_ROUTES } from '@/lib/marketing/retired-marketing-routes';
import { PASSES_TABS, parsePassesTab } from './passes/passes-tabs';
import { PROFILE_SECTION_ANCHORS } from './profile/page';

/**
 * The routing table the portal actually ships, asserted against
 * `next.config.ts` itself rather than against the array it is built from.
 *
 * Testing `RETIRED_ACCOUNT_ROUTES` alone would prove only that a list matches
 * itself. What decides whether a customer's stale link works is the object
 * `redirects()` returns, so that is what this reads. It also catches the
 * likeliest future mistake: someone adding a route straight into the config by
 * hand, where nothing would check its destination goes anywhere real.
 *
 * `next.config.ts` is importable here because its only runtime imports are
 * `node:path` and this table; the `NextConfig` import is type-only and erases.
 */

async function shippedRedirects() {
  const redirects = nextConfig.redirects;
  expect(typeof redirects, 'next.config.ts defines no redirects() block').toBe('function');
  return await redirects!();
}

/**
 * The portal's share of the shipped table. Retired marketing pages redirect
 * from the same config, so the sweep below scopes itself to `/account/`
 * sources rather than asserting the whole table is the portal's.
 */
async function redirectTable() {
  return (await shippedRedirects()).filter((r) => r.source.startsWith('/account/'));
}

/** Every path the portal has retired, across P1-5 and P1-3. */
const EXPECTED_SOURCES = [
  '/account/classes',
  '/account/courses',
  '/account/credits',
  '/account/events',
  '/account/memberships',
  '/account/payment-methods',
  '/account/recurring',
  '/account/resources',
  '/account/security',
];

describe('the retired portal routes', () => {
  it('redirects every retired route, and nothing else', async () => {
    const table = await redirectTable();
    expect(table.map((r) => r.source).sort()).toEqual([...EXPECTED_SOURCES].sort());
  });

  it('is temporary, so a wrong destination is not cached into a customer forever', async () => {
    const table = await redirectTable();
    for (const entry of table) {
      expect(
        entry.permanent,
        `${entry.source} should be a 307 while the portal is being rebuilt`,
      ).toBe(false);
    }
  });

  it('sends the four commerce routes to their tab on the passes page', async () => {
    const table = await redirectTable();
    const bySource = new Map(table.map((r) => [r.source, r]));
    const expected: Record<string, string> = {
      '/account/credits': 'credits',
      '/account/courses': 'courses',
      '/account/memberships': 'memberships',
      '/account/recurring': 'recurring',
      // The static hub. Credits is where its own list started.
      '/account/classes': 'credits',
    };

    for (const [source, tab] of Object.entries(expected)) {
      const entry = bySource.get(source);
      expect(entry, `${source} is not in the shipped redirect table`).toBeDefined();
      const url = new URL(entry!.destination, 'https://resneo.test');
      expect(url.pathname, source).toBe('/account/passes');
      // Parsed rather than string-compared, so a destination naming a tab the
      // page would silently fall back on cannot pass.
      expect(parsePassesTab(url.searchParams.get('tab')), source).toBe(tab);
    }
  });

  it('covers all four passes tabs, so no section was left without a way back', async () => {
    const table = await redirectTable();
    const tabs = new Set(
      table
        .filter((r) => r.destination.startsWith('/account/passes'))
        .map((r) => parsePassesTab(new URL(r.destination, 'https://x.test').searchParams.get('tab'))),
    );
    for (const tab of PASSES_TABS) {
      expect(tabs.has(tab.id), `nothing redirects to the ${tab.id} tab`).toBe(true);
    }
  });

  it('sends events and resources to the matching type filter', async () => {
    const table = await redirectTable();
    const bySource = new Map(table.map((r) => [r.source, r]));
    for (const [source, model] of [
      ['/account/events', 'event'],
      ['/account/resources', 'resource'],
    ] as const) {
      const url = new URL(bySource.get(source)!.destination, 'https://resneo.test');
      expect(url.pathname, source).toBe('/account/bookings');
      expect(url.searchParams.get('model'), source).toBe(model);
    }
  });

  it('sends payments and security to anchors the profile page really has', async () => {
    // The fragment is the whole destination here: land on `/account/profile`
    // with the wrong anchor and the customer is at the top of a nine-section
    // page with no idea where their saved cards went. Checked against the
    // page's own exported list rather than against string literals, so
    // renaming a section id fails here instead of in production.
    const table = await redirectTable();
    const bySource = new Map(table.map((r) => [r.source, r]));
    const anchors = new Set(PROFILE_SECTION_ANCHORS.map((a) => a.id));

    for (const [source, anchor] of [
      ['/account/payment-methods', 'payment-methods'],
      ['/account/security', 'password'],
    ] as const) {
      const destination = bySource.get(source)!.destination;
      const url = new URL(destination, 'https://resneo.test');
      expect(url.pathname, source).toBe('/account/profile');
      // Per RFC 7231 §7.1.2 a client re-applies its own fragment only when
      // Location has none, so this fragment is what the customer lands on.
      expect(url.hash, source).toBe(`#${anchor}`);
      expect(anchors.has(anchor), `${anchor} is not a section of the profile page`).toBe(true);
    }
  });

  it('leaves no page behind at a retired path', async () => {
    // A config redirect wins over a filesystem route, so a leftover page.tsx
    // would be invisible dead code rather than a broken route. Invisible dead
    // code in a portal being rebuilt is how the next person concludes the old
    // page is still live and edits it.
    for (const { from } of RETIRED_ACCOUNT_ROUTES) {
      const dir = path.join(process.cwd(), 'src', 'app', from.replace(/^\//, ''));
      expect(fs.existsSync(dir), `${from} still has a route directory at ${dir}`).toBe(false);
    }
  });

  it('the sweep is not vacuous', async () => {
    const table = await redirectTable();
    expect(table.length).toBe(EXPECTED_SOURCES.length);
    expect(RETIRED_ACCOUNT_ROUTES.length).toBe(EXPECTED_SOURCES.length);
    expect(EXPECTED_SOURCES.length).toBe(9);
  });
});

describe('the retired marketing routes', () => {
  it('ship every retired page as a temporary redirect, and nothing else rides along', async () => {
    const shipped = await shippedRedirects();
    const others = shipped.filter((r) => !r.source.startsWith('/account/'));
    expect(others.map((r) => r.source).sort()).toEqual(
      RETIRED_MARKETING_ROUTES.map((r) => r.from).sort(),
    );
    for (const entry of others) {
      expect(entry.permanent, `${entry.source} should stay a 307 in case the page returns`).toBe(false);
    }
  });

  it('leaves no page behind at a retired path', () => {
    for (const { from } of RETIRED_MARKETING_ROUTES) {
      const dir = path.join(process.cwd(), 'src', 'app', from.replace(/^\//, ''));
      expect(fs.existsSync(dir), `${from} still has a route directory at ${dir}`).toBe(false);
    }
  });
});
