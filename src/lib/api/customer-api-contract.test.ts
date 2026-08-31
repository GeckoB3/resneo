import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { API_ERROR_CODES } from './error-codes';

/**
 * The customer API contract, enforced rather than described (P0-11).
 *
 * Derived from the filesystem on the model of
 * `schedule-fail-closed-coverage.test.ts`, which records that four routes
 * escaped an enumeration precisely because the list was typed by hand. A
 * convention with no failing check is a comment.
 *
 * Note what is NOT asserted here: that every existing error carries a `code`.
 * There are 162 error returns under /api/account and a WRONG code is worse
 * than none, because it lies to a client that trusts it. Codes are added with
 * per-site judgement; this file pins the vocabulary, the 401 convergence, the
 * v1-alias rule for NEW routes, and the envelope carve-out.
 */

const API = path.join(process.cwd(), 'src', 'app', 'api');

function routeFiles(...segments: string[]): string[] {
  const dir = path.join(API, ...segments);
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...routeFiles(...segments, entry.name));
    else if (entry.name === 'route.ts') out.push(full);
  }
  return out;
}

const rel = (f: string) => path.relative(API, f).replace(/\\/g, '/');

describe('customer API error vocabulary', () => {
  it('every code used anywhere in the API is a member of the exported union', () => {
    // The union is the registry. A code outside it is a string a client cannot
    // rely on, which is the exact failure this task exists to prevent.
    const known = new Set<string>(API_ERROR_CODES);
    const offenders: string[] = [];
    for (const file of [...routeFiles('account'), ...routeFiles('v1'), ...routeFiles('venue')]) {
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(/\bcode:\s*'([A-Z_]+)'/g)) {
        if (!known.has(m[1])) offenders.push(`${rel(file)} -> ${m[1]}`);
      }
    }
    expect(
      offenders,
      'These codes are not in API_ERROR_CODES. Add them to src/lib/api/error-codes.ts, ' +
        'with a comment saying what a client should do about each.',
    ).toEqual([]);
  });

  it('the sweep is not vacuous: it sees codes that really exist', () => {
    const seen: string[] = [];
    for (const file of [...routeFiles('account'), ...routeFiles('v1')]) {
      for (const m of fs.readFileSync(file, 'utf8').matchAll(/\bcode:\s*'([A-Z_]+)'/g)) {
        seen.push(m[1]);
      }
    }
    expect(seen.length).toBeGreaterThan(20);
    expect(seen).toContain('UNAUTHENTICATED');
  });
});

describe('401 convergence', () => {
  it('the customer API uses one 401 literal', () => {
    // /api/venue used 'Unauthorised' at 259 sites and the customer API used
    // 'Unauthenticated' at 42. Converged on the former: fewer sites to change,
    // and §5D.0 established the app never string-matches this literal.
    const offenders: string[] = [];
    for (const file of [...routeFiles('account'), ...routeFiles('v1')]) {
      const src = fs.readFileSync(file, 'utf8');
      // Only literal response values, not prose in comments.
      if (/error:\s*'Unauthenticated'/.test(src)) offenders.push(rel(file));
    }
    expect(offenders, "Use 'Unauthorised' with code 'UNAUTHENTICATED'.").toEqual([]);
  });
});

/**
 * The exclusion list is a PERMANENT carve-out, not a transition (§5D.0).
 *
 * All six of the shipped app's blast-radius pairs are served by
 * `/api/account/*` handlers, four through one-line v1 re-exports. Re-enveloping
 * `/api/v1/me/profile` silently wipes a user's notification preferences;
 * re-enveloping `/api/v1/me/devices` reintroduces a shared-tablet push leak.
 * A path prefix cannot express this, which is why the rule is a file list.
 */
const ENVELOPE_EXCLUDED = [
  'account/delete-request/route.ts',
  'account/delete-request/cancel/route.ts',
  'account/devices/route.ts',
  'account/devices/[id]/route.ts',
  'account/profile/route.ts',
] as const;

describe('response envelope carve-out', () => {
  it('every excluded handler still exists, so the list cannot rot silently', () => {
    // If one is renamed and the list is not updated, the carve-out silently
    // stops protecting it and the next codemod eats the shipped app.
    for (const f of ENVELOPE_EXCLUDED) {
      expect(fs.existsSync(path.join(API, f)), `${f} is on the envelope exclusion list but does not exist`).toBe(true);
    }
  });

  it('excluded handlers keep their current top-level response shapes', () => {
    // A cheap tripwire: these five must not grow a generic wrapper. Asserted
    // by their distinctive keys rather than by parsing responses.
    const shapes: Record<string, string> = {
      'account/delete-request/route.ts': 'deletion_scheduled_at',
      'account/devices/route.ts': 'devices',
      'account/profile/route.ts': 'profile',
    };
    for (const [file, key] of Object.entries(shapes)) {
      const src = fs.readFileSync(path.join(API, file), 'utf8');
      expect(src, `${file} must still return its bare ${key} shape`).toContain(key);
    }
  });
});

/**
 * C7a: every route this plan CREATES needs a v1 alias. C7b: do not backfill
 * the existing ones. The app already calls two account routes by their direct
 * path and works, so a backfill protects nothing today and would publish
 * routes on a versioned surface before anything consumes them.
 */

