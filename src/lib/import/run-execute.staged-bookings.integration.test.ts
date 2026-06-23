import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SupabaseStub, resetStubIds, type Row } from '@/lib/import/__tests__/supabase-stub';
import { createInitialImportExecuteState } from '@/lib/import/import-execute-state';

/**
 * Integration test for the `staged_bookings` phase of `runImportExecuteBatch`.
 *
 * WHAT THIS LOCKS IN:
 *   For a unified_scheduling venue, the staged-bookings phase only inserts a
 *   booking when the staged row carries BOTH a resolved unified calendar and a
 *   resolved service item (resolved_calendar_id + resolved_service_id). A row
 *   whose calendar/service did NOT resolve during the references step must be
 *   skipped (recorded via the execute-skip audit as `unified_resolution_failed`)
 *   rather than inserted with a null catalogue linkage. See run-execute.ts
 *   ~L1074 (insert when resolved) vs ~L1095 (skip when unified + unresolved).
 *
 * SCOPE / WHAT THIS DOES *NOT* COVER (kept deliberately small per the task):
 *   - Only the unified `staged_bookings` happy/skip split is exercised. The
 *     `clients` and `csv_bookings` phases, table/practitioner/CDE models,
 *     external-ref (Phorest) dedupe, reminder-log emission, duplicate detection,
 *     service-commercial defaulting, and batch pause/resume are NOT covered here.
 *   - `detected_platform` is left null so `refProvider` is null: this avoids the
 *     external_record_refs lookups/inserts entirely.
 *   - Booking dates are in the PAST so `bookingImportCommsFields` returns
 *     `suppress_import_comms: true`; the reminder-log path (which would call the
 *     real venue-communication-policy resolver) is therefore never reached.
 *   - `resolveVenueMode` is mocked to a unified_scheduling venue (the real
 *     resolver needs the full venues + service-config chain seeded).
 *   - The atomic booking-insert RPC `import_insert_booking_with_audit` is stubbed
 *     to return a synthetic booking id and record the insert payload, so we assert
 *     on WHICH rows reached the insert rather than on real DB-side capacity logic.
 */

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

// The completion email path imports send-email dynamically; stub it so the test
// never attempts a real send (there is no staff/venue email seeded anyway).
vi.mock('@/lib/emails/send-email', () => ({
  sendEmail: vi.fn(async () => ({ ok: true })),
}));

import { runImportExecuteBatch } from '@/lib/import/run-execute';

const VENUE_ID = 'venue-1';
const SESSION_ID = 'session-1';
const STAFF_ID = 'staff-1';
const FILE_ID = 'file-bookings';
const CAL_ID = 'cal-1';
const SVC_ID = 'svc-1';

/** A staged `import_booking_rows` row with the columns the staged phase reads. */
function stagedRow(overrides: Partial<Row> & { row_number: number }): Row {
  return {
    id: `bookingrow-${overrides.row_number}`,
    session_id: SESSION_ID,
    file_id: FILE_ID,
    venue_id: VENUE_ID,
    booking_date: '2020-05-01',
    booking_time: '10:00:00',
    booking_end_time: '11:00:00',
    duration_minutes: 60,
    party_size: 1,
    raw_client_email: null,
    raw_client_phone: null,
    raw_guest_first_name: 'Guest',
    raw_guest_last_name: `Row${overrides.row_number}`,
    raw_external_appointment_id: null,
    raw_external_booking_id: null,
    raw_external_client_id: null,
    raw_group_booking_id: null,
    raw_import_metadata: {},
    raw_status: null,
    raw_price: null,
    raw_deposit_amount: null,
    raw_deposit_paid: null,
    raw_deposit_status: null,
    raw_notes: null,
    resolved_service_id: null,
    resolved_calendar_id: null,
    resolved_practitioner_id: null,
    resolved_appointment_service_id: null,
    resolved_event_session_id: null,
    resolved_class_instance_id: null,
    resolved_resource_id: null,
    raw_booking_end_time: null,
    raw_duration_minutes: null,
    import_status: 'pending',
    is_future_booking: false,
    ...overrides,
  };
}

