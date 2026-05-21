import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { resolveCallerGrantOverVenue } from '@/lib/linked-accounts/queries';
import { resolveVenueMode } from '@/lib/venue-mode';
import { mapApiVenueToVenuePublic } from '@/lib/booking/map-api-venue-to-public';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * GET /api/venue/linked-calendar/venue-profile?venueId=
 * Staff booking surfaces for a linked venue (full modal parity with own venue).
 * Requires `create_edit_cancel` on the link.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const staff = await getVenueStaff(supabase);
  if (!staff) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const venueId = request.nextUrl.searchParams.get('venueId') ?? '';
  if (!UUID_RE.test(venueId)) {
    return NextResponse.json({ error: 'A valid venueId is required.' }, { status: 400 });
  }
  if (venueId === staff.venue_id) {
    return NextResponse.json({ error: 'Use the normal venue profile for your own venue.' }, { status: 400 });
  }

  try {
    const admin = getSupabaseAdminClient();
    const access = await resolveCallerGrantOverVenue(admin, staff.venue_id, venueId);
    if (!access) {
      return NextResponse.json(
        { error: 'You do not have an active link with that venue.' },
        { status: 403 },
      );
    }
    if (access.grant.act !== 'create_edit_cancel') {
      return NextResponse.json(
        { error: 'This link does not allow creating bookings in the other venue.' },
        { status: 403 },
      );
    }

    const { data: venueRow, error: venueErr } = await admin
      .from('venues')
      .select(
        'id, name, slug, address, phone, email, cover_photo_url, logo_url, opening_hours, venue_opening_exceptions, booking_rules, deposit_config, stripe_connected_account_id, timezone, currency, website_url, booking_model, enabled_models, active_booking_models, terminology, public_booking_area_mode, require_account_login_for_bookings, feature_flags',
      )
      .eq('id', venueId)
      .maybeSingle();

    if (venueErr || !venueRow) {
      return NextResponse.json({ error: 'Linked venue not found.' }, { status: 404 });
    }

    const venueMode = await resolveVenueMode(admin, venueId);

    return NextResponse.json({
      venue_name: (venueRow.name as string) ?? 'Linked venue',
      venue: mapApiVenueToVenuePublic(venueRow as Record<string, unknown>),
      booking_model: venueMode.bookingModel,
      enabled_models: venueMode.enabledModels,
      currency: (venueRow.currency as string) ?? 'GBP',
    });
  } catch (err) {
    console.error('GET /api/venue/linked-calendar/venue-profile failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
