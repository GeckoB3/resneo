import { NextRequest, NextResponse, after } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { loadOutstandingBookingFormLinks } from "@/lib/compliance/form-links-service";
import {
  getCancellationNoticeHoursForBooking,
  parseExtendedBookingRules,
} from "@/lib/booking/venue-booking-rules";
import { verifyConfirmToken } from "@/lib/confirm-token";
import { confirmAttendanceForGuest } from "@/lib/booking/guest-actions/confirm-attendance";
import { cancelBookingForGuest } from "@/lib/booking/guest-actions/cancel";
import { rescheduleBookingForGuest } from "@/lib/booking/guest-actions/reschedule";
import type { GuestActionActor, GuestActionResult } from "@/lib/booking/guest-actions/types";
import {
  createOrGetBookingShortLink,
  createOrGetPaymentShortLink,
} from "@/lib/booking-short-links";
import {
  deriveGuestCardHoldSummary,
  type GuestCardHoldRowInput,
  type GuestCardHoldSummary,
} from "@/lib/booking/guest-card-hold-summary";
import { verifyBookingHmac } from "@/lib/short-manage-link";
import { isUnifiedSchedulingVenue } from "@/lib/booking/unified-scheduling";
import { inferBookingRowModel } from "@/lib/booking/infer-booking-row-model";
import type { BookingModel } from "@/types/booking-models";
import { buildVenuePublicForBookingById } from "@/lib/booking/build-venue-public";
import {
  parseVenueFeatureFlags,
  resolveAppointmentsFeatureFlags,
} from "@/lib/feature-flags";

/**
 * GET /api/confirm?booking_id=uuid&token=xxx  (token-based)
 * GET /api/confirm?booking_id=uuid&hmac=xxx   (HMAC-based, used by /m/ short links)
 * Returns booking details for confirm-or-cancel page if auth is valid.
 */
