import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/venue-route-client', () => ({ createVenueRouteClient: vi.fn(async () => ({})) }));
vi.mock('@/lib/venue-auth', () => ({ getVenueStaff: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: vi.fn(() => ({})) }));
vi.mock('@/lib/booking/staff-booking-access', () => ({ resolveLinkedStaffCatalogScope: vi.fn() }));
vi.mock('@/lib/linked-accounts/collective-staff-scope', () => ({ resolveStaffCollectiveScope: vi.fn() }));
vi.mock('@/lib/linked-accounts/collective-booking-bridge', () => ({ loadCollectiveDayAvailability: vi.fn() }));
vi.mock('@/lib/availability/schedule-unavailable-response', () => ({
  withScheduleFailClosed: (fn: () => Promise<Response>) => fn(),
}));

import { getVenueStaff } from '@/lib/venue-auth';
import { resolveLinkedStaffCatalogScope } from '@/lib/booking/staff-booking-access';
import { resolveStaffCollectiveScope } from '@/lib/linked-accounts/collective-staff-scope';
import { loadCollectiveDayAvailability } from '@/lib/linked-accounts/collective-booking-bridge';
import { ANY_AVAILABLE_PRACTITIONER_ID } from '@/lib/availability/appointment-any-practitioner';
import { GET } from './route';

const CALLER = '11111111-1111-4111-8111-111111111111';
const COLLECTIVE = '22222222-2222-4222-8222-222222222222';
const CAL = '44444444-4444-4444-8444-444444444444';
const OFFERING = '55555555-5555-4555-8555-555555555555';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getVenueStaff).mockResolvedValue({ id: 's', venue_id: CALLER, email: 'a@b.c', role: 'admin', db: {} } as never);
});

/** The staff day picker (and the app's time picker) for a collective goes through the bridge. */
describe('GET /api/venue/appointment-availability for a collective', () => {
  it('delegates to the bridge with the staff audience, one calendar or the any-available pool', async () => {
    vi.mocked(resolveStaffCollectiveScope).mockResolvedValue({ collectiveId: COLLECTIVE, name: 'C', hostVenueId: CALLER, memberVenueIds: [CALLER] });
    vi.mocked(loadCollectiveDayAvailability).mockResolvedValue({ date: '2026-09-07', venue_id: COLLECTIVE, practitioners: [] });

    const one = await GET(new NextRequest(`https://resneo.test/api/venue/appointment-availability?date=2026-09-07&practitioner_id=${CAL}&service_id=${OFFERING}&owner_venue_id=${COLLECTIVE}`));
    expect(one.status).toBe(200);
    expect(vi.mocked(loadCollectiveDayAvailability)).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ collectiveId: COLLECTIVE, offeringId: OFFERING, calendarId: CAL, anyAvailable: false, date: '2026-09-07', audience: 'staff' }),
    );

    const pooled = await GET(new NextRequest(`https://resneo.test/api/venue/appointment-availability?date=2026-09-07&practitioner_id=${ANY_AVAILABLE_PRACTITIONER_ID}&service_id=${OFFERING}&owner_venue_id=${COLLECTIVE}`));
    expect(pooled.status).toBe(200);
    expect(vi.mocked(loadCollectiveDayAvailability)).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ calendarId: null, anyAvailable: true }),
    );
    expect(vi.mocked(resolveLinkedStaffCatalogScope)).not.toHaveBeenCalled();
  });
});
