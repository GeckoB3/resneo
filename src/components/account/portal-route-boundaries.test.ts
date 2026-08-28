import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * P0-5 acceptance: each surviving route has a `loading.tsx` and an `error.tsx`.
 *
 * Enumerated from the filesystem rather than eyeballed, because the failure is
 * invisible: a route with no `error.tsx` does not break, it quietly unwinds to
 * `src/app/error.tsx`, which sits OUTSIDE the account layout. The customer
 * loses the portal header, the account nav and every route they might navigate
 * to instead, and lands on a bare page. Nothing in the app reports that; it
 * just looks like a different, worse product for one render.
 *
 * Scoped to the survivors, matching P0-8's metadata scoping: P1-3 and P1-5 turn
 * nine of the thirteen routes into one-line redirects, and a boundary on a
 * redirect is work spent on a file about to stop existing. `/account/passes`
 * joined the list when P1-5 created it, which is what the previous version of
 * this comment predicted would happen.
 */

const ACCOUNT = path.join(process.cwd(), 'src', 'app', 'account');

/** The routes that survive P1-3 and P1-5, relative to `src/app/account`. */
const SURVIVING = ['', 'bookings', 'bookings/[bookingId]', 'passes', 'profile', 'security'];

describe('P0-5: every surviving portal route has both boundaries', () => {
  for (const route of SURVIVING) {
    const label = `/account${route ? `/${route}` : ''}`;

    it(`${label} has a loading.tsx`, () => {
      expect(fs.existsSync(path.join(ACCOUNT, route, 'loading.tsx')), `${label} loading.tsx`).toBe(
        true,
      );
    });

    it(`${label} has an error.tsx`, () => {
      expect(fs.existsSync(path.join(ACCOUNT, route, 'error.tsx')), `${label} error.tsx`).toBe(true);
    });
  }

  it('every error boundary is a client component that offers a retry', () => {
    // Next only treats `error.tsx` as a boundary when it is a client
    // component, and it passes `reset` for exactly one purpose. A boundary
    // that renders an apology and no way forward leaves the customer stuck on
    // a dead page.
    for (const route of SURVIVING) {
      const file = path.join(ACCOUNT, route, 'error.tsx');
      const src = fs.readFileSync(file, 'utf8');
      const label = `/account${route ? `/${route}` : ''}`;
      expect(src.startsWith("'use client'"), `${label} error.tsx must be a client component`).toBe(
        true,
      );
      expect(src, `${label} error.tsx must use reset`).toContain('reset');
    }
  });

  it('the sweep is not vacuous: it is looking at real files', () => {
    // Without this, renaming the account directory would make every assertion
    // above pass by finding nothing to check.
    expect(fs.existsSync(path.join(ACCOUNT, 'page.tsx'))).toBe(true);
    expect(SURVIVING.length).toBe(6);
  });
});
