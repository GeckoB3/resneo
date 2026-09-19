import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SupabaseStub, resetStubIds, type Row } from '@/lib/import/__tests__/supabase-stub';
import { createInitialImportExecuteState } from '@/lib/import/import-execute-state';
import { IMPORT_MARKETING_CHANGE_KEY } from '@/lib/import/import-marketing-consent';

/**
 * Imported contacts are taken to have agreed to marketing unless the file says
 * they have not (owner's rule, 2026-09-19). Before it, every imported contact
 * landed with marketing_consent false, so bulk marketing skipped all of them,
 * even rows whose own file said "Marketing Consent: Yes".
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
import { runImportUndo } from '@/lib/import/run-undo';

const VENUE_ID = 'venue-1';
const SESSION_ID = 'session-1';
const STAFF_ID = 'staff-1';
const FILE_ID = 'file-clients';

const CSV = [
  'First Name,Last Name,Email,Marketing,Unsubscribed,SMS Marketing',
  'Ann,New,ann@example.com,,,',
  'Ben,New,ben@example.com,No,,',
  'Cat,New,cat@example.com,,Yes,',
  'Dan,New,dan@example.com,Yes,,No',
  'Eve,New,eve@example.com,Yes,,',
  'Fay,Existing,fay@example.com,,,',
  'Gus,Existing,gus@example.com,Yes,,',
  'Hal,Existing,hal@example.com,,,',
  'Ivy,Existing,ivy@example.com,No,,',
].join('\n');

function mapping(source_column: string, target_field: string): Row {
  return {
    id: `map-${target_field}`,
    session_id: SESSION_ID,
    file_id: FILE_ID,
    source_column,
    target_field,
    action: 'map',
    custom_field_name: null,
    custom_field_type: null,
    split_config: null,
  };
}

function existingGuest(id: string, first: string, email: string, marketing: Partial<Row>): Row {
  return {
    id,
    venue_id: VENUE_ID,
    first_name: first,
    last_name: 'Existing',
    email,
    phone: null,
    visit_count: 2,
    tags: [],
    custom_fields: {},
    last_visit_date: null,
    created_at: '2026-01-01T00:00:00Z',
    marketing_consent: false,
    marketing_consent_at: null,
    marketing_opt_out: false,
    ...marketing,
  };
}

/** The wizard asks what to do with a matched contact; these rows chose "update existing". */
function updateDecision(rowNumber: number): Row {
  return {
    id: `issue-${rowNumber}`,
    session_id: SESSION_ID,
    file_id: FILE_ID,
    row_number: rowNumber,
    severity: 'warning',
    issue_type: 'existing_client',
    user_decision: 'update_existing',
  };
}

function buildDb() {
  const insertedGuests: Array<Record<string, unknown>> = [];
  const db = new SupabaseStub(
    {
      import_sessions: [
        { id: SESSION_ID, venue_id: VENUE_ID, session_settings: {}, total_rows: 9, detected_platform: 'unknown' },
      ],
      venues: [{ id: VENUE_ID, timezone: 'Europe/London', currency: 'GBP', name: 'Test Venue', email: null }],
      import_files: [
        { id: FILE_ID, session_id: SESSION_ID, storage_path: 'c.csv', file_type: 'clients', row_count: 9, created_at: '2026-09-19T00:00:00Z' },
      ],
      import_column_mappings: [
        mapping('First Name', 'first_name'),
        mapping('Last Name', 'last_name'),
        mapping('Email', 'email'),
        mapping('Marketing', 'marketing_consent'),
        mapping('Unsubscribed', 'marketing_opt_out'),
        mapping('SMS Marketing', 'sms_marketing_consent'),
      ],
      import_validation_issues: [updateDecision(6), updateDecision(7), updateDecision(8), updateDecision(9)],
      import_booking_rows: [],
      guests: [
        // Never made a marketing choice in ResNeo.
        existingGuest('g-fay', 'Fay', 'fay@example.com', {}),
        // Unsubscribed in ResNeo; the file's Yes must not re-subscribe them.
        existingGuest('g-gus', 'Gus', 'gus@example.com', { marketing_opt_out: true }),
        // Chose no consent on a booking page (a choice on record).
        existingGuest('g-hal', 'Hal', 'hal@example.com', {}),
        // Consented in ResNeo; the file says No.
        existingGuest('g-ivy', 'Ivy', 'ivy@example.com', {
          marketing_consent: true,
          marketing_consent_at: '2026-05-01T00:00:00Z',
        }),
      ],
      guest_marketing_consent_events: [
        {
          id: 'evt-hal',
          venue_id: VENUE_ID,
          guest_id: 'g-hal',
          actor_staff_id: null,
          marketing_consent: false,
          marketing_opt_out: false,
          created_at: '2026-08-01T00:00:00Z',
        },
      ],
      import_records: [],
      external_record_refs: [],
      staff: [{ id: STAFF_ID, email: null, name: 'Importer' }],
    },
    {
      files: { 'c.csv': CSV },
      rpc: {
        import_insert_guest_with_audit: (args) => {
          insertedGuests.push(args.p_guest as Record<string, unknown>);
          return { data: `guest-${insertedGuests.length}`, error: null };
        },
        collective_bookable_service_ids: () => ({ data: null, error: null }),
      },
    },
  );
  return { db, insertedGuests };
}

