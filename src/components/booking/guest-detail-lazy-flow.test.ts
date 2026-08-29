/**
 * P2-5a regression guard (Register Q-01).
 *
 * `GuestBookingDetailView` is what an emailed cancel link opens. It mounts
 * `AppointmentBookingFlow`, which is 5,903 lines and reaches `PaymentStep`,
 * which reaches both Stripe packages. Imported statically, that meant a guest
 * clicking a link to CANCEL a booking downloaded the whole booking flow and a
 * payment SDK before the page could paint.
 *
 * Measured with `npm run measure:route-bundle` on 2026-08-29: the token manage
 * page went from 1,331 KB containing both to 648 KB containing neither, and
 * the public booking page, which already mounted the same component lazily,
 * did not move.
 *
 * THIS TEST IS NOT THE MEASUREMENT. It cannot see a bundle; it sees the one
 * edit that produces the bundle, which is the thing a future change would undo
 * by accident. The measurement is the script, and the script needs a build.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const VIEW = path.join(
  process.cwd(),
  'src/components/booking/GuestBookingDetailView.tsx',
);

const source = fs.readFileSync(VIEW, 'utf8');

describe('the guest booking detail view loads the booking flow lazily', () => {
  it('reads the real file, so the assertions below cannot pass on nothing', () => {
    expect(source.length).toBeGreaterThan(1000);
    expect(source).toContain('GuestBookingDetailView');
  });

  it('does not import AppointmentBookingFlow statically', () => {
    // A plain `import { AppointmentBookingFlow } from ...` is the regression.
    // Matched on the import STATEMENT, so the `dynamic(() => import(...))`
    // below, and the prose that mentions the component by name, both pass.
    const staticImport = /^\s*import\s+[^;]*?\bAppointmentBookingFlow\b[^;]*?from\s+['"][^'"]+['"];/m;
    expect(
      staticImport.test(source),
      'AppointmentBookingFlow is imported statically again, which puts it and Stripe back in the initial bundle of every emailed cancel link',
    ).toBe(false);
  });

  it('loads it through next/dynamic instead', () => {
    // The other half. Without this, deleting the component entirely would pass
    // the row above while breaking every reschedule.
    expect(source).toContain("import dynamic from 'next/dynamic'");
    expect(source).toMatch(/dynamic\(\s*\(\)\s*=>[\s\S]{0,120}AppointmentBookingFlow/);
  });

  it('shows something while it loads, rather than nothing', () => {
    // The guest has already pressed "Change appointment" by then. A gap with
    // no feedback reads as the button not having worked, and the flow is the
    // biggest chunk on the page.
    expect(source).toMatch(/loading:\s*\(\)\s*=>/);
    expect(source).toContain('aria-label="Loading booking"');
  });

  it('imports no payment SDK of its own', () => {
    // Stripe reaches this page only through the flow. A direct import here
    // would put it back in the initial bundle by another door, and the size
    // would look like it had simply crept up.
    expect(source).not.toMatch(/from\s+['"]@stripe\//);
  });
});
