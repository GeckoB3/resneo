import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeSupabase } from '@/lib/compliance/test-utils/fake-supabase';
import { makeRecordingDb, type RecordedCall } from '@/lib/testing/recording-supabase';
import { loadComplianceDashboard } from '@/lib/compliance/dashboard-service';

/**
 * The "Expiring soon" panel is a chase list: records whose validity is running out and
 * which someone has to renew. Per-visit records (validity 0) run to the end of the
 * appointment day by design, so every one of them falls inside the 30-day window. Listing
 * them buries the records that genuinely need chasing.
 */

const VENUE = 'venue-1';
const NOW = new Date('2027-06-01T09:00:00Z');
const TODAY = '2027-06-01';
const inDays = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

function recordRow(id: string, validityPeriodDays: number | null, name: string) {
  return {
    id,
    venue_id: VENUE,
    guest_id: 'g1',
    compliance_type_id: `type-${id}`,
    status: 'completed',
    voided_at: null,
    expires_at: inDays(4),
    result: 'signed',
    compliance_types: { name, validity_period_days: validityPeriodDays },
    guests: { first_name: 'Jane', last_name: 'Doe' },
  };
}

function seed() {
  return new FakeSupabase({
    venues: [{ id: VENUE, timezone: 'Europe/London' }],
    compliance_records: [
      recordRow('per-visit', 0, 'Treatment Consent'),
      recordRow('patch-test', 90, 'Patch Test'),
    ],
    compliance_form_links: [],
    bookings: [],
  });
}

describe('loadComplianceDashboard — expiring soon', () => {
  it('lists the record that needs renewing and omits the per-visit one', async () => {
    const data = await loadComplianceDashboard(seed().asClient(), VENUE, NOW);
    expect(data.expiring_soon.map((r) => r.id)).toEqual(['patch-test']);
    expect(data.expiring_soon[0]!.compliance_type_name).toBe('Patch Test');
    expect(data.expiring_soon[0]!.guest_name).toBe('Jane Doe');
  });

  it('resolves "today" in the venue timezone', async () => {
    const data = await loadComplianceDashboard(seed().asClient(), VENUE, NOW);
    expect(data.today).toBe('2027-06-01');
  });
});

// ─── Missing for upcoming bookings ──────────────────────────────────────────

const INTAKE = { id: 'type-intake', name: 'New Patient Intake' };
const PHOTO = { id: 'type-photo', name: 'Photo Consent' };

function requirement(
  id: string,
  type: { id: string; name: string },
  over: { service_item_id?: string | null; scope?: 'service' | 'venue'; enforcement?: string } = {},
) {
  return {
    id,
    venue_id: VENUE,
    compliance_type_id: type.id,
    enforcement: over.enforcement ?? 'warn_staff',
    lock_period_hours: null,
    scope: over.scope ?? 'service',
    appointment_service_id: null,
    service_item_id: over.scope === 'venue' ? null : (over.service_item_id ?? 'svc-facial'),
    compliance_types: { name: type.name, is_active: true, validity_period_days: 365 },
  };
}

function booking(
  id: string,
  over: { guest_id?: string; service_item_id?: string; booking_date?: string; booking_time?: string; status?: string } = {},
) {
  const guestId = over.guest_id ?? 'g1';
  return {
    id,
    venue_id: VENUE,
    guest_id: guestId,
    booking_date: over.booking_date ?? TODAY,
    booking_time: over.booking_time ?? '14:00:00',
    status: over.status ?? 'Booked',
    appointment_service_id: null,
    service_item_id: over.service_item_id ?? 'svc-facial',
    guests: guestId === 'g1' ? { first_name: 'Jane', last_name: 'Doe' } : { first_name: 'Client', last_name: guestId },
  };
}

function validRecord(guestId: string, type: { id: string }) {
  return {
    id: `rec-${guestId}-${type.id}`,
    venue_id: VENUE,
    guest_id: guestId,
    compliance_type_id: type.id,
    status: 'completed',
    expires_at: inDays(200),
    voided_at: null,
    captured_at: inDays(-10),
    result: 'signed',
    captured_by_staff_id: null,
    compliance_types: { result_type: 'completed' },
  };
}

function venueWith(tables: { requirements: unknown[]; bookings: unknown[]; records?: unknown[] }) {
  return new FakeSupabase({
    venues: [{ id: VENUE, timezone: 'Europe/London' }],
    service_compliance_requirements: tables.requirements as Record<string, unknown>[],
    bookings: tables.bookings as Record<string, unknown>[],
    compliance_records: (tables.records ?? []) as Record<string, unknown>[],
    compliance_form_links: [],
  }).asClient();
}

