import { describe, expect, it } from 'vitest';
import {
  bookingDisplayStart,
  groupAppointmentTextLines,
  isVisitLines,
  linesShareOneDay,
} from '@/lib/emails/group-appointment-display';
import type { BookingEmailData, GroupAppointmentLine } from '@/lib/emails/types';

const line = (over: Partial<GroupAppointmentLine> = {}): GroupAppointmentLine => ({
  person_label: '',
  booking_date: '2026-08-25',
  booking_time: '09:00',
  practitioner_name: 'Neill',
  service_name: 'Full Head Foils',
  price_display: '£110.00',
  ...over,
});

const booking = (over: Partial<BookingEmailData> = {}): BookingEmailData => ({
  id: 'b1',
  guest_name: 'Andrew Courtney',
  guest_email: 'a@example.com',
  booking_date: '2026-08-25',
  booking_time: '11:30',
  party_size: 1,
  ...over,
});

const time = (t: string) => t;
const date = (d: string) => d;

describe('isVisitLines', () => {
  it('is a visit when no line names a person', () => {
    expect(isVisitLines([line(), line({ booking_time: '11:30' })])).toBe(true);
  });
  it('is a party when every line names a person', () => {
    expect(isVisitLines([line({ person_label: 'Alex' }), line({ person_label: 'Sam' })])).toBe(false);
  });
  it('is a party when only some lines name a person, so the named ones keep their name', () => {
    expect(isVisitLines([line({ person_label: 'Alex' }), line()])).toBe(false);
  });
  it('treats a whitespace-only label as no label', () => {
    expect(isVisitLines([line({ person_label: '   ' })])).toBe(true);
  });
  it('is false for no lines at all', () => {
    expect(isVisitLines([])).toBe(false);
  });
});

describe('linesShareOneDay', () => {
  it('is true when every line is on the same date', () => {
    expect(linesShareOneDay([line(), line({ booking_time: '11:30' })])).toBe(true);
  });
  it('is false when the lines span days', () => {
    expect(linesShareOneDay([line(), line({ booking_date: '2026-08-26' })])).toBe(false);
  });
});

describe('bookingDisplayStart', () => {
  it('uses the earliest line, not the row the email was sent for', () => {
    // The reminder fired for the 11:30 service; the visit starts at 09:00.
    expect(
      bookingDisplayStart(
        booking({ group_appointments: [line({ booking_time: '11:30' }), line({ booking_time: '09:00' })] }),
      ),
    ).toEqual({ date: '2026-08-25', time: '09:00' });
  });

  it('compares date before time across days', () => {
    expect(
      bookingDisplayStart(
        booking({
          group_appointments: [
            line({ booking_date: '2026-08-26', booking_time: '08:00' }),
            line({ booking_date: '2026-08-25', booking_time: '17:00' }),
          ],
        }),
      ),
    ).toEqual({ date: '2026-08-25', time: '17:00' });
  });

  it('falls back to the booking itself with no lines', () => {
    expect(bookingDisplayStart(booking())).toEqual({ date: '2026-08-25', time: '11:30' });
    expect(bookingDisplayStart(booking({ group_appointments: [] }))).toEqual({
      date: '2026-08-25',
      time: '11:30',
    });
  });
});

describe('groupAppointmentTextLines', () => {
  it('lists a visit by time and service, with no person named', () => {
    const out = groupAppointmentTextLines(
      [line(), line({ booking_time: '11:30', service_name: 'Blow Dry', price_display: '£30.00' })],
      time,
      date,
    );
    expect(out).toEqual([
      'Services:',
      '  - 09:00, Full Head Foils with Neill, £110.00',
      '  - 11:30, Blow Dry with Neill, £30.00',
    ]);
  });

  it('names each person for a party', () => {
    const out = groupAppointmentTextLines(
      [line({ person_label: 'Alex' }), line({ person_label: 'Sam', booking_time: '10:30' })],
      time,
      date,
    );
    expect(out[1]).toBe('  - Alex, 09:00, Full Head Foils with Neill, £110.00');
    expect(out[2]).toBe('  - Sam, 10:30, Full Head Foils with Neill, £110.00');
  });

  it('includes the date when the lines span days', () => {
    const out = groupAppointmentTextLines([line(), line({ booking_date: '2026-08-26' })], time, date);
    expect(out[1]).toBe('  - 2026-08-25 at 09:00, Full Head Foils with Neill, £110.00');
  });

  it('itemises add-ons and a subtotal under their service', () => {
    const out = groupAppointmentTextLines(
      [line({ addon_lines: ['Olaplex treatment (+£10.00, +15 min)'], subtotal_display: '£120.00' })],
      time,
      date,
    );
    expect(out).toEqual([
      'Services:',
      '  - 09:00, Full Head Foils with Neill, £110.00',
      '      + Olaplex treatment (+£10.00, +15 min)',
      '      Subtotal: £120.00',
    ]);
  });

  it('omits a missing price rather than printing an empty field', () => {
    const out = groupAppointmentTextLines([line({ price_display: null })], time, date);
    expect(out[1]).toBe('  - 09:00, Full Head Foils with Neill');
  });
});
