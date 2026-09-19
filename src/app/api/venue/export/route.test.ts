import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import * as XLSX from 'xlsx';

vi.mock('@/lib/supabase/venue-route-client', () => ({
  createVenueRouteClient: vi.fn(async () => ({})),
}));
const serviceDb = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdminClient: () => serviceDb.current,
}));
vi.mock('@/lib/venue-auth', () => ({
  getVenueStaff: vi.fn(),
  requireAdmin: (staff: { role?: string } | null) => staff !== null && staff.role === 'admin',
}));

import { getVenueStaff, type VenueStaff } from '@/lib/venue-auth';
import { columnsMissingFromMigrations } from '@/lib/testing/migration-columns';
import { makeRecordingDb, type RecordedCall, type Responder } from '@/lib/testing/recording-supabase';
import { GET } from './route';

const VENUE = 'venue-1';
const mockStaff = vi.mocked(getVenueStaff);

const venueRow = { id: VENUE, name: 'Sept Salon', timezone: 'Europe/London', currency: 'GBP', booking_model: 'unified_scheduling', terminology: null };

/** Answers the venue read for every test, then defers to the test's own responder. */
function withVenue(responder?: Responder): Responder {
  return (call) => {
    if (call.table === 'venues') return { data: venueRow };
    return responder?.(call);
  };
}

async function runExport(params: Record<string, string>, responder?: Responder, role: 'admin' | 'staff' = 'admin') {
  const rec = makeRecordingDb(withVenue(responder));
  serviceDb.current = rec.db;
  const staff: VenueStaff = { id: 'staff-1', venue_id: VENUE, email: 'owner@example.com', role, db: rec.db };
  mockStaff.mockResolvedValue(staff);
  const res = await GET(new NextRequest(`http://localhost/api/venue/export?${new URLSearchParams(params).toString()}`));
  return { rec, res };
}

/** The CSV as rows of cells, byte-order mark removed, quoted cells (commas inside options, add-ons) unwrapped. */
async function csvRows(res: Response): Promise<string[][]> {
  const text = (await res.text()).replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' && text[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += 1;
    } else cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

function cellReader(headers: string[], row: string[]) {
  return (header: string) => {
    const i = headers.indexOf(header);
    if (i === -1) throw new Error(`no column ${header}: ${headers.join(' | ')}`);
    return row[i];
  };
}

const filtersOf = (call: RecordedCall | undefined) => call?.filters ?? [];

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

const booking = {
  id: 'b1',
  group_booking_id: 'visit-1',
  booking_date: '2026-09-20',
  booking_time: '14:30:00',
  booking_end_time: '15:15:00',
  estimated_end_time: null,
  party_size: 1,
  status: 'Confirmed',
  source: 'booking_page',
  collective_id: 'col-1',
  created_at: '2026-09-01T09:00:00Z',
  created_by_staff_id: 'st-2',
  cancelled_by_staff_id: null,
  cancellation_actor_type: null,
  calendar_id: 'cal-1',
  service_item_id: 'svc-1',
  service_variant_id: null,
  appointment_service_id: null,
  practitioner_id: null,
  experience_event_id: null,
  class_instance_id: null,
  resource_id: null,
  event_session_id: null,
  service_name_snapshot: 'Cut and finish',
  service_variant_name_snapshot: 'Long hair',
  service_price_snapshot_pence: 4000,
  booking_total_price_pence: 4500,
  addons_total_price_pence: 500,
  amount_paid_pence: 1500,
  tip_amount_pence: 0,
  payment_state: 'deposit_paid',
  deposit_status: 'Paid',
  deposit_amount_pence: 1500,
  stripe_payment_intent_id: 'pi_1',
  location_type: 'business_venue',
  client_address_line1: null,
  client_address_line2: null,
  client_address_city: null,
  client_address_postcode: null,
  special_requests: 'Quiet chair please',
  dietary_notes: null,
  occasion: null,
  internal_notes: 'Regular',
  client_arrived_at: null,
  checked_in_at: null,
  reminder_sent_at: '2026-09-19T14:30:00Z',
  post_visit_sent_at: null,
  guest_id: 'g1',
  guest_first_name: null,
  guest_last_name: null,
  guest_email: null,
  guest_phone: null,
  guests: { id: 'g1', first_name: 'Ann', last_name: 'Lee', email: 'ann@example.com', phone: '+447700900001' },
};

