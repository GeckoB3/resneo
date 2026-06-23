import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SupabaseStub, resetStubIds, type Row } from '@/lib/import/__tests__/supabase-stub';

/**
 * Integration tests for `runExtractBookingReferences` (the stateful core of the
 * data-import "references" stage), driven through an in-memory Supabase stub.
 *
 * WHAT THESE LOCK IN (the recent behaviour change being protected):
 *   - The stage used to stage ONLY future-dated booking rows and only extract
 *     references from them, bailing to a staff-only result when there were no
 *     future rows. It now stages ALL parseable rows (past + future) into
 *     `import_booking_rows` with `is_future_booking` per row, aggregates
 *     `import_booking_references` across ALL rows, and only bails to staff-only
 *     when there are ZERO parseable booking rows.
 *
 * Tests use a `unified_scheduling` venue so both service and staff references are
 * extracted. `resolveVenueMode` is mocked (the real resolver would need the full
 * `venues` + service-config chain seeded); everything else runs against real
 * production code (apply-mappings, normalize, parse-storage-csv, the aggregation
 * loop, and refresh-references-resolved) over the stub.
 *
 * Dates are hard-coded far-past (2020) / far-future (2099) so the past/future
 * split is deterministic regardless of when the suite runs.
 */

// `resolveVenueMode` caches per-venue for 30s and reads venues/service config we
// don't want to seed; mock it to return a unified_scheduling venue mode.
vi.mock('@/lib/venue-mode', () => ({
  resolveVenueMode: vi.fn(async () => ({
    bookingModel: 'unified_scheduling' as const,
    activeBookingModels: ['unified_scheduling' as const],
    enabledModels: [],
    tableManagementEnabled: false,
    availabilityEngine: 'service' as const,
    terminology: {} as never,
  })),
}));

import { runExtractBookingReferences } from '@/lib/import/extract-booking-references';

const VENUE_ID = 'venue-1';
const SESSION_ID = 'session-1';

/** Column mappings for a bookings file: Date->booking_date, Time->booking_time, Service->service_name, Staff->staff_name. */
function bookingMappings(fileId: string): Row[] {
  return [
    { id: 'm1', file_id: fileId, session_id: SESSION_ID, action: 'map', source_column: 'Date', target_field: 'booking_date', split_config: null },
    { id: 'm2', file_id: fileId, session_id: SESSION_ID, action: 'map', source_column: 'Time', target_field: 'booking_time', split_config: null },
    { id: 'm3', file_id: fileId, session_id: SESSION_ID, action: 'map', source_column: 'Service', target_field: 'service_name', split_config: null },
    { id: 'm4', file_id: fileId, session_id: SESSION_ID, action: 'map', source_column: 'Staff', target_field: 'staff_name', split_config: null },
  ];
}

function staffMappings(fileId: string): Row[] {
  return [
    { id: 's1', file_id: fileId, session_id: SESSION_ID, action: 'map', source_column: 'Name', target_field: 'staff_name', split_config: null },
  ];
}

/** Base session/file rows shared by tests; `has_booking_file` and files vary per test. */
function baseSeed(extra: Record<string, Row[]>): Record<string, Row[]> {
  return {
    import_sessions: [
      { id: SESSION_ID, venue_id: VENUE_ID, session_settings: {}, has_booking_file: true },
    ],
    import_booking_rows: [],
    import_booking_references: [],
    ...extra,
  };
}

