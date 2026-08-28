import { describe, it, expect } from 'vitest';
import nextConfig from '../../../../next.config';
import { LEGACY_PASSES_ROUTES, PASSES_TABS, parsePassesTab } from './passes-tabs';

/**
 * The routing table P1-5 actually ships, asserted against `next.config.ts`
 * itself rather than against the array it is built from.
 *
 * Testing `LEGACY_PASSES_ROUTES` alone would prove only that a list matches
 * itself. What decides whether a customer's stale link works is the object
 * `redirects()` returns, so that is what this reads. It also catches the
 * likeliest future mistake: someone adding a sixth retired route straight into
 * the config by hand, where nothing would check its destination parses to a
 * real tab.
 *
 * `next.config.ts` is importable here because its only runtime import is
 * `node:path`; the `NextConfig` import is type-only and erases.
 */

async function redirectTable() {
  const redirects = nextConfig.redirects;
  expect(typeof redirects, 'next.config.ts defines no redirects() block').toBe('function');
  return await redirects!();
}

describe('the retired portal routes', () => {
  it('redirects every route P1-5 retires, and nothing else', async () => {
    const table = await redirectTable();
    expect(table.map((r) => r.source).sort()).toEqual(
      [
        '/account/classes',
        '/account/courses',
        '/account/credits',
        '/account/memberships',
        '/account/recurring',
      ].sort(),
    );
  });

  it('sends each one to its tab on the passes page', async () => {
    const table = await redirectTable();
    const bySource = new Map(table.map((r) => [r.source, r]));

    for (const { from, tab } of LEGACY_PASSES_ROUTES) {
      const entry = bySource.get(from);
      expect(entry, `${from} is not in the shipped redirect table`).toBeDefined();

      const url = new URL(entry!.destination, 'https://resneo.test');
      expect(url.pathname, from).toBe('/account/passes');
      // Parsed rather than string-compared, so a destination that names a tab
      // the page would silently fall back on cannot pass.
      expect(parsePassesTab(url.searchParams.get('tab')), from).toBe(tab);
    }
  });

  it('is temporary, so a wrong destination is not cached into a customer forever', async () => {
    const table = await redirectTable();
    for (const entry of table) {
      expect(entry.permanent, `${entry.source} should be a 307 while the portal is being rebuilt`).toBe(
        false,
      );
    }
  });

  it('covers all four tabs, so no section was left without a way back', async () => {
    // Every section that had a route of its own must still be reachable from
    // the URL it used to live at. Credits appears twice: the classes hub lands
    // there too.
    const covered = new Set(LEGACY_PASSES_ROUTES.map((r) => r.tab));
    for (const tab of PASSES_TABS) {
      expect(covered.has(tab.id), `nothing redirects to the ${tab.id} tab`).toBe(true);
    }
  });

  it('leaves no page behind at a retired path', async () => {
    // A config redirect wins over a filesystem route, so a leftover page.tsx
    // would be invisible dead code rather than a broken route. Invisible dead
    // code in a portal being rebuilt is how the next person concludes the old
    // page is still live and edits it.
    const fs = await import('node:fs');
    const path = await import('node:path');
    for (const { from } of LEGACY_PASSES_ROUTES) {
      const dir = path.join(process.cwd(), 'src', 'app', from.replace(/^\//, ''));
      expect(fs.existsSync(dir), `${from} still has a route directory at ${dir}`).toBe(false);
    }
  });

  it('the sweep is not vacuous', async () => {
    const table = await redirectTable();
    expect(table.length).toBe(5);
    expect(LEGACY_PASSES_ROUTES.length).toBe(5);
  });
});
