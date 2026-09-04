import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '@/lib/supabase';
import type { VenueStaff } from '@/lib/venue-auth';
import { resolveCallerGrantOverVenue } from '@/lib/linked-accounts/queries';
import { recordReadAudit } from '@/lib/linked-accounts/audit';

/**
 * Which venue's compliance data a read is scoped to, and the client to read it with.
 *
 * A booking on a linked venue's column opens in the same detail panel as an own
 * booking, and its Compliance tab asked the compliance routes for a booking and a
 * guest that belong to the OTHER venue. Both routes filtered on the caller's own
 * `venue_id`, answered 404, and the tab showed "Couldn't load compliance details",
 * while the same contact's own-venue booking loaded fine. Records are the other
 * venue's, so the read is allowed only through the link, and only when the link
 * shares full details AND personal data: a compliance record is medical history
 * and consent, the most sensitive thing a guest row carries. A permitted read is
 * audited as `viewed_booking` like any other cross-venue detail view.
 */
export type ComplianceReadScope =
  | { ok: true; venueId: string; db: SupabaseClient; linked: boolean }
  | { ok: false; response: NextResponse };

export async function resolveComplianceReadScope(params: {
  staff: VenueStaff;
  /** The venue the record belongs to; null or the caller's own id means the caller's own data. */
  ownerVenueId: string | null;
  actingUserId: string | null;
  resourceType: 'booking' | 'guest';
  resourceId: string;
}): Promise<ComplianceReadScope> {
  const { staff, ownerVenueId, actingUserId, resourceType, resourceId } = params;
  if (!ownerVenueId || ownerVenueId === staff.venue_id) {
    return { ok: true, venueId: staff.venue_id, db: staff.db, linked: false };
  }

  const admin = getSupabaseAdminClient();
  const access = await resolveCallerGrantOverVenue(admin, staff.venue_id, ownerVenueId);
  if (!access || access.grant.calendar !== 'full_details' || !access.grant.pii) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'This link does not share compliance records for that venue.', code: 'linked_no_pii' },
        { status: 403 },
      ),
    };
  }

  await recordReadAudit({
    admin,
    linkId: access.linkId,
    actingVenueId: staff.venue_id,
    actingUserId,
    owningVenueId: ownerVenueId,
    actionType: 'viewed_booking',
    resourceType: `compliance_${resourceType}`,
    resourceId,
  });

  return { ok: true, venueId: ownerVenueId, db: admin, linked: true };
}
