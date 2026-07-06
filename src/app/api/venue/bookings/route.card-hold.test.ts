import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: vi.fn(),
}));

vi.mock('@/lib/supabase/venue-route-client', () => ({
  createVenueRouteClient: vi.fn(),
}));

vi.mock('@/lib/venue-auth', () => ({
  getVenueStaff: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdminClient: vi.fn(),
}));

vi.mock('@/lib/stripe', () => ({
  stripe: { paymentIntents: { create: vi.fn() } },
}));

vi.mock('@/lib/guests', () => ({
  findOrCreateGuest: vi.fn(),
}));

vi.mock('@/lib/venue-mode', () => ({
  resolveVenueMode: vi.fn(),
}));

vi.mock('@/lib/booking/staff-booking-access', () => ({
  resolveLinkedStaffCreateScope: vi.fn(),
}));

vi.mock('@/lib/booking/staff-booking-payment-comms', () => ({
  applyStaffBookingPaymentAndComms: vi.fn(),
}));

vi.mock('@/lib/availability/class-session-engine', () => ({
  fetchClassInput: vi.fn(),
  computeClassAvailability: vi.fn(),
}));

vi.mock('@/lib/availability', () => ({
  computeAvailability: vi.fn(),
  fetchEngineInput: vi.fn(),
  hasServiceConfig: vi.fn(),
}));

vi.mock('@/lib/areas/resolve-default-area', () => ({
  listActiveAreasForVenue: vi.fn(),
}));

vi.mock('@/lib/table-management/booking-table-duration', () => ({
  resolveDurationAndBufferForTableAssignment: vi.fn(),
}));

vi.mock('@/lib/table-availability', () => ({
  autoAssignTable: vi.fn(),
}));

vi.mock('@/lib/table-management/lifecycle', () => ({
  syncTableStatusesForBooking: vi.fn(),
}));

vi.mock('@/lib/booking-short-links', () => ({
  createOrGetBookingShortLink: vi.fn().mockResolvedValue('https://app.test/b/manage'),
  createOrGetPaymentShortLink: vi.fn().mockResolvedValue('https://app.test/b/pay'),
}));

vi.mock('@/lib/communications/send-templated', () => ({
  sendBookingConfirmationNotifications: vi.fn(),
  sendDepositRequestNotifications: vi.fn(),
}));

vi.mock('@/lib/metrics/log-staff-booking-flow-event', () => ({
  logStaffBookingFlowEvent: vi.fn(),
}));

import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { findOrCreateGuest } from '@/lib/guests';
import { resolveVenueMode } from '@/lib/venue-mode';
import { resolveLinkedStaffCreateScope } from '@/lib/booking/staff-booking-access';
import { applyStaffBookingPaymentAndComms } from '@/lib/booking/staff-booking-payment-comms';
import { fetchClassInput, computeClassAvailability } from '@/lib/availability/class-session-engine';
import { computeAvailability, fetchEngineInput } from '@/lib/availability';
import { listActiveAreasForVenue } from '@/lib/areas/resolve-default-area';
import { resolveDurationAndBufferForTableAssignment } from '@/lib/table-management/booking-table-duration';
import { POST } from './route';

const mockCreateVenueRouteClient = vi.mocked(createVenueRouteClient);
const mockGetVenueStaff = vi.mocked(getVenueStaff);
const mockGetAdmin = vi.mocked(getSupabaseAdminClient);
const mockFindOrCreateGuest = vi.mocked(findOrCreateGuest);
const mockResolveVenueMode = vi.mocked(resolveVenueMode);
const mockResolveScope = vi.mocked(resolveLinkedStaffCreateScope);
const mockApplyComms = vi.mocked(applyStaffBookingPaymentAndComms);
const mockFetchClassInput = vi.mocked(fetchClassInput);
const mockComputeClassAvailability = vi.mocked(computeClassAvailability);
const mockComputeAvailability = vi.mocked(computeAvailability);
const mockFetchEngineInput = vi.mocked(fetchEngineInput);
const mockListAreas = vi.mocked(listActiveAreasForVenue);
const mockResolveDuration = vi.mocked(resolveDurationAndBufferForTableAssignment);

