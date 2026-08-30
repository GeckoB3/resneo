import { enforceBookingCompliance } from "@/lib/compliance/enforce-booking";
import { rescheduleBookingComplianceRecords } from "@/lib/compliance/records-service";
import { resolveRescheduleCancellationDeadline } from "@/lib/booking/reschedule-cancellation-deadline";
import { computeAvailability, fetchEngineInput } from "@/lib/availability";
import { AVAILABILITY_SETUP_REQUIRED_MESSAGE } from "@/lib/availability/availability-errors";
import { resolveVenueMode } from "@/lib/venue-mode";
import {
  attachVenueClockToAppointmentInput,
  computeAppointmentAvailability,
  fetchAppointmentInput,
} from "@/lib/availability/appointment-engine";
import { mergeAppointmentServiceWithPractitionerLink } from "@/lib/appointments/merge-service-with-overrides";
import { applyReservedDurationToInput } from "@/lib/appointments/reserved-appointment-duration";
import {
  createAppointmentSlotRecheck,
  SLOT_TAKEN_RESPONSE,
} from "@/lib/booking/revalidate-appointment-slot";
import { cancellationDeadlineHoursBefore } from "@/lib/booking/cancellation-deadline";
import { bookingEndFieldsForStorage } from "@/lib/booking/booking-end-time";
import { loadActiveVariantForService } from "@/lib/venue/service-variants";
import { snapshotProcessingTimeBlocksFromCatalog } from "@/lib/appointments/processing-time";
import {
  isGuestBookingDateAllowed,
  loadServiceEntityBookingWindow,
} from "@/lib/booking/entity-booking-window";
import { resolveCancellationNoticeHoursForCreate } from "@/lib/booking/resolve-cancellation-notice-hours";
import { inferBookingRowModel } from "@/lib/booking/infer-booking-row-model";
import {
  assertAppointmentsFeatureEnabled,
  parseVenueFeatureFlags,
} from "@/lib/feature-flags";
import { validateResourceBookingModification } from "@/lib/booking/validate-resource-booking-modification";
import { validateClassModification } from "@/lib/booking/validate-class-modification";
import { loadAndAuthoriseGuestBooking } from "./authorise";
import type { ApiErrorCode } from "@/lib/api/error-codes";
import {
  jsonActionResult,
  type GuestActionActor,
  type GuestActionClients,
  type GuestActionResult,
} from "./types";

/**
 * A guest rescheduling their own booking (AD1, extracted from `/api/confirm`).
 *
 * LIFTED, NOT REWRITTEN. This was 1,085 lines with 37 `NextResponse.json`
 * returns woven through four model-specific branches (appointment, resource,
 * class, table) and two availability engines. Every line below came out of the
 * route unchanged except for the return shape and the four deferred comms
 * blocks. P0-9's 21 modify snapshots are the gate.
 *
 * THE TOKEN IS DELIBERATELY NOT CONSUMED HERE. `confirm` and `cancel` stamp
 * `confirm_token_used_at`; this path does not, so a guest who reschedules can
 * still cancel from the same email link. `reschedule-cancellation-deadline.ts`
 * records the same rule. A session actor must not consume it either: a customer
 * may act on the same booking twice from the portal.
 */

/**
 * The statuses a booking can be moved from.
 *
 * Exported because `reschedule-options.ts` has to answer "can this be moved"
 * without attempting the move, and a second copy of this list is a promise the
 * two surfaces would eventually break in opposite directions: the options
 * endpoint offering a reschedule the POST refuses, or hiding one it would have
 * allowed. There is no per-booking modify window in the platform; this list and
 * the `guest_self_reschedule` venue flag are the whole gate.
 */
export const RESCHEDULE_MODIFIABLE_STATUSES: readonly string[] = [
  "Booked",
  "Confirmed",
  "Pending",
];

/** Whatever the caller wants changed. Names follow the route's request body. */
export interface RescheduleRequest {
  booking_date?: string;
  booking_time?: string;
  party_size?: number;
  practitioner_id?: string;
  appointment_service_id?: string;
  duration_minutes?: number | null;
  booking_end_time?: string | null;
  target_class_instance_id?: string;
}

/**
 * The success body. Loose because the four branches return different subsets:
 * an appointment move returns the new end time, a class move returns the new
 * instance, and pinning a union here would have meant editing the lifted code.
 */