const bookingsWorld: Responder = (call) => {
  switch (call.table) {
    case 'bookings':
      return { data: [booking] };
    case 'staff':
      return { data: [{ id: 'st-1', name: 'Dana', email: 'dana@example.com' }, { id: 'st-2', name: null, email: 'front@example.com' }] };
    case 'unified_calendars':
      return { data: [{ id: 'cal-1', name: 'Dana', staff_id: 'st-1' }] };
    case 'service_items':
      return { data: [{ id: 'svc-1', name: 'Cut & finish (catalogue)' }] };
    case 'booking_addons':
      return { data: [{ booking_id: 'b1', addon_name_snapshot: 'Gloss', price_pence_at_booking: 500 }] };
    case 'venue_collectives':
      return { data: [{ id: 'col-1', name: 'High Street' }] };
    default:
      return undefined;
  }
};

const guests = [
  {
    id: 'g1', first_name: 'Ann', last_name: 'Lee', email: 'ann@example.com', phone: '+447700900001',
    address_line1: '1 High St', address_line2: 'Flat 2', address_city: 'Leeds', address_postcode: 'LS1 1AA', tags: ['VIP', 'Allergy'],
    marketing_consent: true, marketing_consent_at: '2026-01-05T10:00:00Z', marketing_opt_out: false,
    customer_profile_notes: 'Prefers Dana', dietary_preferences: null, source: 'online', visit_count: 3, no_show_count: 1,
    last_visit_date: '2026-09-01', first_booked_at: '2026-01-06T09:00:00Z', last_booked_at: '2026-09-01T09:00:00Z',
    waiver_signed_at: null, custom_fields: { allergy: 'Nuts', score: 7 }, created_at: '2026-01-05T10:00:00Z',
  },
  {
    id: 'g2', first_name: ' Cher ', last_name: null, email: null, phone: null, address_line1: null, address_line2: null, address_city: null,
    address_postcode: null, tags: [], marketing_consent: false, marketing_consent_at: null, marketing_opt_out: true,
    customer_profile_notes: null, dietary_preferences: null, source: null, visit_count: 0, no_show_count: 0,
    last_visit_date: null, first_booked_at: null, last_booked_at: null, waiver_signed_at: null,
    custom_fields: null, created_at: '2026-08-31T23:30:00Z', // 2026-09-01 00:30 in London
  },
];

const contactsWorld: Responder = (call) => {
  switch (call.table) {
    case 'guests':
      return { data: guests, count: guests.length };
    case 'custom_client_fields':
      return { data: [{ field_name: 'Allergy', field_key: 'allergy' }, { field_name: 'Score', field_key: 'score' }] };
    case 'bookings':
      return {
        data: [
          { guest_id: 'g1', status: 'Confirmed', booking_date: '2099-01-01', deposit_status: 'Paid', deposit_amount_pence: 1500 },
          { guest_id: 'g1', status: 'Cancelled', booking_date: '2026-02-01', deposit_status: null, deposit_amount_pence: null },
          { guest_id: 'g1', status: 'Completed', booking_date: '2026-03-01', deposit_status: 'Paid', deposit_amount_pence: 1000 },
          { guest_id: 'g2', status: 'Booked', booking_date: '2000-01-01', deposit_status: null, deposit_amount_pence: null },
        ],
      };
    default:
      return undefined;
  }
};

const services = [
  {
    id: 'svc-1', name: 'Cut and finish', description: 'Wash, cut, blow dry', item_type: 'appointment', category_id: 'cat-1',
    duration_minutes: 45, buffer_minutes: 10, processing_time_minutes: null,
    processing_time_blocks: [{ start_minute: 20, end_minute: 35 }], price_pence: 4000, price_type: 'fixed', deposit_pence: 1500,
    payment_requirement: 'deposit', capacity_per_session: 1, location_type: 'business_venue', online_meeting_url: null,
    online_meeting_info: null, is_active: true, is_bookable_online: true, max_advance_booking_days: 60,
    min_booking_notice_hours: 2, cancellation_notice_hours: 24, allow_same_day_booking: true,
    pre_appointment_instructions: 'Arrive with dry hair', colour: '#00C2C7', sort_order: 1, synced_from_service_id: null,
    created_at: '2026-05-01T08:00:00Z',
  },
  {
    id: 'svc-2', name: 'Beard trim', description: null, item_type: 'appointment', category_id: null, duration_minutes: 15,
    buffer_minutes: 0, processing_time_minutes: null, processing_time_blocks: null, price_pence: 1200, price_type: 'fixed',
    deposit_pence: null, payment_requirement: 'none', capacity_per_session: 1, location_type: 'business_venue',
    online_meeting_url: null, online_meeting_info: null, is_active: false, is_bookable_online: false,
    max_advance_booking_days: null, min_booking_notice_hours: null, cancellation_notice_hours: null,
    allow_same_day_booking: null, pre_appointment_instructions: null, colour: null, sort_order: 2,
    synced_from_service_id: 'origin-9', created_at: '2026-09-10T08:00:00Z',
  },
];

