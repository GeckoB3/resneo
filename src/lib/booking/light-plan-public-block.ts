import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import {
  isPublicOnlineBookingBlocked,
  type VenueBillingFields,
} from '@/lib/billing/subscription-entitlement';
import { resolveLinkedStaffCatalogScope } from '@/lib/booking/staff-booking-access';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';

export type { VenueBillingFields } from '@/lib/billing/subscription-entitlement';
export { isPublicOnlineBookingBlocked } from '@/lib/billing/subscription-entitlement';

const BLOCKED_MESSAGE = 'Online booking is temporarily unavailable for this venue.';

/**
 * Who is asking, when a public booking route needs to know.
 *
 * The billing guard exists so a venue on a lapsed plan does not keep taking
 * bookings from the public it can no longer serve. A staff member working that
 * venue's diary is not the public, and neither is staff of a partner venue that
 * holds an active link with booking rights over it (the linked calendar's "New
 * booking" button). Both reach these routes through the shared booking flow
 * with a staff session, cookie or Bearer, and were being turned away with the
 * public's message. The admin client is passed in rather than created here so
 * a route's own client (and its fakes in tests) is the one consulted.
 */
export type PublicBookingRequestContext = {
  request: NextRequest;
  admin: SupabaseClient;
};

/**
 * True when the request carries a staff session for `venueId` itself, or for a
 * venue whose link over `venueId` allows booking changes. Any failure to
 * resolve the session reads as "not staff": the guard then applies as it
 * always did, which is the safe direction.
 */
export async function requestIsStaffActingOnVenue(
  ctx: PublicBookingRequestContext,
  venueId: string,
): Promise<boolean> {
  try {
    const authClient = await createVenueRouteClient(ctx.request);
    const staff = await getVenueStaff(authClient);
    if (!staff) return false;
    if (staff.venue_id === venueId) return true;
    const scope = await resolveLinkedStaffCatalogScope(
      ctx.admin as Parameters<typeof resolveLinkedStaffCatalogScope>[0],
      staff.venue_id,
      venueId,
    );
    return scope.ok;
  } catch (err) {
    console.error('[public booking guard] staff resolution failed; guard applies:', err, { venueId });
    return false;
  }
}

/**
 * Whether the public-booking guard blocks THIS request for a venue whose plan
 * fields are already in hand. The billing check runs first: only a blocked
 * venue pays for the session lookup, so the common case costs nothing extra.
 */
export async function publicBookingBlockedForRequest(
  row: VenueBillingFields,
  ctx: PublicBookingRequestContext | null | undefined,
  venueId: string,
): Promise<boolean> {
  if (!isPublicOnlineBookingBlocked(row)) return false;
  if (!ctx) return true;
  return !(await requestIsStaffActingOnVenue(ctx, venueId));
}

/**
 * For venue rows that include plan fields (and period end for accurate cancelled access).
 * Returns a JSON 403 when public online booking must be blocked.
 */
export function nextResponseIfPublicBookingBlockedFromVenueRow(row: VenueBillingFields): NextResponse | null {
  if (isPublicOnlineBookingBlocked(row)) {
    return NextResponse.json({ error: BLOCKED_MESSAGE }, { status: 403 });
  }
  return null;
}

/**
 * As {@link nextResponseIfPublicBookingBlockedFromVenueRow}, but a staff session
 * for the venue (or a linked venue with booking rights over it) is let through.
 */
export async function nextResponseIfPublicBookingBlockedForRequest(
  row: VenueBillingFields,
  ctx: PublicBookingRequestContext,
  venueId: string,
): Promise<NextResponse | null> {
  if (await publicBookingBlockedForRequest(row, ctx, venueId)) {
    return NextResponse.json({ error: BLOCKED_MESSAGE }, { status: 403 });
  }
  return null;
}

/**
 * Load plan fields for `venueId` and return 403 when public booking is blocked
 * (Light + past_due, or subscription ended / cancelled with no remaining paid period).
 * Pass the request so a staff session for the venue, or for a venue linked to
 * it with booking rights, is not treated as the public.
 */
export async function nextResponseIfPublicBookingBlockedForVenue(
  admin: SupabaseClient,
  venueId: string,
  request?: NextRequest,
): Promise<NextResponse | null> {
  const { data: row, error } = await admin
    .from('venues')
    .select('pricing_tier, plan_status, subscription_current_period_end, billing_access_source')
    .eq('id', venueId)
    .maybeSingle();

  if (error) {
    console.error('[public booking guard] venue lookup failed:', error.message, { venueId });
    return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  }
  if (!row) {
    return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  }

  const fields = row as {
    pricing_tier?: string | null;
    plan_status?: string | null;
    subscription_current_period_end?: string | null;
    billing_access_source?: string | null;
  };
  if (request) {
    return nextResponseIfPublicBookingBlockedForRequest(fields, { request, admin }, venueId);
  }
  return nextResponseIfPublicBookingBlockedFromVenueRow(fields);
}
