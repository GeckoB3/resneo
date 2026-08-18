import { describe, expect, it } from 'vitest';
import {
  resolveStaffVisitChargeDiscretion,
  type VisitBookingSource,
} from './staff-visit-charge-discretion';

/**
 * The rules these assertions pin are not new: `POST /api/venue/bookings` has
 * applied them to single bookings for a long time. What was new was that the
 * two VISIT routes never applied them at all, because they were written as
 * public endpoints and only later became the staff surfaces' multi-service and
 * group create routes. A staff two-service visit of a deposit-taking service
 * had no way to skip the deposit and stuck at `Pending`.
 *
 * The public cases matter as much as the staff ones: the visit routes have no
 * staff authentication, so `require_deposit` has to be IGNORED for public
 * sources rather than merely defaulted, or a crafted body would waive a guest's
 * deposit.
 */

const PUBLIC_SOURCES: VisitBookingSource[] = ['online', 'widget', 'booking_page'];

describe('resolveStaffVisitChargeDiscretion', () => {
  describe('public sources always charge what the catalog says', () => {
    it.each(PUBLIC_SOURCES)('%s charges even with require_deposit false', (source) => {
      const d = resolveStaffVisitChargeDiscretion({
        source,
        require_deposit: false,
        require_card_hold: false,
      });

      expect(d.isStaffSource).toBe(false);
      expect(d.chargeDeposits).toBe(true);
      expect(d.holdCards).toBe(true);
    });

    it.each(PUBLIC_SOURCES)('%s charges when the fields are absent', (source) => {
      const d = resolveStaffVisitChargeDiscretion({ source });

      expect(d.chargeDeposits).toBe(true);
      expect(d.holdCards).toBe(true);
    });
  });

  describe('staff phone bookings opt in', () => {
    it('does not charge by default, matching the unchecked checkbox', () => {
      const d = resolveStaffVisitChargeDiscretion({ source: 'phone' });

      expect(d.isStaffSource).toBe(true);
      expect(d.isWalkIn).toBe(false);
      expect(d.chargeDeposits).toBe(false);
    });

    it('does not charge when the checkbox is explicitly unchecked', () => {
      expect(
        resolveStaffVisitChargeDiscretion({ source: 'phone', require_deposit: false })
          .chargeDeposits,
      ).toBe(false);
    });

    it('charges when the checkbox is ticked', () => {
      expect(
        resolveStaffVisitChargeDiscretion({ source: 'phone', require_deposit: true })
          .chargeDeposits,
      ).toBe(true);
    });
  });

  describe('staff walk-ins never charge', () => {
    it('does not charge even when require_deposit is true', () => {
      const d = resolveStaffVisitChargeDiscretion({ source: 'walk-in', require_deposit: true });

      expect(d.isWalkIn).toBe(true);
      expect(d.chargeDeposits).toBe(false);
    });
  });

  describe('card holds are a separate decision, defaulting on', () => {
    it('holds by default for staff phone bookings', () => {
      expect(resolveStaffVisitChargeDiscretion({ source: 'phone' }).holdCards).toBe(true);
    });

    it('holds by default on walk-ins too (D6)', () => {
      expect(resolveStaffVisitChargeDiscretion({ source: 'walk-in' }).holdCards).toBe(true);
    });

    it('drops the hold when staff switch it off', () => {
      expect(
        resolveStaffVisitChargeDiscretion({ source: 'phone', require_card_hold: false }).holdCards,
      ).toBe(false);
    });

    it('is independent of the deposit decision', () => {
      const d = resolveStaffVisitChargeDiscretion({
        source: 'phone',
        require_deposit: true,
        require_card_hold: false,
      });

      expect(d.chargeDeposits).toBe(true);
      expect(d.holdCards).toBe(false);
    });
  });
});
