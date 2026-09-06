import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/*
 * The mobile app reads these two GET routes with a Bearer token. They used to build
 * their Supabase client from cookies alone, so the app got 401 while the dashboard
 * worked (R25 web handover, 2026-09-06). Each must hand the request to the shared
 * Bearer-or-cookie client and answer 401 only when that client yields no staff.
 */

vi.mock('@/lib/supabase/venue-route-client', () => ({ createVenueRouteClient: vi.fn(async () => ({ tag: 'client' })) }));
vi.mock('@/lib/venue-auth', () => ({ getVenueStaff: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: vi.fn() }));
vi.mock('@/lib/light-plan', () => ({
  assertCalendarSlotAvailable: vi.fn(async () => ({ allowed: true, limit: 5, current: 3 })),
  assertStaffSlotAvailable: vi.fn(async () => ({ allowed: true, limit: 10, staffCount: 2 })),
}));
vi.mock('@/lib/calendar/column-assignment-conflicts', () => ({
  collectCalendarColumnConflicts: vi.fn(async () => [{ calendarId: 'cal-1', kind: 'resource_overlap' }]),
}));

import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { GET as getEntitlement } from './route';
import { GET as getConflicts } from '../calendar-column-conflicts/route';

const mockClient = vi.mocked(createVenueRouteClient);
const mockStaff = vi.mocked(getVenueStaff);
const mockAdmin = vi.mocked(getSupabaseAdminClient);

function bearerRequest(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, { headers: { authorization: 'Bearer app-token' } });
}

/** An admin client answering the entitlement route's two venue reads. */
function adminForEntitlement() {
  const venueQuery = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn(async () => ({ data: { pricing_tier: 'plus', calendar_count: 3, booking_model: 'unified_scheduling' } })) };
  const countQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ count: 3, error: null }).then(resolve),
  };
  return { from: vi.fn((table: string) => (table === 'venues' ? venueQuery : countQuery)) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAdmin.mockReturnValue(adminForEntitlement() as never);
});

describe.each([
  ['GET /api/venue/calendar-entitlement', '/api/venue/calendar-entitlement', getEntitlement],
  ['GET /api/venue/calendar-column-conflicts', '/api/venue/calendar-column-conflicts', getConflicts],
])('%s', (_label, path, handler) => {
  it('builds its client from the request, so a Bearer token is honoured', async () => {
    mockStaff.mockResolvedValue({ id: 'staff-1', venue_id: 'venue-1', role: 'admin' } as never);
    const request = bearerRequest(path);
    const res = await handler(request);
    expect(res.status).toBe(200);
    expect(mockClient).toHaveBeenCalledTimes(1);
    expect(mockClient).toHaveBeenCalledWith(request);
    expect(mockStaff).toHaveBeenCalledWith({ tag: 'client' });
  });

  it('answers 401 when the client yields no staff', async () => {
    mockStaff.mockResolvedValue(null as never);
    const res = await handler(bearerRequest(path));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorised' });
  });
});

it('the entitlement response keeps the shape the dashboard and the app read', async () => {
  mockStaff.mockResolvedValue({ id: 'staff-1', venue_id: 'venue-1', role: 'admin' } as never);
  const body = await (await getEntitlement(bearerRequest('/api/venue/calendar-entitlement'))).json();
  expect(body).toMatchObject({
    pricing_tier: 'plus',
    calendar_limit: 5,
    unified_calendar_count: 3,
    at_calendar_limit: false,
    can_add_practitioner: true,
    active_staff: 2,
    booking_model: 'unified_scheduling',
  });
});

it('the conflicts response keeps its shape', async () => {
  mockStaff.mockResolvedValue({ id: 'staff-1', venue_id: 'venue-1', role: 'admin' } as never);
  const body = await (await getConflicts(bearerRequest('/api/venue/calendar-column-conflicts'))).json();
  expect(body).toEqual({ conflicts: [{ calendarId: 'cal-1', kind: 'resource_overlap' }] });
});
