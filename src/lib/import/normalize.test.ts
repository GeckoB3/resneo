import { describe, expect, it } from 'vitest';
import {
  durationMinutesBetweenTimes,
  mapBookingStatus,
  mapImportBookingStatus,
  normalisePhone,
  parseCurrencyPence,
  parseDateString,
  parseTimeString,
  resolveDepositFromImport,
  splitFullName,
  todayIsoLocal,
} from './normalize';

describe('parseTimeString', () => {
  it('parses 24-hour times', () => {
    expect(parseTimeString('14:30')).toBe('14:30:00');
    expect(parseTimeString('9:05')).toBe('09:05:00');
    expect(parseTimeString('14:30:45')).toBe('14:30:00');
  });

  it('parses 12-hour AM/PM times', () => {
    expect(parseTimeString('2:30 PM')).toBe('14:30:00');
    expect(parseTimeString('2:30pm')).toBe('14:30:00');
    expect(parseTimeString('2.30 pm')).toBe('14:30:00');
    expect(parseTimeString('12 AM')).toBe('00:00:00');
    expect(parseTimeString('12:15 p.m.')).toBe('12:15:00');
    expect(parseTimeString('9 am')).toBe('09:00:00');
  });

  it('extracts the time from combined datetimes', () => {
    expect(parseTimeString('2026-03-14T14:30:00')).toBe('14:30:00');
    expect(parseTimeString('2026-03-14 14:30')).toBe('14:30:00');
    expect(parseTimeString('14/03/2026 2:30 PM')).toBe('14:30:00');
  });

  it('rejects nonsense', () => {
    expect(parseTimeString('25:99')).toBeNull();
    expect(parseTimeString('13:00 PM')).toBeNull();
    expect(parseTimeString('soon')).toBeNull();
    expect(parseTimeString('')).toBeNull();
  });
});

describe('parseCurrencyPence', () => {
  it('parses UK formats', () => {
    expect(parseCurrencyPence('£45.00')).toBe(4500);
    expect(parseCurrencyPence('1,234.56')).toBe(123456);
    expect(parseCurrencyPence('1,234')).toBe(123400);
  });

  it('parses European decimal-comma formats to the correct value', () => {
    expect(parseCurrencyPence('1.234,56')).toBe(123456);
    expect(parseCurrencyPence('12,50')).toBe(1250);
    expect(parseCurrencyPence('€ 1 234,56')).toBe(123456);
    expect(parseCurrencyPence('1.234.567')).toBe(123456700);
  });

  it('returns null for non-numeric input', () => {
    expect(parseCurrencyPence('free')).toBeNull();
    expect(parseCurrencyPence('')).toBeNull();
  });
});

describe('normalisePhone', () => {
  it('normalises UK national numbers (default GB)', () => {
    expect(normalisePhone('07725 002233')).toEqual({ e164: '+447725002233', warning: false });
  });

  it('normalises international numbers with + prefix', () => {
    expect(normalisePhone('+353 87 123 4567')).toEqual({ e164: '+353871234567', warning: false });
  });

  it('normalises 00-prefixed international numbers', () => {
    expect(normalisePhone('00353871234567')).toEqual({ e164: '+353871234567', warning: false });
  });

  it('recovers international numbers exported without the +', () => {
    expect(normalisePhone('447725002233')).toEqual({ e164: '+447725002233', warning: false });
  });

  it('strips Excel numeric artifacts', () => {
    expect(normalisePhone('447725002233.0')).toEqual({ e164: '+447725002233', warning: false });
  });

  it('keeps unparseable values with a warning', () => {
    expect(normalisePhone('ext. 12')).toEqual({ e164: 'ext. 12', warning: true });
  });

  it('normalises non-UK national numbers against the venue country', () => {
    // Irish mobile in national format only resolves with an IE default region.
    expect(normalisePhone('087 123 4567', 'IE')).toEqual({ e164: '+353871234567', warning: false });
    // French mobile in national format.
    expect(normalisePhone('06 12 34 56 78', 'FR')).toEqual({ e164: '+33612345678', warning: false });
    // US national number.
    expect(normalisePhone('(415) 555-2671', 'US')).toEqual({ e164: '+14155552671', warning: false });
  });

  it('still parses + / country-coded numbers regardless of default region', () => {
    expect(normalisePhone('+1 415 555 2671', 'IE')).toEqual({ e164: '+14155552671', warning: false });
  });
});

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

  it('maps common provider status codes/abbreviations', () => {
    expect(mapBookingStatus('CXL')).toBe('Cancelled');
    expect(mapBookingStatus('cx')).toBe('Cancelled');
    expect(mapBookingStatus('NS')).toBe('No-Show');
    expect(mapBookingStatus('DNA')).toBe('No-Show');
    expect(mapBookingStatus('did not attend')).toBe('No-Show');
    expect(mapBookingStatus('attended')).toBe('Completed');
    expect(mapBookingStatus('Done')).toBe('Completed');
    expect(mapBookingStatus('checked-in')).toBe('Seated');
    expect(mapBookingStatus('New')).toBe('Pending');
    expect(mapBookingStatus('Confirmed')).toBe('Booked');
    // Whole-value matching: "ns" inside a word must not trigger No-Show.
    expect(mapBookingStatus('Insurance')).toBe('Booked');
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
