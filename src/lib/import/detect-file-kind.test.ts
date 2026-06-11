import { describe, expect, it } from 'vitest';
import { detectFileKind } from './detect-file-kind';
import { profileColumns } from './column-profile';

function profilesFor(headers: string[], rows: Record<string, string>[]) {
  return profileColumns(headers, rows);
}

describe('detectFileKind', () => {
  it('detects a booking history from date/time columns', () => {
    const headers = ['Client Name', 'Service', 'Date', 'Start Time'];
    const rows = [
      { 'Client Name': 'Sarah Jones', Service: 'Haircut', Date: '14/03/2026', 'Start Time': '14:30' },
      { 'Client Name': 'John Smith', Service: 'Colour', Date: '15/03/2026', 'Start Time': '10:00' },
    ];
    const d = detectFileKind({
      filename: 'export.csv',
      headers,
      rowCount: rows.length,
      columnProfiles: profilesFor(headers, rows),
    });
    expect(d.kind).toBe('bookings');
    expect(d.confidence).toBe('high');
  });

  it('detects a client list from name/contact columns without dates', () => {
    const headers = ['First Name', 'Last Name', 'Email', 'Mobile'];
    const rows = [
      { 'First Name': 'Sarah', 'Last Name': 'Jones', Email: 'sarah@example.com', Mobile: '07700900123' },
    ];
    const d = detectFileKind({
      filename: 'customers.csv',
      headers,
      rowCount: rows.length,
      columnProfiles: profilesFor(headers, rows),
    });
    expect(d.kind).toBe('clients');
    expect(d.confidence).toBe('high');
  });

  it('detects a staff roster from filename and role columns', () => {
    const headers = ['Name', 'Role', 'Email'];
    const rows = [{ Name: 'Alice Brown', Role: 'Senior Stylist', Email: 'alice@salon.com' }];
    const d = detectFileKind({
      filename: 'staff_list.xlsx',
      headers,
      rowCount: rows.length,
      columnProfiles: profilesFor(headers, rows),
    });
    expect(d.kind).toBe('staff');
    expect(d.confidence).toBe('high');
  });

  it('returns unknown when the evidence is unclear', () => {
    const headers = ['A', 'B'];
    const rows = [{ A: '1', B: '2' }];
    const d = detectFileKind({
      filename: 'data.csv',
      headers,
      rowCount: rows.length,
      columnProfiles: profilesFor(headers, rows),
    });
    expect(d.kind).toBe('unknown');
  });
});
