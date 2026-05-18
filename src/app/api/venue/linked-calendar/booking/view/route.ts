import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { resolveCallerGrantOverVenue } from '@/lib/linked-accounts/queries';
import { recordReadAudit } from '@/lib/linked-accounts/audit';

/**
 * POST /api/venue/linked-calendar/booking/view — record that the caller opened
 * a specific linked-venue booking's detail (§4.2 `viewed_booking`). A read-only
 * ping fired by the linked booking detail / edit modals on open; debounced to a
 * 5-minute window per (user, booking). Best-effort: a failure never blocks the
 * UI, which has already shown the detail from data it was permitted to load.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const staff = await getVenueStaff(supabase);
  if (!staff) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const bookingId =
    body && typeof body === 'object' && typeof (body as { bookingId?: unknown }).bookingId === 'string'
      ? (body as { bookingId: string }).bookingId
      : null;
  if (!bookingId) {
    return NextResponse.json({ error: 'A bookingId is required.' }, { status: 400 });
  }

  try {
    const admin = getSupabaseAdminClient();
    const { data: booking } = await admin
      .from('bookings')
      .select('id, venue_id')
      .eq('id', bookingId)
      .maybeSingle();
    // Silently succeed for an unknown or own-venue booking — there is nothing
    // cross-venue to audit, and the ping must never surface an error.
    if (!booking || (booking.venue_id as string) === staff.venue_id) {
      return NextResponse.json({ ok: true });
    }
    const ownerVenueId = booking.venue_id as string;

    const access = await resolveCallerGrantOverVenue(admin, staff.venue_id, ownerVenueId);
    if (!access || access.grant.calendar === 'none') {
      return NextResponse.json(
        { error: 'You do not have visibility of that venue.' },
        { status: 403 },
      );
    }

    await recordReadAudit({
      admin,
      linkId: access.linkId,
      actingVenueId: staff.venue_id,
      actingUserId: user?.id ?? null,
      owningVenueId: ownerVenueId,
      actionType: 'viewed_booking',
      resourceType: 'booking',
      resourceId: bookingId,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('POST /api/venue/linked-calendar/booking/view failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
