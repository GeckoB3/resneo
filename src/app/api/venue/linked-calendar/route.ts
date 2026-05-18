import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { loadAccessibleLinkedVenueIds } from '@/lib/linked-accounts/queries';
import { recordReadAudit } from '@/lib/linked-accounts/audit';
import { venueUsesUnifiedCalendarList } from '@/lib/booking/unified-calendar-list';
import type {
  LinkedBooking,
  LinkedPractitioner,
  LinkedService,
  LinkedVenueCalendar,
} from '@/lib/linked-accounts/calendar';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/venue/linked-calendar — bookings and practitioners of every venue
 * linked to the caller's venue. Pass either `?date=YYYY-MM-DD` for a single
 * day or `?from=YYYY-MM-DD&to=YYYY-MM-DD` for a date range (used by the
 * bookings list, §8.2). Available to all staff (visibility is inherited from
 * the link, §3.1). time_only links return bare time blocks; full_details
 * links return full detail (PII only when granted).
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const staff = await getVenueStaff(supabase);
  if (!staff) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const date = params.get('date') ?? '';
  const fromParam = params.get('from') ?? '';
  const toParam = params.get('to') ?? '';
  const isRange = fromParam !== '' || toParam !== '';

  if (isRange) {
    if (!DATE_RE.test(fromParam) || !DATE_RE.test(toParam) || fromParam > toParam) {
      return NextResponse.json(
        { error: 'A valid from/to range (YYYY-MM-DD) is required.' },
        { status: 400 },
      );
    }
  } else if (!DATE_RE.test(date)) {
    return NextResponse.json({ error: 'A valid date (YYYY-MM-DD) is required.' }, { status: 400 });
  }
  const rangeFrom = isRange ? fromParam : date;
  const rangeTo = isRange ? toParam : date;

  try {
    const admin = getSupabaseAdminClient();
    const accessible = await loadAccessibleLinkedVenueIds(admin, staff.venue_id);
    if (accessible.length === 0) {
      return NextResponse.json({ date, from: rangeFrom, to: rangeTo, venues: [] });
    }

    const venueIds = accessible.map((a) => a.venueId);
    const { data: venueRows } = await admin
      .from('venues')
      .select('id, name')
      .in('id', venueIds);
    const venueNames: Record<string, string> = {};
    for (const v of venueRows ?? []) {
      venueNames[v.id as string] = (v.name as string) ?? 'Linked venue';
    }

    const calendars: LinkedVenueCalendar[] = [];

    for (const access of accessible) {
      const fullDetails = access.grant.calendar === 'full_details';
      const canSeePii = fullDetails && access.grant.pii;

      // Calendar columns: appointments-family venues store them in
      // `unified_calendars`; only legacy table venues use `practitioners`.
      const usesUnified = await venueUsesUnifiedCalendarList(admin, access.venueId);
      let practitioners: LinkedPractitioner[];
      if (usesUnified) {
        const { data: calendarRows } = await admin
          .from('unified_calendars')
          .select('id, name, is_active, calendar_type')
          .eq('venue_id', access.venueId)
          .order('sort_order', { ascending: true });
        practitioners = (calendarRows ?? [])
          .filter((c) => (c.calendar_type as string | null) !== 'resource')
          .map((c) => ({
            id: c.id as string,
            name: (c.name as string) ?? 'Calendar',
            isActive: (c.is_active as boolean) ?? true,
          }));
      } else {
        const { data: practitionerRows } = await admin
          .from('practitioners')
          .select('id, name, is_active')
          .eq('venue_id', access.venueId)
          .order('sort_order', { ascending: true });
        practitioners = (practitionerRows ?? []).map((p) => ({
          id: p.id as string,
          name: (p.name as string) ?? 'Calendar',
          isActive: (p.is_active as boolean) ?? true,
        }));
      }

      // Services — only meaningful to full_details viewers (used by the
      // cross-venue "new booking" form when the link allows creating).
      let services: LinkedService[] = [];
      if (fullDetails) {
        const { data: serviceRows } = await admin
          .from('appointment_services')
          .select('id, name')
          .eq('venue_id', access.venueId)
          .eq('is_active', true)
          .order('name', { ascending: true });
        services = (serviceRows ?? []).map((s) => ({
          id: s.id as string,
          name: (s.name as string) ?? 'Service',
        }));
      }

      const { data: bookingRows } = await admin
        .from('bookings')
        .select(
          'id, practitioner_id, calendar_id, appointment_service_id, guest_id, booking_date, booking_time, booking_end_time, status',
        )
        .eq('venue_id', access.venueId)
        .gte('booking_date', rangeFrom)
        .lte('booking_date', rangeTo);

      const rawBookings = (bookingRows ?? []) as unknown as Array<Record<string, unknown>>;

      // Resolve guest + service names only for full_details links.
      const guestNames: Record<string, string> = {};
      const serviceNames: Record<string, string> = {};
      if (fullDetails && rawBookings.length > 0) {
        const serviceIds = [
          ...new Set(
            rawBookings
              .map((b) => b.appointment_service_id as string | null)
              .filter((x): x is string => Boolean(x)),
          ),
        ];
        if (serviceIds.length > 0) {
          const { data: services } = await admin
            .from('appointment_services')
            .select('id, name')
            .in('id', serviceIds);
          for (const s of services ?? []) {
            serviceNames[s.id as string] = (s.name as string) ?? 'Service';
          }
        }
        if (canSeePii) {
          const guestIds = [
            ...new Set(
              rawBookings
                .map((b) => b.guest_id as string | null)
                .filter((x): x is string => Boolean(x)),
            ),
          ];
          if (guestIds.length > 0) {
            const { data: guests } = await admin
              .from('guests')
              .select('id, name, first_name, last_name')
              .in('id', guestIds);
            for (const g of guests ?? []) {
              const composed = [g.first_name, g.last_name]
                .filter((x): x is string => Boolean(x))
                .join(' ')
                .trim();
              guestNames[g.id as string] =
                composed || (g.name as string) || 'Client';
            }
          }
        }
      }

      const editable =
        access.grant.act === 'edit_existing' || access.grant.act === 'create_edit_cancel';

      // Resolve each booking onto its column id. Unified venues key bookings
      // by `calendar_id`; legacy venues by `practitioner_id`. The fallback
      // covers mirror rows, where both ids are shared.
      const bookings: LinkedBooking[] = rawBookings.map((b) => ({
        id: b.id as string,
        practitionerId: usesUnified
          ? (b.calendar_id as string | null) ?? (b.practitioner_id as string | null) ?? null
          : (b.practitioner_id as string | null) ?? (b.calendar_id as string | null) ?? null,
        bookingDate: b.booking_date as string,
        bookingTime: (b.booking_time as string) ?? '',
        bookingEndTime: (b.booking_end_time as string | null) ?? null,
        status: (b.status as string) ?? 'Pending',
        guestName: canSeePii ? guestNames[b.guest_id as string] ?? null : null,
        serviceName: fullDetails
          ? serviceNames[(b.appointment_service_id as string) ?? ''] ?? null
          : null,
        editable,
      }));

      calendars.push({
        venueId: access.venueId,
        venueName: venueNames[access.venueId] ?? 'Linked venue',
        linkId: access.linkId,
        visibility: access.grant.calendar,
        action: access.grant.act,
        practitioners,
        services,
        bookings,
      });

      // Record the cross-venue calendar view (debounced 5 minutes).
      void recordReadAudit({
        admin,
        linkId: access.linkId,
        actingVenueId: staff.venue_id,
        actingUserId: user?.id ?? null,
        owningVenueId: access.venueId,
        actionType: 'viewed_calendar',
        resourceType: 'practitioner',
        resourceId: null,
      });
    }

    return NextResponse.json({ date, from: rangeFrom, to: rangeTo, venues: calendars });
  } catch (err) {
    console.error('GET /api/venue/linked-calendar failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
