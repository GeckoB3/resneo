import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * SA-H7 is an instance of this codebase's most common defect shape: a rule got
 * right in one place and not carried to its siblings. `isGuestBookingDateAllowed`
 * is the only real enforcement of a service's booking window, because the
 * engine's `allowSameDayBooking` is assigned and never read. `booking/create`
 * called it. `create-multi-service` and `create-group` did not, and both are
 * anonymous public flows.
 *
 * This is a bypass guard, not a behaviour test: it proves the call is present in
 * each public create route, not that it is reached on every branch. The routes
 * are several hundred lines with Stripe, compliance and add-on resolution in the
 * path, so a behavioural test of the window alone would cost more than it
 * proves. Round-1 staging testing covers the reached-ness by booking an
 * out-of-window date through each flow.
 *
 * If a fourth public create route appears, add it here.
 */

const PUBLIC_CREATE_ROUTES = [
  'src/app/api/booking/create/route.ts',
  'src/app/api/booking/create-multi-service/route.ts',
  'src/app/api/booking/create-group/route.ts',
];

function sourceOf(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('public create routes enforce the service booking window (SA-H7)', () => {
  it.each(PUBLIC_CREATE_ROUTES)('%s calls isGuestBookingDateAllowed', (route) => {
    const source = sourceOf(route);

    expect(source).toContain('isGuestBookingDateAllowed');
    // Imported AND invoked: an unused import would satisfy a naive contains().
    expect(source).toMatch(/isGuestBookingDateAllowed\s*\(/);
  });

  it.each(PUBLIC_CREATE_ROUTES)('%s loads the window it checks against', (route) => {
    const source = sourceOf(route);
    expect(source).toContain('loadServiceEntityBookingWindow');
  });

  it('group members are checked on their own date, not a shared one', () => {
    // A group is not necessarily same-day: each person carries `booking_date`.
    // Checking a single shared date would pass a member booked months out.
    const source = sourceOf('src/app/api/booking/create-group/route.ts');
    expect(source).toMatch(/isGuestBookingDateAllowed\(\s*person\.booking_date/);
  });
});
