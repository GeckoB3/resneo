import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Another instance of this codebase's most common defect shape: a rule got
 * right in one place and not carried to its siblings.
 *
 * Staff must always be able to take a booking without collecting money. That
 * was true of `POST /api/venue/bookings`, which reads `require_deposit`, and
 * false of both visit routes, which read the deposit straight off the catalog.
 * The staff appointment flow posts to all three depending on the SHAPE of the
 * booking, so one service worked and two did not: a staff multi-service visit
 * of a deposit-taking service landed `Pending` with a Stripe payment step and
 * no way past it.
 *
 * The client half had the mirror-image bug. Its deposit checkbox was gated on
 * `!(segments.length > 1)`, the exact inverse of the branch that posts to
 * `create-multi-service`, so the control appeared precisely when it was not
 * needed and vanished precisely when it was. The group flow had no control at
 * all.
 *
 * This is a bypass guard, not a behaviour test: it proves each route consults
 * the discretion and each client path sends it. The behaviour of the rules
 * themselves lives in `staff-visit-charge-discretion.test.ts`, and the walk
 * that proves the checkbox reaches the screen lives in
 * `AppointmentBookingFlow.staff-charge.test.tsx`.
 *
 * If a fourth staff-reachable create route appears, add it here.
 */

const VISIT_ROUTES = [
  'src/app/api/booking/create-multi-service/route.ts',
  'src/app/api/booking/create-group/route.ts',
];

const FLOW = 'src/components/booking/AppointmentBookingFlow.tsx';

function sourceOf(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('visit create routes honour staff charge discretion', () => {
  it.each(VISIT_ROUTES)('%s accepts require_deposit and require_card_hold', (route) => {
    const source = sourceOf(route);

    expect(source).toMatch(/require_deposit:\s*z\.boolean\(\)\.optional\(\)/);
    expect(source).toMatch(/require_card_hold:\s*z\.boolean\(\)\.optional\(\)/);
  });

  it.each(VISIT_ROUTES)('%s resolves the discretion rather than trusting the field', (route) => {
    const source = sourceOf(route);

    // Imported AND invoked: an unused import would satisfy a naive contains().
    expect(source).toContain('resolveStaffVisitChargeDiscretion');
    expect(source).toMatch(/resolveStaffVisitChargeDiscretion\s*\(/);
  });

  it.each(VISIT_ROUTES)('%s gates the chargeable amount on the resolved decision', (route) => {
    const source = sourceOf(route);

    // The bug was `else { depositPence = online.amountPence; }` with no gate.
    // Both chargeable labels fall into that branch, so the gate must sit on it.
    expect(source).toMatch(/else if \(staffCharges\.chargeDeposits\) \{/);
    expect(source).toMatch(/staffCharges\.holdCards/);
  });
});

describe('the staff appointment flow sends the decision on every shape', () => {
  it('posts require_deposit from all three create paths', () => {
    const source = sourceOf(FLOW);

    // Single (venue/bookings), multi-service and group. Fewer than three means
    // a shape has silently gone back to taking money staff did not ask for.
    const sent = source.match(/require_deposit[,:]/g) ?? [];
    expect(sent.length).toBeGreaterThanOrEqual(3);
  });

  it('never sends a deposit request for a walk-in', () => {
    const source = sourceOf(FLOW);

    // Spec 2.8: walk-ins never collect deposits in any model. Every send site
    // carries the guard, so a walk-in cannot be charged by any shape.
    const sends = source.match(/require_deposit:\s*[^,\n]+/g) ?? [];
    expect(sends.length).toBeGreaterThan(0);
    for (const send of sends) {
      expect(send).toContain('!isStaffWalkInAppointment');
    }
  });

  it('does not gate the charge control on the segment count', () => {
    const source = sourceOf(FLOW);

    // The original bug, verbatim. It hid the checkbox for exactly the bookings
    // that posted to create-multi-service.
    expect(source).not.toContain('!(multiServiceSegments && multiServiceSegments.length > 1)');
  });

  it('lets the checkbox gate full_payment too, not just deposit', () => {
    const source = sourceOf(FLOW);

    // `full_payment` used to be forced on regardless of the checkbox, so a
    // pay-in-full service could not be booked over the phone at all.
    expect(source).not.toMatch(
      /chargeLabel === 'full_payment' \|\| \(online\.chargeLabel === 'deposit' && staffRequireDeposit\)/,
    );
  });
});

describe('the single-booking route keeps the same rule', () => {
  it('gates both chargeable labels on the staff toggle', () => {
    const source = sourceOf('src/app/api/venue/bookings/route.ts');

    expect(source).not.toMatch(
      /chargeLabel === 'full_payment' \|\| \(online\.chargeLabel === 'deposit' && staffWantsDeposit\)/,
    );
    expect(source).toMatch(/staffWantsDeposit &&/);
  });
});