describe('runImportExecuteBatch — staged_bookings honours resolved_* ids (unified)', () => {
  beforeEach(() => {
    resetStubIds();
    vi.clearAllMocks();
  });

  it('inserts the row whose calendar+service resolved, and skips the row that did not', async () => {
    // Row 1: fully resolved -> should insert. Row 2: unresolved -> should skip.
    const resolved = stagedRow({
      row_number: 1,
      resolved_calendar_id: CAL_ID,
      resolved_service_id: SVC_ID,
    });
    const unresolved = stagedRow({ row_number: 2 }); // resolved_* stay null

    const insertedBookings: Array<Record<string, unknown>> = [];
    const insertedGuests: Array<Record<string, unknown>> = [];

    const db = new SupabaseStub(
      {
        import_sessions: [
          {
            id: SESSION_ID,
            venue_id: VENUE_ID,
            session_settings: {},
            total_rows: 2,
            detected_platform: null, // -> refProvider null, no external-ref lookups
          },
        ],
        venues: [{ id: VENUE_ID, timezone: 'Europe/London', currency: 'GBP', name: 'Test Venue', email: null }],
        // file_type 'bookings' with row_count so totalRows is well-defined.
        import_files: [
          { id: FILE_ID, session_id: SESSION_ID, storage_path: 'b.csv', file_type: 'bookings', row_count: 2, created_at: '2020-01-01T00:00:00Z' },
        ],
        import_column_mappings: [],
        import_validation_issues: [],
        import_booking_rows: [resolved, unresolved],
        // resolveBookingImportDefaults (unified branch) reads these:
        unified_calendars: [{ id: CAL_ID, venue_id: VENUE_ID, is_active: true, sort_order: 1 }],
        calendar_service_assignments: [{ id: 'csa-1', calendar_id: CAL_ID, service_item_id: SVC_ID }],
        service_items: [{ id: SVC_ID, venue_id: VENUE_ID, is_active: true, sort_order: 1 }],
        // Guest matching: no email/phone/external id and unique-name lookup finds
        // nothing -> a synthetic import-only guest is created in `guests`.
        guests: [],
        import_records: [],
        staff: [{ id: STAFF_ID, email: null, name: 'Importer' }],
      },
      {
        // After the staged phase the engine advances to the csv_bookings phase and
        // re-downloads the source file. Every parseable row was already staged, so
        // the CSV carries only a header (zero data rows) — the csv phase therefore
        // iterates nothing and adds no further inserts/skips. We still seed the file
        // so the download itself succeeds.
        files: { 'b.csv': 'Date,Time\n' },
        rpc: {
          // Atomic guest-insert (M1): the booking-guest path creates a synthetic
          // import-only guest via this RPC; record the payload, return an id.
          import_insert_guest_with_audit: (args) => {
            insertedGuests.push(args.p_guest as Record<string, unknown>);
            return { data: `guest-${insertedGuests.length}`, error: null };
          },
          // Atomic booking-insert: record the payload, return a synthetic id.
          import_insert_booking_with_audit: (args) => {
            insertedBookings.push(args.p_booking as Record<string, unknown>);
            return { data: `booking-${insertedBookings.length}`, error: null };
          },
        },
      },
    );

    const { state, finished } = await runImportExecuteBatch(
      db.asClient(),
      SESSION_ID,
      VENUE_ID,
      STAFF_ID,
      { maxRows: 100, state: createInitialImportExecuteState() },
    );

    expect(finished).toBe(true);

    // Exactly ONE booking was inserted (the resolved row), and it carries the
    // resolved calendar + service linkage.
    expect(insertedBookings).toHaveLength(1);
    expect(insertedBookings[0]!.calendar_id).toBe(CAL_ID);
    expect(insertedBookings[0]!.service_item_id).toBe(SVC_ID);
    expect(insertedBookings[0]!.booking_model).toBe('unified_scheduling');

    // The unresolved row was skipped (counter) and audited via execute-skip.
    expect(state.importedBookings).toBe(1);
    expect(state.skipped).toBe(1);

    const skips = db
      .rows('import_validation_issues')
      .filter((r) => r.issue_type === 'skipped_at_execute');
    expect(skips).toHaveLength(1);
    expect(skips[0]!.column_name).toBe('unified_resolution_failed');
    expect(skips[0]!.row_number).toBe(2);

    // The resolved row only ever reached the RPC, never the skip audit.
    expect(db.rpcCalls.filter((c) => c.name === 'import_insert_booking_with_audit')).toHaveLength(1);

    // Synthetic import-only guests are created via the atomic guest RPC (M1), not a
    // bare guests.insert. Guest resolution runs before the per-model dispatch, so both
    // staged rows create a guest even though only the resolved row's booking inserts.
    expect(insertedGuests).toHaveLength(2);
    expect(db.rpcCalls.filter((c) => c.name === 'import_insert_guest_with_audit')).toHaveLength(2);

    // Session marked complete at the end.
    const session = db.rows('import_sessions')[0]!;
    expect(session.status).toBe('complete');
    expect(session.imported_bookings).toBe(1);
    expect(session.skipped_rows).toBe(1);
  });
});