async function runImport(db: SupabaseStub) {
  return runImportExecuteBatch(db.asClient(), SESSION_ID, VENUE_ID, STAFF_ID, {
    maxRows: 100,
    state: createInitialImportExecuteState(),
  });
}

function guest(db: SupabaseStub, id: string): Row {
  return db.rows('guests').find((g) => g.id === id)!;
}

describe('runImportExecuteBatch: marketing consent for imported contacts', () => {
  beforeEach(() => {
    resetStubIds();
    vi.clearAllMocks();
  });

  it('gives new contacts consent unless their row opts them out', async () => {
    const { db, insertedGuests } = buildDb();
    const { finished } = await runImport(db);
    expect(finished).toBe(true);

    const byName = Object.fromEntries(insertedGuests.map((g) => [g.first_name as string, g]));
    expect(Object.keys(byName).sort()).toEqual(['Ann', 'Ben', 'Cat', 'Dan', 'Eve']);

    // No marketing answer at all: consent, dated at the import.
    expect(byName.Ann).toMatchObject({ marketing_consent: true, marketing_opt_out: false });
    expect(typeof byName.Ann!.marketing_consent_at).toBe('string');
    expect(byName.Eve).toMatchObject({ marketing_consent: true, marketing_opt_out: false });

    // Consent column No, opt-out column Yes, and a no to texts are all opt-outs.
    for (const name of ['Ben', 'Cat', 'Dan']) {
      expect(byName[name]).toMatchObject({ marketing_consent: false, marketing_consent_at: null, marketing_opt_out: true });
    }
  });

  it('fills in consent for an existing contact who never chose, and nothing else', async () => {
    const { db } = buildDb();
    await runImport(db);

    expect(guest(db, 'g-fay')).toMatchObject({ marketing_consent: true, marketing_opt_out: false });
    expect(typeof guest(db, 'g-fay').marketing_consent_at).toBe('string');
    // Opted out in ResNeo: the file's Yes does not re-subscribe them.
    expect(guest(db, 'g-gus')).toMatchObject({ marketing_consent: false, marketing_opt_out: true });
    // A choice on record stands.
    expect(guest(db, 'g-hal')).toMatchObject({ marketing_consent: false, marketing_opt_out: false });
    // The file's No is applied.
    expect(guest(db, 'g-ivy')).toMatchObject({ marketing_consent: false, marketing_consent_at: null, marketing_opt_out: true });

    // Each change is on the contact's timeline, credited to whoever ran the import.
    const events = db.rows('guest_marketing_consent_events').filter((e) => e.id !== 'evt-hal');
    expect(events.map((e) => [e.guest_id, e.marketing_consent, e.marketing_opt_out, e.actor_staff_id]).sort()).toEqual([
      ['g-fay', true, false, STAFF_ID],
      ['g-ivy', false, true, STAFF_ID],
    ]);

    // The undo record keeps what was there and what the import changed.
    const fayRecord = db.rows('import_records').find((r) => r.record_id === 'g-fay')!;
    const previous = fayRecord.previous_data as Record<string, unknown>;
    expect(previous).toMatchObject({ marketing_consent: false, marketing_opt_out: false });
    expect(previous[IMPORT_MARKETING_CHANGE_KEY]).toMatchObject({ marketing_consent: true, marketing_opt_out: false });
    const gusRecord = db.rows('import_records').find((r) => r.record_id === 'g-gus')!;
    expect((gusRecord.previous_data as Record<string, unknown>)[IMPORT_MARKETING_CHANGE_KEY]).toEqual({});
  });

  it('undo puts marketing back, but keeps an unsubscribe made since the import', async () => {
    const { db } = buildDb();
    await runImport(db);

    // Ivy was opted out by the import; Fay was given consent, then unsubscribed by email.
    const fay = db.tables.guests!.find((g) => g.id === 'g-fay')!;
    Object.assign(fay, { marketing_consent: false, marketing_consent_at: null, marketing_opt_out: true });
    const session = db.tables.import_sessions![0]!;
    Object.assign(session, { status: 'complete', undone_at: null, undo_available_until: '2999-01-01T00:00:00Z' });
    const eventsBefore = db.rows('guest_marketing_consent_events').length;

    await runImportUndo(db.asClient(), SESSION_ID, VENUE_ID, 'staff-undo');

    expect(guest(db, 'g-ivy')).toMatchObject({
      marketing_consent: true,
      marketing_consent_at: '2026-05-01T00:00:00Z',
      marketing_opt_out: false,
    });
    expect(guest(db, 'g-fay')).toMatchObject({ marketing_consent: false, marketing_opt_out: true });
    expect(guest(db, 'g-gus')).toMatchObject({ marketing_opt_out: true });

    const newEvents = db.rows('guest_marketing_consent_events').slice(eventsBefore);
    expect(newEvents).toEqual([
      expect.objectContaining({ guest_id: 'g-ivy', marketing_consent: true, marketing_opt_out: false, actor_staff_id: 'staff-undo' }),
    ]);
  });
});
