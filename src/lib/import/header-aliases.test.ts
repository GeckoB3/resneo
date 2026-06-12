import { describe, it, expect } from 'vitest';
import { aliasMapColumns, normalizeHeader } from '@/lib/import/header-aliases';

describe('normalizeHeader', () => {
  it('lowercases and collapses punctuation/whitespace', () => {
    expect(normalizeHeader('  Start_Time ')).toBe('start time');
    expect(normalizeHeader('E-mail')).toBe('e mail');
    expect(normalizeHeader('Mobile #')).toBe('mobile');
  });
});

describe('aliasMapColumns', () => {
  it('maps a reshaped salon booking export deterministically', () => {
    const headers = [
      'Stylist',
      'Appointment Date',
      'Appointment Time',
      'Client Name',
      'Service Name',
      'First Name',
      'Last Name',
      'Mobile',
      'Email',
    ];
    const map = Object.fromEntries(
      aliasMapColumns(headers, 'bookings').map((m) => [m.source_column, m.target_field]),
    );
    expect(map).toMatchObject({
      Stylist: 'staff_name',
      'Appointment Date': 'booking_date',
      'Appointment Time': 'booking_time',
      'Client Name': 'guest_full_name',
      'Service Name': 'service_name',
      'First Name': 'guest_first_name',
      'Last Name': 'guest_last_name',
      Mobile: 'client_phone',
      Email: 'client_email',
    });
  });

  it('claims each target field once (first matching column wins)', () => {
    // Both "Mobile" and "Phone" alias to client_phone; only the first is kept.
    const result = aliasMapColumns(['Mobile', 'Phone', 'Email'], 'bookings');
    const phoneCols = result.filter((m) => m.target_field === 'client_phone');
    expect(phoneCols).toHaveLength(1);
    expect(phoneCols[0]!.source_column).toBe('Mobile');
  });

  it('maps client-list name/contact columns', () => {
    const map = Object.fromEntries(
      aliasMapColumns(['Forename', 'Surname', 'Email Address', 'Postcode'], 'clients').map((m) => [
        m.source_column,
        m.target_field,
      ]),
    );
    expect(map).toMatchObject({
      Forename: 'first_name',
      Surname: 'last_name',
      'Email Address': 'email',
      Postcode: 'postcode',
    });
  });

  it('returns nothing for unrecognised headers', () => {
    expect(aliasMapColumns(['Sky colour', 'Mood'], 'bookings')).toEqual([]);
  });
});