describe('runExtractBookingReferences — stages all rows (past + future) and aggregates refs from all', () => {
  beforeEach(() => {
    resetStubIds();
    vi.clearAllMocks();
  });

  it('(a) past-only bookings now stage rows (is_future_booking=false) AND produce service/staff references', async () => {
    const fileId = 'file-bookings';
    const csv = [
      'Date,Time,Service,Staff',
      '2020-01-15,10:00,Haircut,Alice',
      '2020-02-20,11:30,Colour,Bob',
    ].join('\n');

    const db = new SupabaseStub(
      baseSeed({
        import_files: [
          { id: fileId, session_id: SESSION_ID, storage_path: 'bookings.csv', file_type: 'bookings', created_at: '2020-01-01T00:00:00Z' },
        ],
        import_column_mappings: bookingMappings(fileId),
      }),
      { files: { 'bookings.csv': csv } },
    );

    const result = await runExtractBookingReferences(db.asClient(), SESSION_ID, VENUE_ID);

    // Two past rows are now STAGED (previously: nothing staged, staff-only bail).
    const stagedRows = db.rows('import_booking_rows');
    expect(stagedRows).toHaveLength(2);
    expect(stagedRows.every((r) => r.is_future_booking === false)).toBe(true);
    expect(stagedRows.map((r) => r.row_number).sort()).toEqual([1, 2]);
    expect(stagedRows.map((r) => r.raw_service_name).sort()).toEqual(['Colour', 'Haircut']);

    // References are now EXTRACTED from past rows (previously: extractedReferenceCount=0).
    const refs = db.rows('import_booking_references');
    const refKey = (r: Row) => `${r.reference_type}:${r.raw_value}`;
    expect(refs.map(refKey).sort()).toEqual(
      ['service:Colour', 'service:Haircut', 'staff:Alice', 'staff:Bob'].sort(),
    );

    expect(result.bookingModel).toBe('unified_scheduling');
    expect(result.insertedBookingRowCount).toBe(2);
    expect(result.extractedReferenceCount).toBe(4);
    expect(result.futureRowCount).toBe(0); // both rows are in the past
    expect(result.requiresTableConfirmation).toBe(false);
    // Mode is a real references-pending state, NOT the old 'no_future_rows' staff-only bail.
    expect(result.mode).not.toBe('no_future_rows');
    expect(['ready', 'unified_refs_pending']).toContain(result.mode);
  });

  it('(b) mix of past + future: references aggregate across BOTH; booking_count reflects all rows', async () => {
    const fileId = 'file-bookings';
    // Haircut appears in BOTH a past and a future row -> count must be 2.
    // Alice (staff) appears in both rows too -> count 2. Colour/Bob appear once (future).
    const csv = [
      'Date,Time,Service,Staff',
      '2020-03-01,09:00,Haircut,Alice', // past
      '2099-06-10,14:00,Haircut,Alice', // future, same service+staff
      '2099-07-11,15:30,Colour,Bob', // future, distinct
    ].join('\n');

    const db = new SupabaseStub(
      baseSeed({
        import_files: [
          { id: fileId, session_id: SESSION_ID, storage_path: 'mixed.csv', file_type: 'bookings', created_at: '2020-01-01T00:00:00Z' },
        ],
        import_column_mappings: bookingMappings(fileId),
      }),
      { files: { 'mixed.csv': csv } },
    );

    const result = await runExtractBookingReferences(db.asClient(), SESSION_ID, VENUE_ID);

    // All three rows staged, with the right per-row future flag.
    const stagedRows = db.rows('import_booking_rows');
    expect(stagedRows).toHaveLength(3);
    const futureByRow = Object.fromEntries(stagedRows.map((r) => [r.row_number, r.is_future_booking]));
    expect(futureByRow[1]).toBe(false); // 2020
    expect(futureByRow[2]).toBe(true); // 2099
    expect(futureByRow[3]).toBe(true); // 2099

    // Aggregation spans past + future: Haircut/Alice counted twice.
    const refs = db.rows('import_booking_references');
    const byKey = new Map(refs.map((r) => [`${r.reference_type}:${r.raw_value}`, r.booking_count]));
    expect(byKey.get('service:Haircut')).toBe(2);
    expect(byKey.get('staff:Alice')).toBe(2);
    expect(byKey.get('service:Colour')).toBe(1);
    expect(byKey.get('staff:Bob')).toBe(1);

    expect(result.insertedBookingRowCount).toBe(3);
    expect(result.futureRowCount).toBe(2);
    expect(result.extractedReferenceCount).toBe(4); // Haircut, Colour, Alice, Bob (deduped types)
  });

  it('(c) staff-list-only import (no bookings) still yields staff references — regression guard', async () => {
    const staffFileId = 'file-staff';
    const csv = ['Name', 'Alice', 'Bob', 'Alice'].join('\n'); // Alice duplicated -> deduped

    const db = new SupabaseStub(
      {
        import_sessions: [
          // No booking file present.
          { id: SESSION_ID, venue_id: VENUE_ID, session_settings: {}, has_booking_file: false },
        ],
        import_booking_rows: [],
        import_booking_references: [],
        import_files: [
          { id: staffFileId, session_id: SESSION_ID, storage_path: 'staff.csv', file_type: 'staff', created_at: '2020-01-01T00:00:00Z' },
        ],
        import_column_mappings: staffMappings(staffFileId),
      },
      { files: { 'staff.csv': csv } },
    );

    const result = await runExtractBookingReferences(db.asClient(), SESSION_ID, VENUE_ID);

    const refs = db.rows('import_booking_references');
    expect(refs).toHaveLength(2);
    expect(refs.every((r) => r.reference_type === 'staff')).toBe(true);
    expect(refs.map((r) => r.raw_value).sort()).toEqual(['Alice', 'Bob']);
    // Staff-list refs carry booking_count 0 (they are not booking-derived).
    expect(refs.every((r) => r.booking_count === 0)).toBe(true);

    expect(result.mode).toBe('no_booking_file');
    expect(result.staffReferenceCount).toBe(2);
    expect(result.insertedBookingRowCount).toBe(0);
    expect(db.rows('import_booking_rows')).toHaveLength(0);
  });

  it('staff-list members already named by a booking row are not double-counted as staff refs', async () => {
    // Combined bookings + staff: Alice is booked (service ref) AND on the staff list.
    // The booking yields a staff ref for Alice; the staff-list path must exclude
    // Alice (already referenced) and only add Carol.
    const bookingsFileId = 'file-bookings';
    const staffFileId = 'file-staff';
    const bookingsCsv = ['Date,Time,Service,Staff', '2020-04-01,10:00,Haircut,Alice'].join('\n');
    const staffCsv = ['Name', 'Alice', 'Carol'].join('\n');

    const db = new SupabaseStub(
      baseSeed({
        import_files: [
          { id: bookingsFileId, session_id: SESSION_ID, storage_path: 'b.csv', file_type: 'bookings', created_at: '2020-01-01T00:00:00Z' },
          { id: staffFileId, session_id: SESSION_ID, storage_path: 's.csv', file_type: 'staff', created_at: '2020-01-02T00:00:00Z' },
        ],
        import_column_mappings: [...bookingMappings(bookingsFileId), ...staffMappings(staffFileId)],
      }),
      { files: { 'b.csv': bookingsCsv, 's.csv': staffCsv } },
    );

    const result = await runExtractBookingReferences(db.asClient(), SESSION_ID, VENUE_ID);

    const staffRefs = db.rows('import_booking_references').filter((r) => r.reference_type === 'staff');
    const staffNames = staffRefs.map((r) => r.raw_value).sort();
    // Alice appears once (from the booking), Carol added from the staff list. No duplicate Alice.
    expect(staffNames).toEqual(['Alice', 'Carol']);
    expect(result.staffReferenceCount).toBe(1); // only Carol added via the staff-list path
  });
});
