import { NextRequest, NextResponse, after } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { verifyConfirmToken } from "@/lib/confirm-token";
import { confirmAttendanceForGuest } from "@/lib/booking/guest-actions/confirm-attendance";
import { cancelBookingForGuest } from "@/lib/booking/guest-actions/cancel";
import { rescheduleBookingForGuest } from "@/lib/booking/guest-actions/reschedule";
import type { GuestActionActor, GuestActionResult } from "@/lib/booking/guest-actions/types";
import { verifyBookingHmac } from "@/lib/short-manage-link";
import { buildBookingDetailDto } from "@/lib/booking/booking-detail-dto";

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
        "id, venue_id, guest_id, booking_date, booking_time, booking_end_time, party_size, status, deposit_status, deposit_amount_pence, stripe_payment_intent_id, cancellation_deadline, confirm_token_hash, confirm_token_used_at, practitioner_id, appointment_service_id, calendar_id, service_item_id, service_variant_id, experience_event_id, class_instance_id, resource_id, event_session_id, updated_at, guest_attendance_confirmed_at, location_type, client_address_line1, client_address_line2, client_address_city, client_address_postcode, special_requests, dietary_notes, occasion, cancellation_actor_type, created_at",
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

    /**
     * The payload moved to `src/lib/booking/booking-detail-dto.ts` (P2-4, AD9).
     *
     * It was ~270 lines here, and it is everything a guest may see about one
     * booking. AD9 has the token surface and the portal render the same
     * component over the same shape, so the payload had to become callable
     * rather than reachable only over HTTP. This route keeps its own auth: the
     * 404-before-any-proof ordering above, and the 410 on a used token, are
     * pinned by `characterisation/detail.test.ts` and are not the builder's
     * business.
     */
    return NextResponse.json(await buildBookingDetailDto(supabase, booking));
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
