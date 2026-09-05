import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { validateAppointmentModificationInterval } from '@/lib/booking/validate-appointment-modification';

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createRouteHandlerClientFromHeaders: vi.fn(),
}));

vi.mock('@/lib/venue-auth', () => ({
  getVenueStaff: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdminClient: vi.fn(),
}));

vi.mock('@/lib/linked-accounts/queries', () => ({
  resolveCallerGrantOverVenue: vi.fn(),
}));

vi.mock('@/lib/booking/unified-calendar-list', () => ({
  venueUsesUnifiedCalendarList: vi.fn(),
}));

vi.mock('@/lib/linked-accounts/notifications', () => ({
  notifyCrossVenueBookingWrite: vi.fn(),
}));

// H38 — the overlap check is unconditional now, so it runs in these tests too.
// This suite is about card-hold rejection, not availability, so the validator is
// stubbed to "available"; its own behaviour is covered where it lives.
vi.mock('@/lib/booking/validate-appointment-modification', () => ({
  validateAppointmentModificationInterval: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/lib/booking/card-hold-cancellation', () => ({
  settleCardHoldsOnCancellation: vi.fn(async () => ({
    releasedBookingIds: [],
    keptHolds: [],
  })),
}));

import { createRouteHandlerClientFromHeaders } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { resolveCallerGrantOverVenue } from '@/lib/linked-accounts/queries';
import { venueUsesUnifiedCalendarList } from '@/lib/booking/unified-calendar-list';
import { settleCardHoldsOnCancellation } from '@/lib/booking/card-hold-cancellation';
import { PATCH, POST } from './route';

const mockCreateClient = vi.mocked(createRouteHandlerClientFromHeaders);
const mockGetVenueStaff = vi.mocked(getVenueStaff);
const mockGetAdmin = vi.mocked(getSupabaseAdminClient);
const mockResolveGrant = vi.mocked(resolveCallerGrantOverVenue);
const mockUsesUnified = vi.mocked(venueUsesUnifiedCalendarList);

const ACTING_VENUE_ID = 'a0000000-0000-4000-8000-000000000001';
const OWNER_VENUE_ID = 'a0000000-0000-4000-8000-000000000002';
const GUEST_ID = 'f0000000-0000-4000-8000-000000000001';
const SERVICE_ID = 'f0000000-0000-4000-8000-000000000002';
// H38 — the calendar is required now. This fixture used to omit it, which is
// itself telling: the unvalidated shape was normal enough to be the default.
const PRACTITIONER_ID = 'f0000000-0000-4000-8000-000000000003';

function mockAdmin(opts: {
  service: Record<string, unknown> | null;
}) {
  const rpc = vi.fn().mockResolvedValue({ data: { id: 'created-1' }, error: null });
  const client = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'guests') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi
            .fn()
            .mockResolvedValue({ data: { id: GUEST_ID, venue_id: OWNER_VENUE_ID }, error: null }),
        };
      }
      if (table === 'appointment_services') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: opts.service, error: null }),
        };
      }
      if (table === 'practitioners' || table === 'unified_calendars') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi
            .fn()
            .mockResolvedValue({ data: { id: PRACTITIONER_ID, venue_id: OWNER_VENUE_ID }, error: null }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
    rpc,
  };
  mockGetAdmin.mockReturnValue(client as never);
  return { client, rpc };
}

function postRequest(): NextRequest {
  return new NextRequest('https://app.test/api/venue/linked-calendar/booking', {
    method: 'POST',
    body: JSON.stringify({
      ownerVenueId: OWNER_VENUE_ID,
      guestId: GUEST_ID,
      practitionerId: PRACTITIONER_ID,
      appointmentServiceId: SERVICE_ID,
      bookingDate: '2026-07-10',
      bookingTime: '10:00',
    }),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
  } as never);
  mockGetVenueStaff.mockResolvedValue({
    id: 'staff-1',
    venue_id: ACTING_VENUE_ID,
    role: 'admin',
  } as never);
  mockResolveGrant.mockResolvedValue({
    linkId: 'link-1',
    grant: { act: 'create_edit_cancel', calendarIds: null },
  } as never);
  mockUsesUnified.mockResolvedValue(false);
});

