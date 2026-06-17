import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClientFromHeaders } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { resolveCallerGrantOverVenue } from '@/lib/linked-accounts/queries';
import { recordReadAudit } from '@/lib/linked-accounts/audit';
import type { LinkGrant } from '@/lib/linked-accounts/types';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * GET /api/venue/linked-calendar/event?eventId=&ownerVenueId=
 * Event occurrence detail for a linked owner venue. Respects calendar visibility
 * (full_details required for names/descriptions) and PII grant for guest contact fields
 * in the bookings list (loaded separately).
 */
export async function GET(request: NextRequest) {
  const supabase = await createRouteHandlerClientFromHeaders();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const staff = await getVenueStaff(supabase);
  if (!staff) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const eventId = request.nextUrl.searchParams.get('eventId') ?? '';
  const ownerVenueId = request.nextUrl.searchParams.get('ownerVenueId') ?? '';
  if (!UUID_RE.test(eventId) || !UUID_RE.test(ownerVenueId)) {
    return NextResponse.json({ error: 'Valid eventId and ownerVenueId are required.' }, { status: 400 });
  }
  if (ownerVenueId === staff.venue_id) {
    return NextResponse.json(
      { error: 'Use the normal event detail tools for your own venue.' },
      { status: 400 },
    );
  }

  try {
    const admin = getSupabaseAdminClient();
    const access = await resolveCallerGrantOverVenue(admin, staff.venue_id, ownerVenueId);
    if (!access || access.grant.calendar === 'none') {
      return NextResponse.json(
        { error: 'You do not have visibility of that venue.' },
        { status: 403 },
      );
    }
    if (access.grant.calendar === 'time_only') {
      return NextResponse.json(
        { error: 'This link only shows busy time — event details are not available.' },
        { status: 403 },
      );
    }

    const { data: eventRow, error: evErr } = await admin
      .from('experience_events')
      .select('*, ticket_types:event_ticket_types(*)')
      .eq('id', eventId)
      .eq('venue_id', ownerVenueId)
      .maybeSingle();

    if (evErr) {
      console.error('GET /api/venue/linked-calendar/event load failed:', evErr);
      return NextResponse.json({ error: 'Failed to load event' }, { status: 500 });
    }
    if (!eventRow) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    const { data: venueRow } = await admin
      .from('venues')
      .select('name, timezone, currency')
      .eq('id', ownerVenueId)
      .maybeSingle();

    const grant: LinkGrant = access.grant;

    void recordReadAudit({
      admin,
      linkId: access.linkId,
      actingVenueId: staff.venue_id,
      actingUserId: user?.id ?? null,
      owningVenueId: ownerVenueId,
      actionType: 'viewed_calendar',
      resourceType: 'experience_event',
      resourceId: eventId,
    });

    const tzRaw = (venueRow as { timezone?: string | null } | null)?.timezone;
    const venueTimezone =
      typeof tzRaw === 'string' && tzRaw.trim() !== '' ? tzRaw.trim() : 'Europe/London';

    return NextResponse.json({
      grant: {
        calendar: grant.calendar,
        pii: grant.pii,
        act: grant.act,
      },
      ownerVenueId,
      ownerVenueName: ((venueRow as { name?: string } | null)?.name as string) ?? 'Linked venue',
      ownerVenueTimezone: venueTimezone,
      currency: ((venueRow as { currency?: string } | null)?.currency as string) ?? 'GBP',
      event: eventRow,
    });
  } catch (err) {
    console.error('GET /api/venue/linked-calendar/event failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