const servicesWorld: Responder = (call) => {
  switch (call.table) {
    case 'service_items':
      return { data: services };
    case 'service_categories':
      return { data: [{ id: 'cat-1', name: 'Hair' }] };
    case 'unified_calendars':
      return { data: [{ id: 'cal-1', name: 'Dana', staff_id: 'st-1' }, { id: 'cal-2', name: 'Sam', staff_id: null }] };
    case 'calendar_service_assignments':
      return {
        data: [
          { service_item_id: 'svc-1', calendar_id: 'cal-1', custom_duration_minutes: null, custom_price_pence: null },
          { service_item_id: 'svc-1', calendar_id: 'cal-2', custom_duration_minutes: 60, custom_price_pence: 4500 },
          { service_item_id: 'svc-1', calendar_id: 'someone-elses-cal', custom_duration_minutes: null, custom_price_pence: null },
        ],
      };
    case 'service_variants':
      return {
        data: [
          { service_item_id: 'svc-1', name: 'Short hair', duration_minutes: 30, price_pence: 3000, deposit_pence: null, is_active: true, sort_order: 0 },
          { service_item_id: 'svc-1', name: 'Long hair', duration_minutes: 60, price_pence: 5000, deposit_pence: 2000, is_active: false, sort_order: 1 },
        ],
      };
    case 'service_addon_groups':
      return { data: [{ service_item_id: 'svc-1', addon_group_id: 'grp-1', sort_order: 0 }] };
    case 'addon_groups':
      return { data: [{ id: 'grp-1', name: 'Finishing', is_active: true }] };
    case 'addons':
      return {
        data: [
          { addon_group_id: 'grp-1', name: 'Gloss', additional_price_pence: 500, is_active: true, sort_order: 0 },
          { addon_group_id: 'grp-1', name: 'Old treatment', additional_price_pence: 900, is_active: false, sort_order: 1 },
        ],
      };
    default:
      return undefined;
  }
};

// ─── Projection guard ────────────────────────────────────────────────────────

/**
 * The old export asked `guests` for `name` after 20260810120000_guest_first_last_names.sql dropped
 * it, so every download failed with 42703. The recording double answers whatever a test seeds and
 * never reads the SELECT, so this checks every recorded projection and column modifier, across
 * every table the three exports touch, against the columns the migrations leave those tables with.
 */
describe('GET /api/venue/export: columns', () => {
  it.each([
    ['bookings', bookingsWorld],
    ['contacts', contactsWorld],
    ['services', servicesWorld],
  ] as const)('the %s export reads only columns its tables have', async (type, world) => {
    const { rec, res } = await runExport({ type, format: 'csv' }, world);
    expect(res.status).toBe(200);
    expect(columnsMissingFromMigrations(rec.calls)).toEqual([]);
  });

  it('the count reads only columns its tables have', async () => {
    for (const type of ['bookings', 'contacts', 'services'] as const) {
      const { rec, res } = await runExport({ type, count: '1', from: '2026-09-01', to: '2026-09-30' });
      expect(res.status).toBe(200);
      expect(columnsMissingFromMigrations(rec.calls)).toEqual([]);
    }
  });
});

// ─── Appointments ────────────────────────────────────────────────────────────