describe('loadComplianceDashboard — missing for upcoming bookings', () => {
  it('lists a booking whose service needs forms the client has not given', async () => {
    const db = venueWith({
      requirements: [requirement('r1', INTAKE), requirement('r2', PHOTO, { enforcement: 'warn_client' })],
      bookings: [booking('b1', { booking_time: '10:30:00' })],
    });
    const data = await loadComplianceDashboard(db, VENUE, NOW);
    expect(data.missing_for_bookings.map((m) => [m.booking_id, m.guest_name, m.compliance_type_name, m.state])).toEqual([
      ['b1', 'Jane Doe', 'New Patient Intake', 'missing'],
      ['b1', 'Jane Doe', 'Photo Consent', 'missing'],
    ]);
  });

  it('leaves out a form the client already has on file', async () => {
    const db = venueWith({
      requirements: [requirement('r1', INTAKE), requirement('r2', PHOTO)],
      bookings: [booking('b1')],
      records: [validRecord('g1', INTAKE)],
    });
    const data = await loadComplianceDashboard(db, VENUE, NOW);
    expect(data.missing_for_bookings.map((m) => m.compliance_type_name)).toEqual(['Photo Consent']);
  });

  it('ignores cancelled bookings and bookings outside the next 14 days', async () => {
    const db = venueWith({
      requirements: [requirement('r1', INTAKE)],
      bookings: [
        booking('cancelled', { status: 'Cancelled' }),
        booking('too-far', { booking_date: '2027-06-16' }),
        booking('yesterday', { booking_date: '2027-05-31' }),
        booking('in-window', { booking_date: '2027-06-15' }),
      ],
    });
    const data = await loadComplianceDashboard(db, VENUE, NOW);
    expect(data.missing_for_bookings.map((m) => m.booking_id)).toEqual(['in-window']);
  });

  it('applies a requirement set for all bookings to a service with none of its own', async () => {
    const db = venueWith({
      requirements: [requirement('r1', INTAKE, { scope: 'venue' })],
      bookings: [booking('b1', { service_item_id: 'svc-no-requirements' })],
    });
    const data = await loadComplianceDashboard(db, VENUE, NOW);
    expect(data.missing_for_bookings.map((m) => [m.booking_id, m.compliance_type_name])).toEqual([
      ['b1', 'New Patient Intake'],
    ]);
  });

  it('lists a form shared by the services of one visit once, at the first service, with the strictest rule', async () => {
    const db = venueWith({
      requirements: [
        requirement('r1', INTAKE, { service_item_id: 'svc-colour', enforcement: 'warn_staff' }),
        requirement('r2', INTAKE, { service_item_id: 'svc-cut', enforcement: 'block_all' }),
      ],
      bookings: [
        booking('cut', { service_item_id: 'svc-cut', booking_time: '11:00:00' }),
        booking('colour', { service_item_id: 'svc-colour', booking_time: '10:00:00' }),
        // The same client on another day needs it again for that day.
        booking('next-week', { service_item_id: 'svc-cut', booking_date: '2027-06-08', booking_time: '09:00:00' }),
      ],
    });
    const data = await loadComplianceDashboard(db, VENUE, NOW);
    expect(data.missing_for_bookings.map((m) => [m.booking_id, m.booking_time, m.enforcement])).toEqual([
      ['colour', '10:00:00', 'block_all'],
      ['next-week', '09:00:00', 'block_all'],
    ]);
  });

  it('reads records for every client when there are more clients than one records read takes', async () => {
    const guests = Array.from({ length: 60 }, (_, i) => `g-${String(i).padStart(2, '0')}`);
    const db = venueWith({
      requirements: [requirement('r1', INTAKE)],
      bookings: guests.map((g) => booking(`b-${g}`, { guest_id: g })),
      // The last client falls in the second batch of guest ids.
      records: [validRecord('g-59', INTAKE)],
    });
    const data = await loadComplianceDashboard(db, VENUE, NOW);
    expect(data.missing_for_bookings).toHaveLength(59);
    expect(data.missing_for_bookings.some((m) => m.guest_id === 'g-59')).toBe(false);
  });
});

// ─── Failures must not read as an all-clear ─────────────────────────────────

