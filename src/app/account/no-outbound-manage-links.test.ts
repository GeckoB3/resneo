/**
 * P2-5 acceptance: the portal does not send a customer out to a token page.
 *
 * The plan's acceptance is "no manage link is rendered anywhere under
 * /account, and no route under /api/account mints one". Asserted structurally
 * rather than through a render, because the failure it guards is a NEW site
 * appearing later: a render test only covers the pages someone thought to
 * write one for, and the whole point is that the next person adding a booking
 * surface does not quietly reach for a manage link again.
 *
 * WHY IT MATTERS, beyond tidiness. A `/b/{code}` manage link is a bearer
 * credential: whoever holds it can cancel the booking without logging in. The
 * portal has authenticated actions of its own since P2-2 and P2-3, so every
 * one of these was handing out a credential nobody needed. The route that
 * minted them on request is deleted; this stops one growing back.
 *
 * The three token surfaces (`/b/{code}`, `/m/v3...`, `/manage/...`) stay live
 * indefinitely and transactional emails keep minting their own links. This is
 * about ResNeo's own outbound links FROM the portal, not the destinations.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

/** The portal's own surfaces: its pages, and the API it calls. */
const PORTAL_DIRS = [
  path.join(ROOT, 'src/app/account'),
  path.join(ROOT, 'src/components/account'),
  path.join(ROOT, 'src/app/api/account'),
];

function sourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const rel = (f: string) => path.relative(ROOT, f).replace(/\\/g, '/');

describe('P2-5: the portal renders no manage links and mints none', () => {
  it('reads a real portal, so the assertions below cannot pass on an empty list', () => {
    // The vacuity guard. A typo in a directory name would otherwise make every
    // assertion here pass by scanning nothing at all.
    const files = PORTAL_DIRS.flatMap(sourceFiles);
    expect(files.length).toBeGreaterThan(20);
    expect(files.map(rel)).toContain('src/app/account/bookings/page.tsx');
  });

  it('no portal file mints a booking short link', () => {
    // `createOrGetBookingShortLink` is the only way one is made. Emails and the
    // venue-side routes keep calling it; nothing the customer's own surfaces
    // reach may, because a GET that mints writes a row on every page view.
    const offenders = PORTAL_DIRS.flatMap(sourceFiles).filter((f) =>
      fs.readFileSync(f, 'utf8').includes('createOrGetBookingShortLink'),
    );
    expect(offenders.map(rel), 'a portal surface mints a manage link').toEqual([]);
  });

  it('no portal file calls a manage-link endpoint', () => {
    const offenders = PORTAL_DIRS.flatMap(sourceFiles).filter((f) =>
      fs.readFileSync(f, 'utf8').includes('manage-link'),
    );
    expect(offenders.map(rel), 'a portal surface asks for a manage link').toEqual([]);
  });

  it('no route under /api/account is a manage-link route', () => {
    const dir = path.join(ROOT, 'src/app/api/account');
    const offenders = sourceFiles(dir).filter((f) => rel(f).includes('manage-link'));
    expect(offenders.map(rel)).toEqual([]);
  });

  it('the ManageBookingLink component is gone, not merely unused', () => {
    // Left in place it is one import away from coming back, and it would come
    // back without the route it needs, which fails at runtime rather than here.
    expect(fs.existsSync(path.join(ROOT, 'src/components/account/ManageBookingLink.tsx'))).toBe(
      false,
    );
  });
});