export async function GET(request: NextRequest) {
  try {
    const bookingId = request.nextUrl.searchParams.get("booking_id");
    const token = request.nextUrl.searchParams.get("token");
    const hmac = request.nextUrl.searchParams.get("hmac");
    if (!bookingId || (!token && !hmac)) {
      return NextResponse.json(
        { error: "Missing booking_id or auth" },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdminClient();
    const { data: booking, error: bookErr } = await supabase
      .from("bookings")
      .select(
        "id, venue_id, guest_id, booking_date, booking_time, booking_end_time, party_size, status, deposit_status, deposit_amount_pence, stripe_payment_intent_id, cancellation_deadline, confirm_token_hash, confirm_token_used_at, practitioner_id, appointment_service_id, calendar_id, service_item_id, service_variant_id, experience_event_id, class_instance_id, resource_id, event_session_id, updated_at, guest_attendance_confirmed_at",
      )
      .eq("id", bookingId)
      .single();

    if (bookErr || !booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    if (hmac) {
      if (!verifyBookingHmac(bookingId, hmac)) {
        return NextResponse.json({ error: "Invalid link" }, { status: 400 });
      }
    } else if (token) {
      if (booking.confirm_token_used_at) {
        return NextResponse.json(
          { error: "This link has already been used" },
          { status: 410 },
        );
      }
      if (!verifyConfirmToken(token, booking.confirm_token_hash)) {
        return NextResponse.json({ error: "Invalid link" }, { status: 400 });
      }
    }

    const { data: venue } = await supabase
      .from("venues")
      .select("name, address, phone, booking_model, booking_rules, email, reply_to_email, feature_flags")
      .eq("id", booking.venue_id)
      .single();
    const depositPaid = booking.deposit_status === "Paid";
    const timeStr =
      typeof booking.booking_time === "string"
        ? booking.booking_time.slice(0, 5)
        : "";

    let practitioner_name: string | null = null;
    let appointment_service_name: string | null = null;

    const bookingRow = booking as {
      practitioner_id?: string | null;
      appointment_service_id?: string | null;
      calendar_id?: string | null;
      service_item_id?: string | null;
      service_variant_id?: string | null;
      experience_event_id?: string | null;
      class_instance_id?: string | null;
      resource_id?: string | null;
      booking_end_time?: string | null;
      event_session_id?: string | null;
      cancellation_deadline?: string | null;
    };
    const inferredModel: BookingModel = inferBookingRowModel(bookingRow);
    const unifiedVenue = isUnifiedSchedulingVenue(venue?.booking_model);
    const legacyAppt = Boolean(
      bookingRow.practitioner_id && bookingRow.appointment_service_id,
    );
    const unifiedAppt = Boolean(
      unifiedVenue && bookingRow.calendar_id && bookingRow.service_item_id,
    );
    const isAppointment = legacyAppt || unifiedAppt;

    let event_name: string | null = null;
    let class_summary: string | null = null;
    let class_type_id: string | null = null;
    let class_type_name: string | null = null;
    let resource_name: string | null = null;
    let booking_end_label: string | null = null;

    if (bookingRow.experience_event_id) {
      const { data: ev } = await supabase
        .from("experience_events")
        .select("name")
        .eq("id", bookingRow.experience_event_id)
        .maybeSingle();
      event_name = (ev as { name?: string } | null)?.name ?? null;
    }
    if (bookingRow.class_instance_id) {
      const { data: ci } = await supabase
        .from("class_instances")
        .select("instance_date, start_time, class_type_id")
        .eq("id", bookingRow.class_instance_id)
        .maybeSingle();
      if (ci) {
        const ctId = (ci as { class_type_id?: string }).class_type_id ?? null;
        class_type_id = ctId;
        const { data: ct } = ctId
          ? await supabase
              .from("class_types")
              .select("name")
              .eq("id", ctId)
              .maybeSingle()
          : { data: null };
        const nm = (ct as { name?: string } | null)?.name ?? "Class";
        class_type_name = (ct as { name?: string } | null)?.name ?? null;
        const d = String(
          (ci as { instance_date?: string }).instance_date ?? "",
        );
        const st = String(
          (ci as { start_time?: string }).start_time ?? "",
        ).slice(0, 5);
        class_summary = `${nm} · ${d} ${st}`;
      }
    }
    if (bookingRow.resource_id) {
      const { data: vr } = await supabase
        .from("unified_calendars")
        .select("name")
        .eq("id", bookingRow.resource_id)
        .maybeSingle();
      resource_name = (vr as { name?: string } | null)?.name ?? null;
    }
    if (bookingRow.booking_end_time) {
      booking_end_label = String(bookingRow.booking_end_time).slice(0, 5);
    }

    const variantPromise = bookingRow.service_variant_id
      ? supabase
          .from("service_variants")
          .select("name")
          .eq("id", bookingRow.service_variant_id)
          .maybeSingle()
      : Promise.resolve({ data: null });

    if (unifiedAppt) {
      const [{ data: uc }, { data: si }, { data: variant }] = await Promise.all([
        supabase
          .from("unified_calendars")
          .select("name")
          .eq("id", bookingRow.calendar_id as string)
          .maybeSingle(),
        supabase
          .from("service_items")
          .select("name")
          .eq("id", bookingRow.service_item_id as string)
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
          .from("practitioners")
          .select("name")
          .eq("id", bookingRow.practitioner_id as string)
          .maybeSingle(),
        supabase
          .from("appointment_services")
          .select("name")
          .eq("id", bookingRow.appointment_service_id as string)
          .maybeSingle(),
        variantPromise,
      ]);
      practitioner_name = pr?.name ?? null;
      const baseName = (svc as { name?: string } | null)?.name ?? null;
      const variantName = (variant as { name?: string } | null)?.name ?? null;
      appointment_service_name =
        baseName && variantName ? `${baseName} - ${variantName}` : baseName ?? variantName;
    }

    const practitionerIdForUi = (bookingRow.practitioner_id ??
      bookingRow.calendar_id) as string | null | undefined;
    const serviceIdForUi = (bookingRow.appointment_service_id ??
      bookingRow.service_item_id) as string | null | undefined;

    const rulesParsed = parseExtendedBookingRules(venue?.booking_rules);
    const refundNoticeHours = getCancellationNoticeHoursForBooking(
      rulesParsed,
      inferredModel,
      48,
    );

    const venueFlags = parseVenueFeatureFlags(
      (venue as { feature_flags?: unknown } | null)?.feature_flags,
    );
    const featureFlagsResolved = resolveAppointmentsFeatureFlags(venueFlags);

    // Guest-safe card-hold summary (card_hold deposits §10.1): fee + derived
    // state only, never Stripe ids or the terms snapshot. For an unsaved hold
    // (`awaiting_card`, staff link flow pre-save) also include the payment
    // link so the manage page can offer "Add card details".
    let card_hold: (GuestCardHoldSummary & { payment_link?: string }) | null =
      null;
    {
      const { data: holdRow } = await supabase
        .from("booking_card_holds")
        .select(
          "fee_pence, released_at, charged_pence, charged_at, stripe_payment_method_id",
        )
        .eq("booking_id", booking.id)
        .maybeSingle();
      const summary = deriveGuestCardHoldSummary(
        booking as { deposit_status?: string | null },
        (holdRow as GuestCardHoldRowInput | null) ?? null,
      );
      if (summary) {
        card_hold = summary;
        if (summary.state === "awaiting_card") {
          try {
            card_hold = {
              ...summary,
              payment_link: await createOrGetPaymentShortLink(
                booking.venue_id,
                booking.id,
              ),
            };
          } catch (linkErr) {
            console.error("[confirm GET] payment short link failed:", linkErr);
          }
        }
      }
    }

    return NextResponse.json({
      booking_id: booking.id,
      venue_id: booking.venue_id,
      venue_name: venue?.name,
      venue_address: venue?.address,
      venue_phone: venue?.phone ?? null,
      booking_date: booking.booking_date,
      booking_time: timeStr,
      party_size: booking.party_size,
      deposit_paid: depositPaid,
      deposit_amount_pence: booking.deposit_amount_pence,
      card_hold,
      status: booking.status,
      booking_model: inferredModel,
      is_appointment: isAppointment,
      practitioner_id:
        isAppointment && practitionerIdForUi ? practitionerIdForUi : null,
      appointment_service_id:
        isAppointment && serviceIdForUi ? serviceIdForUi : null,
      practitioner_name,
      appointment_service_name,
      event_name,
      class_summary,
      class_type_name,
      // CDE self-reschedule (guest manage link): the slot/instance pickers need
      // the resource / class-type identity to list alternative slots. Only
      // surfaced for the relevant model so other bookings keep a lean payload.
      resource_id: inferredModel === "resource_booking" ? bookingRow.resource_id ?? null : null,
      class_instance_id:
        inferredModel === "class_session" ? bookingRow.class_instance_id ?? null : null,
      class_type_id: inferredModel === "class_session" ? class_type_id : null,
      resource_name,
      booking_end_time: booking_end_label,
      cancellation_deadline: bookingRow.cancellation_deadline ?? null,
      refund_notice_hours: refundNoticeHours,
      guest_attendance_confirmed_at:
        (booking as { guest_attendance_confirmed_at?: string | null })
          .guest_attendance_confirmed_at ?? null,
      venue_public: isAppointment
        ? await buildVenuePublicForBookingById(booking.venue_id)
        : null,
      manage_booking_url: await createOrGetBookingShortLink({
        venueId: booking.venue_id,
        bookingId: booking.id,
        purpose: "manage",
      }),
      compliance_forms: await loadOutstandingBookingFormLinks(supabase, booking.venue_id, booking.id),
      feature_flags: { resolved: featureFlagsResolved },
    });
  } catch (err) {
    console.error("GET /api/confirm failed:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/confirm — action: confirm | cancel | modify
 * Body: { booking_id, token, action }.
 * Confirm: only valid when the booking is `Booked` (or already `Confirmed` —
 *   idempotent). Pending bookings (awaiting deposit) are blocked. Sets status
 *   to Confirmed, records guest_attendance_confirmed_at, marks token used.
 * Cancel: set status Cancelled; if before cancellation_deadline trigger refund
 *   and set deposit_status Refunded; set confirm_token_used_at; send
 *   cancellation_confirmation.
 * Modify: change date/time/party for a Booked or Confirmed booking.
 */
/**
 * The one place a guest action result becomes an HTTP response (AD1, P0-4).
 *
 * The service layer returns `{ ok, code, message, status }` and never a
 * Response, because a service that returns a Response can only be called over
 * HTTP, which is how `DELETE /api/v1/me/bookings/[id]` ended up POSTing to this
 * route with a self-minted HMAC.
 *
 * `code` is DELIBERATELY NOT serialised here. P0-9 froze these bodies and the
 * gate for this task is zero modified snapshots, so `/api/confirm` keeps
 * returning exactly `{ error }`. New consumers read `code` off the result
 * directly, which is where it is useful; adding it to this route's bodies is a
 * separate, reviewable change.
 */
function guestActionResponse<T>(result: GuestActionResult<T>): NextResponse {
  if (result.ok) return NextResponse.json(result.data as Record<string, unknown>);
  return NextResponse.json(
    { error: result.message, ...(result.extra ?? {}) },
    { status: result.status },
  );
}

/** Schedule whatever the service deferred, on the adapter's side of the boundary. */
function scheduleGuestActionEffects<T>(result: GuestActionResult<T>): void {
  const schedule = result.scheduleNotification;
  if (schedule) after(schedule);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      booking_id: bookingId,
      token,
      hmac,
      action,
      booking_date,
      booking_time,
      party_size,
      practitioner_id: bodyPractitionerId,
      appointment_service_id: bodyAppointmentServiceId,
      duration_minutes: bodyDurationMinutes,
      booking_end_time: bodyBookingEndTime,
      target_class_instance_id: bodyTargetClassInstanceId,
    } = body as {
      booking_id?: string;
      token?: string;
      hmac?: string;
      action?: string;
      booking_date?: string;
      booking_time?: string;
      party_size?: number;
      practitioner_id?: string;
      appointment_service_id?: string;
      duration_minutes?: number | null;
      booking_end_time?: string | null;
      target_class_instance_id?: string;
    };

    if (
      !bookingId ||
      (!token && !hmac) ||
      (action !== "confirm" && action !== "cancel" && action !== "modify")
    ) {
      return NextResponse.json(
        { error: "Missing or invalid body" },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdminClient();

    // Token and HMAC actors only on this route. A session actor never arrives
    // here: the portal calls the service directly rather than laundering a
    // session into an HMAC, which is the whole point of AD1.
    const actor: GuestActionActor = hmac
      ? { kind: "hmac", hmac }
      : { kind: "token", token: token as string };

    if (action === "confirm") {
      const result = await confirmAttendanceForGuest(
        { admin: supabase, session: null },
        { bookingId, actor },
      );
      scheduleGuestActionEffects(result);
      return guestActionResponse(result);
    }

    if (action === "cancel") {
      const result = await cancelBookingForGuest(
        { admin: supabase, session: null },
        { bookingId, actor },
      );
      scheduleGuestActionEffects(result);
      return guestActionResponse(result);
    }

    if (action === "modify") {
      const result = await rescheduleBookingForGuest(
        { admin: supabase, session: null },
        {
          bookingId,
          actor,
          changes: {
            booking_date,
            booking_time,
            party_size,
            practitioner_id: bodyPractitionerId,
            appointment_service_id: bodyAppointmentServiceId,
            duration_minutes: bodyDurationMinutes,
            booking_end_time: bodyBookingEndTime,
            target_class_instance_id: bodyTargetClassInstanceId,
          },
        },
      );
      scheduleGuestActionEffects(result);
      return guestActionResponse(result);
    }

    // Unreachable: the guard above admits only the three actions, and each
    // returns. Kept so the handler has a total return rather than relying on
    // that guard staying exhaustive, and because a silent `undefined` here
    // would surface as a 500 with no clue why.
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    console.error("POST /api/confirm failed:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
