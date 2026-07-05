import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

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

import { createRouteHandlerClientFromHeaders } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { resolveCallerGrantOverVenue } from '@/lib/linked-accounts/queries';
import { venueUsesUnifiedCalendarList } from '@/lib/booking/unified-calendar-list';
import { POST } from './route';

const mockCreateClient = vi.mocked(createRouteHandlerClientFromHeaders);
const mockGetVenueStaff = vi.mocked(getVenueStaff);
const mockGetAdmin = vi.mocked(getSupabaseAdminClient);
const mockResolveGrant = vi.mocked(resolveCallerGrantOverVenue);
const mockUsesUnified = vi.mocked(venueUsesUnifiedCalendarList);

const ACTING_VENUE_ID = 'a0000000-0000-4000-8000-000000000001';
const OWNER_VENUE_ID = 'a0000000-0000-4000-8000-000000000002';
const GUEST_ID = 'f0000000-0000-4000-8000-000000000001';
const SERVICE_ID = 'f0000000-0000-4000-8000-000000000002';

function mockAdmin(opts: {
  service: Record<string, unknown> | null;
  ownerVenue?: Record<string, unknown> | null;
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
      if (table === 'venues') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: opts.ownerVenue ?? { feature_flags: { card_hold_deposits: true } },
            error: null,
          }),
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
    expect(json.error).toBe(
      'This service requires a card hold. Create the booking from the main booking form.',
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it('creates normally when the owner venue flag is off (requirement resolves as none)', async () => {
    const { rpc } = mockAdmin({
      service: {
        id: SERVICE_ID,
        venue_id: OWNER_VENUE_ID,
        payment_requirement: 'card_hold',
        deposit_pence: 2500,
        price_pence: 5000,
      },
      ownerVenue: { feature_flags: {} },
    });

    const res = await POST(postRequest());
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('linked_apply_booking_insert', expect.anything());
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
