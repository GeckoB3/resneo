import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * SA-H7 is an instance of this codebase's most common defect shape: a rule got
 * right in one place and not carried to its siblings. `isGuestBookingDateAllowed`
 * is the only real enforcement of a service's booking window, because the
 * engine's `allowSameDayBooking` is assigned and never read. `booking/create`
 * called it. `create-multi-service` and `create-group` did not.
 *
 * ---------------------------------------------------------------------------
 * A CORRECTION THIS FILE ORIGINALLY GOT WRONG, and it caused a live regression.
 *
 * The first version of this comment said both routes "are anonymous public
 * flows". They are not. They have no staff authentication, but they are also
 * where the STAFF MOBILE APP creates every multi-service visit and every group
 * booking, with a `source` of `phone` or `walk-in`. The unconditional guest
 * check written on that false premise refused walk-ins — which are always today
 * — on any venue with `allow_same_day_booking: false`. Staff at the counter got
 * a 400 on a booking they were standing there taking.
 *
 * Both routes already branched on `source` several times for compliance
 * context, entitlement blocking and address requirements, so the distinction
 * was there to be read and was not read.
 *
 * The fix mirrors `api/venue/bookings`: only `walk-in` skips the same-day rule,
 * so a visit, a group and a single booking now answer identically. A staff
 * PHONE booking still gets the guest rule, matching singles.
 *
 * ---------------------------------------------------------------------------
 * This is a bypass guard, not a behaviour test: it proves the calls are present
 * in each route, not that they are reached on every branch. The routes are
 * several hundred lines with Stripe, compliance and add-on resolution in the
 * path, so a behavioural test of the window alone would cost more than it
 * proves. Staging testing covers reached-ness by booking an out-of-window date
 * through each flow.
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

/**
 * The regression guard. Without this, reverting to a single unconditional
 * `isGuestBookingDateAllowed` still satisfies every assertion above, which is
 * exactly how the original defect passed its own test.
 */
describe('staff walk-ins are not refused by the guest same-day rule', () => {
  const STAFF_CAPABLE_ROUTES = [
    'src/app/api/booking/create-multi-service/route.ts',
    'src/app/api/booking/create-group/route.ts',
  ];

  it.each(STAFF_CAPABLE_ROUTES)('%s uses the staff helper for walk-ins', (route) => {
    const source = sourceOf(route);
    expect(source).toContain('isStaffWalkInBookingDateAllowed');
    expect(source).toMatch(/isStaffWalkInBookingDateAllowed\s*\(/);
  });

  it.each(STAFF_CAPABLE_ROUTES)('%s selects the helper on source, not unconditionally', (route) => {
    const source = sourceOf(route);
    // The ternary is the whole fix: a bare guest call would refuse the counter
    // booking staff are standing there taking.
    expect(source).toMatch(/source === 'walk-in'\s*\?\s*isStaffWalkInBookingDateAllowed/);
  });

  /**
   * Parity with singles is the bar, and `api/venue/bookings` is the reference:
   * a staff PHONE booking keeps the guest rule there, so it must here too.
   * Asserted so that widening phone becomes a deliberate product decision
   * rather than something that drifts in.
   */
  it('keeps the reference implementation in api/venue/bookings on walk-in only', () => {
    const source = sourceOf('src/app/api/venue/bookings/route.ts');
    expect(source).toMatch(/staffWalkIn\s*\n?\s*\?\s*isStaffWalkInBookingDateAllowed/);
    expect(source).toMatch(/const staffWalkIn = bookingSource === 'walk-in'/);
  });
});
