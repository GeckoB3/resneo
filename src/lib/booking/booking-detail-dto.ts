import type { SupabaseClient } from '@supabase/supabase-js';
import { loadOutstandingBookingFormLinks } from '@/lib/compliance/form-links-service';
import {
  getCancellationNoticeHoursForBooking,
  parseExtendedBookingRules,
} from '@/lib/booking/venue-booking-rules';
import {
  createOrGetBookingShortLink,
  createOrGetPaymentShortLink,
} from '@/lib/booking-short-links';
import {
  deriveGuestCardHoldSummary,
  type GuestCardHoldRowInput,
  type GuestCardHoldSummary,
} from '@/lib/booking/guest-card-hold-summary';
import { isUnifiedSchedulingVenue } from '@/lib/booking/unified-scheduling';
import { inferBookingRowModel } from '@/lib/booking/infer-booking-row-model';
import type { BookingModel } from '@/types/booking-models';
import { buildVenuePublicForBookingById } from '@/lib/booking/build-venue-public';
import { parseVenueFeatureFlags, resolveAppointmentsFeatureFlags } from '@/lib/feature-flags';
import type { VenuePublic } from '@/components/booking/types';
import { buildGoogleCalendarAddUrlForBooking } from '@/lib/emails/calendar-links';
import { buildIcsContent } from '@/lib/ics';

/**
 * The one booking detail payload (P2-4, AD9).
 *
 * WHY IT MOVED. This was ~270 lines inside `GET /api/confirm`, and it is
 * everything a guest may see about one booking. AD9 makes the token surface and
 * the portal render the SAME component over the SAME shape, so there is exactly
 * one rendering of the cancellation and refund policy copy rather than two that
 * drift. A shared component needs a shared payload, and a payload that only a
 * route can build is not shared: it can only be reached over HTTP, which is the
 * pattern AD1 removed from `DELETE /api/v1/me/bookings/[id]`.
 *
 * WHAT DECIDED THE SHAPE. It is the existing `/api/confirm` body, field for
 * field, because that body is what `ManageBookingView` already reads and the
 * token surface is in production. P0-9 characterised the POST only, so this
 * payload had no gate at all until P2-4 added
 * `src/app/api/confirm/characterisation/detail.test.ts`; the extraction's
 * acceptance was that all fourteen of its snapshots stayed byte-identical.
 *
 * THE BOUNDARY. This takes an already-loaded, already-AUTHORISED booking row.
 * It performs no authorisation of its own and must not: the token surface
 * proves a token or an HMAC, the portal proves a session through
 * `loadAndAuthoriseGuestBooking`, and a builder that tried to do both would
 * have to be told which, which is how a caller ends up passing the answer in.
 * Give it a row the caller has established the reader may see.
 */

/** Guest-safe card-hold summary: fee and derived state, never Stripe ids. */
export type BookingDetailCardHold = GuestCardHoldSummary & { payment_link?: string };

export interface BookingDetailDto {
  booking_id: string;
  venue_id: string;
  venue_name: string | undefined;
  venue_address: string | null | undefined;
  venue_phone: string | null;
  booking_date: string;
  booking_time: string;
  party_size: number;
  deposit_paid: boolean;
  deposit_amount_pence: number | null;
  card_hold: BookingDetailCardHold | null;
  status: string;
  booking_model: BookingModel;
  is_appointment: boolean;
  practitioner_id: string | null;
  appointment_service_id: string | null;
  practitioner_name: string | null;
  appointment_service_name: string | null;
  event_name: string | null;
  class_summary: string | null;
  class_type_name: string | null;
  resource_id: string | null;
  class_instance_id: string | null;
  class_type_id: string | null;
  /**
   * Whether this booking is one session of a course bought together (P2-3).
   *
   * The portal needs it to say what a reschedule DOES: a course is many
   * booking rows sharing a `group_booking_id`, and moving one moves that one.
   * A guest who reads "change booking" as "move my course" and then finds
   * five sessions still in the old slot has been misled by the button.
   */
  part_of_course: boolean;
  resource_name: string | null;
  booking_end_time: string | null;
  cancellation_deadline: string | null;
  refund_notice_hours: number;
  guest_attendance_confirmed_at: string | null;
  venue_public: VenuePublic | null;
  manage_booking_url: string;
  compliance_forms: Array<{ name: string; url: string }>;
  feature_flags: { resolved: ReturnType<typeof resolveAppointmentsFeatureFlags> };

