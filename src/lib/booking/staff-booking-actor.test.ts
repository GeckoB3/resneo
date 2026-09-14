import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/venue-route-client', () => ({ createVenueRouteClient: vi.fn() }));
vi.mock('@/lib/venue-auth', () => ({ getVenueStaff: vi.fn() }));
vi.mock('@/lib/linked-accounts/collective-staff-scope', () => ({ resolveStaffCollectiveScope: vi.fn() }));
vi.mock('@/lib/booking/staff-booking-access', () => ({ resolveLinkedStaffCreateScope: vi.fn() }));
vi.mock('@/lib/linked-accounts/collective-booking-bridge', () => ({ resolveCombinedBookingTarget: vi.fn() }));
vi.mock('@/lib/linked-accounts/collective-venue', () => ({ loadCollectiveAppointmentCatalog: vi.fn() }));

import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { resolveStaffCollectiveScope } from '@/lib/linked-accounts/collective-staff-scope';
import { resolveLinkedStaffCreateScope } from '@/lib/booking/staff-booking-access';
import {
  resolveStaffBookingActor,
  STAFF_SOURCE_FORBIDDEN_ERROR,
  STAFF_SOURCE_SIGNED_OUT_ERROR,
} from './staff-availability-override';

/** CB-23 / CB-26: who may post a phone or walk-in visit or group, and who gets stamped. */
const admin = {} as never;
const request = {} as NextRequest;
const staff = { id: 'staff-1', venue_id: 'venue-a' };

describe('resolveStaffBookingActor', () => {
  beforeEach(() => {
    vi.mocked(createVenueRouteClient).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    } as never);
    vi.mocked(getVenueStaff).mockResolvedValue(staff as never);
    vi.mocked(resolveStaffCollectiveScope).mockResolvedValue(null as never);
    vi.mocked(resolveLinkedStaffCreateScope).mockResolvedValue({ ok: false } as never);
  });

  it('refuses a request with no staff session', async () => {
    vi.mocked(getVenueStaff).mockResolvedValue(null as never);
    await expect(resolveStaffBookingActor(admin, request, { venueId: 'venue-a' })).resolves.toEqual({
      ok: false,
      status: 401,
      error: STAFF_SOURCE_SIGNED_OUT_ERROR,
    });
  });

  it('accepts staff booking at their own venue', async () => {
    await expect(resolveStaffBookingActor(admin, request, { venueId: 'venue-a' })).resolves.toMatchObject({
      ok: true,
      via: 'own',
      staff: { id: 'staff-1' },
    });
  });

  it('accepts staff of a member booking at another member through the collective', async () => {
    vi.mocked(resolveStaffCollectiveScope).mockResolvedValue({ memberVenueIds: ['venue-a', 'venue-b'] } as never);
    await expect(
      resolveStaffBookingActor(admin, request, { venueId: 'venue-b', collectiveId: 'col-1' }),
    ).resolves.toMatchObject({ ok: true, via: 'collective' });
  });

  it('accepts staff holding create access through an account link', async () => {
    vi.mocked(resolveLinkedStaffCreateScope).mockResolvedValue({ ok: true } as never);
    await expect(resolveStaffBookingActor(admin, request, { venueId: 'venue-b' })).resolves.toMatchObject({
      ok: true,
      via: 'linked',
    });
    expect(resolveLinkedStaffCreateScope).toHaveBeenCalledWith(admin, 'venue-a', 'venue-b', 'user-1');
  });

  it("refuses staff of an unrelated venue", async () => {
    await expect(resolveStaffBookingActor(admin, request, { venueId: 'venue-z' })).resolves.toEqual({
      ok: false,
      status: 403,
      error: STAFF_SOURCE_FORBIDDEN_ERROR,
    });
  });
});
