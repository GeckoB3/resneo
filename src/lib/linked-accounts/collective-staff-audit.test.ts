import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/venue-route-client', () => ({
  createVenueRouteClient: vi.fn(async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) } })),
}));
vi.mock('@/lib/venue-auth', () => ({ getVenueStaff: vi.fn() }));
vi.mock('./queries', () => ({ resolveCallerGrantOverVenue: vi.fn() }));
vi.mock('./audit', () => ({ recordBookingWriteAudit: vi.fn(async () => {}) }));
vi.mock('./notifications', () => ({ notifyCrossVenueBookingWrite: vi.fn(async () => {}) }));

import { getVenueStaff } from '@/lib/venue-auth';
import { resolveCallerGrantOverVenue } from './queries';
import { recordBookingWriteAudit } from './audit';
import { notifyCrossVenueBookingWrite } from './notifications';
import { recordStaffCollectiveCrossVenueCreate } from './collective-staff-audit';

const ACTOR = 'venue-actor';
const OWNER = 'venue-owner';
const admin = {} as never;
const request = new NextRequest('https://resneo.test/api/booking/create-multi-service');

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * The visit and group creates are public routes the staff form also uses. When a
 * member's staff book for the collective onto a partner's calendar, the partner
 * gets the same audit entry and notification a single linked create leaves.
 */
describe('recordStaffCollectiveCrossVenueCreate', () => {
  it('records one audit entry per booking and one notification for a staff actor from another venue', async () => {
    vi.mocked(getVenueStaff).mockResolvedValue({ id: 's', venue_id: ACTOR, email: 'a@b.c', role: 'staff', db: {} } as never);
    vi.mocked(resolveCallerGrantOverVenue).mockResolvedValue({ linkId: 'link-1', grant: { calendar: 'full_details', pii: true, act: 'create_edit_cancel' } } as never);
    await recordStaffCollectiveCrossVenueCreate({ admin, request, owningVenueId: OWNER, bookingIds: ['b1', 'b2'] });
    expect(vi.mocked(recordBookingWriteAudit)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(recordBookingWriteAudit)).toHaveBeenCalledWith(
      expect.objectContaining({ linkId: 'link-1', actingVenueId: ACTOR, actingUserId: 'user-1', owningVenueId: OWNER, actionType: 'created_booking', bookingId: 'b1' }),
    );
    expect(vi.mocked(notifyCrossVenueBookingWrite)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notifyCrossVenueBookingWrite)).toHaveBeenCalledWith(
      expect.objectContaining({ owningVenueId: OWNER, actingVenueId: ACTOR, actionType: 'created_booking' }),
    );
  });

  it('does nothing for the public, for the owner venue itself, or without a usable link', async () => {
    vi.mocked(getVenueStaff).mockResolvedValue(null as never);
    await recordStaffCollectiveCrossVenueCreate({ admin, request, owningVenueId: OWNER, bookingIds: ['b1'] });

    vi.mocked(getVenueStaff).mockResolvedValue({ id: 's', venue_id: OWNER, email: 'a@b.c', role: 'staff', db: {} } as never);
    await recordStaffCollectiveCrossVenueCreate({ admin, request, owningVenueId: OWNER, bookingIds: ['b1'] });

    vi.mocked(getVenueStaff).mockResolvedValue({ id: 's', venue_id: ACTOR, email: 'a@b.c', role: 'staff', db: {} } as never);
    vi.mocked(resolveCallerGrantOverVenue).mockResolvedValue(null);
    await recordStaffCollectiveCrossVenueCreate({ admin, request, owningVenueId: OWNER, bookingIds: ['b1'] });

    expect(vi.mocked(recordBookingWriteAudit)).not.toHaveBeenCalled();
    expect(vi.mocked(notifyCrossVenueBookingWrite)).not.toHaveBeenCalled();
  });
});