describe('POST /api/venue/linked-calendar/booking card-hold rejection (spec D6)', () => {
  it('400s with card_hold_service_unsupported BEFORE the RPC for a card-hold service', async () => {
    const { rpc } = mockAdmin({
      service: {
        id: SERVICE_ID,
        venue_id: OWNER_VENUE_ID,
        payment_requirement: 'card_hold',
        deposit_pence: 2500,
        price_pence: 5000,
      },
    });

    const res = await POST(postRequest());
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe('card_hold_service_unsupported');
    // The message must point at the Calendar screen, which can genuinely take a
    // card-hold booking for a linked venue. It previously said "the main booking
    // form", which is scoped to the staff member's own venue and cannot.
    expect(json.error).toContain('Calendar screen');
    expect(json.error).not.toContain('main booking form');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('creates normally for a non-card-hold service', async () => {
    const { rpc } = mockAdmin({
      service: {
        id: SERVICE_ID,
        venue_id: OWNER_VENUE_ID,
        payment_requirement: 'deposit',
        deposit_pence: 2500,
        price_pence: 5000,
      },
    });

    const res = await POST(postRequest());
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('linked_apply_booking_insert', expect.anything());
  });

  it('allows a zero-fee card_hold config through (resolves as none, matching Phase 1)', async () => {
    const { rpc } = mockAdmin({
      service: {
        id: SERVICE_ID,
        venue_id: OWNER_VENUE_ID,
        payment_requirement: 'card_hold',
        deposit_pence: 0,
        price_pence: 5000,
      },
    });

    const res = await POST(postRequest());
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalled();
  });
});

describe('PATCH /api/venue/linked-calendar/booking card-hold settle on cancel (spec 9.3)', () => {
  it('settles open card holds after a successful cross-venue PATCH cancel', async () => {
    const BOOKING_ID = 'f0000000-0000-4000-8000-000000000099';
    const rpc = vi.fn().mockResolvedValue({ data: { id: BOOKING_ID, status: 'Cancelled' }, error: null });
    const client = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'bookings') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: BOOKING_ID,
                venue_id: OWNER_VENUE_ID,
                calendar_id: null,
                practitioner_id: null,
                booking_date: '2026-07-10',
                booking_time: '10:00:00',
                booking_end_time: null,
              },
              error: null,
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
      rpc,
    };
    mockGetAdmin.mockReturnValue(client as never);

    const res = await PATCH(
      new NextRequest('https://app.test/api/venue/linked-calendar/booking', {
        method: 'PATCH',
        body: JSON.stringify({ bookingId: BOOKING_ID, changes: { status: 'Cancelled' } }),
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('linked_apply_booking_update', expect.anything());
    // The cross-venue cancel goes through the SQL RPC and skips every other
    // cancel hook, so this route must settle the hold itself (released before
    // the deadline, kept chargeable after it).
    expect(settleCardHoldsOnCancellation).toHaveBeenCalledTimes(1);
    expect(settleCardHoldsOnCancellation).toHaveBeenCalledWith(client, [BOOKING_ID]);
  });

  it('does not touch holds on a non-cancel PATCH (reschedule keeps the hold open)', async () => {
    const BOOKING_ID = 'f0000000-0000-4000-8000-000000000099';
    const rpc = vi.fn().mockResolvedValue({ data: { id: BOOKING_ID }, error: null });
    const client = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'bookings') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: BOOKING_ID,
                venue_id: OWNER_VENUE_ID,
                calendar_id: null,
                practitioner_id: null,
                booking_date: '2026-07-10',
                booking_time: '10:00:00',
                booking_end_time: null,
              },
              error: null,
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
      rpc,
    };
    mockGetAdmin.mockReturnValue(client as never);

    const res = await PATCH(
      new NextRequest('https://app.test/api/venue/linked-calendar/booking', {
        method: 'PATCH',
        body: JSON.stringify({ bookingId: BOOKING_ID, changes: { booking_date: '2026-07-12' } }),
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('linked_apply_booking_update', expect.anything());
    expect(settleCardHoldsOnCancellation).not.toHaveBeenCalled();
  });
});

describe('POST /api/venue/linked-calendar/booking availability gating (H38)', () => {
  /** The same body, minus whichever id the caller chooses to leave out. */
  function postWithout(omit: 'practitionerId' | 'appointmentServiceId'): NextRequest {
    const body: Record<string, unknown> = {
      ownerVenueId: OWNER_VENUE_ID,
      guestId: GUEST_ID,
      practitionerId: PRACTITIONER_ID,
      appointmentServiceId: SERVICE_ID,
      bookingDate: '2026-07-10',
      bookingTime: '10:00',
    };
    delete body[omit];
    return new NextRequest('https://app.test/api/venue/linked-calendar/booking', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    });
  }

  it('refuses a cross-venue create with no calendar', async () => {
    // Every guard on this route was conditional on these two ids, and both were
    // optional, so omitting one skipped the calendar check, the service check
    // AND the overlap check while the RPC still wrote the row. A booking with no
    // calendar also escapes calendar scoping, because link_calendar_allows
    // returns true when the calendar is NULL.
    const { rpc } = mockAdmin({ service: { id: SERVICE_ID, venue_id: OWNER_VENUE_ID } });
    const res = await POST(postWithout('practitionerId'));
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses a cross-venue create with no service', async () => {
    const { rpc } = mockAdmin({ service: { id: SERVICE_ID, venue_id: OWNER_VENUE_ID } });
    const res = await POST(postWithout('appointmentServiceId'));
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('runs the overlap check on every create, and refuses when it fails', async () => {
    const { rpc } = mockAdmin({ service: { id: SERVICE_ID, venue_id: OWNER_VENUE_ID } });
    vi.mocked(validateAppointmentModificationInterval).mockResolvedValueOnce({
      ok: false,
      reason: 'That slot is already taken.',
    } as never);

    const res = await POST(postRequest());

    expect(validateAppointmentModificationInterval).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(409);
    expect(rpc).not.toHaveBeenCalled();
  });
});
