import { describe, expect, it } from 'vitest';
import {
  resolveAppointmentServiceOnlineCharge,
  resolveAppointmentServiceOnlineChargeWithAddons,
} from './appointment-service-payment';

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
});
