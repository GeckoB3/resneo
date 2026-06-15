import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { getVenueLocalDateAndMinutes } from '@/lib/venue/venue-local-clock';
import { parseVenueOpeningExceptions } from '@/types/venue-opening-exceptions';
import {
  describeHoursChangeOrphans,
  findBookingsOrphanedByHoursChange,
  venueWeeklyMinutesForDate,
} from '@/lib/calendar/hours-change-orphans';
import type { OpeningHours } from '@/types/availability';
import { openingHoursSchema } from '@/types/config-schemas';

/** PATCH /api/venue/opening-hours - update opening_hours (admin only). */
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
    if (!requireAdmin(staff)) {
      return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    const body = await request.json();
    const parsed = openingHoursSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const opening_hours = parsed.data ?? undefined;

    // Narrowing/shifting hours can leave existing upcoming bookings outside the new hours.
    // We don't block (those commitments are honoured) — but unless the admin has acknowledged,
    // surface which bookings are affected so the change is made knowingly.
    const acknowledge = request.nextUrl.searchParams.get('acknowledge_affected_bookings') === 'true';
    if (!acknowledge) {
      const { data: current, error: curErr } = await staff.db
        .from('venues')
        .select('opening_hours, venue_opening_exceptions, timezone')
        .eq('id', staff.venue_id)
        .single();
      if (curErr || !current) {
        console.error('PATCH /api/venue/opening-hours load current failed:', curErr);
        return NextResponse.json({ error: 'Failed to load venue' }, { status: 500 });
      }
      try {
        const tz =
          typeof current.timezone === 'string' && current.timezone.trim() ? current.timezone.trim() : 'Europe/London';
        const fromDate = getVenueLocalDateAndMinutes(tz, new Date()).dateYmd;
        const exceptions = parseVenueOpeningExceptions(
          (current as { venue_opening_exceptions?: unknown }).venue_opening_exceptions,
        );
        const orphans = await findBookingsOrphanedByHoursChange(getSupabaseAdminClient(), {
          venueId: staff.venue_id,
          fromDate,
          oldPeriodsForDate: venueWeeklyMinutesForDate((current.opening_hours as OpeningHours | null) ?? null),
          newPeriodsForDate: venueWeeklyMinutesForDate((opening_hours as OpeningHours | null | undefined) ?? null),
          skipDate: (d) => exceptions.some((ex) => ex.date_start <= d && d <= ex.date_end),
        });
        if (orphans.total > 0) {
          return NextResponse.json(
            {
              requires_confirmation: true,
              affected_count: orphans.total,
              affected_bookings: orphans.sample,
              message: describeHoursChangeOrphans(orphans, { scope: 'venue' }),
            },
            { status: 409 },
          );
        }
      } catch (e) {
        console.error('PATCH /api/venue/opening-hours orphan check:', e);
        return NextResponse.json(
          { error: 'Could not verify existing bookings. Please try again.' },
          { status: 500 },
        );
      }
    }

    const { data: venue, error } = await staff.db
      .from('venues')
      .update({ opening_hours, updated_at: new Date().toISOString() })
      .eq('id', staff.venue_id)
      .select('opening_hours')
      .single();

    if (error) {
      console.error('PATCH /api/venue/opening-hours failed:', error);
      return NextResponse.json({ error: 'Failed to update opening hours' }, { status: 500 });
    }

    return NextResponse.json({ opening_hours: venue.opening_hours });
  } catch (err) {
    console.error('PATCH /api/venue/opening-hours failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
