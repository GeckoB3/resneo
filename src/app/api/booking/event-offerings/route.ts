import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { resolveVenueMode } from '@/lib/venue-mode';
import { venueExposesBookingModel } from '@/lib/booking/enabled-models';
import {
  buildEventOfferingSummaries,
  computeEventAvailability,
  fetchEventInputForRange,
} from '@/lib/availability/event-ticket-engine';
import { nextResponseIfPublicBookingBlockedForVenue } from '@/lib/booking/light-plan-public-block';

function addDaysIso(from: string, days: number): string {
  const [y, m, d] = from.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * GET /api/booking/event-offerings?venue_id=uuid&from=YYYY-MM-DD&days=90
 * Public: event series with bookable dates in range + occurrence rows (guest booking rules applied).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const venueId = searchParams.get('venue_id');
    if (!venueId) {
      return NextResponse.json({ error: 'Missing venue_id' }, { status: 400 });
    }

    // Events may be created up to 365 days out (`max_advance_booking_days` ≤ 365),
    // and each event's own booking window is enforced downstream by
    // `computeEventAvailability` → `isGuestBookingDateAllowed`. The previous horizon
    // capped the fetch at 120 days (and the default caller only asks for 90), so
    // events 121–365 days out were never loaded and never appeared publicly even
    // when their own window allowed them (CDE review §5.3, finding 15).
    //
    // Fix: decouple the *fetch* horizon from the requested `days`. We always scan
    // out to the maximum advance window an event could permit; the per-event
    // window check then drops anything a given event doesn't yet allow. The
    // requested `days` only raises the floor (a caller may ask for more, never less
    // than the full window), so distant events surface as soon as they're bookable.
    const MAX_EVENT_ADVANCE_DAYS = 365;
    const daysRaw = searchParams.get('days');
    const requestedDays = Math.max(7, parseInt(daysRaw ?? '90', 10) || 90);
    // Always scan the full advance window so distant-but-bookable events appear;
    // honour a caller asking for more, but never less than the full window.
    const days = Math.max(MAX_EVENT_ADVANCE_DAYS, requestedDays);
    const fromParam = searchParams.get('from');
    const from =
      fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) ? fromParam : new Date().toISOString().slice(0, 10);
    const to = addDaysIso(from, days);

    const supabase = getSupabaseAdminClient();
    const blocked = await nextResponseIfPublicBookingBlockedForVenue(supabase, venueId);
    if (blocked) return blocked;

    const venueMode = await resolveVenueMode(supabase, venueId);
    if (!venueExposesBookingModel(venueMode.bookingModel, venueMode.enabledModels, 'event_ticket')) {
      return NextResponse.json({ error: 'Event booking is not available for this venue' }, { status: 403 });
    }

    const { data: v } = await supabase.from('venues').select('timezone').eq('id', venueId).maybeSingle();
    const tz =
      typeof (v as { timezone?: string | null } | null)?.timezone === 'string' &&
      String((v as { timezone?: string | null }).timezone).trim() !== ''
        ? String((v as { timezone?: string | null }).timezone).trim()
        : 'Europe/London';

    const input = await fetchEventInputForRange({
      supabase,
      venueId,
      fromDate: from,
      toDate: to,
    });
    const slots = computeEventAvailability(input, { venueTimezone: tz });
    const events = buildEventOfferingSummaries(slots);

    return NextResponse.json({
      venue_id: venueId,
      from,
      to,
      events,
      instances: slots,
    });
  } catch (err) {
    console.error('GET /api/booking/event-offerings failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
