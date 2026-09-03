import { stripe } from "@/lib/stripe";
import { sendCancellationNotification } from "@/lib/communications/send-templated";
import type { BookingEmailData } from "@/lib/emails/types";
import { venueRowToEmailData } from "@/lib/emails/venue-email-data";
import { enrichBookingEmailForComms } from "@/lib/emails/booking-email-enrichment";
import {
  getCancellationNoticeHoursForBooking,
  parseExtendedBookingRules,
} from "@/lib/booking/venue-booking-rules";
import {
  applyBookingLifecycleStatusEffects,
  validateBookingStatusTransition,
} from "@/lib/table-management/lifecycle";
import { settleCardHoldsOnCancellation } from "@/lib/booking/card-hold-cancellation";
import { cancelOpenDepositIntentForBookings } from "@/lib/booking/cancel-open-deposit-intent";
import { classifyDepositRefundFailure } from "@/lib/booking/deposit-refund-convergence";
import { planSharedDepositRefund } from "@/lib/booking/shared-deposit-refund";
import { formatCardHoldFeePence } from "@/lib/booking/card-hold-terms";
import { inferBookingRowModel } from "@/lib/booking/infer-booking-row-model";
import { logBookingOp } from "@/lib/observability/booking-ops-log";
import { formatGuestDisplayName } from "@/lib/guests/name";
import { offerAppointmentWaitlistOnCancel } from "@/lib/booking/offer-appointment-waitlist-on-cancel";
import { loadAndAuthoriseGuestBooking } from "./authorise";
import {
  actionFailure,
  actionSuccess,
  type GuestActionActor,
  type GuestActionClients,
  type GuestActionResult,
} from "./types";

/**
 * A guest cancelling their own booking (AD1, extracted from `/api/confirm`).
 *
 * LIFTED, NOT REWRITTEN. Every branch, message, write and comment below came
 * out of the route unchanged; only the four return statements and the deferred
 * comms block moved to the result shape. P0-9's 13 cancel snapshots are the
 * gate, and the acceptance for this task is that they do not move.
 *
 * CANCEL IS IMPLEMENTED THREE TIMES in this codebase and this is the guest one:
 *
 *   - here, for a guest acting on their own booking through a token, an HMAC
 *     link, or (new) a portal session;
 *   - `PATCH /api/venue/bookings/[id]`, for staff;
 *   - `cancelStaffBookingWithNotify` (`src/lib/booking/staff-cancel-booking.ts`),
 *     which the staff route is converging on.
 *
 * They are NOT merged, and that is a decision rather than an oversight. The
 * guest path restores class credits only when the cancellation policy was met,
 * stamps `cancellation_actor_type: 'customer'`, keeps a saved card hold
 * chargeable after the deadline, and consumes the confirm token. The staff path
 * does none of those, and folding them together would put four booleans through
 * one function to recover two behaviours. See the cross-reference in
 * `staff-cancel-booking.ts`.
 */

export interface CancelBookingData {
  success: true;
  message: string;
  refund_message: string;
  refund_eligible: boolean;
  deposit_amount_str: string | null;
  card_hold_released: boolean;
  card_hold_kept: boolean;
  card_hold_message: string | null;
}