  // ── Sections added by P2-4's completion ─────────────────────────────────

  /**
   * Where it happens (P2-4's "when and where").
   *
   * `venue` is the default and the common case. The other two exist because an
   * appointment can be at the CUSTOMER's address or online, and a booking page
   * that always printed the venue's address would send a mobile practitioner's
   * client to the wrong place.
   */
  location: {
    type: 'venue' | 'client_address' | 'online';
    /** The address to show, already assembled in reading order. */
    address: string | null;
    /** A map link for a physical address, or null for an online booking. */
    map_url: string | null;
  };

  /** What the guest wrote when booking. Empty when they wrote nothing. */
  notes: Array<{ label: string; value: string }>;

  /** Ticket tiers with their prices, for an event booking. */
  ticket_lines: Array<{ label: string; quantity: number; unit_price_pence: number }>;

  /** Derived from start and end, so a guest can see how long to allow. */
  duration_minutes: number | null;

  /**
   * What the venue wants the guest to do beforehand (G8a).
   *
   * `service_items.pre_appointment_instructions` is written by venues and, until
   * now, was read by NOTHING in the codebase. The plan said it rendered in
   * emails; it did not. A venue typing "please arrive with clean hair" had it
   * stored and shown to nobody.
   */
  pre_appointment_instructions: string | null;

  /**
   * How to reach the venue, for anything this page cannot answer.
   *
   * `reply_to_email` first, falling back to the legacy `email`, which is the
   * exact precedence `venue-email-data.ts:22` already uses for the Reply-To on
   * every email a guest receives. Deliberately not `email` alone: that column
   * predates `reply_to_email` and may hold the venue's own account address
   * rather than a business inbox, and this page would be a new place it leaked.
   */
  venue_email: string | null;

  /** The deposit's own state, distinct from whether it was paid. */
  deposit_status: string | null;

  /**
   * Who cancelled, when it is cancelled (Q-22).
   *
   * A guest who opens a cancelled booking is asked to accept a refund outcome,
   * and "you cancelled this" and "the venue cancelled this" carry different
   * ones. `cancelled_by_staff_id` stays staff-only and is not carried here.
   */
  cancelled_by: 'customer' | 'venue' | null;

  /** Booked, confirmed and cancelled instants, for a plain history line. */
  timeline: Array<{ label: string; at: string }>;

  /**
   * Whether a class credit or membership allowance paid for this booking.
   *
   * Read so the cancel dialog can say what happens to it. `cancelBookingForGuest`
   * restores credits only when the booking is a class session AND the
   * cancellation deadline has not passed, so a guest deciding whether to cancel
   * needs to know both, and "your credit will be returned" is a different
   * decision from "your credit will not be returned".
   *
   * Always false for anything that is not a class session, since nothing else
   * can be paid that way.
   */
  paid_with_credit: boolean;

  /**
   * Add to calendar, built here rather than in the browser.
   *
   * Both need the venue's timezone to be right, and the client does not have
   * it: a booking's date and time are the venue's wall clock, so an
   * appointment at 14:00 in London belongs in the guest's calendar at 13:00
   * UTC during BST. `ics` is the file's whole content, ready to hand to a
   * download; `google_url` is null when the booking has no usable time.
   */
  calendar: { google_url: string | null; ics: string | null };
}