describe('GET /api/venue/export?type=bookings', () => {
  it('carries every detail of the booking, named in the venue words, with one header per cell', async () => {
    const { res } = await runExport({ type: 'bookings' }, bookingsWorld);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    expect(res.headers.get('Content-Disposition')).toMatch(/filename="sept-salon-appointments-all-time-\d{4}-\d{2}-\d{2}\.csv"/);
    expect(res.headers.get('X-Export-Rows')).toBe('1');

    const [headers, row] = await csvRows(res);
    expect(row).toHaveLength(headers!.length);
    const cell = cellReader(headers!, row!);
    expect(cell('Appointment ID')).toBe('b1');
    expect(cell('Visit ID')).toBe('visit-1');
    expect(cell('Date')).toBe('2026-09-20');
    expect(cell('Start time')).toBe('14:30');
    expect(cell('End time')).toBe('15:15');
    expect(cell('Type')).toBe('Appointment');
    // The name captured at booking time wins over today's catalogue name.
    expect(cell('Service')).toBe('Cut and finish');
    expect(cell('Option')).toBe('Long hair');
    expect(cell('Add-ons')).toBe('Gloss (£5.00)');
    expect(cell('Calendar')).toBe('Dana');
    expect(cell('Staff')).toBe('Dana');
    expect(cell('Client name')).toBe('Ann Lee');
    expect(cell('Client email')).toBe('ann@example.com');
    expect(cell('Client phone')).toBe('+447700900001');
    expect(cell('Client ID')).toBe('g1');
    expect(cell('Price (£)')).toBe('45');
    expect(cell('Add-ons total (£)')).toBe('5');
    expect(cell('Payment state')).toBe('Deposit paid');
    expect(cell('Amount paid (£)')).toBe('15');
    expect(cell('Deposit status')).toBe('Paid');
    expect(cell('Deposit (£)')).toBe('15');
    expect(cell('Stripe payment')).toBe('pi_1');
    expect(cell('Source')).toBe('Booking page');
    expect(cell('Booked through collective')).toBe('High Street');
    expect(cell('Location')).toBe('At the business');
    expect(cell('Special requests')).toBe('Quiet chair please');
    expect(cell('Internal notes')).toBe('Regular');
    // Timestamps read in the venue's clock (BST here), not UTC.
    expect(cell('Booked on')).toBe('2026-09-01 10:00');
    expect(cell('Reminder sent')).toBe('2026-09-19 15:30');
    // A staff row with no name falls back to its email.
    expect(cell('Booked by')).toBe('front@example.com');
    expect(cell('Cancelled by')).toBe('');
  });

  it('falls back to the client details captured on the booking when no client record is linked', async () => {
    const { res } = await runExport({ type: 'bookings' }, (call) =>
      call.table === 'bookings'
        ? {
            data: [
              {
                ...booking,
                guests: null,
                guest_id: null,
                guest_first_name: 'Walk',
                guest_last_name: 'In',
                guest_email: 'walk@example.com',
                guest_phone: '+447700900999',
                collective_id: null,
                status: 'Cancelled',
                cancellation_actor_type: 'guest',
              },
            ],
          }
        : undefined,
    );
    const [headers, row] = await csvRows(res);
    const cell = cellReader(headers!, row!);
    expect(cell('Client name')).toBe('Walk In');
    expect(cell('Client email')).toBe('walk@example.com');
    expect(cell('Client phone')).toBe('+447700900999');
    expect(cell('Booked through collective')).toBe('');
    expect(cell('Cancelled by')).toBe('Client');
  });

  it('narrows to the appointment dates asked for, in the database, ordered by date and time', async () => {
    const { rec, res } = await runExport({ type: 'bookings', from: '2026-09-01', to: '2026-09-30' }, bookingsWorld);
    expect(res.status).toBe(200);
    const read = rec.calls.find((c) => c.table === 'bookings' && c.op === 'select');
    expect(filtersOf(read)).toEqual(
      expect.arrayContaining([
        ['eq', 'venue_id', VENUE],
        ['gte', 'booking_date', '2026-09-01'],
        ['lte', 'booking_date', '2026-09-30'],
        ['order', 'booking_date', { ascending: true }],
        ['order', 'booking_time', { ascending: true }],
      ]),
    );
    expect(res.headers.get('Content-Disposition')).toContain('sept-salon-appointments-2026-09-01-to-2026-09-30.csv');
  });

  it('reads every page of a busy venue rather than stopping at the first thousand', async () => {
    const page = (n: number) => Array.from({ length: n }, (_, i) => ({ ...booking, id: `b${i}`, collective_id: null }));
    let bookingReads = 0;
    const { res } = await runExport({ type: 'bookings' }, (call) => {
      if (call.table !== 'bookings') return undefined;
      bookingReads += 1;
      return { data: bookingReads === 1 ? page(1000) : page(3) };
    });
    expect(bookingReads).toBe(2);
    expect(res.headers.get('X-Export-Rows')).toBe('1003');
  });
});

// ─── Clients ─────────────────────────────────────────────────────────────────