/** A venue with one requirement and one booking, so every read the dashboard makes happens. */
function recordingVenue() {
  return makeRecordingDb((call) => {
    if (call.table === 'service_compliance_requirements') return { data: [requirement('r1', INTAKE)] };
    if (call.table === 'bookings') return { data: [booking('b1')] };
    return undefined;
  });
}

describe('loadComplianceDashboard — failed reads', () => {
  const reads: Array<[what: string, matches: (call: RecordedCall) => boolean]> = [
    ['expiring records', (c) => c.table === 'compliance_records' && !c.columns?.includes('captured_by_staff_id')],
    ['pending form links', (c) => c.table === 'compliance_form_links'],
    ['requirements', (c) => c.table === 'service_compliance_requirements'],
    ['upcoming bookings', (c) => c.table === 'bookings'],
    ['client records', (c) => c.table === 'compliance_records' && Boolean(c.columns?.includes('captured_by_staff_id'))],
  ];

  for (const [what, matches] of reads) {
    it(`throws when the ${what} read fails, rather than reporting nothing outstanding`, async () => {
      const rec = recordingVenue();
      rec.inject(matches, { code: '42703', message: 'column guests_1.name does not exist' });
      await expect(loadComplianceDashboard(rec.db, VENUE, NOW)).rejects.toThrow(what);
    });
  }

  it('does not read bookings at all when the venue has no requirements', async () => {
    const rec = makeRecordingDb();
    const data = await loadComplianceDashboard(rec.db, VENUE, NOW);
    expect(data.missing_for_bookings).toEqual([]);
    expect(rec.queryCount({ table: 'bookings' })).toBe(0);
  });
});

// ─── Projection guard ───────────────────────────────────────────────────────

/**
 * The page shipped asking `guests` for `name`, a column the first/last name migration had
 * already dropped, so every read failed with 42703 and the page reported an all-clear for
 * months. The fakes above hand back whatever a test seeds and never look at the SELECT, so
 * this reads the SELECT strings and checks them against the columns the migrations give
 * `guests`.
 */
const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

function guestColumnsFromMigrations(): Set<string> {
  const columns = new Set<string>();
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const created = sql.match(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:public\.)?guests\s*\(([\s\S]*?)\n\);/i);
    if (created) {
      for (const line of created[1]!.split('\n')) {
        const column = line.trim().match(/^([a-z_][a-z0-9_]*)\s/i)?.[1]?.toLowerCase();
        if (column && !['constraint', 'primary', 'unique', 'foreign', 'check'].includes(column)) columns.add(column);
      }
    }
    for (const statement of sql.matchAll(/ALTER TABLE\s+(?:IF EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?guests\s([\s\S]*?);/gi)) {
      const body = statement[1]!;
      for (const m of body.matchAll(/ADD COLUMN\s+(?:IF NOT EXISTS\s+)?([a-z_][a-z0-9_]*)/gi)) columns.add(m[1]!.toLowerCase());
      for (const m of body.matchAll(/DROP COLUMN\s+(?:IF EXISTS\s+)?([a-z_][a-z0-9_]*)/gi)) columns.delete(m[1]!.toLowerCase());
      for (const m of body.matchAll(/RENAME COLUMN\s+([a-z_][a-z0-9_]*)\s+TO\s+([a-z_][a-z0-9_]*)/gi)) {
        columns.delete(m[1]!.toLowerCase());
        columns.add(m[2]!.toLowerCase());
      }
    }
  }
  return columns;
}

describe('loadComplianceDashboard — guest columns', () => {
  it('reads the guests table the way the migrations left it', () => {
    const columns = guestColumnsFromMigrations();
    expect(columns.has('first_name')).toBe(true);
    expect(columns.has('last_name')).toBe(true);
    expect(columns.has('name')).toBe(false);
  });

  it('asks guests only for columns the table has', async () => {
    const rec = recordingVenue();
    await loadComplianceDashboard(rec.db, VENUE, NOW);

    const embeds = rec.calls.flatMap((c) =>
      [...(c.columns ?? '').matchAll(/\bguests(?:!inner)?\(([^)]*)\)/g)].map((m) => ({ table: c.table, list: m[1]! })),
    );
    // Expiring records, pending links and bookings each name the client.
    expect(embeds.map((e) => e.table).sort()).toEqual(['bookings', 'compliance_form_links', 'compliance_records']);

    const known = guestColumnsFromMigrations();
    for (const { table, list } of embeds) {
      for (const column of list.split(',').map((c) => c.trim())) {
        expect(known.has(column), `${table} embeds guests.${column}`).toBe(true);
      }
    }
  });
});
