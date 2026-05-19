import { NextRequest, NextResponse, after } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { stripe } from "@/lib/stripe";
import { sendCancellationNotification } from "@/lib/communications/send-templated";
import type { BookingEmailData } from "@/lib/emails/types";
import { venueRowToEmailData } from "@/lib/emails/venue-email-data";
import { enrichBookingEmailForComms } from "@/lib/emails/booking-email-enrichment";
import {
  getCancellationNoticeHoursForBooking,
  parseExtendedBookingRules,
} from "@/lib/booking/venue-booking-rules";
import { verifyConfirmToken } from "@/lib/confirm-token";
import { createOrGetBookingShortLink } from "@/lib/booking-short-links";
import { verifyBookingHmac } from "@/lib/short-manage-link";
import {
  validateBookingStatusTransition,
  applyBookingLifecycleStatusEffects,
} from "@/lib/table-management/lifecycle";
import { computeAvailability, fetchEngineInput } from "@/lib/availability";
import { AVAILABILITY_SETUP_REQUIRED_MESSAGE } from "@/lib/availability/availability-errors";
import { resolveVenueMode } from "@/lib/venue-mode";
import {
  attachVenueClockToAppointmentInput,
  computeAppointmentAvailability,
  fetchAppointmentInput,
} from "@/lib/availability/appointment-engine";
import { mergeAppointmentServiceWithPractitionerLink } from "@/lib/appointments/merge-service-with-overrides";
import { cancellationDeadlineHoursBefore } from "@/lib/booking/cancellation-deadline";
import { isUnifiedSchedulingVenue } from "@/lib/booking/unified-scheduling";
import {
  isGuestBookingDateAllowed,
  loadServiceEntityBookingWindow,
} from "@/lib/booking/entity-booking-window";
import { resolveCancellationNoticeHoursForCreate } from "@/lib/booking/resolve-cancellation-notice-hours";
import { inferBookingRowModel } from "@/lib/booking/infer-booking-row-model";
import { logBookingOp } from "@/lib/observability/booking-ops-log";
import type { BookingModel } from "@/types/booking-models";
import { formatGuestDisplayName } from "@/lib/guests/name";
import { buildVenuePublicForBookingById } from "@/lib/booking/build-venue-public";
import {
  assertAppointmentsFeatureEnabled,
  parseVenueFeatureFlags,
  resolveAppointmentsFeatureFlags,
} from "@/lib/feature-flags";
import { guestAppointmentModifyBlockedReason } from "@/lib/booking/guest-appointment-modify-policy";
import { offerAppointmentWaitlistOnCancel } from "@/lib/booking/offer-appointment-waitlist-on-cancel";

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
        const ctId = (ci as { class_type_id?: string }).class_type_id;
        const { data: ct } = ctId
          ? await supabase
              .from("class_types")
              .select("name")
              .eq("id", ctId)
              .maybeSingle()
          : { data: null };
        const nm = (ct as { name?: string } | null)?.name ?? "Class";
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
        .from("venue_resources")
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
    const { data: booking, error: bookErr } = await supabase
      .from("bookings")
      .select(
        "id, venue_id, guest_id, booking_date, booking_time, booking_end_time, party_size, status, deposit_status, deposit_amount_pence, stripe_payment_intent_id, cancellation_deadline, confirm_token_hash, confirm_token_used_at, service_id, practitioner_id, appointment_service_id, calendar_id, service_item_id, experience_event_id, class_instance_id, resource_id, event_session_id, updated_at, guest_attendance_confirmed_at",
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

    const now = new Date().toISOString();
    const usedAt = now;

    if (action === "confirm") {
      const currentStatus = booking.status as string;
      const attendanceAlready = (
        booking as { guest_attendance_confirmed_at?: string | null }
      ).guest_attendance_confirmed_at;

      // Guests cannot confirm attendance on a booking still awaiting deposit
      // payment (`Pending`). They must complete the deposit first; once paid
      // the booking moves to `Booked` and becomes confirmable.
      if (currentStatus === "Pending") {
        return NextResponse.json(
          {
            error:
              "This booking is awaiting deposit payment. Please complete the deposit before confirming your attendance.",
          },
          { status: 400 },
        );
      }

      // Idempotent: if the booking is already in `Confirmed`, just record the
      // guest timestamp if missing — never attempt Confirmed → Confirmed.
      if (currentStatus === "Confirmed") {
        if (attendanceAlready) {
          return NextResponse.json({
            success: true,
            message:
              'Thanks. We already have your confirmation on file for this booking.',
            guest_attendance_confirmed_at: attendanceAlready,
          });
        }
        await supabase
          .from("bookings")
          .update({
            guest_attendance_confirmed_at: now,
            updated_at: now,
          })
          .eq("id", bookingId);

        return NextResponse.json({
          success: true,
          message:
            "Thanks. We've noted that you're coming. Your booking is confirmed on our side.",
          guest_attendance_confirmed_at: now,
        });
      }

      // Standard path: Booked → Confirmed (guest tapped the confirm link).
      const confirmCheck = validateBookingStatusTransition(
        currentStatus,
        "Confirmed",
      );
      if (!confirmCheck.ok) {
        return NextResponse.json(
          { error: confirmCheck.error },
          { status: 400 },
        );
      }

      const previousStatus = currentStatus;
      await supabase
        .from("bookings")
        .update({
          status: "Confirmed",
          confirm_token_used_at: usedAt,
          guest_attendance_confirmed_at: now,
          updated_at: now,
        })
        .eq("id", bookingId);

      await applyBookingLifecycleStatusEffects(supabase, {
        bookingId,
        guestId: booking.guest_id,
        previousStatus,
        nextStatus: "Confirmed",
        actorId: null,
      });

      return NextResponse.json({
        success: true,
        message: "Thanks. We've noted that you're coming. We look forward to seeing you.",
      });
    }

    if (action === "cancel") {
      const cancelCheck = validateBookingStatusTransition(
        booking.status as string,
        "Cancelled",
      );
      if (!cancelCheck.ok) {
        return NextResponse.json({ error: cancelCheck.error }, { status: 400 });
      }

      const cancelInferred = inferBookingRowModel(
        booking as {
          experience_event_id?: string | null;
          class_instance_id?: string | null;
          resource_id?: string | null;
          event_session_id?: string | null;
          calendar_id?: string | null;
          service_item_id?: string | null;
          practitioner_id?: string | null;
          appointment_service_id?: string | null;
        },
      );

      const previousStatus = booking.status as string;
      const deadline = booking.cancellation_deadline
        ? new Date(booking.cancellation_deadline)
        : null;
      const canRefund =
        deadline &&
        new Date() <= deadline &&
        booking.deposit_status === "Paid" &&
        booking.stripe_payment_intent_id;

      let refundSucceeded = false;
      if (canRefund) {
        const { data: venue } = await supabase
          .from("venues")
          .select("stripe_connected_account_id")
          .eq("id", booking.venue_id)
          .single();
        if (venue?.stripe_connected_account_id) {
          try {
            await stripe.refunds.create(
              { payment_intent: booking.stripe_payment_intent_id },
              { stripeAccount: venue.stripe_connected_account_id },
            );
            refundSucceeded = true;
          } catch (refundErr) {
            logBookingOp({
              operation: "refund_failed",
              venue_id: booking.venue_id as string,
              booking_id: bookingId,
              booking_model: cancelInferred,
              error:
                refundErr instanceof Error
                  ? refundErr.message
                  : String(refundErr),
            });
          }
        }
      }

      await supabase
        .from("bookings")
        .update({
          status: "Cancelled",
          deposit_status: refundSucceeded ? "Refunded" : booking.deposit_status,
          confirm_token_used_at: usedAt,
          cancelled_by_staff_id: null,
          cancellation_actor_type: "customer",
          updated_at: now,
        })
        .eq("id", bookingId);

      await applyBookingLifecycleStatusEffects(supabase, {
        bookingId,
        guestId: booking.guest_id,
        previousStatus,
        nextStatus: "Cancelled",
        actorId: null,
      });

      const { data: venue } = await supabase
        .from("venues")
        .select("name, address, phone, booking_rules, email, reply_to_email")
        .eq("id", booking.venue_id)
        .single();
      const { data: guest } = await supabase
        .from("guests")
        .select("first_name, last_name, email, phone")
        .eq("id", booking.guest_id)
        .single();
      const timeStr =
        typeof booking.booking_time === "string"
          ? booking.booking_time.slice(0, 5)
          : "";

      const depositAmountStr = booking.deposit_amount_pence
        ? `\u00A3${(booking.deposit_amount_pence / 100).toFixed(2)}`
        : null;

      const cancelRules = parseExtendedBookingRules(venue?.booking_rules);
      const refundWindowHoursDisplay = getCancellationNoticeHoursForBooking(
        cancelRules,
        cancelInferred,
        48,
      );

      let refund_message: string;
      if (refundSucceeded) {
        refund_message = `Your deposit of ${depositAmountStr} will be refunded to your original payment method within 5-10 business days.`;
      } else if (booking.deposit_status === "Paid" && !canRefund) {
        refund_message = `Your deposit of ${depositAmountStr} is non-refundable as the cancellation was made less than ${refundWindowHoursDisplay} hours before the start of your booking.`;
      } else if (
        booking.deposit_status === "Paid" &&
        canRefund &&
        !refundSucceeded
      ) {
        refund_message = `We were unable to process your refund automatically. Please contact the venue directly to arrange your refund of ${depositAmountStr}.`;
      } else {
        refund_message = "";
      }

      if (guest && venue?.name) {
        const cancelBookingEmail: BookingEmailData = {
          id: bookingId,
          guest_name: formatGuestDisplayName(guest.first_name, guest.last_name),
          guest_email: guest.email ?? null,
          guest_phone: guest.phone ?? null,
          booking_date: booking.booking_date,
          booking_time: timeStr,
          party_size: booking.party_size,
          deposit_amount_pence: booking.deposit_amount_pence ?? null,
          deposit_status: booking.deposit_status ?? null,
        };
        const cancelVenueEmail = venueRowToEmailData({
          name: venue.name,
          address: venue.address ?? null,
          phone: venue.phone ?? null,
          email: venue.email ?? null,
          reply_to_email: venue.reply_to_email ?? null,
        });
        const vid = booking.venue_id;
        const refundMsg = refund_message || null;
        const cancelledBookingForWaitlist = {
          id: bookingId,
          venue_id: booking.venue_id as string,
          booking_date: String(booking.booking_date),
          booking_time: String(booking.booking_time),
          practitioner_id: booking.practitioner_id as string | null | undefined,
          calendar_id: booking.calendar_id as string | null | undefined,
          appointment_service_id: booking.appointment_service_id as string | null | undefined,
          service_item_id: booking.service_item_id as string | null | undefined,
          experience_event_id: booking.experience_event_id as string | null | undefined,
          class_instance_id: booking.class_instance_id as string | null | undefined,
          resource_id: booking.resource_id as string | null | undefined,
          event_session_id: booking.event_session_id as string | null | undefined,
        };
        after(async () => {
          try {
            const enriched = await enrichBookingEmailForComms(
              supabase,
              bookingId,
              cancelBookingEmail,
            );
            await sendCancellationNotification(
              enriched,
              cancelVenueEmail,
              vid,
              refundMsg,
            );
          } catch (commsErr) {
            console.error("Cancellation confirmation comms failed:", commsErr);
          }
          try {
            const offerResult = await offerAppointmentWaitlistOnCancel(
              supabase,
              cancelledBookingForWaitlist,
            );
            if (offerResult.offered) {
              console.info("[confirm cancel] waitlist offer sent", {
                bookingId,
                waitlistEntryId: offerResult.waitlistEntryId,
              });
            }
          } catch (waitlistErr) {
            console.error("[confirm cancel] waitlist offer failed:", waitlistErr, {
              bookingId,
            });
          }
        });
      }

      logBookingOp({
        operation: "cancel",
        venue_id: booking.venue_id as string,
        booking_id: bookingId,
        booking_model: cancelInferred,
      });

      return NextResponse.json({
        success: true,
        message: refundSucceeded
          ? "Booking cancelled. Your deposit will be refunded."
          : "Booking cancelled.",
        refund_message,
        refund_eligible: refundSucceeded,
        deposit_amount_str: depositAmountStr,
      });
    }

    if (action === "modify") {
      const modifiableStatuses = ["Booked", "Confirmed", "Pending"];
      if (!modifiableStatuses.includes(booking.status as string)) {
        return NextResponse.json(
          { error: "This booking cannot be modified." },
          { status: 400 },
        );
      }

      const venueMode = await resolveVenueMode(supabase, booking.venue_id);

      const currentBookingModel = inferBookingRowModel(
        booking as {
          experience_event_id?: string | null;
          class_instance_id?: string | null;
          resource_id?: string | null;
          event_session_id?: string | null;
          calendar_id?: string | null;
          service_item_id?: string | null;
          practitioner_id?: string | null;
          appointment_service_id?: string | null;
        },
      );
      const isAppointmentBooking =
        currentBookingModel === "unified_scheduling" ||
        currentBookingModel === "practitioner_appointment";

      if (isAppointmentBooking) {
        const { data: venueFlagsRow } = await supabase
          .from("venues")
          .select("feature_flags, timezone, booking_rules")
          .eq("id", booking.venue_id)
          .single();
        const venueFlags = parseVenueFeatureFlags(
          (venueFlagsRow as { feature_flags?: unknown } | null)?.feature_flags,
        );
        try {
          assertAppointmentsFeatureEnabled("guest_self_reschedule", venueFlags);
        } catch {
          return NextResponse.json(
            {
              error: "Online appointment changes are not available for this venue.",
              code: "feature_disabled",
              feature: "guest_self_reschedule",
            },
            { status: 403 },
          );
        }

        const rulesParsed = parseExtendedBookingRules(
          (venueFlagsRow as { booking_rules?: unknown } | null)?.booking_rules,
        );
        const modifyNoticeHours = getCancellationNoticeHoursForBooking(
          rulesParsed,
          currentBookingModel,
          48,
        );
        const venueTzForModify =
          typeof (venueFlagsRow as { timezone?: string | null } | null)?.timezone ===
            "string" &&
          String(
            (venueFlagsRow as { timezone?: string | null }).timezone,
          ).trim() !== ""
            ? String(
                (venueFlagsRow as { timezone?: string | null }).timezone,
              ).trim()
            : "Europe/London";
        const currentTimeStr =
          typeof booking.booking_time === "string"
            ? booking.booking_time.slice(0, 5)
            : "";
        const modifyBlocked = guestAppointmentModifyBlockedReason({
          bookingDate: String(booking.booking_date),
          bookingTime: currentTimeStr,
          venueTimezone: venueTzForModify,
          modifyNoticeHours,
        });
        if (modifyBlocked) {
          return NextResponse.json({ error: modifyBlocked }, { status: 400 });
        }

        if (
          !booking_date ||
          !booking_time ||
          !bodyPractitionerId ||
          !bodyAppointmentServiceId
        ) {
          return NextResponse.json(
            {
              error:
                "booking_date, booking_time, practitioner_id, and appointment_service_id are required for appointment changes.",
            },
            { status: 400 },
          );
        }

        const newDate = booking_date;
        const newTimeRaw = booking_time;
        const newTime =
          newTimeRaw.length === 5 ? newTimeRaw + ":00" : newTimeRaw;
        const timeStr = newTime.slice(0, 5);
        const newPartySize = Number(party_size ?? booking.party_size);
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(newDate) ||
          newPartySize < 1 ||
          newPartySize > 50
        ) {
          return NextResponse.json(
            { error: "Invalid date or party size." },
            { status: 400 },
          );
        }

        const { data: venueAppt } = await supabase
          .from("venues")
          .select(
            "timezone, booking_rules, opening_hours, venue_opening_exceptions",
          )
          .eq("id", booking.venue_id)
          .single();

        const effectiveBookingModel =
          currentBookingModel === "practitioner_appointment"
            ? "practitioner_appointment"
            : venueMode.bookingModel;
        const svcWindow = await loadServiceEntityBookingWindow(
          supabase,
          booking.venue_id,
          effectiveBookingModel,
          bodyAppointmentServiceId,
        );
        const tz =
          typeof (venueAppt as { timezone?: string | null } | null)
            ?.timezone === "string" &&
          String(
            (venueAppt as { timezone?: string | null }).timezone,
          ).trim() !== ""
            ? String(
                (venueAppt as { timezone?: string | null }).timezone,
              ).trim()
            : "Europe/London";
        if (!isGuestBookingDateAllowed(newDate, svcWindow, tz)) {
          return NextResponse.json(
            { error: "This date is not available for booking" },
            { status: 400 },
          );
        }

        const input = await fetchAppointmentInput({
          supabase,
          venueId: booking.venue_id,
          date: newDate,
          practitionerId: bodyPractitionerId,
          serviceId: bodyAppointmentServiceId,
        });
        input.existingBookings = input.existingBookings.filter(
          (b) => b.id !== bookingId,
        );
        attachVenueClockToAppointmentInput(input, venueAppt ?? {}, svcWindow);
        const result = computeAppointmentAvailability(input);
        const prac = result.practitioners.find(
          (p) => p.id === bodyPractitionerId,
        );
        const slotAvailable = prac?.slots.some(
          (s) =>
            s.start_time === timeStr &&
            s.service_id === bodyAppointmentServiceId,
        );
        if (!slotAvailable) {
          return NextResponse.json(
            {
              error:
                "This appointment slot is no longer available. Please choose another time or service.",
            },
            { status: 409 },
          );
        }

        const baseSvc = input.services.find(
          (s) => s.id === bodyAppointmentServiceId,
        );
        const ps = input.practitionerServices.find(
          (row) =>
            row.practitioner_id === bodyPractitionerId &&
            row.service_id === bodyAppointmentServiceId,
        );
        const svc = baseSvc
          ? mergeAppointmentServiceWithPractitionerLink(baseSvc, ps)
          : undefined;

        let estimatedEndTime: string | null = null;
        if (svc) {
          const [y, mo, d] = newDate.split("-").map(Number);
          const [hh, mm] = timeStr.split(":").map(Number);
          const endDate = new Date(Date.UTC(y!, mo! - 1, d!, hh!, mm!, 0));
          endDate.setMinutes(endDate.getMinutes() + svc.duration_minutes);
          estimatedEndTime = endDate.toISOString();
        }

        const refundWindowHours = await resolveCancellationNoticeHoursForCreate(
          {
            supabase,
            venueId: booking.venue_id,
            effectiveModel: effectiveBookingModel,
            ...(effectiveBookingModel === "unified_scheduling"
              ? { serviceItemId: bodyAppointmentServiceId }
              : { appointmentServiceId: bodyAppointmentServiceId }),
          },
        );
        const cancellation_deadline = cancellationDeadlineHoursBefore(
          newDate,
          newTime,
          refundWindowHours,
        );
        const cancellation_policy_snapshot = {
          refund_window_hours: refundWindowHours,
          policy: `Full refund if cancelled ${refundWindowHours}+ hours before appointment start. No refund within ${refundWindowHours} hours of the appointment or for no-shows.`,
        };

        const nowIso = new Date().toISOString();
        const prevUpdatedAt = booking.updated_at as string;
        const { data: apptUpdated, error: apptUpdErr } = await supabase
          .from("bookings")
          .update({
            booking_date: newDate,
            booking_time: newTime,
            party_size: newPartySize,
            ...(currentBookingModel === "unified_scheduling"
              ? {
                  calendar_id: bodyPractitionerId,
                  service_item_id: bodyAppointmentServiceId,
                  practitioner_id: null,
                  appointment_service_id: null,
                }
              : {
                  practitioner_id: bodyPractitionerId,
                  appointment_service_id: bodyAppointmentServiceId,
                  calendar_id: null,
                  service_item_id: null,
                }),
            estimated_end_time: estimatedEndTime,
            cancellation_deadline,
            cancellation_policy_snapshot,
            updated_at: nowIso,
          })
          .eq("id", bookingId)
          .eq("updated_at", prevUpdatedAt)
          .select("id")
          .maybeSingle();

        if (apptUpdErr) {
          console.error(
            "confirm modify (appointment) update failed:",
            apptUpdErr,
          );
          return NextResponse.json(
            { error: "Failed to update booking." },
            { status: 500 },
          );
        }
        if (!apptUpdated) {
          return NextResponse.json(
            {
              error:
                "This booking was updated elsewhere. Refresh the page and try again.",
            },
            { status: 412 },
          );
        }

        const { logBookingModifiedEvent } = await import(
          "@/lib/booking/log-booking-modified-event"
        );
        const apptBeforeTime =
          typeof booking.booking_time === "string"
            ? booking.booking_time.slice(0, 5)
            : "";
        await logBookingModifiedEvent(supabase, {
          venue_id: booking.venue_id as string,
          booking_id: bookingId,
          modification_actor: "guest",
          before: {
            booking_date: String(booking.booking_date),
            booking_time: apptBeforeTime,
            party_size: Number(booking.party_size),
          },
          after: {
            booking_date: newDate,
            booking_time: timeStr,
            party_size: newPartySize,
          },
        });

        after(async () => {
          try {
            const { executeBookingModificationGuestNotification } = await import(
              "@/lib/booking/send-booking-modification-guest-notification"
            );
            await executeBookingModificationGuestNotification(
              supabase,
              booking.venue_id,
              bookingId,
            );
          } catch (commsErr) {
            console.error(
              "Self-service appointment modification notification failed:",
              commsErr,
            );
          }
        });

        return NextResponse.json({
          success: true,
          message: "Your appointment has been updated.",
          booking_date: newDate,
          booking_time: timeStr,
          party_size: newPartySize,
          practitioner_id: bodyPractitionerId,
          appointment_service_id: bodyAppointmentServiceId,
        });
      }

      if (!booking_date || !booking_time || party_size == null) {
        return NextResponse.json(
          {
            error:
              "booking_date, booking_time and party_size are required for modification.",
          },
          { status: 400 },
        );
      }

      const newDate = booking_date;
      const newTimeRaw = booking_time;
      const newTime = newTimeRaw.length === 5 ? newTimeRaw + ":00" : newTimeRaw;
      const newPartySize = Number(party_size);

      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(newDate) ||
        newPartySize < 1 ||
        newPartySize > 50
      ) {
        return NextResponse.json(
          { error: "Invalid date or party size." },
          { status: 400 },
        );
      }

      const timeStr = newTime.slice(0, 5);

      if (venueMode.availabilityEngine !== "service") {
        return NextResponse.json(
          { error: AVAILABILITY_SETUP_REQUIRED_MESSAGE },
          { status: 503 },
        );
      }

      const engineInput = await fetchEngineInput({
        supabase,
        venueId: booking.venue_id,
        date: newDate,
        partySize: newPartySize,
      });
      engineInput.bookings = engineInput.bookings.filter(
        (b) => b.id !== bookingId,
      );

      const results = computeAvailability(engineInput);
      const allSlots = results.flatMap((r) => r.slots);
      const largeParty = results.some((r) => r.large_party_redirect);
      const largePartyMsg = results.find(
        (r) => r.large_party_message,
      )?.large_party_message;

      if (largeParty) {
        return NextResponse.json(
          {
            error:
              largePartyMsg ??
              "For parties of this size, please call the restaurant directly.",
          },
          { status: 400 },
        );
      }

      const slot = allSlots.find(
        (s) =>
          s.start_time === timeStr &&
          (!booking.service_id || s.service_id === booking.service_id),
      );
      if (!slot || slot.available_covers < newPartySize) {
        return NextResponse.json(
          {
            error:
              "The selected date/time is not available for this party size.",
          },
          { status: 409 },
        );
      }

      const now = new Date().toISOString();
      const prevUpdatedAt = booking.updated_at as string;
      const { data: tableUpdated, error: tableUpdErr } = await supabase
        .from("bookings")
        .update({
          booking_date: newDate,
          booking_time: newTime,
          party_size: newPartySize,
          updated_at: now,
        })
        .eq("id", bookingId)
        .eq("updated_at", prevUpdatedAt)
        .select("id")
        .maybeSingle();

      if (tableUpdErr) {
        console.error("confirm modify (table) update failed:", tableUpdErr);
        return NextResponse.json(
          { error: "Failed to update booking." },
          { status: 500 },
        );
      }
      if (!tableUpdated) {
        return NextResponse.json(
          {
            error:
              "This booking was updated elsewhere. Refresh the page and try again.",
          },
          { status: 412 },
        );
      }

      const { logBookingModifiedEvent: logTableModified } = await import(
        "@/lib/booking/log-booking-modified-event"
      );
      const tableBeforeTime =
        typeof booking.booking_time === "string"
          ? booking.booking_time.slice(0, 5)
          : "";
      await logTableModified(supabase, {
        venue_id: booking.venue_id as string,
        booking_id: bookingId,
        modification_actor: "guest",
        before: {
          booking_date: String(booking.booking_date),
          booking_time: tableBeforeTime,
          party_size: Number(booking.party_size),
        },
        after: {
          booking_date: newDate,
          booking_time: timeStr,
          party_size: newPartySize,
        },
      });

      after(async () => {
        try {
          const { executeBookingModificationGuestNotification } = await import(
            "@/lib/booking/send-booking-modification-guest-notification"
          );
          await executeBookingModificationGuestNotification(
            supabase,
            booking.venue_id,
            bookingId,
          );
        } catch (commsErr) {
          console.error(
            "Self-service booking modification notification failed:",
            commsErr,
          );
        }
      });

      return NextResponse.json({
        success: true,
        message: "Your booking has been updated.",
        booking_date: newDate,
        booking_time: timeStr,
        party_size: newPartySize,
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    console.error("POST /api/confirm failed:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
