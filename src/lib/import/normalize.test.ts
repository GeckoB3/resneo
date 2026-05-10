import { describe, expect, it } from 'vitest';
import {
  durationMinutesBetweenTimes,
  mapImportBookingStatus,
  resolveDepositFromImport,
  todayIsoLocal,
} from './normalize';

describe('todayIsoLocal', () => {
  it('returns a YYYY-MM-DD string', () => {
    expect(todayIsoLocal()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('resolveDepositFromImport', () => {
  it('maps amount + paid true to Paid', () => {
    expect(
      resolveDepositFromImport({
        amountRaw: '£25.00',
        paidRaw: 'yes',
        statusRaw: undefined,
      }),
    ).toEqual({ deposit_status: 'Paid', deposit_amount_pence: 2500 });
  });

  it('maps amount + paid false to Pending', () => {
    expect(
      resolveDepositFromImport({
        amountRaw: '10',
        paidRaw: 'no',
        statusRaw: undefined,
      }),
    ).toEqual({ deposit_status: 'Pending', deposit_amount_pence: 1000 });
  });

  it('defaults amount-only to Paid', () => {
    expect(
      resolveDepositFromImport({
        amountRaw: '5.50',
        paidRaw: '',
        statusRaw: undefined,
      }),
    ).toEqual({ deposit_status: 'Paid', deposit_amount_pence: 550 });
  });

  it('respects explicit deposit status text', () => {
    expect(
      resolveDepositFromImport({
        amountRaw: '20',
        paidRaw: 'no',
        statusRaw: 'Refunded',
      }),
    ).toEqual({ deposit_status: 'Refunded', deposit_amount_pence: 2000 });
  });

  it('returns Not Required when nothing mapped', () => {
    expect(
      resolveDepositFromImport({
        amountRaw: '',
        paidRaw: '',
        statusRaw: undefined,
      }),
    ).toEqual({ deposit_status: 'Not Required', deposit_amount_pence: null });
  });
});

describe('durationMinutesBetweenTimes', () => {
  it('computes span between same-day times', () => {
    expect(durationMinutesBetweenTimes('09:00:00', '09:45:00')).toBe(45);
  });
});

describe('mapImportBookingStatus', () => {
  it('maps Phorest PAID to Completed', () => {
    expect(mapImportBookingStatus({ rawStatus: 'PAID', activationState: null, deletedFlag: null })).toBe('Completed');
  });

  it('maps activation CANCELED to Cancelled', () => {
    expect(mapImportBookingStatus({ rawStatus: 'BOOKED', activationState: 'CANCELED', deletedFlag: null })).toBe(
      'Cancelled',
    );
  });

  it('falls back to generic status parsing', () => {
    expect(mapImportBookingStatus({ rawStatus: 'cancelled', activationState: null, deletedFlag: null })).toBe(
      'Cancelled',
    );
  });
});