export async function cancelBookingForGuest(
  clients: GuestActionClients,
  params: { bookingId: string; actor: GuestActionActor; now?: string },
): Promise<GuestActionResult<CancelBookingData>> {
  const { bookingId, actor } = params;
  const loaded = await loadAndAuthoriseGuestBooking(clients, bookingId, actor);
  if (!loaded.ok) return loaded;

  const booking = loaded.data;
  const supabase = clients.admin;
  const now = params.now ?? new Date().toISOString();
  const usedAt = now;

  /**
   * A SESSION actor does not consume the confirm token.
   *
   * Token and HMAC actors keep the route's exact semantics: cancelling stamps
   * `confirm_token_used_at`, which is what makes an emailed link single use. A
   * portal session is not that link, and burning it as a side effect of a
   * portal action would silently invalidate an email the customer may still
   * need. The key is omitted rather than written back, so the update payload
   * stays byte-identical for the other two actors.
   */
  const consumesToken = actor.kind !== "session";

  /** Set when there is a guest and a venue name to send a cancellation to. */
  let scheduleNotification: (() => Promise<void>) | undefined;

  const cancelCheck = validateBookingStatusTransition(
    booking.status,
    "Cancelled",
  );
  if (!cancelCheck.ok) {
    return actionFailure(400, 'CONFLICT', cancelCheck.error);
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

  const previousStatus = booking.status;

  // Card-hold deposits (§9.3/§10.1): note whether this booking carries an
  // OPEN hold before we cancel, so we can settle it afterwards. A saved
  // hold cancelled BEFORE the deadline (and any unsaved hold) is released
  // and the card is never charged; a saved hold cancelled AFTER the
  // deadline is KEPT chargeable (late-cancellation change, §9.3 amended).
  const { data: cancelHoldRow } = await supabase
    .from("booking_card_holds")
    .select("id, released_at")
    .eq("booking_id", bookingId)
    .maybeSingle();
  const hadOpenCardHold = Boolean(
    cancelHoldRow &&
      !(cancelHoldRow as { released_at?: string | null }).released_at,
  );

  const deadline = booking.cancellation_deadline
    ? new Date(booking.cancellation_deadline)
    : null;
  // Refund + late-cancel copy below are keyed strictly on
  // `deposit_status === 'Paid'`. Card holds never reach 'Paid'
  // (Pending -> Card Held -> Charged/Refunded, §14), so neither the refund
  // path nor the "non-refundable" late-cancel message can fire for a
  // card-hold booking; hold cancellations are settled separately below
  // (released before the deadline, kept chargeable after it).
  const canRefund =
    deadline &&
    new Date() <= deadline &&
    booking.deposit_status === "Paid" &&
    booking.stripe_payment_intent_id;

  let refundSucceeded = false;
  /** PM-1: the deposit is settled, but not through a live intent. */
  let nothingToRefund = false;
  if (canRefund) {
    const { data: venue } = await supabase
      .from("venues")
      .select("stripe_connected_account_id")
      .eq("id", booking.venue_id)
      .single();
    if (venue?.stripe_connected_account_id) {
      try {
        // C11 — a group booking, visit or class cart puts EVERY row on one
        // PaymentIntent, and this route cancels only the row the guest
        // clicked. Refunding that intent without an amount therefore handed
        // back the whole party's deposits on one attendee's cancel, and the
        // charge.refunded webhook then stamped every sibling 'Refunded'
        // while they were still Booked. Refund only this row's share; when
        // it is the only paid row left on the intent this still refunds the
        // full remaining balance, exactly as before.
        const refundPlan = await planSharedDepositRefund(supabase, {
          paymentIntentId: booking.stripe_payment_intent_id as string,
          settlingBookingIds: [bookingId],
        });
        await stripe.refunds.create(
          {
            payment_intent: booking.stripe_payment_intent_id as string,
            ...(refundPlan.amountPence != null ? { amount: refundPlan.amountPence } : {}),
          },
          {
            stripeAccount: venue.stripe_connected_account_id,
            idempotencyKey: refundPlan.idempotencyKey,
          },
        );
        refundSucceeded = true;
      } catch (refundErr) {
        // A prior attempt (or the dashboard) already refunded this PI: the
        // money is back with the guest, so converge instead of failing. This
        // also lets a retry succeed after a previous cancel-update failure
        // left the booking uncancelled but the refund already issued.
        //
        // Still correct now that refunds can be partial. Stripe raises this
        // only when the CHARGE is fully refunded, and the charge total is
        // the sum of every row's deposit, so a fully-refunded charge means
        // this row's money is necessarily back too. The idempotency key
        // above handles the other convergence case (a crash-retry of this
        // exact refund), which replays the original result rather than
        // raising at all.
        //
        // PM-1 adds the second convergence: a deposit settled in cash has
        // its intent cancelled by `record_cash`, and refunding a cancelled
        // intent throws. Before the fix that made the booking permanently
        // uncancellable from this route, returning a 502 reading "Your
        // booking has not been cancelled" on every attempt, forever. There
        // is no money to return here, so cancel and leave deposit_status
        // alone (the update below preserves it when refundSucceeded is
        // false) rather than stamping a 'Refunded' that never happened.
        const convergence = await classifyDepositRefundFailure(refundErr, {
          paymentIntentId: booking.stripe_payment_intent_id as string,
          stripeAccountId: venue.stripe_connected_account_id,
        });
        if (convergence === 'refunded') {
          refundSucceeded = true;
        } else if (convergence === 'nothing_to_refund') {
          nothingToRefund = true;
        } else {
          logBookingOp({
            operation: "refund_failed",
            venue_id: booking.venue_id,
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
  }

  if (canRefund && !refundSucceeded && !nothingToRefund) {
    return actionFailure(
      502,
      'REFUND_FAILED',
      'We could not process your refund right now. Your booking has not been cancelled. Please try again or contact the venue.',
      // This route has shipped `code` in the body since before P0-11's
      // union existed, and P0-9's snapshot pins it. Carried as `extra` so
      // the adapter reproduces today's body byte for byte, rather than the
      // adapter learning to serialise `code` for one case out of 48.
      { code: 'REFUND_FAILED' },
    );
  }

  const { error: cancelUpdateErr } = await supabase
    .from("bookings")
    .update({
      status: "Cancelled",
      deposit_status: refundSucceeded ? "Refunded" : booking.deposit_status,
      ...(consumesToken ? { confirm_token_used_at: usedAt } : {}),
      cancelled_by_staff_id: null,
      cancellation_actor_type: "customer",
      updated_at: now,
    })
    .eq("id", bookingId);
  if (cancelUpdateErr) {
    // The booking is still live: do not run lifecycle effects or release a
    // card hold for a cancellation that did not happen.
    console.error("[confirm cancel] booking update failed:", cancelUpdateErr, {
      bookingId,
    });
    return actionFailure(
      500,
      'INTERNAL_ERROR',
      "We could not cancel your booking right now. Please try again or contact the venue.",
    );
  }

  await applyBookingLifecycleStatusEffects(supabase, {
    bookingId,
    guestId: booking.guest_id,
    previousStatus,
    nextStatus: "Cancelled",
    actorId: null,
  });

  // Plan 8.3/D7: a cancelled booking's open deposit PI must die with it
  // (a guest can otherwise still pay through a stale payment tab or link).
  await cancelOpenDepositIntentForBookings(supabase, {
    settledBookingIds: [bookingId],
    venueId: booking.venue_id,
  });

  // Card-hold deposits (§9.3 amended): a guest cancel BEFORE the deadline
  // releases the hold (stamps released_at + reason 'cancelled', emits
  // card_hold_released, best-effort deletes the booking-scoped Stripe
  // customer). A cancel AFTER the deadline keeps a saved hold chargeable
  // (late_cancellation_at stamped). The booking is already cancelled at
  // this point, so a settle failure must not fail the request; the release
  // cron (§12.3) is the backstop and errs on the guest's side.
  let cardHoldReleased = false;
  let keptCardHoldFeePence: number | null = null;
  if (hadOpenCardHold) {
    try {
      const settleResult = await settleCardHoldsOnCancellation(supabase, [bookingId]);
      cardHoldReleased = settleResult.releasedBookingIds.includes(bookingId);
      keptCardHoldFeePence =
        settleResult.keptHolds.find((k) => k.bookingId === bookingId)?.feePence ?? null;
    } catch (settleErr) {
      console.error("[confirm cancel] card-hold settle failed:", settleErr, {
        bookingId,
      });
    }
  }

  // Plan §4.1 — restore class credits / membership allowance when the
  // cancelled booking is a class_session paid via credits or membership.
  // For guest self-cancel we only restore when the cancellation policy was
  // met (i.e. a refund would have been due if the booking had been card-paid).
  const eligibleForCreditRestore = Boolean(deadline && new Date() <= deadline);
  if (eligibleForCreditRestore && cancelInferred === 'class_session') {
    try {
      const { bookingWasCreditPaid, bookingWasMembershipPaid } = await import(
        '@/lib/class-commerce/booking-was-credit-paid'
      );
      if (await bookingWasCreditPaid(supabase, bookingId)) {
        const { restoreClassCreditsForBooking } = await import(
          '@/lib/class-commerce/restore-class-credits'
        );
        const res = await restoreClassCreditsForBooking(supabase, {
          bookingId,
          idempotencyPrefix: `guest_self_cancel:${bookingId}`,
        });
        if (res.ok && res.restoredCredits > 0) {
          await supabase.from('events').insert({
            venue_id: booking.venue_id,
            booking_id: bookingId,
            event_type: 'class_credit_restored',
            payload: { restored_credits: res.restoredCredits, source: 'guest_self_cancel' },
          });
        }
      }
      if (await bookingWasMembershipPaid(supabase, bookingId)) {
        const { restoreMembershipAllowanceForBooking } = await import(
          '@/lib/class-commerce/restore-membership-allowance'
        );
        const res = await restoreMembershipAllowanceForBooking({
          admin: supabase,
          bookingId,
          idempotencyPrefix: `guest_self_cancel:${bookingId}`,
        });
        if (res.restoredSessions > 0) {
          await supabase.from('events').insert({
            venue_id: booking.venue_id,
            booking_id: bookingId,
            event_type: 'class_membership_allowance_restored',
            payload: { restored_sessions: res.restoredSessions, source: 'guest_self_cancel' },
          });
        }
      }
    } catch (err) {
      console.error('[confirm/cancel] credit/allowance restore failed', err);
    }
  }

  const { data: venue } = await supabase
    .from("venues")
    .select("name, address, phone, booking_rules, email, reply_to_email, booking_page_config")
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

  // Late-cancellation card holds (§9.3 amended): the guest cancelled after
  // the deadline, so the hold was kept and the fee stays chargeable. Shown
  // on the cancel screen and repeated in the cancellation email.
  const lateCancelFeeLine =
    keptCardHoldFeePence != null
      ? `Because the booking was cancelled after the cancellation deadline, ${
          venue?.name ?? "the venue"
        } may charge a no-show fee of up to ${formatCardHoldFeePence(keptCardHoldFeePence)}.`
      : null;

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

  const cancelledBookingForWaitlist = {
    id: bookingId,
    venue_id: booking.venue_id,
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

  try {
    const offerResult = await offerAppointmentWaitlistOnCancel(
      supabase,
      cancelledBookingForWaitlist,
    );
    if (offerResult.offered) {
      console.info("[confirm cancel] waitlist offer sent", {
        bookingId,
        mode: offerResult.mode,
        ...(offerResult.mode === 'notify_in_order'
          ? { waitlistEntryId: offerResult.waitlistEntryId }
          : offerResult.mode === 'notify_all'
            ? { notifiedCount: offerResult.notifiedCount }
            : {}),
      });
    }
  } catch (waitlistErr) {
    console.error("[confirm cancel] waitlist offer failed:", waitlistErr, {
      bookingId,
    });
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
      booking_page_config: venue.booking_page_config ?? null,
    });
    const vid = booking.venue_id;
    const refundMsg = refund_message || lateCancelFeeLine || null;
    scheduleNotification = async () => {
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
    };
  }

  logBookingOp({
    operation: "cancel",
    venue_id: booking.venue_id,
    booking_id: bookingId,
    booking_model: cancelInferred,
  });

  // Card-hold cancel copy (§10.1): the released line is only claimed when
  // the release actually happened (saved holds have the card detached;
  // awaiting_card holds never saved one). A kept hold gets the
  // late-cancellation line instead: the fee is still chargeable.
  const cardHoldMessage = lateCancelFeeLine
    ? `Your booking is cancelled. ${lateCancelFeeLine}`
    : cardHoldReleased
      ? "Your booking is cancelled. Your card will not be charged and the card hold has been released."
      : null;

  return actionSuccess(
    {
      success: true as const,
      message:
        cardHoldMessage ??
        (refundSucceeded
          ? "Booking cancelled. Your deposit will be refunded."
          : "Booking cancelled."),
      refund_message,
      refund_eligible: refundSucceeded,
      deposit_amount_str: depositAmountStr,
      card_hold_released: cardHoldReleased,
      card_hold_kept: keptCardHoldFeePence != null,
      card_hold_message: cardHoldMessage,
    },
    scheduleNotification,
  );
}
