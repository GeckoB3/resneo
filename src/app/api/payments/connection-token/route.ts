import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { stripe } from '@/lib/stripe';
import { ensureTerminalLocation } from '@/lib/stripe/terminal-location';
import { resolveLinkedStaffCatalogScope } from '@/lib/booking/staff-booking-access';

const schema = z.object({ owner_venue_id: z.string().uuid().optional() });

/**
 * POST /api/payments/connection-token — mint a Stripe Terminal connection token
 * on the active venue's connected account (§6.2). The mobile Terminal SDK's
 * tokenProvider calls this; the returned `location_id` is what readers connect
 * through. Gated on the per-venue `in_person_payments_enabled` flag.
 */
export async function POST(request: NextRequest) {
  const supabase = await createVenueRouteClient(request);
  const staff = await getVenueStaff(supabase);
  if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  const ownerVenueId = parsed.success ? parsed.data.owner_venue_id : undefined;

  // Resolve the active venue. Own venue = staff.venue_id. For a linked
  // (chair-rental) venue, the catalog-scope helper requires full-details +
  // mutation rights — appropriate for taking a payment on its bookings.
  let venueId = staff.venue_id;
  if (ownerVenueId && ownerVenueId !== staff.venue_id) {
    const scope = await resolveLinkedStaffCatalogScope(staff.db, staff.venue_id, ownerVenueId);
    if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status });
    venueId = scope.venueId;
  }

  const { data: venueData, error: venueErr } = await staff.db
    .from('venues')
    .select('in_person_payments_enabled, stripe_connected_account_id')
    .eq('id', venueId)
    .maybeSingle();
  if (venueErr) {
    console.error('[connection-token] venue load failed:', venueErr.message, { venueId });
    return NextResponse.json({ error: 'Failed to load venue' }, { status: 500 });
  }
  const venue = venueData as
    | { in_person_payments_enabled: boolean | null; stripe_connected_account_id: string | null }
    | null;

  if (!venue?.in_person_payments_enabled) {
    return NextResponse.json(
      { error: 'In-person payments are not enabled for this venue.' },
      { status: 403 },
    );
  }
  if (!venue.stripe_connected_account_id) {
    return NextResponse.json(
      { error: "This venue isn't set up for in-person payments yet." },
      { status: 400 },
    );
  }

  /**
   * Provisioning the Location and minting the token fail for completely
   * different reasons, so they get their own branches. A single catch reported
   * both as "not enabled for card payments", which sent staff (and us) hunting a
   * Stripe capability problem when the real cause was a venue address missing
   * its city — the failure took an afternoon to find precisely because the
   * message pointed the wrong way.
   */
  let locationId: string;
  try {
    locationId = await ensureTerminalLocation(
      staff.db,
      venueId,
      venue.stripe_connected_account_id,
    );
  } catch (err) {
    // Nearly always the venue address: Stripe requires city (and country) for a
    // GB Location, and `venues.address` is free text that may not contain one.
    console.error('[connection-token] location provisioning failed:', err, { venueId });
    return NextResponse.json(
      { error: 'Could not set this venue up for card readers. Check the venue address in Settings.' },
      { status: 400 },
    );
  }

  try {
    const token = await stripe.terminal.connectionTokens.create(
      {},
      { stripeAccount: venue.stripe_connected_account_id },
    );
    return NextResponse.json({ secret: token.secret, location_id: locationId });
  } catch (err) {
    // The #1 runtime failure mode here: the connected account lacks the
    // card-present capability, or Terminal is otherwise not enabled on it.
    console.error('[connection-token] token mint failed:', err, { venueId });
    return NextResponse.json(
      { error: "This venue isn't enabled for in-person card payments yet." },
      { status: 400 },
    );
  }
}