/** The columns this builder reads. A superset is fine; a subset is not. */
export interface BookingDetailSourceRow {
  id: string;
  venue_id: string;
  booking_date: string;
  booking_time: string;
  booking_end_time?: string | null;
  party_size: number;
  status: string;
  deposit_status?: string | null;
  deposit_amount_pence?: number | null;
  cancellation_deadline?: string | null;
  practitioner_id?: string | null;
  appointment_service_id?: string | null;
  calendar_id?: string | null;
  service_item_id?: string | null;
  service_variant_id?: string | null;
  experience_event_id?: string | null;
  class_instance_id?: string | null;
  group_booking_id?: string | null;
  resource_id?: string | null;
  event_session_id?: string | null;
  guest_attendance_confirmed_at?: string | null;
  /** Where the appointment happens; null or 'venue' means at the venue. */
  location_type?: string | null;
  client_address_line1?: string | null;
  client_address_line2?: string | null;
  client_address_city?: string | null;
  client_address_postcode?: string | null;
  special_requests?: string | null;
  dietary_notes?: string | null;
  occasion?: string | null;
  /** Who cancelled: 'customer', 'venue', or null when it was not cancelled. */
  cancellation_actor_type?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export async function buildBookingDetailDto(
  supabase: SupabaseClient,
  booking: BookingDetailSourceRow,
): Promise<BookingDetailDto> {
  const { data: venue } = await supabase
    .from('venues')
    .select('name, address, phone, booking_model, booking_rules, email, reply_to_email, feature_flags, timezone')
    .eq('id', booking.venue_id)
    .single();
  const depositPaid = booking.deposit_status === 'Paid';
  const timeStr = typeof booking.booking_time === 'string' ? booking.booking_time.slice(0, 5) : '';

  let practitioner_name: string | null = null;
  let appointment_service_name: string | null = null;

  const bookingRow = booking;
  const inferredModel: BookingModel = inferBookingRowModel(bookingRow);
  const unifiedVenue = isUnifiedSchedulingVenue(
    (venue as { booking_model?: string } | null)?.booking_model,
  );
  const legacyAppt = Boolean(bookingRow.practitioner_id && bookingRow.appointment_service_id);
  const unifiedAppt = Boolean(unifiedVenue && bookingRow.calendar_id && bookingRow.service_item_id);
  const isAppointment = legacyAppt || unifiedAppt;

  let event_name: string | null = null;
  let class_summary: string | null = null;
  let class_type_id: string | null = null;
  let class_type_name: string | null = null;
  let resource_name: string | null = null;
  let booking_end_label: string | null = null;
  /** G8a: written by venues, read by nothing until now. */
  let preAppointmentInstructions: string | null = null;

  if (bookingRow.experience_event_id) {
    const { data: ev } = await supabase
      .from('experience_events')
      .select('name')
      .eq('id', bookingRow.experience_event_id)
      .maybeSingle();
    event_name = (ev as { name?: string } | null)?.name ?? null;
  }
  if (bookingRow.class_instance_id) {
    const { data: ci } = await supabase
      .from('class_instances')
      .select('instance_date, start_time, class_type_id')
      .eq('id', bookingRow.class_instance_id)
      .maybeSingle();
    if (ci) {
      const ctId = (ci as { class_type_id?: string }).class_type_id ?? null;
      class_type_id = ctId;
      const { data: ct } = ctId
        ? await supabase.from('class_types').select('name').eq('id', ctId).maybeSingle()
        : { data: null };
      const nm = (ct as { name?: string } | null)?.name ?? 'Class';
      class_type_name = (ct as { name?: string } | null)?.name ?? null;
      const d = String((ci as { instance_date?: string }).instance_date ?? '');
      const st = String((ci as { start_time?: string }).start_time ?? '').slice(0, 5);
      class_summary = `${nm} · ${d} ${st}`;
    }
  }
  if (bookingRow.resource_id) {
    const { data: vr } = await supabase
      .from('unified_calendars')
      .select('name')
      .eq('id', bookingRow.resource_id)
      .maybeSingle();
    resource_name = (vr as { name?: string } | null)?.name ?? null;
  }
  if (bookingRow.booking_end_time) {
    booking_end_label = String(bookingRow.booking_end_time).slice(0, 5);
  }

  const variantPromise = bookingRow.service_variant_id
    ? supabase
        .from('service_variants')
        .select('name')
        .eq('id', bookingRow.service_variant_id)
        .maybeSingle()
    : Promise.resolve({ data: null });

  if (unifiedAppt) {
    const [{ data: uc }, { data: si }, { data: variant }] = await Promise.all([
      supabase
        .from('unified_calendars')
        .select('name')
        .eq('id', bookingRow.calendar_id as string)
        .maybeSingle(),
      supabase
        .from('service_items')
        .select('name, pre_appointment_instructions')
        .eq('id', bookingRow.service_item_id as string)
        .maybeSingle(),
      variantPromise,
    ]);
    practitioner_name = (uc as { name?: string } | null)?.name ?? null;
    preAppointmentInstructions =
      (si as { pre_appointment_instructions?: string | null } | null)?.pre_appointment_instructions ??
      null;
    const baseName = (si as { name?: string } | null)?.name ?? null;
    const variantName = (variant as { name?: string } | null)?.name ?? null;
    appointment_service_name =
      baseName && variantName ? `${baseName} - ${variantName}` : baseName ?? variantName;
  } else if (legacyAppt) {
    const [{ data: pr }, { data: svc }, { data: variant }] = await Promise.all([
      supabase
        .from('practitioners')
        .select('name')
        .eq('id', bookingRow.practitioner_id as string)
        .maybeSingle(),
      supabase
        .from('appointment_services')
        .select('name')
        .eq('id', bookingRow.appointment_service_id as string)
        .maybeSingle(),
      variantPromise,
    ]);
    practitioner_name = (pr as { name?: string } | null)?.name ?? null;
    const baseName = (svc as { name?: string } | null)?.name ?? null;
    const variantName = (variant as { name?: string } | null)?.name ?? null;
    appointment_service_name =
      baseName && variantName ? `${baseName} - ${variantName}` : baseName ?? variantName;
  }

  const practitionerIdForUi = (bookingRow.practitioner_id ?? bookingRow.calendar_id) as
    | string
    | null
    | undefined;
  const serviceIdForUi = (bookingRow.appointment_service_id ?? bookingRow.service_item_id) as
    | string
    | null
    | undefined;

  const rulesParsed = parseExtendedBookingRules(
    (venue as { booking_rules?: unknown } | null)?.booking_rules,
  );
  const refundNoticeHours = getCancellationNoticeHoursForBooking(rulesParsed, inferredModel, 48);

  const venueFlags = parseVenueFeatureFlags((venue as { feature_flags?: unknown } | null)?.feature_flags);
  const featureFlagsResolved = resolveAppointmentsFeatureFlags(venueFlags);

  // Guest-safe card-hold summary (card_hold deposits §10.1): fee + derived
  // state only, never Stripe ids or the terms snapshot. For an unsaved hold
  // (`awaiting_card`, staff link flow pre-save) also include the payment
  // link so the manage page can offer "Add card details".
  let card_hold: BookingDetailCardHold | null = null;
  {
    const { data: holdRow } = await supabase
      .from('booking_card_holds')
      .select('fee_pence, released_at, charged_pence, charged_at, stripe_payment_method_id')
      .eq('booking_id', booking.id)
      .maybeSingle();
    const summary = deriveGuestCardHoldSummary(
      booking as { deposit_status?: string | null },
      (holdRow as GuestCardHoldRowInput | null) ?? null,
    );
    if (summary) {
      card_hold = summary;
      if (summary.state === 'awaiting_card') {
        try {
          card_hold = {
            ...summary,
            payment_link: await createOrGetPaymentShortLink(booking.venue_id, booking.id),
          };
        } catch (linkErr) {
          console.error('[booking-detail-dto] payment short link failed:', linkErr);
        }
      }
    }
  }

  /*
    Where it happens.

    An appointment can be at the venue, at the CUSTOMER's address, or online. A
    page that always printed the venue's address would send a mobile
    practitioner's client to the wrong place, which is why `location_type` and
    the four `client_address_*` columns exist and why P0-6 put them in the
    account-safe view.
  */
  const locationType: BookingDetailDto['location']['type'] =
    booking.location_type === 'client_address'
      ? 'client_address'
      : booking.location_type === 'online'
        ? 'online'
        : 'venue';
  const clientAddress = [
    booking.client_address_line1,
    booking.client_address_line2,
    booking.client_address_city,
    booking.client_address_postcode,
  ]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter((part) => part.length > 0)
    .join(', ');
  const venueAddress = (venue as { address?: string | null } | null)?.address ?? null;
  const locationAddress =
    locationType === 'online' ? null : locationType === 'client_address' ? clientAddress || null : venueAddress;
  const mapUrl = locationAddress
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(locationAddress)}`
    : null;

  /** Only what the guest actually wrote; an empty list renders nothing. */
  const notes = (
    [
      ['Occasion', booking.occasion],
      ['Special requests', booking.special_requests],
      ['Dietary notes', booking.dietary_notes],
    ] as Array<[string, string | null | undefined]>
  )
    .filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
    .map(([label, value]) => ({ label, value: (value as string).trim() }));

  /** Event tiers and their prices, so "3 tickets" can say which three. */
  let ticketLines: BookingDetailDto['ticket_lines'] = [];
  if (bookingRow.experience_event_id) {
    const { data: lines } = await supabase
      .from('booking_ticket_lines')
      .select('label, quantity, unit_price_pence')
      .eq('booking_id', booking.id);
    ticketLines = ((lines ?? []) as Array<Record<string, unknown>>).map((l) => ({
      label: String(l.label ?? 'Ticket'),
      quantity: Number(l.quantity ?? 0),
      unit_price_pence: Number(l.unit_price_pence ?? 0),
    }));
  }

  const durationMinutes = minutesBetweenTimes(booking.booking_time, booking.booking_end_time);

  const cancelledBy: BookingDetailDto['cancelled_by'] =
    booking.cancellation_actor_type === 'venue'
      ? 'venue'
      : booking.cancellation_actor_type === 'customer'
        ? 'customer'
        : null;

  /*
    A plain history, built from instants already on the booking rather than
    from the `events` table. Those rows carry `guest_id` and `source` and are
    shaped for staff audit, so projecting them guest-safely would be its own
    piece of work for a line that says the same three things.
  */
  const timeline: BookingDetailDto['timeline'] = [];
  if (booking.created_at) timeline.push({ label: 'Booked', at: booking.created_at });
  if (booking.guest_attendance_confirmed_at) {
    timeline.push({ label: 'Confirmed', at: booking.guest_attendance_confirmed_at });
  }
  if (cancelledBy && booking.updated_at) {
    timeline.push({
      label: cancelledBy === 'venue' ? 'Cancelled by the venue' : 'Cancelled by you',
      at: booking.updated_at,
    });
  }

  /*
    Only asked for a class session: nothing else can be credit-paid, and this
    is a second table read on a page that already makes several.
  */
  let paidWithCredit = false;
  if (inferredModel === 'class_session') {
    const [{ data: creditRow }, { data: allowanceRow }] = await Promise.all([
      supabase
        .from('class_credit_ledger')
        .select('id')
        .eq('booking_id', booking.id)
        .eq('reason', 'redeem')
        .limit(1)
        .maybeSingle(),
      supabase
        .from('class_membership_allowance_ledger')
        .select('id')
        .eq('booking_id', booking.id)
        .eq('reason', 'redeem')
        .limit(1)
        .maybeSingle(),
    ]);
    paidWithCredit = Boolean(creditRow || allowanceRow);
  }

  const venueTimezone =
    typeof (venue as { timezone?: string | null } | null)?.timezone === 'string' &&
    String((venue as { timezone?: string | null }).timezone).trim() !== ''
      ? String((venue as { timezone?: string | null }).timezone).trim()
      : 'Europe/London';
  const calendarVenueName = (venue as { name?: string } | null)?.name ?? 'Your booking';
  const calendarTitle =
    appointment_service_name ?? event_name ?? class_type_name ?? resource_name ?? calendarVenueName;
  const calendar = {
    google_url: buildGoogleCalendarAddUrlForBooking(
      {
        id: booking.id,
        booking_date: booking.booking_date,
        booking_time: timeStr,
        party_size: booking.party_size,
        // The helper takes an email-shaped booking and reads only the date,
        // time and party size from it (`calendar-links.ts:79-95`). The guest
        // fields it does not touch are given empty strings rather than a
        // customer's real name and address, which have no business being
        // assembled here just to satisfy a type.
        guest_name: '',
        guest_email: '',
        guest_phone: '',
      } as Parameters<typeof buildGoogleCalendarAddUrlForBooking>[0],
      {
        name: calendarVenueName,
        address: locationAddress,
        timezone: venueTimezone,
      } as Parameters<typeof buildGoogleCalendarAddUrlForBooking>[1],
    ),
    ics: timeStr
      ? buildIcsContent({
          venueName: calendarTitle,
          venueAddress: locationAddress,
          bookingDate: booking.booking_date,
          bookingTime: timeStr,
          partySize: booking.party_size,
          timeZone: venueTimezone,
          durationMinutes,
          // So the fallback matches the Google link's when the duration is
          // unknown: an event is three hours, an appointment is one.
          bookingModel: inferredModel,
        })
      : null,
  };

  return {
    booking_id: booking.id,
    venue_id: booking.venue_id,
    venue_name: (venue as { name?: string } | null)?.name,
    venue_address: (venue as { address?: string | null } | null)?.address,
    venue_phone: (venue as { phone?: string | null } | null)?.phone ?? null,
    booking_date: booking.booking_date,
    booking_time: timeStr,
    party_size: booking.party_size,
    deposit_paid: depositPaid,
    deposit_amount_pence: booking.deposit_amount_pence ?? null,
    card_hold,
    status: booking.status,
    booking_model: inferredModel,
    is_appointment: isAppointment,
    practitioner_id: isAppointment && practitionerIdForUi ? practitionerIdForUi : null,
    appointment_service_id: isAppointment && serviceIdForUi ? serviceIdForUi : null,
    practitioner_name,
    appointment_service_name,
    event_name,
    class_summary,
    class_type_name,
    // CDE self-reschedule (guest manage link): the slot/instance pickers need
    // the resource / class-type identity to list alternative slots. Only
    // surfaced for the relevant model so other bookings keep a lean payload.
    resource_id: inferredModel === 'resource_booking' ? bookingRow.resource_id ?? null : null,
    class_instance_id:
      inferredModel === 'class_session' ? bookingRow.class_instance_id ?? null : null,
    class_type_id: inferredModel === 'class_session' ? class_type_id : null,
    // A course is several booking rows sharing one group id. Not scoped to a
    // model on purpose: courses are class sessions today, and a guard that
    // encoded that would go quietly wrong the day they are not.
    part_of_course: Boolean(bookingRow.group_booking_id),
    resource_name,
    booking_end_time: booking_end_label,
    cancellation_deadline: bookingRow.cancellation_deadline ?? null,
    refund_notice_hours: refundNoticeHours,
    guest_attendance_confirmed_at: booking.guest_attendance_confirmed_at ?? null,
    venue_public: isAppointment ? await buildVenuePublicForBookingById(booking.venue_id) : null,
    manage_booking_url: await createOrGetBookingShortLink({
      venueId: booking.venue_id,
      bookingId: booking.id,
      purpose: 'manage',
    }),
    compliance_forms: await loadOutstandingBookingFormLinks(supabase, booking.venue_id, booking.id),
    feature_flags: { resolved: featureFlagsResolved },
    location: { type: locationType, address: locationAddress, map_url: mapUrl },
    notes,
    ticket_lines: ticketLines,
    duration_minutes: durationMinutes,
    pre_appointment_instructions: preAppointmentInstructions,
    venue_email:
      (venue as { reply_to_email?: string | null } | null)?.reply_to_email ??
      (venue as { email?: string | null } | null)?.email ??
      null,
    deposit_status: booking.deposit_status ?? null,
    cancelled_by: cancelledBy,
    timeline,
    calendar,
    paid_with_credit: paidWithCredit,
  };
}

/** Minutes between two `HH:MM[:SS]` wall-clock times, or null if unusable. */
function minutesBetweenTimes(start: string, end?: string | null): number | null {
  if (!end) return null;
  const toMinutes = (t: string): number | null => {
    const m = /^(\d{1,2}):(\d{2})/.exec(t.trim());
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  };
  const a = toMinutes(start);
  const b = toMinutes(end);
  if (a == null || b == null) return null;
  // An end before the start is a booking crossing midnight.
  const diff = b >= a ? b - a : b + 24 * 60 - a;
  return diff > 0 ? diff : null;
}
