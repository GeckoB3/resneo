import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { LinkGrant } from '@/lib/linked-accounts/types';

vi.mock('@/lib/supabase/venue-route-client', () => ({
  createVenueRouteClient: vi.fn(async () => ({})),
}));

vi.mock('@/lib/venue-auth', () => ({
  getVenueStaff: vi.fn(),
}));

// Only the loader is doubled. `linkedGrantHasFullDetails` stays real, so the
// gate under test is the actual one rather than a stand-in, and the redaction
// module is not mocked at all for the same reason.
vi.mock('@/lib/booking/staff-booking-access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/booking/staff-booking-access')>()),
  loadStaffAccessibleBooking: vi.fn(),
}));

vi.mock('@/lib/booking/load-booking-detail-bundle', () => ({
  loadStaffBookingDetailBundle: vi.fn(),
}));
vi.mock('@/lib/booking/cde-booking-context', () => ({
  resolveCdeBookingContext: vi.fn(async () => null),
}));
vi.mock('@/lib/booking/booking-service-payment-requirement', () => ({
  resolveBookingServicePaymentRequirement: vi.fn(async () => null),
}));
vi.mock('@/lib/booking/infer-booking-row-model', () => ({
  inferBookingRowModel: vi.fn(() => 'appointment'),
}));
vi.mock('@/lib/booking/payment-summary', () => ({
  visitAnchorFromBooking: vi.fn(() => ({})),
  loadVisitPaymentPicture: vi.fn(async () => ({
    anchorTotalPence: 0,
    amountPaidPence: 0,
    paymentState: 'unpaid',
    balanceDuePence: 0,
    bookingIds: [],
    totalPence: 0,
  })),
}));

import { getVenueStaff } from '@/lib/venue-auth';
import { loadStaffAccessibleBooking } from '@/lib/booking/staff-booking-access';
import { loadStaffBookingDetailBundle } from '@/lib/booking/load-booking-detail-bundle';
import { GET } from './route';

const BOOKING_ID = 'bk-1';
const routeParams = { params: Promise.resolve({ id: BOOKING_ID }) };

const BOOKING_ROW = {
  id: BOOKING_ID,
  venue_id: 'venue-owner',
  booking_time: '14:30:00',
  guest_first_name: 'Ann',
  guest_last_name: 'Lee',
  guest_email: 'ann@example.com',
  guest_phone: '+447700900000',
  special_requests: 'Allergic to latex',
  dietary_notes: 'Coeliac',
  occasion: 'Birthday',
  internal_notes: 'Difficult client',
};

const GUEST_ROW = {
  id: 'g1',
  first_name: 'Ann',
  last_name: 'Lee',
  email: 'ann@example.com',
  phone: '+447700900000',
  visit_count: 9,
  last_visit_date: '2026-01-02',
  customer_profile_notes: 'VIP',
  tags: ['vip'],
};

function grant(overrides: Partial<LinkGrant>): LinkGrant {
  return { calendar: 'full_details', pii: true, act: 'none', ...overrides } as LinkGrant;
}

function setup(ctx: { isOwnVenue: boolean; linkedGrant: LinkGrant | null }) {
  vi.mocked(getVenueStaff).mockResolvedValue({
    id: 'staff-1',
    venue_id: ctx.isOwnVenue ? 'venue-owner' : 'venue-partner',
    role: 'admin',
    db: {},
  } as unknown as Awaited<ReturnType<typeof getVenueStaff>>);

  vi.mocked(loadStaffAccessibleBooking).mockResolvedValue({
    ok: true,
    ctx: {
      booking: { ...BOOKING_ROW },
      ownerVenueId: 'venue-owner',
      isOwnVenue: ctx.isOwnVenue,
      linkedGrant: ctx.linkedGrant,
      linkId: ctx.isOwnVenue ? null : 'link-1',
    },
  } as unknown as Awaited<ReturnType<typeof loadStaffAccessibleBooking>>);

  vi.mocked(loadStaffBookingDetailBundle).mockResolvedValue({
    area_name: null,
    service_variant_name: null,
    service_variant_price_pence: null,
    guest: { ...GUEST_ROW },
    table_assignments: [],
    addons: [],
    events: [],
  } as unknown as Awaited<ReturnType<typeof loadStaffBookingDetailBundle>>);
}

const request = () =>
  new NextRequest(`http://localhost/api/venue/bookings/${BOOKING_ID}/summary`);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/venue/bookings/[id]/summary — linked-venue gates (C6)', () => {
  it('refuses a time_only link, matching the full GET', async () => {
    // Before this gate existed the route answered 200 with the whole row, and
    // the panel prefers this route for first paint, so a time_only partner saw
    // full booking detail without ever calling the gated sibling.
    setup({ isOwnVenue: false, linkedGrant: grant({ calendar: 'time_only' }) });

    const res = await GET(request(), routeParams);

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/busy times only/i);
  });

  it('redacts the booking row and the guest for a link without the PII grant', async () => {
    setup({ isOwnVenue: false, linkedGrant: grant({ calendar: 'full_details', pii: false }) });

    const res = await GET(request(), routeParams);
    expect(res.status).toBe(200);
    const body = await res.json();

    // The booking row carries its own copy of the client's details; redacting
    // only the joined guest is what let this leak before.
    expect(body.guest_first_name).toBeNull();
    expect(body.guest_last_name).toBeNull();
    expect(body.guest_email).toBeNull();
    expect(body.guest_phone).toBeNull();
    expect(body.special_requests).toBeNull();
    expect(body.dietary_notes).toBeNull();
    expect(body.occasion).toBeNull();
    expect(body.internal_notes).toBeNull();

    expect(body.guest.first_name).toBeNull();
    expect(body.guest.email).toBeNull();
    expect(body.guest.phone).toBeNull();
    expect(body.guest.customer_profile_notes).toBeNull();
    expect(body.guest.tags).toEqual([]);

    // Operational fields must survive, or the calendar cannot render.
    expect(body.id).toBe(BOOKING_ID);
    expect(body.booking_time).toBe('14:30');
  });

  it('leaves the payload intact for a full_details link that holds the PII grant', async () => {
    setup({ isOwnVenue: false, linkedGrant: grant({ calendar: 'full_details', pii: true }) });

    const res = await GET(request(), routeParams);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.guest_email).toBe('ann@example.com');
    expect(body.internal_notes).toBe('Difficult client');
    expect(body.guest.customer_profile_notes).toBe('VIP');
  });

  it('never redacts own-venue staff', async () => {
    setup({ isOwnVenue: true, linkedGrant: null });

    const res = await GET(request(), routeParams);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.guest_email).toBe('ann@example.com');
    expect(body.special_requests).toBe('Allergic to latex');
    expect(body.guest.tags).toEqual(['vip']);
  });
});
