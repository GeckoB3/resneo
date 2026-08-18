/**
 * Staff discretion over money on the two VISIT create routes.
 *
 * `POST /api/booking/create-multi-service` and `POST /api/booking/create-group`
 * were written as anonymous public endpoints and only later became the routes
 * the staff surfaces and the staff mobile app use for every multi-service and
 * group visit. The public premise left them with no per-booking charge
 * discretion at all: they read the deposit straight off the catalog, so a staff
 * member taking a two-service visit over the phone got a `Pending` row and a
 * Stripe payment step with no way past it, while the same two services booked
 * one at a time through `POST /api/venue/bookings` confirmed immediately.
 *
 * (The same wrong premise already produced one bug in these routes: the
 * same-day booking gate, which refused walk-ins staff were standing there
 * taking. See the comment above `msDateAllowed` in create-multi-service.)
 *
 * This resolves the same rules `POST /api/venue/bookings` applies to single
 * bookings, so a visit and a single booking answer identically:
 *
 * - Public sources (`online`, `widget`, `booking_page`) charge whatever the
 *   catalog says. The request fields are IGNORED, not merely defaulted, so a
 *   crafted public body can never waive a guest's deposit.
 * - Staff phone bookings charge only when `require_deposit` is explicitly true.
 *   Default off, matching the unchecked checkbox staff see.
 * - Staff walk-ins never charge, whatever the field says (spec 2.8: "walk-ins
 *   never collect deposits in any model").
 * - Card holds are a separate decision with its own toggle, default ON, and
 *   walk-ins ARE included (D6). The two are never offered together.
 */

export type VisitBookingSource = 'online' | 'phone' | 'walk-in' | 'widget' | 'booking_page';

export type StaffVisitChargeDiscretion = {
  /** True for the two staff sources. Public sources never reach the toggles. */
  isStaffSource: boolean;
  /** True for `walk-in`, which is never charged a deposit. */
  isWalkIn: boolean;
  /**
   * When false, every segment's chargeable deposit (both `deposit` and
   * `full_payment`) is zeroed before the totals are summed, which is what turns
   * the visit into a confirmed, no-payment-step booking downstream.
   */
  chargeDeposits: boolean;
  /** When false, card-hold fees are dropped and no SetupIntent is created. */
  holdCards: boolean;
};

export function resolveStaffVisitChargeDiscretion(input: {
  source: VisitBookingSource;
  require_deposit?: boolean;
  require_card_hold?: boolean;
}): StaffVisitChargeDiscretion {
  const isWalkIn = input.source === 'walk-in';
  const isStaffSource = isWalkIn || input.source === 'phone';

  if (!isStaffSource) {
    return { isStaffSource: false, isWalkIn: false, chargeDeposits: true, holdCards: true };
  }

  return {
    isStaffSource: true,
    isWalkIn,
    chargeDeposits: !isWalkIn && (input.require_deposit ?? false),
    holdCards: input.require_card_hold ?? true,
  };
}
