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
  resource_name: string | null;
  booking_end_time: string | null;
  cancellation_deadline: string | null;
  refund_notice_hours: number;
  guest_attendance_confirmed_at: string | null;
  venue_public: VenuePublic | null;
  manage_booking_url: string;
  compliance_forms: Array<{ name: string; url: string }>;
  feature_flags: { resolved: ReturnType<typeof resolveAppointmentsFeatureFlags> };
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
  resource_id?: string | null;
  event_session_id?: string | null;
  guest_attendance_confirmed_at?: string | null;
}

export async function buildBookingDetailDto(
  supabase: SupabaseClient,
  booking: BookingDetailSourceRow,
): Promise<BookingDetailDto> {
  const { data: venue } = await supabase
    .from('venues')
    .select('name, address, phone, booking_model, booking_rules, email, reply_to_email, feature_flags')
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
        .select('name')
        .eq('id', bookingRow.service_item_id as string)
        .maybeSingle(),
      variantPromise,
    ]);
    practitioner_name = (uc as { name?: string } | null)?.name ?? null;
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
  };
}