const VENUE_ID = 'a0000000-0000-4000-8000-000000000001';
const CLASS_INSTANCE_ID = 'c0000000-0000-4000-8000-000000000001';
const CLASS_TYPE_ID = 'c0000000-0000-4000-8000-000000000002';
const BOOKING_ID = 'b0000000-0000-4000-8000-000000000001';
const AREA_ID = 'd0000000-0000-4000-8000-000000000001';
const TABLE_SERVICE_ID = 'e0000000-0000-4000-8000-000000000001';

type AdminMock = {
  client: { from: ReturnType<typeof vi.fn> };
  bookingInserts: Array<Record<string, unknown>>;
  restrictionRow: Record<string, unknown> | null;
};

function mockAdmin(opts: {
  venue: Record<string, unknown>;
  restrictionRow?: Record<string, unknown> | null;
}): AdminMock {
  const bookingInserts: Array<Record<string, unknown>> = [];
  const client = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'venues') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: opts.venue, error: null }),
        };
      }
      if (table === 'bookings') {
        return {
          insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
            bookingInserts.push(row);
            return {
              select: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({ data: { id: BOOKING_ID }, error: null }),
            };
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
          delete: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }
      if (table === 'booking_restrictions') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: opts.restrictionRow ?? null, error: null }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
  mockGetAdmin.mockReturnValue(client as never);
  return { client, bookingInserts, restrictionRow: opts.restrictionRow ?? null };
}

function venueRow(overrides?: Record<string, unknown>) {
  return {
    id: VENUE_ID,
    name: 'Studio One',
    stripe_connected_account_id: 'acct_1',
    booking_rules: null,
    deposit_config: null,
    table_management_enabled: false,
    show_table_in_confirmation: false,
    timezone: 'Europe/London',
    address: '1 High St',
    opening_hours: null,
    venue_opening_exceptions: null,
    email: 'venue@example.com',
    reply_to_email: null,
    feature_flags: { card_hold_deposits: true },
    ...overrides,
  };
}

function classSlot(overrides?: Record<string, unknown>) {
  return {
    instance_id: CLASS_INSTANCE_ID,
    class_type_id: CLASS_TYPE_ID,
    class_name: 'Reformer Pilates',
    description: null,
    instance_date: '2026-07-10',
    start_time: '18:30:00',
    duration_minutes: 60,
    capacity: 10,
    remaining: 8,
    instructor_id: null,
    instructor_name: null,
    price_pence: 1200,
    // The engine degrades card_hold class types to 'none' (spec 6.3).
    payment_requirement: 'none',
    deposit_amount_pence: null,
    cancellation_notice_hours: 48,
    requires_stripe_checkout: false,
    requires_online_payment: false,
    colour: '#123456',
    ...overrides,
  };
}

function setupClassScenario(opts: {
  venue?: Record<string, unknown>;
  classType?: Record<string, unknown>;
  slot?: Record<string, unknown>;
}) {
  const admin = mockAdmin({ venue: venueRow(opts.venue) });
  mockResolveVenueMode.mockResolvedValue({
    bookingModel: 'class_session',
    activeBookingModels: ['class_session'],
    enabledModels: [],
    tableManagementEnabled: false,
    availabilityEngine: 'legacy',
    terminology: {} as never,
  } as never);
  mockFetchClassInput.mockResolvedValue({
    date: '2026-07-10',
    classTypes: [
      {
        id: CLASS_TYPE_ID,
        payment_requirement: 'card_hold',
        deposit_amount_pence: 500,
        price_pence: 1200,
        ...opts.classType,
      },
    ],
    instances: [],
    bookedByInstance: {},
  } as never);
  mockComputeClassAvailability.mockReturnValue([classSlot(opts.slot)] as never);
  return admin;
}

function setupTableScenario(opts: {
  venue?: Record<string, unknown>;
  restrictionRow?: Record<string, unknown> | null;
}) {
  const admin = mockAdmin({
    venue: venueRow(opts.venue),
    restrictionRow: opts.restrictionRow ?? null,
  });
  mockResolveVenueMode.mockResolvedValue({
    bookingModel: 'table_reservation',
    activeBookingModels: ['table_reservation'],
    enabledModels: [],
    tableManagementEnabled: false,
    availabilityEngine: 'service',
    terminology: {} as never,
  } as never);
  mockListAreas.mockResolvedValue([{ id: AREA_ID, name: 'Main' }] as never);
  mockFetchEngineInput.mockResolvedValue({} as never);
  mockComputeAvailability.mockReturnValue([
    {
      slots: [
        { start_time: '18:30', available_covers: 10, service_id: TABLE_SERVICE_ID },
      ],
    },
  ] as never);
  mockResolveDuration.mockResolvedValue({ durationMinutes: 90, bufferMinutes: 0 } as never);
  return admin;
}

function postRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('https://app.test/api/venue/bookings', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function classBody(overrides?: Record<string, unknown>) {
  return {
    booking_date: '2026-07-10',
    booking_time: '18:30',
    party_size: 2,
    first_name: 'Sam',
    last_name: 'Guest',
    phone: '07712345678',
    email: 'sam@example.com',
    class_instance_id: CLASS_INSTANCE_ID,
    ...overrides,
  };
}

function tableBody(overrides?: Record<string, unknown>) {
  return {
    booking_date: '2026-07-10',
    booking_time: '18:30',
    party_size: 4,
    first_name: 'Sam',
    last_name: 'Guest',
    phone: '07712345678',
    email: 'sam@example.com',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_BASE_URL = 'https://app.test';
  mockCreateVenueRouteClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
  } as never);
  mockGetVenueStaff.mockResolvedValue({
    id: 'staff-1',
    venue_id: VENUE_ID,
    role: 'admin',
  } as never);
  mockResolveScope.mockResolvedValue({ ok: true, venueId: VENUE_ID, linked: null } as never);
  mockFindOrCreateGuest.mockResolvedValue({
    guest: {
      id: 'guest-1',
      first_name: 'Sam',
      last_name: 'Guest',
      email: 'sam@example.com',
      phone: '+447712345678',
    },
    created: false,
  } as never);
  mockApplyComms.mockResolvedValue({ payment_url: 'https://app.test/b/pay' });
});

describe('POST /api/venue/bookings card holds, class branch (spec 7.6)', () => {
  it('defaults the toggle ON for a card_hold class: Pending + hold via shared helper', async () => {
    const admin = setupClassScenario({});

    const res = await POST(postRequest(classBody()));
    const json = await res.json();
    expect(res.status).toBe(201);
    expect(json.card_hold_requested).toBe(true);
    expect(json.payment_url).toBe('https://app.test/b/pay');
    expect(json.message).toBe('Class booking created. Card request link sent.');

    expect(admin.bookingInserts).toHaveLength(1);
    expect(admin.bookingInserts[0]).toMatchObject({
      status: 'Pending',
      deposit_status: 'Pending',
      deposit_amount_pence: null,
    });

    expect(mockApplyComms).toHaveBeenCalledTimes(1);
    const args = mockApplyComms.mock.calls[0]![0];
    // Per-person fee x party size (D5), no deposit on the card-hold path.
    expect(args.cardHoldFeePence).toBe(1000);
    expect(args.requiresDeposit).toBe(false);
    expect(args.stripeConnectedAccountId).toBe('acct_1');
  });

  it('creates a plain confirmed booking when staff waive the hold (require_card_hold false)', async () => {
    const admin = setupClassScenario({});
    mockApplyComms.mockResolvedValue({ payment_url: undefined });

    const res = await POST(postRequest(classBody({ require_card_hold: false })));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.card_hold_requested).toBeUndefined();
    expect(json.message).toBe('Class booking created.');

    expect(admin.bookingInserts[0]).toMatchObject({
      status: 'Booked',
      deposit_status: 'Not Required',
      deposit_amount_pence: null,
    });
    const args = mockApplyComms.mock.calls[0]![0];
    expect(args.cardHoldFeePence).toBeNull();
    expect(args.requiresDeposit).toBe(false);
  });

  it('applies the hold to walk-in bookings too (unlike deposits, D6)', async () => {
    const admin = setupClassScenario({});

    const res = await POST(postRequest(classBody({ source: 'walk-in', phone: undefined })));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.card_hold_requested).toBe(true);

    expect(admin.bookingInserts[0]).toMatchObject({
      status: 'Pending',
      deposit_status: 'Pending',
      deposit_amount_pence: null,
    });
    expect(mockApplyComms.mock.calls[0]![0].cardHoldFeePence).toBe(1000);
  });

  it('ignores require_card_hold when the venue flag is off (never creates a hold)', async () => {
    const admin = setupClassScenario({ venue: { feature_flags: {} } });
    mockApplyComms.mockResolvedValue({ payment_url: undefined });

    const res = await POST(postRequest(classBody({ require_card_hold: true })));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.card_hold_requested).toBeUndefined();

    expect(admin.bookingInserts[0]).toMatchObject({
      status: 'Booked',
      deposit_status: 'Not Required',
    });
    expect(mockApplyComms.mock.calls[0]![0].cardHoldFeePence).toBeNull();
  });

  it('ignores require_card_hold for a deposit-type class (existing behaviour untouched)', async () => {
    const admin = setupClassScenario({
      classType: { payment_requirement: 'deposit', deposit_amount_pence: 500 },
      slot: { payment_requirement: 'deposit', deposit_amount_pence: 500 },
    });

    const res = await POST(postRequest(classBody({ require_card_hold: false })));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.card_hold_requested).toBeUndefined();
    expect(json.message).toBe('Class booking created. Deposit link sent.');

    // Config-driven class deposit still applies: per-person x party, Pending.
    expect(admin.bookingInserts[0]).toMatchObject({
      status: 'Pending',
      deposit_status: 'Pending',
      deposit_amount_pence: 1000,
    });
    const args = mockApplyComms.mock.calls[0]![0];
    expect(args.requiresDeposit).toBe(true);
    expect(args.depositAmountPence).toBe(1000);
    expect(args.cardHoldFeePence).toBeNull();
  });

  it('rejects a hold when the venue has no connected Stripe account (mirrors the deposit 400)', async () => {
    const admin = setupClassScenario({ venue: { stripe_connected_account_id: null } });

    const res = await POST(postRequest(classBody()));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe(
      'Venue has not set up payments; a card hold is required for this booking type.',
    );
    expect(admin.bookingInserts).toHaveLength(0);
  });
});

