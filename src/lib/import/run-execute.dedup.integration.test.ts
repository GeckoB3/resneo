import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SupabaseStub, resetStubIds, type Row } from '@/lib/import/__tests__/supabase-stub';
import { createInitialImportExecuteState } from '@/lib/import/import-execute-state';

/**
 * Integration test for cross-import dedupe (M2).
 *
 * WHAT THIS LOCKS IN:
 *   The importer dedupes against the source system's own IDs for ANY provider
 *   (not just Phorest). A booking row whose `external_appointment_id` already has
 *   an `external_record_refs` entry for the same provider — i.e. it was imported
 *   before — is skipped with `duplicate_external_appointment_id` (recorded in the
 *   skip audit / report), BEFORE a guest is created for it. A row with a new
 *   source ID imports normally.
 *
 * Design (per the agreed decisions): source-IDs-only (the check only fires when a
 * row carries a source ID), scoped to prior imports (external_record_refs is
 * written only by the import), namespaced by detected provider ('fresha' here).
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
    resolved_service_id: SVC_ID,
    resolved_calendar_id: CAL_ID,
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

describe('runImportExecuteBatch — cross-import dedupe by source ID (M2)', () => {
  beforeEach(() => {
    resetStubIds();
    vi.clearAllMocks();
  });

  it('skips a booking whose source appointment ID was already imported, imports a new one', async () => {
    const alreadyImported = stagedRow({ row_number: 1, raw_external_appointment_id: 'APPT-1' });
    const fresh = stagedRow({ row_number: 2, raw_external_appointment_id: 'APPT-2' });

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
            detected_platform: 'fresha', // -> refProvider 'fresha'
          },
        ],
        venues: [{ id: VENUE_ID, timezone: 'Europe/London', currency: 'GBP', name: 'Test Venue', email: null }],
        import_files: [
          { id: FILE_ID, session_id: SESSION_ID, storage_path: 'b.csv', file_type: 'bookings', row_count: 2, created_at: '2020-01-01T00:00:00Z' },
        ],
        import_column_mappings: [],
        import_validation_issues: [],
        import_booking_rows: [alreadyImported, fresh],
        unified_calendars: [{ id: CAL_ID, venue_id: VENUE_ID, is_active: true, sort_order: 1 }],
        calendar_service_assignments: [{ id: 'csa-1', calendar_id: CAL_ID, service_item_id: SVC_ID }],
        service_items: [{ id: SVC_ID, venue_id: VENUE_ID, is_active: true, sort_order: 1 }],
        // APPT-1 was imported by an earlier session — its external ref already exists.
        external_record_refs: [
          {
            id: 'ref-existing',
            venue_id: VENUE_ID,
            provider: 'fresha',
            entity_type: 'booking',
            external_id: 'APPT-1',
            entity_id: 'existing-booking-1',
          },
        ],
        guests: [],
        import_records: [],
        staff: [{ id: STAFF_ID, email: null, name: 'Importer' }],
      },
      {
        files: { 'b.csv': 'Date,Time\n' },
        rpc: {
          import_insert_guest_with_audit: (args) => {
            insertedGuests.push(args.p_guest as Record<string, unknown>);
            return { data: `guest-${insertedGuests.length}`, error: null };
          },
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

    // Only the fresh row (APPT-2) was inserted; the already-imported one was skipped.
    expect(insertedBookings).toHaveLength(1);
    expect(state.importedBookings).toBe(1);
    expect(state.skipped).toBe(1);

    // Dedupe runs before guest creation, so the duplicate never spawns a guest.
    expect(insertedGuests).toHaveLength(1);

    // The skip was recorded for the report with the dedupe reason.
    const dupSkips = db
      .rows('import_validation_issues')
      .filter((r) => r.issue_type === 'skipped_at_execute' && r.column_name === 'duplicate_external_appointment_id');
    expect(dupSkips).toHaveLength(1);
    expect(dupSkips[0]!.row_number).toBe(1);

    // The newly-imported booking got its own external ref written for next time.
    const freshRef = db
      .rows('external_record_refs')
      .find((r) => r.external_id === 'APPT-2' && r.entity_type === 'booking');
    expect(freshRef).toBeTruthy();
    expect(freshRef!.provider).toBe('fresha');
  });
});