export type RescheduleData = Record<string, unknown>;

export async function rescheduleBookingForGuest(
  clients: GuestActionClients,
  params: {
    bookingId: string;
    actor: GuestActionActor;
    changes: RescheduleRequest;
    now?: string;
  },
): Promise<GuestActionResult<RescheduleData>> {
  const { bookingId, actor, changes } = params;
  const loaded = await loadAndAuthoriseGuestBooking(clients, bookingId, actor);
  if (!loaded.ok) return loaded;

  const booking = loaded.data;
  const supabase = clients.admin;

  // Same names the route destructured from its request body, so the lifted
  // code below reads identically to what it replaced.
  const {
    booking_date,
    booking_time,
    party_size,
    practitioner_id: bodyPractitionerId,
    appointment_service_id: bodyAppointmentServiceId,
    duration_minutes: bodyDurationMinutes,
    booking_end_time: bodyBookingEndTime,
    target_class_instance_id: bodyTargetClassInstanceId,
  } = changes;

  /** Set by whichever branch defers guest comms; at most one fires per request. */
  let scheduleNotification: (() => Promise<void>) | undefined;

  /**
   * Every return in this function goes through here.
   *
   * The route called `after(...)` inline, so the deferral happened wherever the
   * branch decided to notify. The service cannot import `next/server`, so it
   * hands the closure back for the adapter to schedule instead, and this is the
   * single point where that closure gets attached to the outgoing result.
   * Without it the branches would set `scheduleNotification` and every return
   * would silently drop it, which is exactly what the first run of P0-9's rows
   * 4, 5 and 9 to 13 caught.
   */
  const finish = (
    body: Record<string, unknown>,
    init?: { status?: number; code?: ApiErrorCode },
  ): GuestActionResult<RescheduleData> => {
    const result = jsonActionResult<RescheduleData>(body, init);
    return scheduleNotification ? { ...result, scheduleNotification } : result;
  };

  if (!RESCHEDULE_MODIFIABLE_STATUSES.includes(booking.status as string)) {
    return finish(
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

  // ── CDE guest self-reschedule (resource + class) ───────────────────────
  // Resource bookings move to another slot for the SAME resource; class
  // bookings move to another FUTURE instance of the SAME class type. Both
  // are gated by the venue `guest_self_reschedule` flag (the only modify
  // gate the platform encodes — there is no per-booking modify window) and
  // are capacity-safe via the `enforce_cde_capacity` DB trigger (409 on
  // conflict). Events stay cancel+rebook (handled by the UI copy).
  if (
    currentBookingModel === "resource_booking" ||
    currentBookingModel === "class_session"
  ) {
    const { data: venueCdeRow } = await supabase
      .from("venues")
      .select("feature_flags, timezone")
      .eq("id", booking.venue_id)
      .single();
    const venueCdeFlags = parseVenueFeatureFlags(
      (venueCdeRow as { feature_flags?: unknown } | null)?.feature_flags,
    );
    try {
      assertAppointmentsFeatureEnabled("guest_self_reschedule", venueCdeFlags);
    } catch {
      return finish(
        {
          error: "Online booking changes are not available for this venue.",
          code: "feature_disabled",
          feature: "guest_self_reschedule",
        },
        { status: 403, code: "SELF_RESCHEDULE_DISABLED" },
      );
    }
    const venueTimezone =
      typeof (venueCdeRow as { timezone?: string | null } | null)?.timezone ===
        "string" &&
      String((venueCdeRow as { timezone?: string | null }).timezone).trim() !== ""
        ? String((venueCdeRow as { timezone?: string | null }).timezone).trim()
        : "Europe/London";

    const beforeTime =
      typeof booking.booking_time === "string"
        ? booking.booking_time.slice(0, 5)
        : "";

    if (currentBookingModel === "resource_booking") {
      const resourceId = booking.resource_id as string | null;
      if (!resourceId) {
        return finish(
          { error: "This booking is missing its resource." },
          { status: 400 },
        );
      }
      if (!booking_date || !booking_time) {
        return finish(
          {
            error:
              "booking_date and booking_time are required to change this booking.",
          },
          { status: 400 },
        );
      }
      const newDate = booking_date;
      const timeStr =
        booking_time.length >= 5 ? booking_time.slice(0, 5) : booking_time;
      const existingEnd =
        typeof booking.booking_end_time === "string"
          ? String(booking.booking_end_time).slice(0, 5)
          : null;

      const validation = await validateResourceBookingModification({
        admin: supabase,
        venueId: booking.venue_id,
        bookingId,
        resourceId,
        newDate,
        timeStr,
        // RS-3: this is the GUEST manage-link flow. Without this the shared
        // validator ran with its staff defaults, so a guest could move their
        // booking to a time that had already passed, inside the venue's notice
        // window, or up to eleven months out.
        audience: 'guest',
        durationMinutes: bodyDurationMinutes ?? null,
        bookingEndTime:
          bodyBookingEndTime ??
          (bodyDurationMinutes == null ? existingEnd : null),
      });
      if (!validation.ok) {
        const status = validation.reason.includes("no longer available")
          ? 409
          : 400;
        return finish({ error: validation.reason }, { status });
      }

      // estimated_end_time must be a true UTC instant: resolve the
      // venue-local start to UTC, then add the booking duration (DST/midnight
      // safe). booking_end_time keeps the venue-local wall-clock HH:mm.
      const resourceEndFields = bookingEndFieldsForStorage({
        dateYmd: newDate,
        startHHmm: timeStr,
        durationMinutes: validation.durationMinutes,
      });
      const newTime = timeStr.length === 5 ? `${timeStr}:00` : timeStr;

      const refundWindowHours = await resolveCancellationNoticeHoursForCreate({
        supabase,
        venueId: booking.venue_id,
        effectiveModel: "resource_booking",
        resourceCalendarId: resourceId,
      });
      // C13 — a deadline that has already passed stays put, so rescheduling
      // cannot make a forfeited deposit refundable again.
      const { deadline: cancellation_deadline } = resolveRescheduleCancellationDeadline({
        previousDeadline: booking.cancellation_deadline as string | null,
        depositStatus: booking.deposit_status as string | null,
        recomputedDeadline: cancellationDeadlineHoursBefore(
          newDate,
          newTime,
          refundWindowHours,
        ),
      });

      const nowIso = new Date().toISOString();
      const prevUpdatedAt = booking.updated_at as string;
      const { data: resUpdated, error: resUpdErr } = await supabase
        .from("bookings")
        .update({
          booking_date: newDate,
          booking_time: newTime,
          booking_end_time: `${validation.endHHmm}:00`,
          estimated_end_time: resourceEndFields.estimated_end_time,
          cancellation_deadline,
          updated_at: nowIso,
        })
        .eq("id", bookingId)
        .eq("updated_at", prevUpdatedAt)
        .select("id")
        .maybeSingle();

      if (resUpdErr) {
        const e = resUpdErr as { code?: string | null; message?: string | null };
        const isCapacityConflict =
          e.code === "23P01" ||
          (typeof e.message === "string" && e.message.includes("CDE_CAPACITY"));
        if (isCapacityConflict) {
          return finish(
            {
              error:
                "That slot just filled. Please choose another available time.",
              code: "slot_unavailable",
            },
            { status: 409, code: "SLOT_TAKEN" },
          );
        }
        console.error("confirm modify (resource) update failed:", resUpdErr);
        return finish(
          { error: "Failed to update booking." },
          { status: 500 },
        );
      }
      if (!resUpdated) {
        return finish(
          {
            error:
              "This booking was updated elsewhere. Refresh the page and try again.",
          },
          { status: 412, code: "STALE_RESOURCE" },
        );
      }

      const { logBookingModifiedEvent } = await import(
        "@/lib/booking/log-booking-modified-event"
      );
      await logBookingModifiedEvent(supabase, {
        venue_id: booking.venue_id as string,
        booking_id: bookingId,
        modification_actor: "guest",
        before: {
          booking_date: String(booking.booking_date),
          booking_time: beforeTime,
          ...(existingEnd ? { booking_end_time: existingEnd } : {}),
        },
        after: {
          booking_date: newDate,
          booking_time: timeStr,
          booking_end_time: validation.endHHmm,
        },
      });

      scheduleNotification = async () => {
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
            "Self-service resource modification notification failed:",
            commsErr,
          );
        }
      };

      return finish({
        success: true,
        message: "Your booking has been updated.",
        booking_date: newDate,
        booking_time: timeStr,
        booking_end_time: validation.endHHmm,
      });
    }

    // ── class_session move to another future instance ────────────────────
    const currentClassInstanceId = booking.class_instance_id as string | null;
    if (!currentClassInstanceId) {
      return finish(
        { error: "This booking is missing its class session." },
        { status: 400 },
      );
    }
    const targetInstanceId = bodyTargetClassInstanceId;
    if (!targetInstanceId) {
      return finish(
        { error: "Please choose a class session to move to." },
        { status: 400 },
      );
    }

    // v1 scope: do not move a booking that spent class credits or a
    // membership allowance. Re-attaching the entitlement to a different
    // instance without double-charging or losing it is non-trivial; until
    // that is built we leave such bookings to cancel+rebook (which already
    // restores credits/allowance) and tell the guest to contact the venue.
    const { bookingWasCreditPaid, bookingWasMembershipPaid } = await import(
      "@/lib/class-commerce/booking-was-credit-paid"
    );
    if (
      (await bookingWasCreditPaid(supabase, bookingId)) ||
      (await bookingWasMembershipPaid(supabase, bookingId))
    ) {
      return finish(
        {
          error:
            "This class was booked with a class pass or membership, so it can't be moved online yet. Please contact the venue to change it.",
          code: "entitlement_booking",
        },
        { status: 409 },
      );
    }

    // Resolve the booking's current class type (the move must stay within it).
    const { data: curInst } = await supabase
      .from("class_instances")
      .select("class_type_id")
      .eq("id", currentClassInstanceId)
      .maybeSingle();
    const currentClassTypeId =
      (curInst as { class_type_id?: string } | null)?.class_type_id ?? null;
    if (!currentClassTypeId) {
      return finish(
        { error: "This class is no longer available." },
        { status: 400 },
      );
    }

    if (targetInstanceId === currentClassInstanceId) {
      return finish(
        { error: "That's the session you're already booked on." },
        { status: 400 },
      );
    }

    const partySize = Number(booking.party_size) || 1;
    const validation = await validateClassModification({
      admin: supabase,
      venueId: booking.venue_id,
      bookingId,
      currentClassTypeId,
      targetInstanceId,
      partySize,
      venueTimezone,
      enforceGuestNotice: true,
    });
    if (!validation.ok) {
      const status = validation.reason.includes("full") ? 409 : 400;
      return finish({ error: validation.reason }, { status });
    }

    const newTime =
      validation.startTime.length === 5
        ? `${validation.startTime}:00`
        : validation.startTime;
    /**
     * Venue-local wall clock encoded as UTC, matching the class create
     * paths. Writing a true instant here left a rescheduled class reading
     * back an hour early under BST, and because class rows carried no
     * `booking_end_time` at all there was nothing to fall back to: the list
     * bar rendered "18:00-18:00" and wrapped the duration to "24 hr".
     */
    const classEndFields = bookingEndFieldsForStorage({
      dateYmd: validation.instanceDate,
      startHHmm: validation.startTime,
      durationMinutes: validation.durationMinutes,
    });
    // C13 — see the resource branch above; a passed deadline is fixed.
    const { deadline: cancellation_deadline } = resolveRescheduleCancellationDeadline({
      previousDeadline: booking.cancellation_deadline as string | null,
      depositStatus: booking.deposit_status as string | null,
      recomputedDeadline: cancellationDeadlineHoursBefore(
        validation.instanceDate,
        newTime,
        validation.cancellationNoticeHours,
      ),
    });

    const nowIso = new Date().toISOString();
    const prevUpdatedAt = booking.updated_at as string;
    // Card-hold fee snapshots are never recomputed on modify; the guest
    // consented to the original amount. The move stays within the same
    // class type and updates the row in place, so any hold (and its
    // fee_pence) carries over untouched (card_hold deposits §10.1).
    const { data: classUpdated, error: classUpdErr } = await supabase
      .from("bookings")
      .update({
        class_instance_id: targetInstanceId,
        booking_date: validation.instanceDate,
        booking_time: newTime,
        estimated_end_time: classEndFields.estimated_end_time,
        booking_end_time: classEndFields.booking_end_time,
        cancellation_deadline,
        updated_at: nowIso,
      })
      .eq("id", bookingId)
      .eq("updated_at", prevUpdatedAt)
      .select("id")
      .maybeSingle();

    if (classUpdErr) {
      const e = classUpdErr as { code?: string | null; message?: string | null };
      const isCapacityConflict =
        e.code === "23P01" ||
        (typeof e.message === "string" && e.message.includes("CDE_CAPACITY"));
      if (isCapacityConflict) {
        return finish(
          {
            error: "That session just filled. Please choose another session.",
            code: "slot_unavailable",
          },
          { status: 409, code: "SLOT_TAKEN" },
        );
      }
      console.error("confirm modify (class) update failed:", classUpdErr);
      return finish(
        { error: "Failed to update booking." },
        { status: 500 },
      );
    }
    if (!classUpdated) {
      return finish(
        {
          error:
            "This booking was updated elsewhere. Refresh the page and try again.",
        },
        { status: 412, code: "STALE_RESOURCE" },
      );
    }

    const { logBookingModifiedEvent } = await import(
      "@/lib/booking/log-booking-modified-event"
    );
    await logBookingModifiedEvent(supabase, {
      venue_id: booking.venue_id as string,
      booking_id: bookingId,
      modification_actor: "guest",
      before: {
        booking_date: String(booking.booking_date),
        booking_time: beforeTime,
      },
      after: {
        booking_date: validation.instanceDate,
        booking_time: validation.startTime,
      },
    });

    scheduleNotification = async () => {
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
          "Self-service class modification notification failed:",
          commsErr,
        );
      }
    };

    return finish({
      success: true,
      message: "Your booking has been updated.",
      booking_date: validation.instanceDate,
      booking_time: validation.startTime,
    });
  }

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
      return finish(
        {
          error: "Online appointment changes are not available for this venue.",
          code: "feature_disabled",
          feature: "guest_self_reschedule",
        },
        { status: 403, code: "SELF_RESCHEDULE_DISABLED" },
      );
    }

    if (
      !booking_date ||
      !booking_time ||
      !bodyPractitionerId ||
      !bodyAppointmentServiceId
    ) {
      return finish(
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
      return finish(
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
      return finish(
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

    /**
     * A self-reschedule may land on a DIFFERENT service. The row's variant
     * and processing snapshot belong to the service they were taken from, so
     * carrying them across left the booking pointing at a variant of another
     * service: staff then got "Invalid or inactive variant for this service"
     * on every later edit, and the old service's gap sat inside the new
     * service's duration.
     */
    const previousServiceId =
      (booking.service_item_id as string | null) ??
      (booking.appointment_service_id as string | null);
    const serviceChanged = bodyAppointmentServiceId !== previousServiceId;
    const previousVariantId = serviceChanged
      ? null
      : ((booking.service_variant_id as string | null) ?? null);

    // An inactive or deleted variant is dropped rather than carried, for the
    // same reason: a variant the server can no longer resolve makes the
    // booking permanently uneditable.
    const keptVariant = previousVariantId
      ? await loadActiveVariantForService({
          admin: supabase,
          venueId: booking.venue_id as string,
          serviceId: bodyAppointmentServiceId as string,
          variantId: previousVariantId,
        })
      : null;
    const nextVariantId = keptVariant?.id ?? null;

    /**
     * Add-ons stay with the booking across a reschedule, so their minutes
     * are part of the length being reserved. Carried only when the service
     * is unchanged: add-ons belong to a service, so a move to a different
     * one cannot bring them, which is the rule the variant follows above.
     */
    const carriedAddonMinutes = serviceChanged
      ? 0
      : Number(
          (booking as { addons_total_duration_minutes?: number | null })
            .addons_total_duration_minutes ?? 0,
        );

    /**
     * SA-C2. Both adjustments go on the input BEFORE the availability check,
     * which is what `booking/create` does and what this route did not: they
     * were applied to the write only, so the engine was asked about the
     * parent's duration and the row was written with the variant's. The
     * write side of that mismatch was found and fixed once already, and the
     * comment explaining it is still below. Nobody checked the other half of
     * the same sentence.
     */
    applyReservedDurationToInput({
      services: input.services,
      serviceId: bodyAppointmentServiceId,
      variant: keptVariant,
      extraMinutes: carriedAddonMinutes,
    });

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
      return finish(
        {
          error:
            "This appointment slot is no longer available. Please choose another time or service.",
        },
        { status: 409, code: "SLOT_TAKEN" },
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

    /**
     * The length the engine actually reserved, which is the whole point of
     * SA-C2: the check and the write must not be able to disagree.
     *
     * `svc` is the right row and `baseSvc` is not, because the engine
     * resolves a practitioner's service the same way, by merging the
     * `practitioner_services` link over the input row
     * (`appointment-engine.ts:550`). `baseSvc` carries the variant and the
     * add-on minutes folded in above; merging the link on top applies a
     * practitioner's `custom_duration_minutes` when there is one, and
     * changes nothing when there is not. Reading `baseSvc` directly would
     * write the catalogue length for a practitioner who has their own.
     *
     * Note this differs from `booking/create`, which reads `baseSvc`: its
     * `svc` is rebuilt by re-applying the variant on top of the merge, so
     * the duration there resets to the variant's own and drops the add-on
     * minutes. Here `svc` is only the merge, so it keeps both.
     */
    const rescheduleDurationMinutes =
      svc?.duration_minutes ?? baseSvc?.duration_minutes ?? null;

    let estimatedEndTime: string | null = null;
    let rescheduleBookingEndTime: string | null = null;
    if (svc && rescheduleDurationMinutes != null) {
      /**
       * Both columns, from one helper. Writing only `estimated_end_time`
       * left `booking_end_time` pinned to the OLD start's clock, and the
       * engine trusts that column: a 60-minute booking moved from 15:00 to
       * 09:00 was read as a seven-hour appointment and swallowed the rest of
       * the practitioner's bookable day.
       */
      const endFields = bookingEndFieldsForStorage({
        dateYmd: newDate,
        startHHmm: timeStr,
        durationMinutes: rescheduleDurationMinutes,
      });
      estimatedEndTime = endFields.estimated_end_time;
      rescheduleBookingEndTime = endFields.booking_end_time;
    }

    /** Re-snapshotted from the new service when the service changed. */
    let rescheduleProcessingBlocks: ReturnType<
      typeof snapshotProcessingTimeBlocksFromCatalog
    > | null = null;
    if (serviceChanged && baseSvc) {
      rescheduleProcessingBlocks = snapshotProcessingTimeBlocksFromCatalog({
        service: baseSvc,
        variant: null,
      });
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
    // C13 — a passed deadline is fixed, so a late reschedule cannot restore
    // a refund the guest has already forfeited. When it is preserved the
    // stored policy snapshot must be preserved with it (below), or the row
    // would advertise a window its own deadline refuses to honour.
    const { deadline: cancellation_deadline, preserved: deadlinePreserved } =
      resolveRescheduleCancellationDeadline({
        previousDeadline: booking.cancellation_deadline as string | null,
        depositStatus: booking.deposit_status as string | null,
        recomputedDeadline: cancellationDeadlineHoursBefore(
          newDate,
          newTime,
          refundWindowHours,
        ),
      });
    const cancellation_policy_snapshot = {
      refund_window_hours: refundWindowHours,
      policy: `Full refund if cancelled ${refundWindowHours}+ hours before appointment start. No refund within ${refundWindowHours} hours of the appointment or for no-shows.`,
    };

    // A per-visit record was completed for THIS booking, so it moves with it when the
    // guest reschedules. Runs before the gate, which would otherwise reject the move on
    // the consent signed for the date being left behind. This cannot weaken the C1 guard
    // below: it only carries forward a record already attached to this booking, and
    // never conjures one for a requirement the guest has not met.
    if (newDate !== booking.booking_date) {
      await rescheduleBookingComplianceRecords(supabase, {
        venueId: booking.venue_id as string,
        bookingId,
        newBookingDate: newDate,
      });
    }

    // Compliance gate (§5.1, audit C1): a guest self-reschedule onto a
    // regulated service/date must satisfy the same online block as the create
    // flow, otherwise block_online / block_all is trivially evadable by booking
    // a no-requirement slot and then moving it.
    const reschedCompliance = await enforceBookingCompliance(supabase, {
      venueId: booking.venue_id as string,
      guestId: (booking.guest_id as string | null) ?? null,
      appointmentServiceId:
        currentBookingModel === "unified_scheduling" ? null : bodyAppointmentServiceId,
      serviceItemId:
        currentBookingModel === "unified_scheduling" ? bodyAppointmentServiceId : null,
      bookingDate: newDate,
      bookingTime: newTime,
      context: "online",
    });
    if (reschedCompliance.blocked) {
      // `blocked` implies a body, but the type does not say so and the route
      // passed it straight to NextResponse.json, where an undefined body would
      // have produced a 409 with nothing in it. The fallback keeps the promise
      // the status makes. Note the enforcement body puts the CODE in `error`
      // and the prose in `message`, which is why the adapter reproduces it
      // unchanged rather than reshaping it.
      return finish(
        reschedCompliance.body ?? { error: "COMPLIANCE_REQUIREMENT_UNMET" },
        { status: 409, code: "COMPLIANCE_REQUIREMENT_UNMET" },
      );
    }

    /**
     * Re-snapshot the display names when a self-reschedule lands on a
     * DIFFERENT service. `service_name_snapshot` and
     * `service_variant_name_snapshot` are written by a BEFORE INSERT trigger
     * and every read prefers them, so without this the venue's calendar, day
     * sheet, bookings list and the guest's visit history all kept showing the
     * service originally booked. The guest's own manage page resolves the
     * service live and showed the NEW one, so the two sides of the same
     * appointment disagreed about what had been booked.
     *
     * Only on a service change: when the service is unchanged the variant is
     * carried as-is above, so its existing snapshot is still the right name.
     * The variant snapshot is cleared alongside, because `nextVariantId` is
     * already forced to null for a different service, for the reason given
     * where `previousVariantId` is resolved.
     *
     * Resolved HERE, before the slot re-check below, so the extra read does
     * not widen the re-check-to-write window that SA-C1 exists to narrow.
     */
    const rescheduleNameSnapshot: Record<string, string | null> = {};
    if (serviceChanged) {
      const { data: nextSvcRow } = await supabase
        .from(
          currentBookingModel === "unified_scheduling"
            ? "service_items"
            : "appointment_services",
        )
        .select("name")
        .eq("id", bodyAppointmentServiceId as string)
        .maybeSingle();
      const nextName = (nextSvcRow as { name?: string } | null)?.name;
      if (typeof nextName === "string" && nextName.trim() !== "") {
        rescheduleNameSnapshot.service_name_snapshot = nextName;
      }
      rescheduleNameSnapshot.service_variant_name_snapshot = null;
    }

    /**
     * SA-C1 on the reschedule path. This was the one appointment-writing
     * route the C3 interim never covered, so the window between the slot
     * check above and the write below stayed hundreds of milliseconds wide,
     * spanning a compliance check and a cancellation-policy lookup.
     *
     * `input` is handed over as validated, mutations and all: it carries the
     * variant and the add-on minutes folded in above, and the re-check
     * replaces only the volatile part. Rebuilding it here would drop both
     * and ask a different question from the one that was answered.
     *
     * Narrows the race. Does not close it, and must not be described as
     * doing so. A failed re-check allows the write, because this is a
     * narrowing of an existing race rather than a new gate.
     */
    const rescheduleRecheck = createAppointmentSlotRecheck({
      supabase,
      venueId: booking.venue_id as string,
      date: newDate,
      practitionerId: bodyPractitionerId,
      serviceId: bodyAppointmentServiceId,
      timeHm: timeStr,
      input,
    });
    if (!(await rescheduleRecheck.stillAvailable())) {
      return finish(SLOT_TAKEN_RESPONSE, { status: 409, code: "SLOT_TAKEN" });
    }

    const nowIso = new Date().toISOString();
    const prevUpdatedAt = booking.updated_at as string;
    // Card-hold fee snapshots are never recomputed on modify; the guest
    // consented to the original amount. This update can move the booking to
    // a different service/practitioner (a different entity may configure a
    // different fee), but the hold row and its fee_pence are untouched
    // (card_hold deposits §10.1): the row is updated in place, never
    // deleted and reinserted, so the hold carries over unchanged.
    const isUnified = currentBookingModel === "unified_scheduling";

    /*
      P2-3a. Everything below the routing columns is a PATCH, not a full row:
      a key that is ABSENT means "leave this column alone" and a key that is
      present-and-null means "set it to null". That is the same distinction the
      conditional spreads made when this was a PostgREST `.update()`, and
      `claim_appointment_slot` preserves it with `p_patch ? 'key'` presence
      tests rather than COALESCE, which cannot express it.
    */
    const claimPatch: Record<string, unknown> = {
      party_size: newPartySize,
      ...(isUnified
        ? {
            service_item_id: bodyAppointmentServiceId,
            appointment_service_id: null,
          }
        : {
            appointment_service_id: bodyAppointmentServiceId,
            service_item_id: null,
          }),
      estimated_end_time: estimatedEndTime,
      ...(rescheduleBookingEndTime
        ? { booking_end_time: rescheduleBookingEndTime }
        : {}),
      service_variant_id: nextVariantId,
      ...rescheduleNameSnapshot,
      ...(rescheduleProcessingBlocks
        ? { processing_time_blocks: rescheduleProcessingBlocks }
        : {}),
      cancellation_deadline,
      // Skipped when the deadline was preserved: the row's existing
      // snapshot is the one that matches it.
      ...(deadlinePreserved ? {} : { cancellation_policy_snapshot }),
      updated_at: nowIso,
    };

    /*
      WHY THIS IS AN RPC AND NOT AN UPDATE. `enforce_cde_capacity` guards
      class, event and resource bookings and explicitly excludes appointments,
      so the recheck above narrows this race without closing it: two guests can
      both pass it and both write the same slot. Closing it needs the lock, the
      capacity count and the write inside ONE transaction, and PostgREST gives
      one transaction per request. So they moved into the function together.

      The optimistic-concurrency check moved with them, from `.eq("updated_at")`
      into `p_expected_updated_at`, for the same reason: split out, it would be
      a second round trip outside the lock.
    */
    const { data: claimRows, error: apptUpdErr } = await supabase.rpc(
      "claim_appointment_slot",
      {
        p_booking_id: bookingId,
        p_calendar_id: isUnified ? bodyPractitionerId : null,
        p_practitioner_id: isUnified ? null : bodyPractitionerId,
        p_booking_date: newDate,
        p_booking_time: newTime,
        p_expected_updated_at: prevUpdatedAt,
        p_patch: claimPatch,
      },
    );
    const apptUpdated = Array.isArray(claimRows) ? claimRows[0] : claimRows;

    if (apptUpdErr) {
      // The guard raises the same SQLSTATE `enforce_cde_capacity` raises, so
      // one mapping covers whichever guard refused the slot.
      if (apptUpdErr.code === "23P01") {
        return finish(SLOT_TAKEN_RESPONSE, { status: 409, code: "SLOT_TAKEN" });
      }
      console.error(
        "confirm modify (appointment) update failed:",
        apptUpdErr,
      );
      return finish(
        { error: "Failed to update booking." },
        { status: 500 },
      );
    }
    if (!apptUpdated) {
      return finish(
        {
          error:
            "This booking was updated elsewhere. Refresh the page and try again.",
        },
        { status: 412, code: "STALE_RESOURCE" },
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

    scheduleNotification = async () => {
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
    };

    return finish({
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
    return finish(
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
    return finish(
      { error: "Invalid date or party size." },
      { status: 400 },
    );
  }

  const timeStr = newTime.slice(0, 5);

  if (venueMode.availabilityEngine !== "service") {
    return finish(
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
    return finish(
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
    return finish(
      {
        error:
          "The selected date/time is not available for this party size.",
      },
      { status: 409, code: "SLOT_TAKEN" },
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
    return finish(
      { error: "Failed to update booking." },
      { status: 500 },
    );
  }
  if (!tableUpdated) {
    return finish(
      {
        error:
          "This booking was updated elsewhere. Refresh the page and try again.",
      },
      { status: 412, code: "STALE_RESOURCE" },
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

  scheduleNotification = async () => {
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
  };

  return finish({
    success: true,
    message: "Your booking has been updated.",
    booking_date: newDate,
    booking_time: timeStr,
    party_size: newPartySize,
  });
  return finish(
    { error: "Unable to modify this booking." },
    { status: 400 },
  );
}
