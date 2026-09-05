import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/venue-route-client', () => ({ createVenueRouteClient: vi.fn(async () => ({})) }));
vi.mock('@/lib/venue-auth', () => ({ getVenueStaff: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: vi.fn(() => ({})) }));
vi.mock('@/lib/linked-accounts/collective-staff-scope', () => ({ loadStaffCollectiveSummary: vi.fn() }));

import { getVenueStaff } from '@/lib/venue-auth';
import { loadStaffCollectiveSummary } from '@/lib/linked-accounts/collective-staff-scope';
import { GET } from './route';

const CALLER = '11111111-1111-4111-8111-111111111111';
const COLLECTIVE = '22222222-2222-4222-8222-222222222222';
const PARTNER = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getVenueStaff).mockResolvedValue({ id: 's', venue_id: CALLER, email: 'a@b.c', role: 'admin', db: {} } as never);
});

/** What the diary needs to route a New booking: the collective, its members and its calendars. */
describe('GET /api/venue/staff-collective', () => {
  it('describes the live collective with its member venues and calendars', async () => {
    vi.mocked(loadStaffCollectiveSummary).mockResolvedValue({
      id: COLLECTIVE,
      name: 'Plus Light',
      hostVenueId: CALLER,
      memberVenueIds: [CALLER, PARTNER],
      calendarIds: ['cal-a', 'cal-b'],
    });
    const res = await GET(new NextRequest('https://resneo.test/api/venue/staff-collective'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      collective: { id: COLLECTIVE, name: 'Plus Light', host_venue_id: CALLER, member_venue_ids: [CALLER, PARTNER], calendar_ids: ['cal-a', 'cal-b'] },
    });
    expect(vi.mocked(loadStaffCollectiveSummary)).toHaveBeenCalledWith(expect.anything(), CALLER);
  });

  it('answers null for a venue with links but no live collective', async () => {
    vi.mocked(loadStaffCollectiveSummary).mockResolvedValue(null);
    const res = await GET(new NextRequest('https://resneo.test/api/venue/staff-collective'));
    expect(await res.json()).toEqual({ collective: null });
  });
});
