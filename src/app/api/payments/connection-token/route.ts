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

  try {
    const locationId = await ensureTerminalLocation(
      staff.db,
      venueId,
      venue.stripe_connected_account_id,
    );
    const token = await stripe.terminal.connectionTokens.create(
      {},
      { stripeAccount: venue.stripe_connected_account_id },
    );
    return NextResponse.json({ secret: token.secret, location_id: locationId });
  } catch (err) {
    // The #1 runtime failure mode: the connected account lacks the
    // card-present capability (or Terminal is otherwise not enabled on it).
    console.error('[connection-token] token mint failed:', err, { venueId });
    return NextResponse.json(
      { error: "This venue isn't enabled for in-person card payments yet." },
      { status: 400 },
    );
  }
}
