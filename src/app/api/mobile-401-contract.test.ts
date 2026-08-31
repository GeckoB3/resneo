/**
 * The mobile app's two 401 contracts, asserted structurally.
 *
 * `Resneo-app` signs in through this repo's API over Bearer, and it reads a
 * 401's SHAPE, not just its status, to decide who is holding the phone:
 *
 *   - a 401 carrying `code: 'UNAUTHENTICATED'` means "this session is dead",
 *     and the app signs the user out;
 *   - a BARE 401 from `GET /api/venue/staff/me` means "this person is not
 *     staff", which is how `useRole` identifies a customer.
 *
 * So the two shapes are load-bearing in opposite directions, and each fails
 * silently in a way no test on this side would otherwise catch. Add the code
 * to `staff/me` and every customer is signed out on launch, because the probe
 * that was meant to say "you are a customer" now says "your session is dead".
 * Drop the code from an account route and a signed-out user sits on a screen
 * that never recovers.
 *
 * Asserted over the source rather than through a request because the failure
 * being guarded is a NEW route, or a tidy-up that makes the 401s "consistent".
 * Consistency is exactly the wrong instinct here: the asymmetry IS the
 * contract. Anyone changing these shapes has to change this file too, which is
 * where they will read why they should not.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ACCOUNT_API = path.join(ROOT, 'src/app/api/account');
const STAFF_ME = path.join(ROOT, 'src/app/api/venue/staff/me/route.ts');

function routeFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(full);
    return /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [full] : [];
  });
}

const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join('/');

/**
 * Every `{ status: 401 }` that is actually a JSON RESPONSE, as the ~400
 * characters of source preceding it.
 *
 * The `NextResponse.json` filter drops one false positive that matters:
 * `account/profile` builds a plain `{ message, status: 401 }` error OBJECT to
 * stand in for a failed auth call. That is not a response and has no body
 * shape to carry a code in.
 */
function jsonUnauthorisedResponses(source: string): string[] {
  return source
    .split('status: 401')
    .slice(0, -1)
    .map((chunk) => chunk.slice(-400))
    .filter((window) => window.includes('NextResponse.json'));
}

describe("the mobile app's 401 shapes", () => {
  it('reads a real API tree, so nothing below passes by scanning nothing', () => {
    // The vacuity guard. A renamed directory would otherwise turn every
    // assertion in this file green while asserting nothing at all.
    const files = routeFiles(ACCOUNT_API);
    expect(files.length).toBeGreaterThan(30);
    expect(files.map(rel)).toContain('src/app/api/account/bookings/route.ts');
    expect(fs.existsSync(STAFF_ME)).toBe(true);
  });

  it('every 401 the customer API returns carries UNAUTHENTICATED', () => {
    // The app treats this code as "your session is dead, sign out". A 401
    // without it leaves the app holding a token it will never retire, on a
    // screen that cannot recover, because nothing ever told it to sign out.
    const offenders = routeFiles(ACCOUNT_API).flatMap((f) =>
      jsonUnauthorisedResponses(fs.readFileSync(f, 'utf8'))
        .filter((window) => !window.includes('UNAUTHENTICATED'))
        .map(() => rel(f)),
    );
    expect([...new Set(offenders)], 'a customer 401 the app cannot act on').toEqual([]);
  });

  it('GET /api/venue/staff/me answers a non-staff caller with a BARE 401', () => {
    /*
      This one is inverted, and it is the dangerous one.

      `useRole` calls this route on launch. A 401 with no code means "not
      staff", and the app settles on `customer`. If this route ever gained
      `code: 'UNAUTHENTICATED'`, that same probe would read as a dead session
      and EVERY CUSTOMER would be signed out at launch, having done nothing
      wrong and with no way to tell what had happened.

      Asserted across the whole file rather than the GET handler alone: the
      PATCH handler's 401s sit a few lines below and are exactly the
      copy-paste that would carry the code back in.
    */
    const source = fs.readFileSync(STAFF_ME, 'utf8');
    expect(jsonUnauthorisedResponses(source).length).toBeGreaterThan(0);
    expect(
      source.includes('UNAUTHENTICATED'),
      'staff/me gained an auth code; this signs out every customer on launch',
    ).toBe(false);
  });
});
