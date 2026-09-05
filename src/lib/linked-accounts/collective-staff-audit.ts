import type { SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { resolveCallerGrantOverVenue } from './queries';
import { recordBookingWriteAudit } from './audit';
import { notifyCrossVenueBookingWrite } from './notifications';

/**
 * After the PUBLIC visit and group create routes have written bookings for a
 * collective: if the request came from a member venue's staff and the bookings
 * landed in ANOTHER member's venue, record the cross-venue write and tell the
 * owner, as `POST /api/venue/bookings` does for a linked single booking. The
 * public routes are used by the staff form for visits and groups, so without
 * this a receptionist's booking onto a partner's calendar left no audit entry.
 *
 * Best effort and never blocks the response: the bookings are already written.
 */
export async function recordStaffCollectiveCrossVenueCreate(params: {
  admin: SupabaseClient;
  request: NextRequest;
  owningVenueId: string;
  bookingIds: string[];
}): Promise<void> {
  const { admin, request, owningVenueId, bookingIds } = params;
  if (bookingIds.length === 0) return;
  try {
    const authClient = await createVenueRouteClient(request);
    const staff = await getVenueStaff(authClient);
    if (!staff || staff.venue_id === owningVenueId) return;
    const access = await resolveCallerGrantOverVenue(admin, staff.venue_id, owningVenueId);
    if (!access) return;
    const {
      data: { user },
    } = await authClient.auth.getUser();
    for (const bookingId of bookingIds) {
      await recordBookingWriteAudit({
        admin,
        linkId: access.linkId,
        actingVenueId: staff.venue_id,
        actingUserId: user?.id ?? null,
        owningVenueId,
        actionType: 'created_booking',
        bookingId,
        afterState: { id: bookingId, venue_id: owningVenueId },
      });
    }
    await notifyCrossVenueBookingWrite({
      admin,
      owningVenueId,
      actingVenueId: staff.venue_id,
      actionType: 'created_booking',
      before: null,
      after: { id: bookingIds[0], venue_id: owningVenueId },
    });
  } catch (err) {
    console.error('[collective-staff-audit] cross-venue create audit failed:', err);
  }
}
