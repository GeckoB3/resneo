import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/venue-route-client', () => ({
  createVenueRouteClient: vi.fn(async () => ({})),
}));
vi.mock('@/lib/venue-auth', () => ({
  getVenueStaff: vi.fn(),
}));
vi.mock('@/lib/booking/staff-booking-access', () => ({
  resolveLinkedStaffCatalogScope: vi.fn(),
}));

import { getVenueStaff } from '@/lib/venue-auth';
import { resolveLinkedStaffCatalogScope } from '@/lib/booking/staff-booking-access';
import {
  nextResponseIfPublicBookingBlockedForVenue,
  publicBookingBlockedForRequest,
  requestIsStaffActingOnVenue,
} from './light-plan-public-block';

const mockStaff = vi.mocked(getVenueStaff);
const mockScope = vi.mocked(resolveLinkedStaffCatalogScope);

const VENUE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PARTNER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const request = {} as NextRequest;
const admin = {} as never;

/** A Light-plan venue whose subscription is past due: the public is turned away. */
const BLOCKED = { pricing_tier: 'light', plan_status: 'past_due' };
/** A venue in good standing. */
const OPEN = { pricing_tier: 'light', plan_status: 'active' };

beforeEach(() => {
  mockStaff.mockReset();
  mockScope.mockReset();
});

/**
 * The guard protects a venue on a lapsed plan from taking online bookings it
 * cannot serve. Staff working that venue's diary, and staff of a partner venue
 * with booking rights over it (the linked calendar's "New booking"), are not the
 * public and were being turned away with the public's message.
 */
describe('requestIsStaffActingOnVenue', () => {
  it('is false with no staff session', async () => {
    mockStaff.mockResolvedValue(null as never);
    expect(await requestIsStaffActingOnVenue({ request, admin }, VENUE)).toBe(false);
    expect(mockScope).not.toHaveBeenCalled();
  });

  it("is true for the venue's own staff", async () => {
    mockStaff.mockResolvedValue({ venue_id: VENUE } as never);
    expect(await requestIsStaffActingOnVenue({ request, admin }, VENUE)).toBe(true);
    expect(mockScope).not.toHaveBeenCalled();
  });

  it('is true for a partner whose link allows booking changes, false otherwise', async () => {
    mockStaff.mockResolvedValue({ venue_id: PARTNER } as never);
    mockScope.mockResolvedValueOnce({ ok: true, venueId: VENUE });
    expect(await requestIsStaffActingOnVenue({ request, admin }, VENUE)).toBe(true);
    expect(mockScope).toHaveBeenCalledWith(admin, PARTNER, VENUE);

    mockScope.mockResolvedValueOnce({ ok: false, status: 403, error: 'no link' });
    expect(await requestIsStaffActingOnVenue({ request, admin }, VENUE)).toBe(false);
  });

  it('applies the guard when the session cannot be resolved', async () => {
    mockStaff.mockRejectedValue(new Error('auth down'));
    expect(await requestIsStaffActingOnVenue({ request, admin }, VENUE)).toBe(false);
  });
});

describe('publicBookingBlockedForRequest', () => {
  it('never consults the session for a venue in good standing', async () => {
    expect(await publicBookingBlockedForRequest(OPEN, { request, admin }, VENUE)).toBe(false);
    expect(mockStaff).not.toHaveBeenCalled();
  });

  it('blocks the public and lets staff through for a blocked venue', async () => {
    expect(await publicBookingBlockedForRequest(BLOCKED, null, VENUE)).toBe(true);
    mockStaff.mockResolvedValue(null as never);
    expect(await publicBookingBlockedForRequest(BLOCKED, { request, admin }, VENUE)).toBe(true);
    mockStaff.mockResolvedValue({ venue_id: VENUE } as never);
    expect(await publicBookingBlockedForRequest(BLOCKED, { request, admin }, VENUE)).toBe(false);
  });
});

describe('nextResponseIfPublicBookingBlockedForVenue', () => {
  function adminReturning(row: unknown) {
    return {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }),
        }),
      }),
    } as never;
  }

  it('still answers 403 to the public for a blocked venue', async () => {
    const res = await nextResponseIfPublicBookingBlockedForVenue(adminReturning(BLOCKED), VENUE, request);
    expect(res?.status).toBe(403);
    expect(await res?.json()).toEqual({ error: 'Online booking is temporarily unavailable for this venue.' });
  });

  it("lets the venue's staff and a linked partner with booking rights through", async () => {
    mockStaff.mockResolvedValue({ venue_id: PARTNER } as never);
    mockScope.mockResolvedValue({ ok: true, venueId: VENUE });
    expect(await nextResponseIfPublicBookingBlockedForVenue(adminReturning(BLOCKED), VENUE, request)).toBeNull();
  });

  it('keeps the old behaviour for callers that pass no request', async () => {
    mockStaff.mockResolvedValue({ venue_id: VENUE } as never);
    const res = await nextResponseIfPublicBookingBlockedForVenue(adminReturning(BLOCKED), VENUE);
    expect(res?.status).toBe(403);
    expect(mockStaff).not.toHaveBeenCalled();
  });
});
