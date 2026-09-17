/**
 * Contract 16: GET /api/venue/guests?scope=collective searches the live collective, and is refused
 * outside one (D41).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/venue-route-client', () => ({ createVenueRouteClient: vi.fn(async () => ({})) }));
vi.mock('@/lib/venue-auth', () => ({
  getVenueStaff: vi.fn(async () => ({ db: {}, venue_id: 'me', role: 'staff' })),
}));
vi.mock('@/lib/linked-accounts/collective-contact-search', () => ({ searchCollectiveContacts: vi.fn() }));

import { searchCollectiveContacts } from '@/lib/linked-accounts/collective-contact-search';
import { GET } from './route';

const get = (query: string) => GET(new NextRequest(`http://test/api/venue/guests?${query}`));

beforeEach(() => {
  vi.mocked(searchCollectiveContacts).mockReset();
});

describe('GET /api/venue/guests?scope=collective', () => {
  it('returns rows with their owners', async () => {
    vi.mocked(searchCollectiveContacts).mockResolvedValue({
      ok: true,
      guests: [{ id: 'g-1', owner_venue_id: 'bloom', owner_venue_name: 'Bloom', owner_is_self: false } as never],
    });
    const response = await get('scope=collective&search=ada&limit=10');
    expect(response.status).toBe(200);
    expect((await response.json()).guests).toEqual([
      { id: 'g-1', owner_venue_id: 'bloom', owner_venue_name: 'Bloom', owner_is_self: false },
    ]);
    expect(vi.mocked(searchCollectiveContacts)).toHaveBeenCalledWith({}, 'me', 'ada', 10);
  });

  it('is refused outside a live collective', async () => {
    vi.mocked(searchCollectiveContacts).mockResolvedValue({ ok: false });
    expect((await get('scope=collective&search=ada')).status).toBe(403);
  });
});