describe('GET /api/venue/export?type=contacts', () => {
  it('carries contact details, consent, history, deposits and custom fields', async () => {
    const { res } = await runExport({ type: 'contacts' }, contactsWorld);
    expect(res.status).toBe(200);
    const [headers, first, second] = await csvRows(res);
    expect(first).toHaveLength(headers!.length);
    expect(headers!.slice(-2)).toEqual(['Allergy', 'Score']);

    const ann = cellReader(headers!, first!);
    expect(ann('Client ID')).toBe('g1');
    expect(ann('First name')).toBe('Ann');
    expect(ann('Surname')).toBe('Lee');
    expect(ann('Address line 1')).toBe('1 High St');
    expect(ann('Address line 2')).toBe('Flat 2');
    expect(ann('Postcode')).toBe('LS1 1AA');
    expect(ann('Tags')).toBe('VIP; Allergy');
    expect(ann('Marketing consent')).toBe('Yes');
    expect(ann('Consent recorded')).toBe('2026-01-05 10:00');
    expect(ann('Marketing opt-out')).toBe('No');
    expect(ann('Notes')).toBe('Prefers Dana');
    expect(ann('Visits')).toBe('3');
    expect(ann('No-shows')).toBe('1');
    expect(ann('Total appointments')).toBe('3');
    expect(ann('Upcoming')).toBe('1');
    expect(ann('Cancelled')).toBe('1');
    expect(ann('Paid deposits (£)')).toBe('25');
    // Booked-at times are venue wall-clock already (the trigger adds date + time), so they are not converted.
    expect(ann('First booked')).toBe('2026-01-06 09:00');
    expect(ann('Added on')).toBe('2026-01-05 10:00');
    expect(ann('Allergy')).toBe('Nuts');
    expect(ann('Score')).toBe('7');

    const cher = cellReader(headers!, second!);
    expect(cher('First name')).toBe('Cher');
    expect(cher('Surname')).toBe('');
    expect(cher('Marketing opt-out')).toBe('Yes');
    expect(cher('Total appointments')).toBe('1');
    expect(cher('Upcoming')).toBe('0');
    expect(cher('Allergy')).toBe('');
  });

  it('narrows by the day a client was added, on the venue clock', async () => {
    // Cher was added at 23:30 UTC on 31 August, which is 00:30 on 1 September in London.
    const { res } = await runExport({ type: 'contacts', from: '2026-09-01', to: '2026-09-30' }, contactsWorld);
    const [, ...rows] = await csvRows(res);
    expect(rows.map((r) => r[0])).toEqual(['g2']);
  });

  it('still answers the old name, type=guests', async () => {
    const { res } = await runExport({ type: 'guests' }, contactsWorld);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toContain('sept-salon-clients-all-time');
  });
});

// ─── Services ────────────────────────────────────────────────────────────────

describe('GET /api/venue/export?type=services', () => {
  it('carries the catalogue: category, timings, prices, calendars, options, add-ons and rules', async () => {
    const { res } = await runExport({ type: 'services' }, servicesWorld);
    expect(res.status).toBe(200);
    const [headers, first, second] = await csvRows(res);
    expect(first).toHaveLength(headers!.length);

    const cut = cellReader(headers!, first!);
    expect(cut('Name')).toBe('Cut and finish');
    expect(cut('Category')).toBe('Hair');
    expect(cut('Duration (minutes)')).toBe('45');
    expect(cut('Buffer after (minutes)')).toBe('10');
    // Processing comes from the canonical blocks when they are set.
    expect(cut('Processing time (minutes)')).toBe('15');
    expect(cut('Price (£)')).toBe('40');
    expect(cut('Deposit (£)')).toBe('15');
    expect(cut('Payment to book')).toBe('Deposit to book');
    expect(cut('Bookable online')).toBe('Yes');
    expect(cut('Active')).toBe('Yes');
    // Only this venue's calendars; a per-calendar duration or price is shown in brackets.
    expect(cut('Offered on calendars')).toBe('Dana; Sam (60 min, £45.00)');
    expect(cut('Options')).toBe('Short hair: 30 min, £30.00; Long hair: 60 min, £50.00, deposit £20.00, inactive');
    // Inactive add-ons are left out.
    expect(cut('Add-on groups')).toBe('Finishing: Gloss £5.00');
    expect(cut('Book up to (days ahead)')).toBe('60');
    expect(cut('Same-day booking')).toBe('Yes');
    expect(cut('Pre-appointment instructions')).toBe('Arrive with dry hair');
    expect(cut('Shared from a collective')).toBe('No');
    expect(cut('Added on')).toBe('2026-05-01 09:00');

    const beard = cellReader(headers!, second!);
    expect(beard('Category')).toBe('');
    expect(beard('Active')).toBe('No');
    expect(beard('Payment to book')).toBe('No payment needed to book');
    expect(beard('Same-day booking')).toBe('');
    expect(beard('Shared from a collective')).toBe('Yes');
  });

  it('narrows by the day a service was added', async () => {
    const { res } = await runExport({ type: 'services', from: '2026-09-01', to: '2026-09-30' }, servicesWorld);
    const [, ...rows] = await csvRows(res);
    expect(rows.map((r) => r[0])).toEqual(['svc-2']);
  });
});

