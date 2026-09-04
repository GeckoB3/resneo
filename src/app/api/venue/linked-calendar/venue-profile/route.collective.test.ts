import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({
  createRouteHandlerClientFromHeaders: vi.fn(async () => ({})),
}));
vi.mock('@/lib/venue-auth', () => ({ getVenueStaff: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: vi.fn(() => ({})) }));
vi.mock('@/lib/linked-accounts/queries', () => ({ resolveCallerGrantOverVenue: vi.fn() }));
vi.mock('@/lib/linked-accounts/collective-staff-scope', () => ({ resolveStaffCollectiveScope: vi.fn() }));
vi.mock('@/lib/linked-accounts/collective-venue', () => ({ loadCollectiveVenuePublic: vi.fn() }));
vi.mock('@/lib/venue-mode', () => ({ resolveVenueMode: vi.fn() }));
vi.mock('@/lib/booking/map-api-venue-to-public', () => ({ mapApiVenueToVenuePublic: vi.fn((r: unknown) => r) }));

import { getVenueStaff } from '@/lib/venue-auth';
import { resolveCallerGrantOverVenue } from '@/lib/linked-accounts/queries';
import { resolveStaffCollectiveScope } from '@/lib/linked-accounts/collective-staff-scope';
import { loadCollectiveVenuePublic } from '@/lib/linked-accounts/collective-venue';
import { GET } from './route';

const CALLER = '11111111-1111-4111-8111-111111111111';
const COLLECTIVE = '22222222-2222-4222-8222-222222222222';
const PARTNER = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getVenueStaff).mockResolvedValue({ id: 's', venue_id: CALLER, email: 'a@b.c', role: 'admin', db: {} } as never);
});

async function call(venueId: string) {
  const res = await GET(new NextRequest(`https://resneo.test/api/venue/linked-calendar/venue-profile?venueId=${venueId}`));
  return { status: res.status, body: await res.json() };
}

/**
 * The staff form books for a live collective through this profile, the same
 * virtual venue the combined public page renders, so its calendars, offerings
 * and prices are the collective's. A partner outside any collective still
 * answers as one linked venue.
 */
describe('GET venue-profile for a collective', () => {
  it('answers with the collective virtual venue for an active member', async () => {
    vi.mocked(resolveStaffCollectiveScope).mockResolvedValue({
      collectiveId: COLLECTIVE,
      name: 'Plus Light',
      hostVenueId: CALLER,
      memberVenueIds: [CALLER, PARTNER],
    });
    vi.mocked(loadCollectiveVenuePublic).mockResolvedValue({ id: COLLECTIVE, name: 'Plus Light', currency: 'GBP', is_collective: true } as never);
    const { status, body } = await call(COLLECTIVE);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      venue_name: 'Plus Light',
      venue: { id: COLLECTIVE, is_collective: true },
      booking_model: 'unified_scheduling',
      enabled_models: [],
      collective: { id: COLLECTIVE, member_venue_ids: [CALLER, PARTNER] },
    });
    // Membership implies full mutual write links; no per-link grant is consulted.
    expect(vi.mocked(resolveCallerGrantOverVenue)).not.toHaveBeenCalled();
  });

  it('falls through to the single-venue link path when the id is not a live collective for the caller', async () => {
    vi.mocked(resolveStaffCollectiveScope).mockResolvedValue(null);
    vi.mocked(resolveCallerGrantOverVenue).mockResolvedValue(null);
    const { status } = await call(PARTNER);
    expect(status).toBe(403);
    expect(vi.mocked(resolveCallerGrantOverVenue)).toHaveBeenCalledWith(expect.anything(), CALLER, PARTNER);
  });
});
