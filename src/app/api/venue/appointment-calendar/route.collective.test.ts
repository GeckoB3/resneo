import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/venue-route-client', () => ({ createVenueRouteClient: vi.fn(async () => ({})) }));
vi.mock('@/lib/venue-auth', () => ({ getVenueStaff: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: vi.fn(() => ({})) }));
vi.mock('@/lib/booking/staff-booking-access', () => ({ resolveLinkedStaffCatalogScope: vi.fn() }));
vi.mock('@/lib/linked-accounts/collective-staff-scope', () => ({ resolveStaffCollectiveScope: vi.fn() }));
vi.mock('@/lib/linked-accounts/collective-booking-bridge', () => ({ loadCollectiveMonthAvailableDates: vi.fn() }));
vi.mock('@/lib/availability/schedule-unavailable-response', () => ({
  withScheduleFailClosed: (fn: () => Promise<Response>) => fn(),
}));

import { getVenueStaff } from '@/lib/venue-auth';
import { resolveLinkedStaffCatalogScope } from '@/lib/booking/staff-booking-access';
import { resolveStaffCollectiveScope } from '@/lib/linked-accounts/collective-staff-scope';
import { loadCollectiveMonthAvailableDates } from '@/lib/linked-accounts/collective-booking-bridge';
import { GET } from './route';

const CALLER = '11111111-1111-4111-8111-111111111111';
const COLLECTIVE = '22222222-2222-4222-8222-222222222222';
const CAL = '44444444-4444-4444-8444-444444444444';
const OFFERING = '55555555-5555-4555-8555-555555555555';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getVenueStaff).mockResolvedValue({ id: 's', venue_id: CALLER, email: 'a@b.c', role: 'admin', db: {} } as never);
});

/** The staff month picker for a collective: the union of provider calendars, with staff rules. */
describe('GET /api/venue/appointment-calendar for a collective', () => {
  it('delegates to the bridge with the staff audience and never treats the id as a venue', async () => {
    vi.mocked(resolveStaffCollectiveScope).mockResolvedValue({ collectiveId: COLLECTIVE, name: 'C', hostVenueId: CALLER, memberVenueIds: [CALLER] });
    vi.mocked(loadCollectiveMonthAvailableDates).mockResolvedValue({
      venue_id: COLLECTIVE,
      practitioner_id: CAL,
      service_id: OFFERING,
      year: 2026,
      month: 9,
      available_dates: ['2026-09-07'],
    });
    const res = await GET(
      new NextRequest(
        `https://resneo.test/api/venue/appointment-calendar?practitioner_id=${CAL}&service_id=${OFFERING}&year=2026&month=9&owner_venue_id=${COLLECTIVE}&duration_minutes=45&addon_ids=a1&addon_ids=a2`,
      ),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ venue_id: COLLECTIVE, available_dates: ['2026-09-07'] });
    expect(vi.mocked(loadCollectiveMonthAvailableDates)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        collectiveId: COLLECTIVE,
        offeringId: OFFERING,
        calendarId: CAL,
        anyAvailable: false,
        year: 2026,
        month: 9,
        durationMinutes: 45,
        addonIds: ['a1', 'a2'],
        audience: 'staff',
      }),
    );
    expect(vi.mocked(resolveLinkedStaffCatalogScope)).not.toHaveBeenCalled();
  });

  it('keeps the single-partner path when the owner is not a collective for the caller', async () => {
    vi.mocked(resolveStaffCollectiveScope).mockResolvedValue(null);
    vi.mocked(resolveLinkedStaffCatalogScope).mockResolvedValue({ ok: false, status: 403, error: 'no link' });
    const res = await GET(
      new NextRequest(`https://resneo.test/api/venue/appointment-calendar?practitioner_id=${CAL}&service_id=${OFFERING}&year=2026&month=9&owner_venue_id=${COLLECTIVE}`),
    );
    expect(res.status).toBe(403);
    expect(vi.mocked(loadCollectiveMonthAvailableDates)).not.toHaveBeenCalled();
  });
});