// ─── File types ──────────────────────────────────────────────────────────────

describe('GET /api/venue/export: file types', () => {
  it('CSV starts with a byte-order mark so Excel reads £ and accents', async () => {
    const { res } = await runExport({ type: 'bookings', format: 'csv' }, bookingsWorld);
    // Read the bytes: Response.text() strips the mark before anyone can see it.
    expect([...new Uint8Array(await res.arrayBuffer()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('writes a real .xlsx workbook with the same headers and rows, money as numbers', async () => {
    const { res } = await runExport({ type: 'bookings', format: 'xlsx' }, bookingsWorld);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.headers.get('Content-Disposition')).toContain('.xlsx"');
    const wb = XLSX.read(new Uint8Array(await res.arrayBuffer()), { type: 'array' });
    expect(wb.SheetNames).toEqual(['Appointments']);
    const grid = XLSX.utils.sheet_to_json(wb.Sheets['Appointments']!, { header: 1 }) as unknown[][];
    expect(grid[0]).toContain('Appointment ID');
    const price = grid[0]!.indexOf('Price (£)');
    expect(grid[1]![price]).toBe(45);
    expect(grid[1]![grid[0]!.indexOf('Client name')]).toBe('Ann Lee');
  });

  it('writes a PDF', async () => {
    const { res } = await runExport({ type: 'services', format: 'pdf' }, servicesWorld);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toContain('sept-salon-services-all-time');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  });

  it('writes a PDF for an empty range rather than failing', async () => {
    const { res } = await runExport({ type: 'bookings', format: 'pdf', from: '2020-01-01', to: '2020-01-31' });
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Export-Rows')).toBe('0');
  });

  it('refuses a file type it does not know', async () => {
    const { rec, res } = await runExport({ type: 'bookings', format: 'docx' });
    expect(res.status).toBe(400);
    expect(rec.calls).toEqual([]);
  });
});

// ─── Counting and validation ─────────────────────────────────────────────────

describe('GET /api/venue/export: count and validation', () => {
  it('count=1 answers how many rows the range holds instead of a file', async () => {
    const { rec, res } = await runExport({ type: 'bookings', count: '1', from: '2026-09-01', to: '2026-09-30' }, (call) =>
      call.table === 'bookings' ? { data: [], count: 42 } : undefined,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 42 });
    const read = rec.calls.find((c) => c.table === 'bookings');
    expect(filtersOf(read)).toEqual(
      expect.arrayContaining([['gte', 'booking_date', '2026-09-01'], ['lte', 'booking_date', '2026-09-30']]),
    );
  });

  it('counts clients and services added in the range on the venue clock', async () => {
    const contacts = await runExport({ type: 'contacts', count: '1', from: '2026-09-01', to: '2026-09-30' }, contactsWorld);
    expect(await contacts.res.json()).toEqual({ count: 1 });
    const svc = await runExport({ type: 'services', count: '1' }, servicesWorld);
    expect(await svc.res.json()).toEqual({ count: 2 });
  });

  it.each<Record<string, string>>([
    { from: '2026-09-30', to: '2026-09-01' },
    { from: '2026-9-1', to: '2026-09-30' },
    { from: '2026-09-01' },
    { to: '2026-09-30' },
  ])('refuses a bad range %j before reading anything', async (range) => {
    const { rec, res } = await runExport({ type: 'bookings', ...range });
    expect(res.status).toBe(400);
    expect(rec.calls).toEqual([]);
  });

  it('refuses an unknown type', async () => {
    const { res } = await runExport({ type: 'invoices' });
    expect(res.status).toBe(400);
  });
});

// ─── Who may export ──────────────────────────────────────────────────────────

describe('GET /api/venue/export: who may export (PB-19)', () => {
  it.each(['bookings', 'contacts', 'services'] as const)('refuses the %s export to non-admin staff before reading anything', async (type) => {
    const { rec, res } = await runExport({ type }, undefined, 'staff');
    expect(res.status).toBe(403);
    expect(rec.calls).toEqual([]);
  });
});
