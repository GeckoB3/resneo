/**
 * PUB-02 and SB-19: an email's Book again follows the same derived rule as the page, so it opens
 * the collective page only while the venue's own page hands over to it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ handover: null as null | Record<string, unknown>, legacyCalls: 0 }));
vi.mock('@/lib/linked-accounts/replicas/page-handover', () => ({
  resolveOwnPageHandover: async () => state.handover,
}));
vi.mock('@/lib/linked-accounts/collectives', () => ({
  loadCollectiveBookingLinksForVenue: async () => {
    state.legacyCalls += 1;
    return [{ id: 'c1', name: 'Old', url: '/book/c/old' }];
  },
}));

import { resolveVenueBookingPageUrl } from './venue-booking-page-link';

const admin = {} as never;

beforeEach(() => {
  state.handover = null;
  state.legacyCalls = 0;
});

describe('resolveVenueBookingPageUrl on a shared-services collective', () => {
  it('opens the collective page, on its service list, while the own page hands over', async () => {
    state.handover = { redirect: true, publicPath: '/book/c/northside' };
    expect(await resolveVenueBookingPageUrl(admin, { id: 'member', slug: 'zen' })).toMatch(/\/book\/c\/northside$/);
    expect(state.legacyCalls).toBe(0);
  });

  it('opens the own page while the rule keeps it showing', async () => {
    state.handover = { redirect: false, reason: 'settingUp', publicPath: '/book/c/northside' };
    expect(await resolveVenueBookingPageUrl(admin, { id: 'member', slug: 'zen' })).toMatch(/\/book\/zen$/);
    expect(state.legacyCalls).toBe(0);
  });

  it('keeps the older lookup for a collective that has not moved over', async () => {
    expect(await resolveVenueBookingPageUrl(admin, { id: 'member', slug: 'zen' })).toMatch(/\/book\/c\/old$/);
    expect(state.legacyCalls).toBe(1);
  });
});
