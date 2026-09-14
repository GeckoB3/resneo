import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/venue-route-client', () => ({
  createVenueRouteClient: vi.fn(async () => ({})),
}));
vi.mock('@/lib/venue-auth', () => ({
  getVenueStaff: vi.fn(),
  requireAdmin: (staff: { role?: string } | null) => staff !== null && staff.role === 'admin',
}));

import { getVenueStaff, type VenueStaff } from '@/lib/venue-auth';
import { columnsMissingFromMigrations } from '@/lib/testing/migration-columns';
import { makeRecordingDb, type Responder } from '@/lib/testing/recording-supabase';
import { GET } from './route';

const VENUE = 'venue-1';
const mockStaff = vi.mocked(getVenueStaff);

async function runExport(type: 'guests' | 'bookings', responder?: Responder) {
  const rec = makeRecordingDb(responder);
  const staff: VenueStaff = { id: 'staff-1', venue_id: VENUE, email: 'owner@example.com', role: 'admin', db: rec.db };
  mockStaff.mockResolvedValue(staff);
  const res = await GET(new NextRequest(`http://localhost/api/venue/export?type=${type}`));
  return { rec, res };
}

/** The CSV as rows of cells. Fixtures hold no commas, quotes or newlines, so a plain split is exact. */
async function csvRows(res: Response): Promise<string[][]> {
  return (await res.text()).split('\r\n').map((line) => line.split(','));
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Projection guard ───────────────────────────────────────────────────────

/**
 * Both exports asked `guests` for `name` after 20260810120000_guest_first_last_names.sql
 * dropped it, so every download failed with 42703 and returned a 500. The recording double
 * answers whatever a test seeds and never reads the SELECT, so this checks each recorded
 * projection and column modifier against the columns the migrations leave its table with.
 */
describe('GET /api/venue/export: columns', () => {
  it.each(['guests', 'bookings'] as const)('the %s export reads only columns its tables have', async (type) => {
    const { rec, res } = await runExport(type);
    expect(res.status).toBe(200);
    expect(rec.queryCount({ table: type, op: 'select' })).toBe(1);
    expect(columnsMissingFromMigrations(rec.calls)).toEqual([]);
  });
});

// ─── Rows ───────────────────────────────────────────────────────────────────

describe('GET /api/venue/export?type=guests', () => {
  it('builds Name from first and last name, sorted by surname then first name', async () => {
    const { rec, res } = await runExport('guests', (call) => {
      if (call.table === 'guests') {
        return {
          data: [
            {
              id: 'g1', first_name: 'Ann', last_name: 'Lee', email: 'ann@example.com', phone: '+447700900001',
              visit_count: 3, no_show_count: 1, last_visit_date: '2026-09-01', created_at: '2026-01-05T10:00:00Z',
              tags: ['VIP', 'Allergy'],
            },
            {
              id: 'g2', first_name: ' Cher ', last_name: null, email: null, phone: null,
              visit_count: 0, no_show_count: 0, last_visit_date: null, created_at: '2026-02-01T10:00:00Z', tags: [],
            },
            {
              id: 'g3', first_name: null, last_name: '', email: 'x@example.com', phone: null,
              visit_count: 0, no_show_count: 0, last_visit_date: null, created_at: '2026-03-01T10:00:00Z', tags: null,
            },
          ],
        };
      }
      if (call.table === 'bookings') return { data: [{ guest_id: 'g1' }, { guest_id: 'g1' }, { guest_id: 'g2' }] };
      return undefined;
    });

    expect(res.status).toBe(200);
    expect(rec.calls[0]).toMatchObject({
      table: 'guests',
      filters: [
        ['eq', 'venue_id', VENUE],
        ['order', 'last_name', { ascending: true, nullsFirst: false }],
        ['order', 'first_name', { ascending: true, nullsFirst: false }],
      ],
    });

    const [headers, ...rows] = await csvRows(res);
    expect(headers).toEqual([
      'Guest ID', 'Name', 'Email', 'Phone', 'Tags', 'Visit count (seated)', 'No-show count', 'Last visit',
      'Total bookings', 'First seen',
    ]);
    expect(rows).toEqual([
      ['g1', 'Ann Lee', 'ann@example.com', '+447700900001', 'VIP; Allergy', '3', '1', '2026-09-01', '2', '2026-01-05T10:00:00Z'],
      ['g2', 'Cher', '', '', '', '0', '0', '', '1', '2026-02-01T10:00:00Z'],
      // No name at all stays empty rather than becoming a "Guest" placeholder.
      ['g3', '', 'x@example.com', '', '', '0', '0', '', '0', '2026-03-01T10:00:00Z'],
    ]);
  });
});

describe('GET /api/venue/export?type=bookings', () => {
  it('fills Guest Name from the client record and gives every cell a header', async () => {
    const { res } = await runExport('bookings', (call) =>
      call.table === 'bookings'
        ? {
            data: [
              {
                id: 'b1', booking_date: '2026-09-20', booking_time: '14:30:00', party_size: 1, status: 'Confirmed',
                deposit_status: 'Paid', deposit_amount_pence: 1500, stripe_payment_intent_id: 'pi_1', source: 'online',
                dietary_notes: null, occasion: null, created_at: '2026-09-01T09:00:00Z',
                calendar_id: 'cal-1', service_item_id: 'svc-1',
                guests: { first_name: 'Ann', last_name: 'Lee', email: 'ann@example.com', phone: '+447700900001' },
              },
            ],
          }
        : undefined,
    );

    expect(res.status).toBe(200);
    const [headers, row] = await csvRows(res);
    // The Type cell once had no header, so every column from Party Size on sat one heading too early.
    expect(row).toHaveLength(headers!.length);
    const cell = (header: string) => row![headers!.indexOf(header)];
    expect(cell('Time')).toBe('14:30');
    expect(cell('Type')).toBe('Appointment');
    expect(cell('Party Size')).toBe('1');
    expect(cell('Deposit Amount (£)')).toBe('15.00');
    expect(cell('Guest Name')).toBe('Ann Lee');
    expect(cell('Guest Email')).toBe('ann@example.com');
    expect(cell('Created At')).toBe('2026-09-01T09:00:00Z');
  });
});

describe('GET /api/venue/export: who may export (PB-19)', () => {
  it.each(['guests', 'bookings'] as const)('refuses the %s export to non-admin staff before reading anything', async (type) => {
    const rec = makeRecordingDb();
    mockStaff.mockResolvedValue({ id: 'staff-2', venue_id: VENUE, email: 'team@example.com', role: 'staff', db: rec.db });

    const res = await GET(new NextRequest(`http://localhost/api/venue/export?type=${type}`));

    expect(res.status).toBe(403);
    expect(rec.calls).toEqual([]);
  });
});
