import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ links: [] as { id: string; name: string; url: string }[], fail: false }));
vi.mock('@/lib/linked-accounts/collectives', () => ({
  loadCollectiveBookingLinksForVenue: async () => {
    if (state.fail) throw new Error('boom');
    return state.links;
  },
}));

import { resolveVenueBookingPageUrl } from './venue-booking-page-link';

const admin = {} as never;

describe('resolveVenueBookingPageUrl', () => {
  beforeEach(() => {
    state.links = [];
    state.fail = false;
  });

  it('sends a collective member to the combined page', async () => {
    state.links = [{ id: 'c1', name: 'Plus 1 Staging', url: '/book/c/plus-1' }];
    const url = await resolveVenueBookingPageUrl(admin, { id: 'v1', slug: 'plus-1-solo' });
    expect(url).toMatch(/^https?:\/\/[^/]+\/book\/c\/plus-1$/);
  });

  it('uses the adopted member address when the collective adopted one', async () => {
    state.links = [{ id: 'c1', name: 'Group', url: '/book/host-venue' }];
    expect(await resolveVenueBookingPageUrl(admin, { id: 'v1', slug: 'member' })).toMatch(/\/book\/host-venue$/);
  });

  it('falls back to the venue page when it is in no live collective', async () => {
    expect(await resolveVenueBookingPageUrl(admin, { id: 'v1', slug: 'solo' })).toMatch(/\/book\/solo$/);
  });

  it('falls back to the venue page when the collective lookup throws', async () => {
    state.fail = true;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await resolveVenueBookingPageUrl(admin, { id: 'v1', slug: 'solo' })).toMatch(/\/book\/solo$/);
    spy.mockRestore();
  });

  it('returns null with no collective and no slug', async () => {
    expect(await resolveVenueBookingPageUrl(admin, { id: 'v1', slug: null })).toBeNull();
  });
});