/**
 * Routes created by this plan that are deliberately NOT aliased into /api/v1,
 * each with the phase that removes it. Distinct from the pre-existing list,
 * which is closed: this one is for exemptions taken with a reason.
 */
const C7A_EXEMPT: Record<string, string> = {
  // P2-6's undo for an accidental membership cancellation. Memberships have no
  // representation on /api/v1/me AT ALL, so aliasing this one verb would
  // publish a fragment of a family that is not there. P5-1 is where the
  // membership surface is added and aliased, driven by a real consumer rather
  // than by a sweep, and this alias belongs in that batch.
  'account/memberships/resume/route.ts': 'memberships reach v1 in P5-1, as a family',
  // P2-1's portal spelling of an action the versioned surface already has, as
  // `DELETE /api/v1/me/bookings/[id]`. Both are thin adapters over
  // `cancelBookingForGuest`, so they cannot diverge in behaviour, and adding
  // `POST /api/v1/me/bookings/[id]/cancel` would publish a second spelling of
  // one operation on the surface the app reads. That is the duplication P2-1's
  // own acceptance rules out for the detail endpoint, applied to cancel. The
  // other three P2-1 routes are new capabilities on v1 and ARE aliased.
  'account/bookings/[id]/cancel/route.ts': 'cancel is on v1 as DELETE /api/v1/me/bookings/[id]',
};

describe('v1 alias rule (C7a/C7b)', () => {
  it('records the dated exclusion list of pre-existing account routes', () => {
    // Dated 2026-08-27. Routes added AFTER this date need a v1 alias, or an
    // entry in C7A_EXEMPT with the phase that removes them; these do not. The
    // count is asserted so that adding a route without an alias, and without
    // consciously updating this list, fails here.
    //
    // 32: P1-1 added account/home, aliased at v1/me/home, and P2-1 added four
    // booking action routes, three aliased under v1/me/bookings/[id]/ and
    // cancel C7A_EXEMPT because v1 already cancels with DELETE. P0-3's
    // account/bookings/[id]/manage-link was here as a C7a exemption and P2-5
    // deleted it, taking the count 32 to 31. P2-6 then added
    // account/memberships/resume, C7A_EXEMPT because memberships are not on
    // v1 at all, taking it back to 32. P4-2 then added account/payments,
    // aliased at v1/me/payments, taking it to 33. It is ALIASED rather than
    // exempt: the memberships exemption was about publishing one verb of a
    // family that has no presence on v1, and a payment history is not a verb
    // of anything, it is a complete capability on its own. P4-4 then added
    // account/waitlist and account/waitlist/[id], both aliased under
    // v1/me/waitlist, taking it to 35. P4-5 then added account/export,
    // aliased at v1/me/export, taking it to 36. P4-6 then added
    // account/payment-methods/[venueId]/[paymentMethodId], aliased under
    // v1/me/payment-methods, taking it to 37. P5-1 then added
    // account/bookings/by-model and account/venues, both aliased, taking it
    // to 39.
    const accountRoutes = routeFiles('account').map(rel).sort();
    expect(
      accountRoutes.length,
      'An /api/account route was added or removed. If added: give it a v1 alias (C7a) ' +
        'or a C7A_EXEMPT entry, and bump this count. Do NOT add it to the pre-existing ' +
        'exclusion list, which is dated 2026-08-27 and closed.',
    ).toBe(39);
  });

  it('routes this plan created have their v1 alias', () => {
    // C7a. The count above notices a new route; this notices a new route that
    // was added without the alias, which is the failure C7a actually names.
    for (const [account, alias] of [
      ['account/home/route.ts', 'v1/me/home/route.ts'],
      [
        'account/bookings/[id]/reschedule/route.ts',
        'v1/me/bookings/[id]/reschedule/route.ts',
      ],
      [
        'account/bookings/[id]/reschedule-options/route.ts',
        'v1/me/bookings/[id]/reschedule-options/route.ts',
      ],
      ['account/bookings/[id]/confirm/route.ts', 'v1/me/bookings/[id]/confirm/route.ts'],
    ]) {
      expect(fs.existsSync(path.join(API, account)), `${account} should exist`).toBe(true);
      expect(fs.existsSync(path.join(API, alias)), `${account} needs its v1 alias at ${alias}`).toBe(
        true,
      );
    }
  });

  it('every C7a exemption still exists, so the reason cannot outlive the route', () => {
    // This is what made P2-5 delete the exemption alongside the route: it
    // failed the moment the file went. An exemption list that quietly
    // describes nothing is how the next route gets waved through without one.
    for (const [file, reason] of Object.entries(C7A_EXEMPT)) {
      expect(fs.existsSync(path.join(API, file)), `${file} is C7a-exempt (${reason}) but does not exist`).toBe(
        true,
      );
    }
  });

  it('names the three divergent v1 duplicates for convergence', () => {
    // These are parallel implementations rather than re-exports. P0-12 touched
    // all three; they converge rather than being aliased.
    for (const f of ['v1/auth/password/set/route.ts', 'v1/me/email/change/route.ts', 'v1/auth/logout/route.ts']) {
      expect(fs.existsSync(path.join(API, f)), `${f} should still exist`).toBe(true);
    }
  });
});
