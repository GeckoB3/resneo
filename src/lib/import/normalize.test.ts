import { describe, expect, it } from 'vitest';
import {
  durationMinutesBetweenTimes,
  mapBookingStatus,
  mapImportBookingStatus,
  parseDateString,
  resolveDepositFromImport,
  splitFullName,
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

describe('splitFullName', () => {
  it('splits a combined name into first name and surname', () => {
    expect(splitFullName('Sarah Jane Smith')).toEqual({ first: 'Sarah', last: 'Jane Smith' });
  });

  it('keeps a single-token name as the first name only', () => {
    expect(splitFullName('Madonna')).toEqual({ first: 'Madonna', last: '' });
  });

  it('handles "Last, First" comma-separated names', () => {
    expect(splitFullName('Smith, Mary')).toEqual({ first: 'Mary', last: 'Smith' });
  });

  it('falls back to space split when comma split is empty on either side', () => {
    expect(splitFullName(', Mary')).toEqual({ first: ',', last: 'Mary' });
  });
});

describe('parseDateString', () => {
  it('parses dd/MM/yyyy without rolling back on non-UTC machines', () => {
    expect(parseDateString('07/05/2026', 'dd/MM/yyyy')).toEqual({
      iso: '2026-05-07',
      ambiguous: false,
    });
  });

  it('parses ISO yyyy-MM-dd unambiguously', () => {
    expect(parseDateString('2026-05-07')).toEqual({ iso: '2026-05-07', ambiguous: false });
  });

  it('flags ambiguous slash dates when both day and month are <=12', () => {
    const result = parseDateString('05/07/2026');
    expect(result.iso).toBeTruthy();
    expect(result.ambiguous).toBe(true);
  });

  it('respects user date preference for slash dates', () => {
    expect(parseDateString('05/07/2026', 'MM/dd/yyyy')).toEqual({
      iso: '2026-05-07',
      ambiguous: false,
    });
    expect(parseDateString('05/07/2026', 'dd/MM/yyyy')).toEqual({
      iso: '2026-07-05',
      ambiguous: false,
    });
  });

  it('returns null iso for unparseable input', () => {
    expect(parseDateString('not a date')).toEqual({ iso: null, ambiguous: false });
  });
});

describe('mapBookingStatus enum contract', () => {
  /** Lock the contract: every value returned by the import status maps must be a valid `bookings.status` enum. */
  const VALID_BOOKING_STATUSES = new Set([
    'Pending',
    'Confirmed',
    'Cancelled',
    'No-Show',
    'Completed',
    'Seated',
    'Booked',
  ]);

  it('mapBookingStatus only returns values in the bookings.status enum', () => {
    for (const raw of [null, '', 'cancelled', 'no show', 'no-show', 'completed', 'seated', 'pending', 'random']) {
      expect(VALID_BOOKING_STATUSES.has(mapBookingStatus(raw))).toBe(true);
    }
  });

  it('mapImportBookingStatus only returns values in the bookings.status enum', () => {
    const inputs: Array<Parameters<typeof mapImportBookingStatus>[0]> = [
      { rawStatus: 'PAID', activationState: null, deletedFlag: null },
      { rawStatus: 'CHECKED_IN', activationState: null, deletedFlag: null },
      { rawStatus: 'BOOKED', activationState: null, deletedFlag: null },
      { rawStatus: null, activationState: 'CANCELED', deletedFlag: null },
      { rawStatus: null, activationState: null, deletedFlag: 'true' },
      { rawStatus: 'unconfirmed', activationState: null, deletedFlag: null },
    ];
    for (const i of inputs) expect(VALID_BOOKING_STATUSES.has(mapImportBookingStatus(i))).toBe(true);
  });

  it('resolveDepositFromImport only returns values in the deposit_status enum', () => {
    const VALID_DEPOSIT_STATUSES = new Set(['Not Required', 'Pending', 'Paid', 'Refunded', 'Forfeited', 'Waived']);
    const cases = [
      { amountRaw: '£20', paidRaw: 'yes', statusRaw: undefined },
      { amountRaw: '£20', paidRaw: 'no', statusRaw: undefined },
      { amountRaw: '', paidRaw: '', statusRaw: 'Refunded' },
      { amountRaw: '', paidRaw: '', statusRaw: 'Forfeited' },
      { amountRaw: '', paidRaw: '', statusRaw: 'Waived' },
      { amountRaw: '', paidRaw: '', statusRaw: 'Not required' },
      { amountRaw: '', paidRaw: '', statusRaw: undefined },
      { amountRaw: '£10', paidRaw: '', statusRaw: 'pending' },
    ];
    for (const c of cases) {
      const out = resolveDepositFromImport(c);
      expect(VALID_DEPOSIT_STATUSES.has(out.deposit_status)).toBe(true);
    }
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
