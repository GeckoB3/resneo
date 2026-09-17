/** Imported bookings on parked services are kept; future ones carry a note (owner, 2026-09-17). */
import { describe, expect, it } from 'vitest';
import { parkedImportNote } from './execute-skip-audit';

const bookable = new Set(['on-page']);

describe('parkedImportNote', () => {
  it('notes a future booking on a parked service', () => {
    expect(parkedImportNote(bookable, 'parked', '2026-09-18', '2026-09-17')).toMatchObject({ code: 'parked_service' });
    expect(parkedImportNote(bookable, 'parked', '2026-09-17', '2026-09-17')).toMatchObject({ code: 'parked_service' });
  });

  it('says nothing for past bookings, services on the page, or a venue outside a collective', () => {
    expect(parkedImportNote(bookable, 'parked', '2026-09-16', '2026-09-17')).toBeNull();
    expect(parkedImportNote(bookable, 'on-page', '2026-09-18', '2026-09-17')).toBeNull();
    expect(parkedImportNote(null, 'parked', '2026-09-18', '2026-09-17')).toBeNull();
    expect(parkedImportNote(bookable, null, '2026-09-18', '2026-09-17')).toBeNull();
  });

  it('is written without em-dashes', () => {
    expect(parkedImportNote(bookable, 'parked', '2026-09-18', '2026-09-17')!.message).not.toContain('—');
  });
});