describe('POST /api/venue/bookings card holds, table branch (spec 7.6 / D5)', () => {
  it('holds per person x party with no threshold when the rules are card_hold', async () => {
    const admin = setupTableScenario({
      restrictionRow: { deposit_amount_per_person_gbp: 5, deposit_type: 'card_hold' },
    });

    const res = await POST(postRequest(tableBody()));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.card_hold_requested).toBe(true);
    expect(json.message).toBe('Booking created. Card request link sent.');

    expect(admin.bookingInserts[0]).toMatchObject({
      status: 'Pending',
      deposit_status: 'Pending',
      deposit_amount_pence: null,
    });
    const args = mockApplyComms.mock.calls[0]![0];
    expect(args.cardHoldFeePence).toBe(2000); // £5 x 4 covers
    expect(args.requiresDeposit).toBe(false);
  });

  it('400s when the card_hold rules have no per-person amount (mirrors the deposit 400)', async () => {
    const admin = setupTableScenario({
      restrictionRow: { deposit_amount_per_person_gbp: null, deposit_type: 'card_hold' },
    });

    const res = await POST(postRequest(tableBody()));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('No per-person no-show fee is configured');
    expect(admin.bookingInserts).toHaveLength(0);
    expect(mockApplyComms).not.toHaveBeenCalled();
  });

  it('falls back to the legacy deposit_config card_hold type when no restriction row exists', async () => {
    const admin = setupTableScenario({
      venue: { deposit_config: { amount_per_person_gbp: 2.5, type: 'card_hold' } },
      restrictionRow: null,
    });

    const res = await POST(postRequest(tableBody()));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.card_hold_requested).toBe(true);
    expect(mockApplyComms.mock.calls[0]![0].cardHoldFeePence).toBe(1000); // £2.50 x 4
    expect(admin.bookingInserts[0]).toMatchObject({ status: 'Pending', deposit_status: 'Pending' });
  });

  it('keeps the deposit toggle behaviour untouched for charge-type rules', async () => {
    const admin = setupTableScenario({
      restrictionRow: { deposit_amount_per_person_gbp: 5, deposit_type: 'charge' },
    });

    const res = await POST(postRequest(tableBody({ require_card_hold: true })));
    expect(res.status).toBe(201);
    const json = await res.json();
    // require_card_hold ignored: no deposit toggle sent either, so a plain booking.
    expect(json.card_hold_requested).toBeUndefined();
    expect(json.message).toBe('Booking created.');
    expect(admin.bookingInserts[0]).toMatchObject({
      status: 'Booked',
      deposit_status: 'Not Required',
      deposit_amount_pence: null,
    });
    expect(mockApplyComms).not.toHaveBeenCalled();
  });
});
