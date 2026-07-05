import { describe, expect, it } from 'vitest';
import {
  resolveStaffEntityCardHold,
  resolveStaffTableSlotCardHold,
  STAFF_CARD_HOLD_CREATED_TOAST,
  STAFF_CARD_HOLD_TOGGLE_LABEL,
  STAFF_CARD_HOLD_TOGGLE_SUBLABEL,
  STAFF_CARD_HOLD_LINK_SENT_LINE,
  staffCardHoldFeeLine,
} from './staff-card-hold';

describe('staff card-hold copy (design doc 7.6)', () => {
  it('uses the exact toggle label and sublabel', () => {
    expect(STAFF_CARD_HOLD_TOGGLE_LABEL).toBe('Card hold');
    expect(STAFF_CARD_HOLD_TOGGLE_SUBLABEL).toBe(
      'Send a link to the guest to add their card details',
    );
  });

  it('uses the exact success toast with an ASCII hyphen', () => {
    expect(STAFF_CARD_HOLD_CREATED_TOAST).toBe('Booking created - card request link sent');
  });

  it('contains no em-dashes in any staff-facing string', () => {
    for (const s of [
      STAFF_CARD_HOLD_TOGGLE_LABEL,
      STAFF_CARD_HOLD_TOGGLE_SUBLABEL,
      STAFF_CARD_HOLD_CREATED_TOAST,
      STAFF_CARD_HOLD_LINK_SENT_LINE,
      staffCardHoldFeeLine(2550),
    ]) {
      expect(s).not.toMatch(/—/);
    }
  });

  it('formats the fee line from pence', () => {
    expect(staffCardHoldFeeLine(2500)).toBe('No-show fee up to £25.00');
    expect(staffCardHoldFeeLine(1050)).toBe('No-show fee up to £10.50');
  });
});

describe('resolveStaffTableSlotCardHold (tables, D5 staff semantics)', () => {
  it('returns per-person fee times party size, ignoring any threshold gating', () => {
    const slot = { deposit_type: 'card_hold' as const, configured_deposit_per_person_gbp: 10 };
    expect(resolveStaffTableSlotCardHold(slot, 4)).toEqual({ feePence: 4000 });
  });

  it('handles fractional per-person amounts without float drift', () => {
    const slot = { deposit_type: 'card_hold' as const, configured_deposit_per_person_gbp: 12.5 };
    expect(resolveStaffTableSlotCardHold(slot, 3)).toEqual({ feePence: 3750 });
  });

  it('returns null for charge-type slots (deposit toggle keeps its behaviour)', () => {
    expect(
      resolveStaffTableSlotCardHold(
        { deposit_type: 'charge', configured_deposit_per_person_gbp: 10 },
        2,
      ),
    ).toBeNull();
  });

  it('returns null without a positive configured amount', () => {
    expect(
      resolveStaffTableSlotCardHold(
        { deposit_type: 'card_hold', configured_deposit_per_person_gbp: null },
        2,
      ),
    ).toBeNull();
    expect(
      resolveStaffTableSlotCardHold(
        { deposit_type: 'card_hold', configured_deposit_per_person_gbp: 0 },
        2,
      ),
    ).toBeNull();
  });

  it('returns null for missing slots and slots without deposit fields', () => {
    expect(resolveStaffTableSlotCardHold(null, 2)).toBeNull();
    expect(resolveStaffTableSlotCardHold(undefined, 2)).toBeNull();
    expect(resolveStaffTableSlotCardHold({}, 2)).toBeNull();
  });

  it('treats a nonsense party size as one cover', () => {
    const slot = { deposit_type: 'card_hold' as const, configured_deposit_per_person_gbp: 10 };
    expect(resolveStaffTableSlotCardHold(slot, 0)).toEqual({ feePence: 1000 });
    expect(resolveStaffTableSlotCardHold(slot, Number.NaN)).toEqual({ feePence: 1000 });
  });
});

describe('resolveStaffEntityCardHold (appointments, classes, events, resources)', () => {
  it('resolves a card-hold entity when the venue flag is on', () => {
    expect(
      resolveStaffEntityCardHold({
        paymentRequirement: 'card_hold',
        feePerUnitPence: 2500,
        cardHoldFlagEnabled: true,
      }),
    ).toEqual({ feePence: 2500 });
  });

  it('multiplies by units (spots / tickets)', () => {
    expect(
      resolveStaffEntityCardHold({
        paymentRequirement: 'card_hold',
        feePerUnitPence: 1500,
        cardHoldFlagEnabled: true,
        units: 3,
      }),
    ).toEqual({ feePence: 4500 });
  });

  it('returns null when the venue flag is off (payloads are flag-independent)', () => {
    expect(
      resolveStaffEntityCardHold({
        paymentRequirement: 'card_hold',
        feePerUnitPence: 2500,
        cardHoldFlagEnabled: false,
      }),
    ).toBeNull();
  });

  it('returns null for other payment requirements', () => {
    for (const req of ['none', 'deposit', 'full_payment', null, undefined]) {
      expect(
        resolveStaffEntityCardHold({
          paymentRequirement: req,
          feePerUnitPence: 2500,
          cardHoldFlagEnabled: true,
        }),
      ).toBeNull();
    }
  });

  it('accepts the appointment chargeLabel union directly', () => {
    // The appointment flow passes resolveAppointmentServiceOnlineCharge().chargeLabel.
    const chargeLabel: 'deposit' | 'full_payment' | 'card_hold' = 'card_hold';
    expect(
      resolveStaffEntityCardHold({
        paymentRequirement: chargeLabel,
        feePerUnitPence: 3000,
        cardHoldFlagEnabled: true,
      }),
    ).toEqual({ feePence: 3000 });
  });

  it('returns null for zero, negative, or missing fees (zero-fee safety, design doc 6.3)', () => {
    for (const fee of [0, -100, null, undefined, Number.NaN]) {
      expect(
        resolveStaffEntityCardHold({
          paymentRequirement: 'card_hold',
          feePerUnitPence: fee,
          cardHoldFlagEnabled: true,
        }),
      ).toBeNull();
    }
  });

  it('treats a nonsense units value as one unit', () => {
    expect(
      resolveStaffEntityCardHold({
        paymentRequirement: 'card_hold',
        feePerUnitPence: 1000,
        cardHoldFlagEnabled: true,
        units: 0,
      }),
    ).toEqual({ feePence: 1000 });
  });
});
