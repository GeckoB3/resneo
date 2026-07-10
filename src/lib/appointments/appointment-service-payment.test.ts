import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertCardHoldSupportedForModel,
  resolveAppointmentPaymentRequirement,
  resolveAppointmentServiceOnlineCharge,
  resolveAppointmentServiceOnlineChargeWithAddons,
} from './appointment-service-payment';
import type { BookingModel } from '@/types/booking-models';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveAppointmentServiceOnlineCharge', () => {
  it('returns null for none', () => {
    expect(
      resolveAppointmentServiceOnlineCharge({
        payment_requirement: 'none',
        deposit_pence: 500,
        price_pence: 2000,
      }),
    ).toBeNull();
  });

  it('uses deposit_pence for deposit mode', () => {
    expect(
      resolveAppointmentServiceOnlineCharge({
        payment_requirement: 'deposit',
        deposit_pence: 500,
        price_pence: 2000,
      }),
    ).toEqual({ amountPence: 500, chargeLabel: 'deposit' });
  });

  it('uses price for full_payment mode', () => {
    expect(
      resolveAppointmentServiceOnlineCharge({
        payment_requirement: 'full_payment',
        deposit_pence: 0,
        price_pence: 2000,
      }),
    ).toEqual({ amountPence: 2000, chargeLabel: 'full_payment' });
  });

  it('infers deposit from legacy deposit_pence when payment_requirement missing', () => {
    expect(
      resolveAppointmentServiceOnlineCharge({
        payment_requirement: undefined,
        deposit_pence: 300,
        price_pence: null,
      }),
    ).toEqual({ amountPence: 300, chargeLabel: 'deposit' });
  });

  it('resolves explicit card_hold to the deposit fee with the card_hold label', () => {
    expect(
      resolveAppointmentServiceOnlineCharge({
        payment_requirement: 'card_hold',
        deposit_pence: 1500,
        price_pence: 6000,
      }),
    ).toEqual({ amountPence: 1500, chargeLabel: 'card_hold' });
  });

  it('uses the variant-adjusted deposit_pence for card_hold (merged base+variant service)', () => {
    // Callers merge the variant override into deposit_pence before resolving,
    // same contract as the deposit path: the merged value is the fee.
    expect(
      resolveAppointmentServiceOnlineCharge({
        payment_requirement: 'card_hold',
        deposit_pence: 2500, // variant override, not the base 1500
        price_pence: 6000,
      }),
    ).toEqual({ amountPence: 2500, chargeLabel: 'card_hold' });
  });

  it('degrades card_hold with fee <= 0 to none with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(
      resolveAppointmentServiceOnlineCharge({
        payment_requirement: 'card_hold',
        deposit_pence: 0,
        price_pence: 6000,
      }),
    ).toBeNull();
    expect(
      resolveAppointmentServiceOnlineCharge({
        payment_requirement: 'card_hold',
        deposit_pence: null,
        price_pence: 6000,
      }),
    ).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('never infers card_hold from legacy deposit_pence (explicit only)', () => {
    const result = resolveAppointmentServiceOnlineCharge({
      payment_requirement: undefined,
      deposit_pence: 1500,
      price_pence: 6000,
    });
    expect(result).toEqual({ amountPence: 1500, chargeLabel: 'deposit' });
  });
});

describe('resolveAppointmentServiceOnlineChargeWithAddons', () => {
  it('rolls addon prices into full_payment charge', () => {
    expect(
      resolveAppointmentServiceOnlineChargeWithAddons({
        svc: { payment_requirement: 'full_payment', deposit_pence: 0, price_pence: 2000 },
        addons_total_price_pence: 800,
      }),
    ).toEqual({ amountPence: 2800, chargeLabel: 'full_payment' });
  });

  it('keeps deposit fixed at base+variant deposit regardless of addons', () => {
    expect(
      resolveAppointmentServiceOnlineChargeWithAddons({
        svc: { payment_requirement: 'deposit', deposit_pence: 500, price_pence: 2000 },
        addons_total_price_pence: 800,
      }),
    ).toEqual({ amountPence: 500, chargeLabel: 'deposit' });
  });

  it('returns null when payment_requirement is none', () => {
    expect(
      resolveAppointmentServiceOnlineChargeWithAddons({
        svc: { payment_requirement: 'none', deposit_pence: 0, price_pence: 1000 },
        addons_total_price_pence: 200,
      }),
    ).toBeNull();
  });

  it('never includes add-ons in a card_hold fee (same rule as deposit)', () => {
    expect(
      resolveAppointmentServiceOnlineChargeWithAddons({
        svc: { payment_requirement: 'card_hold', deposit_pence: 1500, price_pence: 6000 },
        addons_total_price_pence: 800,
      }),
    ).toEqual({ amountPence: 1500, chargeLabel: 'card_hold' });
  });

  it('degrades card_hold with fee <= 0 to none with a warning (addons path)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(
      resolveAppointmentServiceOnlineChargeWithAddons({
        svc: { payment_requirement: 'card_hold', deposit_pence: 0, price_pence: 6000 },
        addons_total_price_pence: 800,
      }),
    ).toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});

describe('resolveAppointmentPaymentRequirement', () => {
  it('honours explicit card_hold (resolver is feature-flag independent; the gate lives at write paths)', () => {
    // No flag/env setup here on purpose: the resolver must return card_hold purely
    // from the row. Flag gating happens in the config write paths and create routes.
    expect(
      resolveAppointmentPaymentRequirement({ payment_requirement: 'card_hold', deposit_pence: 1500 }),
    ).toBe('card_hold');
  });

  it('keeps legacy inference on deposit (never card_hold)', () => {
    expect(
      resolveAppointmentPaymentRequirement({ payment_requirement: undefined, deposit_pence: 300 }),
    ).toBe('deposit');
  });
});

describe('assertCardHoldSupportedForModel', () => {
  it.each([
    'table_reservation',
    'practitioner_appointment',
    'unified_scheduling',
    'event_ticket',
    'class_session',
    'resource_booking',
  ] as BookingModel[])('does not throw for %s', (model) => {
    expect(() => assertCardHoldSupportedForModel(model)).not.toThrow();
  });

  it('throws for an unknown future model', () => {
    expect(() => assertCardHoldSupportedForModel('course_enrollment' as BookingModel)).toThrow(
      /not supported/,
    );
  });
});
