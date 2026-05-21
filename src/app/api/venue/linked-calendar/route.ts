import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { loadAccessibleLinkedVenueIds } from '@/lib/linked-accounts/queries';
import { recordReadAudit } from '@/lib/linked-accounts/audit';
import { venueUsesUnifiedCalendarList } from '@/lib/booking/unified-calendar-list';
import {
  resolveLinkedBookingColumnId,
  type LinkedBooking,
  type LinkedPractitioner,
  type LinkedService,
  type LinkedVenueCalendar,
} from '@/lib/linked-accounts/calendar';
import {
  formatGuestDisplayName,
  mergeBookingSnapshotWithGuestProfile,
  normaliseGuestNamePart,
} from '@/lib/guests/name';
import { resolveBookingListRowLabels } from '@/lib/booking/booking-list-row-label';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Same column set as staff calendar list (`view=calendar`). */
const LINKED_CALENDAR_BOOKING_SELECT =
  'id, booking_date, booking_time, party_size, booking_model, status, source, deposit_status, deposit_amount_pence, special_requests, internal_notes, client_arrived_at, guest_attendance_confirmed_at, staff_attendance_confirmed_at, estimated_end_time, guest_id, guest_first_name, guest_last_name, practitioner_id, appointment_service_id, calendar_id, service_item_id, service_variant_id, processing_time_blocks, resource_id, booking_end_time, experience_event_id, class_instance_id, event_session_id, service_id';

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
          .select(
            'id, name, duration_minutes, buffer_minutes, processing_time_blocks, colour, price_pence',
          )
          .eq('venue_id', access.venueId)
          .eq('is_active', true)
          .order('name', { ascending: true });
        services = (serviceRows ?? []).map((s) => ({
          id: s.id as string,
          name: (s.name as string) ?? 'Service',
          durationMinutes: (s.duration_minutes as number) ?? 60,
          bufferMinutes: (s.buffer_minutes as number) ?? 0,
          processingTimeBlocks: (s.processing_time_blocks as LinkedService['processingTimeBlocks']) ?? [],
          colour: (s.colour as string) ?? '#6366f1',
          pricePence: (s.price_pence as number | null) ?? null,
        }));
      }

      // Bookings are loaded via the admin client once the accepted link grant
      // is verified above. Practitioners/services already use admin for the
      // same reason: the user-scoped client can return zero rows when RLS
      // helper functions disagree with the app-layer grant check (e.g. staff
      // matched by user_id). Grant enforcement stays in this handler — only
      // venues from loadAccessibleLinkedVenueIds are queried.
      //
      // Cancelled bookings are excluded: a cancelled slot is free, so it must
      // never render as "busy" on a time_only link or clutter a full_details
      // grid. No-Show rows are kept — that time was still reserved.
      const { data: bookingRows, error: bookingErr } = await admin
        .from('bookings')
        .select(LINKED_CALENDAR_BOOKING_SELECT)
        .eq('venue_id', access.venueId)
        .neq('status', 'Cancelled')
        .gte('booking_date', rangeFrom)
        .lte('booking_date', rangeTo);

      if (bookingErr) {
        console.error(
          `GET /api/venue/linked-calendar bookings query failed for venue ${access.venueId}:`,
          bookingErr.message,
        );
      }

      const rawBookings = (bookingRows ?? []) as unknown as Array<Record<string, unknown>>;

      // Resolve guest names only for full_details links with PII.
      const guestNames: Record<string, string> = {};
      const guestEmails: Record<string, string | null> = {};
      const guestPhones: Record<string, string | null> = {};
      let serviceLabelByBookingId = new Map<string, string>();
      if (fullDetails && rawBookings.length > 0) {
        serviceLabelByBookingId = await resolveBookingListRowLabels(
          admin,
          rawBookings.map((b) => ({
            id: b.id as string,
            booking_model: b.booking_model as string | null | undefined,
            experience_event_id: b.experience_event_id as string | null | undefined,
            class_instance_id: b.class_instance_id as string | null | undefined,
            resource_id: b.resource_id as string | null | undefined,
            event_session_id: b.event_session_id as string | null | undefined,
            calendar_id: b.calendar_id as string | null | undefined,
            service_item_id: b.service_item_id as string | null | undefined,
            practitioner_id: b.practitioner_id as string | null | undefined,
            appointment_service_id: b.appointment_service_id as string | null | undefined,
            service_id: b.service_id as string | null | undefined,
          })),
        );
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
              .select('id, name, first_name, last_name, email, phone')
              .in('id', guestIds);
            for (const g of guests ?? []) {
              const composed = [g.first_name, g.last_name]
                .filter((x): x is string => Boolean(x))
                .join(' ')
                .trim();
              guestNames[g.id as string] =
                composed || (g.name as string) || 'Client';
              guestEmails[g.id as string] = (g.email as string | null) ?? null;
              guestPhones[g.id as string] = (g.phone as string | null) ?? null;
            }
          }
        }
      }

      const editable =
        access.grant.act === 'edit_existing' || access.grant.act === 'create_edit_cancel';

      const columnIds = new Set(practitioners.map((p) => p.id));

      const bookings: LinkedBooking[] = rawBookings.map((b) => {
        const guestId = b.guest_id as string | null;
        const snapshotMerged = mergeBookingSnapshotWithGuestProfile({
          booking_guest_first_name: b.guest_first_name as string | null | undefined,
          booking_guest_last_name: b.guest_last_name as string | null | undefined,
          profile_first_name: null,
          profile_last_name: null,
        });
        const snapshotPresent =
          Boolean(normaliseGuestNamePart(b.guest_first_name as string | null | undefined)) ||
          Boolean(normaliseGuestNamePart(b.guest_last_name as string | null | undefined));
        const guestLabel =
          canSeePii && guestId
            ? guestNames[guestId] ??
              (snapshotPresent
                ? formatGuestDisplayName(snapshotMerged.first, snapshotMerged.last)
                : null)
            : null;

        const base: LinkedBooking = {
          id: b.id as string,
          practitionerId: resolveLinkedBookingColumnId(
            {
              practitioner_id: b.practitioner_id as string | null,
              calendar_id: b.calendar_id as string | null,
            },
            columnIds,
          ),
          bookingDate: b.booking_date as string,
          bookingTime: (b.booking_time as string) ?? '',
          bookingEndTime: (b.booking_end_time as string | null) ?? null,
          status: (b.status as string) ?? 'Pending',
          guestName: guestLabel,
          serviceName: fullDetails
            ? serviceLabelByBookingId.get(b.id as string) ?? null
            : null,
          editable,
        };

        if (!fullDetails) return base;

        return {
          ...base,
          partySize: (b.party_size as number) ?? 1,
          bookingModel: (b.booking_model as string | null) ?? null,
          source: (b.source as string | null) ?? null,
          depositStatus: (b.deposit_status as string) ?? 'none',
          depositAmountPence: (b.deposit_amount_pence as number | null) ?? null,
          specialRequests: (b.special_requests as string | null) ?? null,
          internalNotes: (b.internal_notes as string | null) ?? null,
          clientArrivedAt: (b.client_arrived_at as string | null) ?? null,
          guestAttendanceConfirmedAt:
            (b.guest_attendance_confirmed_at as string | null) ?? null,
          staffAttendanceConfirmedAt:
            (b.staff_attendance_confirmed_at as string | null) ?? null,
          estimatedEndTime: (b.estimated_end_time as string | null) ?? null,
          guestId,
          guestEmail: guestId && canSeePii ? guestEmails[guestId] ?? null : null,
          guestPhone: guestId && canSeePii ? guestPhones[guestId] ?? null : null,
          appointmentServiceId: (b.appointment_service_id as string | null) ?? null,
          serviceItemId: (b.service_item_id as string | null) ?? null,
          serviceVariantId: (b.service_variant_id as string | null) ?? null,
          processingTimeBlocks: b.processing_time_blocks ?? null,
          resourceId: (b.resource_id as string | null) ?? null,
          calendarId: (b.calendar_id as string | null) ?? null,
          practitionerIdRaw: (b.practitioner_id as string | null) ?? null,
        };
      });

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
