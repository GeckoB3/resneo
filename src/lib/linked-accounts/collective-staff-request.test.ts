import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/venue-route-client', () => ({ createVenueRouteClient: vi.fn(async () => ({})) }));
vi.mock('@/lib/venue-auth', () => ({ getVenueStaff: vi.fn() }));
vi.mock('./collective-staff-scope', () => ({ resolveStaffCollectiveScope: vi.fn() }));

import { getVenueStaff } from '@/lib/venue-auth';
import { resolveStaffCollectiveScope } from './collective-staff-scope';
import { resolveStaffCollectiveScopeFromRequest } from './collective-staff-request';

const admin = {} as never;
const request = new NextRequest('https://resneo.test/api/booking/availability?venue_id=col-1&staff=1');
const scope = { collectiveId: 'col-1', name: 'Plus', hostVenueId: 'venue-a', memberVenueIds: ['venue-a', 'venue-b'] };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveStaffCollectiveScopeFromRequest', () => {
  it("answers with the collective for a member venue's staff session", async () => {
    vi.mocked(getVenueStaff).mockResolvedValue({ venue_id: 'venue-b' } as never);
    vi.mocked(resolveStaffCollectiveScope).mockResolvedValue(scope);
    expect(await resolveStaffCollectiveScopeFromRequest(admin, request, 'col-1')).toEqual(scope);
    expect(vi.mocked(resolveStaffCollectiveScope)).toHaveBeenCalledWith(admin, 'venue-b', 'col-1');
  });

  it('answers null for the public, for a non-member, and when the session lookup throws', async () => {
    vi.mocked(getVenueStaff).mockResolvedValue(null as never);
    expect(await resolveStaffCollectiveScopeFromRequest(admin, request, 'col-1')).toBeNull();
    expect(vi.mocked(resolveStaffCollectiveScope)).not.toHaveBeenCalled();

    vi.mocked(getVenueStaff).mockResolvedValue({ venue_id: 'venue-z' } as never);
    vi.mocked(resolveStaffCollectiveScope).mockResolvedValue(null);
    expect(await resolveStaffCollectiveScopeFromRequest(admin, request, 'col-1')).toBeNull();

    vi.mocked(getVenueStaff).mockRejectedValue(new Error('auth down'));
    expect(await resolveStaffCollectiveScopeFromRequest(admin, request, 'col-1')).toBeNull();
  });
});
