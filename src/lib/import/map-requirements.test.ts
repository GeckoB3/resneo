import { describe, expect, it } from 'vitest';
import {
  computeFileRequirements,
  effectiveMappedFields,
  type RequirementFile,
  type RequirementMapping,
} from './map-requirements';

function file(overrides: Partial<RequirementFile> = {}): RequirementFile {
  return {
    id: 'f1',
    filename: 'export.csv',
    file_type: 'clients',
    sample_rows: null,
    ...overrides,
  };
}

function mapping(
  target_field: string | null,
  overrides: Partial<RequirementMapping> = {},
): RequirementMapping {
  return {
    file_id: 'f1',
    source_column: target_field ?? 'col',
    target_field,
    action: 'map',
    ...overrides,
  };
}

describe('effectiveMappedFields', () => {
  it('includes split parts as mapped fields', () => {
    const fields = effectiveMappedFields('f1', [
      mapping(null, {
        action: 'split',
        source_column: 'Name',
        split_config: { separator: ' ', parts: [{ field: 'first_name' }, { field: 'last_name' }] },
      }),
    ]);
    expect(fields.has('first_name')).toBe(true);
    expect(fields.has('last_name')).toBe(true);
  });
});

describe('computeFileRequirements — clients', () => {
  it('is satisfied by full_name alone', () => {
    const req = computeFileRequirements(file(), [mapping('full_name')]);
    expect(req.satisfied).toBe(true);
  });

  it('is satisfied by a name split configured on the Map step', () => {
    const req = computeFileRequirements(file(), [
      mapping(null, {
        action: 'split',
        source_column: 'Name',
        split_config: { separator: ' ', parts: [{ field: 'first_name' }, { field: 'last_name' }] },
      }),
    ]);
    expect(req.satisfied).toBe(true);
  });

  it('explains what to do when no name is mapped', () => {
    const req = computeFileRequirements(file(), [mapping('email')]);
    expect(req.satisfied).toBe(false);
    const nameItem = req.items.find((i) => i.key === 'client_name');
    expect(nameItem?.satisfied).toBe(false);
    expect(nameItem?.hint).toMatch(/Full Name/);
  });
});

describe('computeFileRequirements — bookings', () => {
  const bookingsFile = (sampleRows: Record<string, string>[] | null = null) =>
    file({ file_type: 'bookings', sample_rows: sampleRows });

  it('accepts guest names as the client identity (no email/phone needed)', () => {
    const req = computeFileRequirements(bookingsFile(), [
      mapping('booking_date'),
      mapping('booking_time'),
      mapping('guest_full_name'),
    ]);
    expect(req.satisfied).toBe(true);
  });

  it('blocks when there is no way at all to identify the client', () => {
    const req = computeFileRequirements(bookingsFile(), [
      mapping('booking_date'),
      mapping('booking_time'),
    ]);
    expect(req.satisfied).toBe(false);
    expect(req.items.find((i) => i.key === 'booking_identity')?.satisfied).toBe(false);
  });

  it('treats a combined date+time column mapped to booking_date as satisfying time', () => {
    const req = computeFileRequirements(
      bookingsFile([{ 'Appointment start': '14/03/2026 14:30' }]),
      [
        mapping('booking_date', { source_column: 'Appointment start' }),
        mapping('client_email'),
      ],
    );
    expect(req.satisfied).toBe(true);
    const timeItem = req.items.find((i) => i.key === 'booking_time');
    expect(timeItem?.satisfied).toBe(true);
    expect(timeItem?.hint).toMatch(/automatically/);
  });

  it('accepts a date+time split configured on the Map step', () => {
    const req = computeFileRequirements(bookingsFile(), [
      mapping(null, {
        action: 'split',
        source_column: 'When',
        split_config: { separator: ' ', parts: [{ field: 'booking_date' }, { field: 'booking_time' }] },
      }),
      mapping('client_phone'),
    ]);
    expect(req.satisfied).toBe(true);
  });
});

describe('computeFileRequirements — staff', () => {
  it('requires some staff name mapping', () => {
    const blocked = computeFileRequirements(file({ file_type: 'staff' }), []);
    expect(blocked.satisfied).toBe(false);

    const ok = computeFileRequirements(file({ file_type: 'staff' }), [mapping('staff_name')]);
    expect(ok.satisfied).toBe(true);

    const viaParts = computeFileRequirements(file({ file_type: 'staff' }), [
      mapping('staff_first_name'),
    ]);
    expect(viaParts.satisfied).toBe(true);
  });
});
