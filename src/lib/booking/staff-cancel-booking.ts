import type { SupabaseClient } from '@supabase/supabase-js';
import { stripe } from '@/lib/stripe';
import {
  applyBookingLifecycleStatusEffects,
  validateBookingStatusTransition,
} from '@/lib/table-management/lifecycle';
import { enrichBookingEmailForComms } from '@/lib/emails/booking-email-enrichment';
import { sendCancellationNotification } from '@/lib/communications/send-templated';
import { inferBookingRowModel } from '@/lib/booking/infer-booking-row-model';
import { releaseCardHoldsForBookings } from '@/lib/booking/card-hold-release';
import { getCancellationNoticeHoursForBooking, parseExtendedBookingRules } from '@/lib/booking/venue-booking-rules';
import type { BookingEmailData } from '@/lib/emails/types';
import { venueRowToEmailData } from '@/lib/emails/venue-email-data';
import { formatGuestDisplayName } from '@/lib/guests/name';
import { offerAppointmentWaitlistOnCancel } from '@/lib/booking/offer-appointment-waitlist-on-cancel';
import { restoreClassCreditsForBooking } from '@/lib/class-commerce/restore-class-credits';
import { restoreMembershipAllowanceForBooking } from '@/lib/class-commerce/restore-membership-allowance';
import {
  bookingWasCreditPaid,
  bookingWasMembershipPaid,
} from '@/lib/class-commerce/booking-was-credit-paid';
import { sendClassCommerceComm } from '@/lib/communications/send-class-commerce';

const CANCELLABLE = ['Pending', 'Booked', 'Confirmed', 'Seated'];

export interface StaffCancelBookingNotifyOptions {
  /** Prepended to refund lines (e.g. event cancelled by venue). */
  refundMessagePrefix?: string | null;
  actorId: string | null;
  /**
   * When false, skip restoring class credits / membership allowance on the
   * cancelled bookings (e.g. an admin "void & forfeit" path). Defaults to true.
   */
  restoreCredits?: boolean;
}

export interface StaffCancelBookingResult {
  cancelled: boolean;
  /** Refund was required by policy but Stripe refund failed — booking left unchanged. */
  refundFailed?: boolean;
  reason?: 'not_found' | 'invalid_status' | 'refund_failed';
  /** Run inside `after()` so the HTTP response is not blocked. */
  scheduleNotification?: () => Promise<void>;
}

/**
 * Staff-initiated cancellation with Stripe refund when policy allows, table lifecycle cleanup,
 * and templated cancellation comms. Mirrors behaviour in PATCH /api/venue/bookings/[id].
 */
export async function cancelStaffBookingWithNotify(
  admin: SupabaseClient,
  staffDb: SupabaseClient,
  venueId: string,
  bookingId: string,
  options: StaffCancelBookingNotifyOptions,
): Promise<StaffCancelBookingResult> {
  const { data: booking, error: bookErr } = await staffDb
    .from('bookings')
    .select(
      'id, venue_id, guest_id, status, group_booking_id, stripe_payment_intent_id, deposit_status, deposit_amount_pence, cancellation_deadline, booking_date, booking_time, party_size, experience_event_id, class_instance_id, resource_id, event_session_id, calendar_id, service_item_id, practitioner_id, appointment_service_id',
    )
    .eq('id', bookingId)
    .single();

  if (bookErr || !booking) {
    console.error('[staff-cancel-booking] load booking failed:', bookErr);
    return { cancelled: false };
  }

  if (booking.venue_id !== venueId) {
    return { cancelled: false };
  }

  const st = booking.status as string;
  if (!CANCELLABLE.includes(st)) {
    return { cancelled: false };
  }

  const transitionCheck = validateBookingStatusTransition(st, 'Cancelled');
  if (!transitionCheck.ok) {
    return { cancelled: false };
  }

  const groupBookingId = booking.group_booking_id as string | null | undefined;
  let idsToCancel: string[] = [bookingId];
  let paymentIntentForRefund: string | null =
    typeof booking.stripe_payment_intent_id === 'string' ? booking.stripe_payment_intent_id : null;
  let depositPenceForMessage: number | null =
    typeof booking.deposit_amount_pence === 'number' ? booking.deposit_amount_pence : null;
  let hadPaidDeposit = booking.deposit_status === 'Paid';

  if (groupBookingId) {
    const { data: groupRows } = await staffDb
      .from('bookings')
      .select('id, stripe_payment_intent_id, deposit_status, deposit_amount_pence, guest_id, status')
      .eq('venue_id', venueId)
      .eq('group_booking_id', groupBookingId)
      .in('status', CANCELLABLE);

    idsToCancel = (groupRows ?? []).map((r: { id: string }) => r.id);
    if (idsToCancel.length === 0) {
      idsToCancel = [bookingId];
    }
    const withPi = (groupRows ?? []).find(
      (r: { stripe_payment_intent_id?: string | null }) => r.stripe_payment_intent_id,
    );
    paymentIntentForRefund =
      typeof withPi?.stripe_payment_intent_id === 'string' ? withPi.stripe_payment_intent_id : paymentIntentForRefund;
    const totalPence = (groupRows ?? []).reduce(
      (sum: number, r: { deposit_amount_pence?: number | null }) => sum + (r.deposit_amount_pence ?? 0),
      0,
    );
    if (totalPence > 0) {
      depositPenceForMessage = totalPence;
    }
    hadPaidDeposit = (groupRows ?? []).some((r: { deposit_status?: string | null }) => r.deposit_status === 'Paid');
  }

  const deadline = booking.cancellation_deadline ? new Date(booking.cancellation_deadline) : null;
  const canRefund =
    Boolean(deadline && new Date() <= deadline && hadPaidDeposit && paymentIntentForRefund);

  let refundSucceeded = false;
  if (canRefund && paymentIntentForRefund) {
    const { data: venueStripe } = await admin
      .from('venues')
      .select('stripe_connected_account_id')
      .eq('id', venueId)
      .single();
    if (venueStripe?.stripe_connected_account_id) {
      try {
        await stripe.refunds.create(
          { payment_intent: paymentIntentForRefund },
          { stripeAccount: venueStripe.stripe_connected_account_id },
        );
        refundSucceeded = true;
      } catch (refundErr) {
        console.error('[staff-cancel-booking] refund failed:', refundErr);
      }
    }
  }

  if (canRefund && !refundSucceeded) {
    return { cancelled: false, refundFailed: true, reason: 'refund_failed' };
  }

  const { data: beforeRows } = await admin
    .from('bookings')
    .select('id, guest_id, status')
    .in('id', idsToCancel);

  if (refundSucceeded) {
    const { error: cancelErr } = await staffDb
      .from('bookings')
      .update({
        status: 'Cancelled',
        deposit_status: 'Refunded',
        cancelled_by_staff_id: options.actorId,
        cancellation_actor_type: options.actorId ? 'staff' : 'system',
        updated_at: new Date().toISOString(),
      })
      .in('id', idsToCancel);
    if (cancelErr) {
      console.error('[staff-cancel-booking] cancel update failed after refund:', cancelErr, { bookingId });
      return { cancelled: false, reason: 'not_found' };
    }
  } else {
    const { error: cancelErr } = await staffDb
      .from('bookings')
      .update({
        status: 'Cancelled',
        cancelled_by_staff_id: options.actorId,
        cancellation_actor_type: options.actorId ? 'staff' : 'system',
        updated_at: new Date().toISOString(),
      })
      .in('id', idsToCancel);
    if (cancelErr) {
      console.error('[staff-cancel-booking] cancel update failed:', cancelErr, { bookingId });
      return { cancelled: false, reason: 'not_found' };
    }
  }

  // §9.3 — cancels release card holds in every path; group cancels release per
  // sibling row. Best-effort: the cancel already happened, and the charge gate
  // also requires status = 'No-Show', so a missed release cannot enable a charge.
  try {
    await releaseCardHoldsForBookings(admin, idsToCancel, 'cancelled');
  } catch (holdErr) {
    console.error('[staff-cancel-booking] card-hold release failed:', holdErr, { bookingId });
  }

  for (const row of beforeRows ?? []) {
    const prev = (row as { status?: string }).status ?? st;
    await applyBookingLifecycleStatusEffects(admin, {
      bookingId: (row as { id: string }).id,
      guestId: (row as { guest_id: string }).guest_id,
      previousStatus: prev,
      nextStatus: 'Cancelled',
      actorId: options.actorId,
    });
  }

  // Plan §4.1 — restore class credits and membership allowance for each
  // cancelled booking. Idempotent.
  const restoreCreditsFlag = options.restoreCredits ?? true;
  if (restoreCreditsFlag) {
    for (const id of idsToCancel) {
      try {
        if (await bookingWasCreditPaid(admin, id)) {
          const res = await restoreClassCreditsForBooking(admin, {
            bookingId: id,
            idempotencyPrefix: `staff_cancel:${id}`,
          });
          if (res.ok && res.restoredCredits > 0) {
            await admin.from('events').insert({
              venue_id: venueId,
              booking_id: id,
              event_type: 'class_credit_restored',
              payload: { restored_credits: res.restoredCredits, source: 'staff_cancel' },
            });
            // Resolve guest auth user id to notify them.
            const { data: bRow } = await admin
              .from('bookings')
              .select('guest_id')
              .eq('id', id)
              .maybeSingle();
            const guestId = (bRow as { guest_id?: string } | null)?.guest_id;
            if (guestId) {
              const { data: g } = await admin
                .from('guests')
                .select('user_id')
                .eq('id', guestId)
                .maybeSingle();
              const userId = (g as { user_id?: string | null } | null)?.user_id ?? null;
              if (userId) {
                await sendClassCommerceComm({
                  venueId,
                  userId,
                  payload: {
                    key: 'class_credits_restored',
                    vars: { venueName: '', creditsRestored: res.restoredCredits },
                  },
                });
              }
            }
          }
        }
        if (await bookingWasMembershipPaid(admin, id)) {
          const res = await restoreMembershipAllowanceForBooking({
            admin,
            bookingId: id,
            idempotencyPrefix: `staff_cancel:${id}`,
          });
          if (res.restoredSessions > 0) {
            await admin.from('events').insert({
              venue_id: venueId,
              booking_id: id,
              event_type: 'class_membership_allowance_restored',
              payload: { restored_sessions: res.restoredSessions, source: 'staff_cancel' },
            });
          }
        }
      } catch (err) {
        console.error('[staff-cancel-booking] credit/allowance restore failed', err, { id });
      }
    }
  }

  const { data: venueRow } = await staffDb
    .from('venues')
    .select('name, address, phone, booking_rules, email, reply_to_email')
    .eq('id', venueId)
    .single();
  const { data: guestRow } = await staffDb
    .from('guests')
    .select('first_name, last_name, email, phone')
    .eq('id', booking.guest_id)
    .single();

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
  const cancelRules = parseExtendedBookingRules(venueRow?.booking_rules);
  const refundWindowHoursDisplay = getCancellationNoticeHoursForBooking(cancelRules, cancelInferred, 48);

  const depositAmountStr = depositPenceForMessage
    ? `£${(depositPenceForMessage / 100).toFixed(2)}`
    : null;

  let refundLine: string;
  if (refundSucceeded && depositAmountStr) {
    refundLine = `Your deposit of ${depositAmountStr} will be refunded to your original payment method within 5–10 business days.`;
  } else if (hadPaidDeposit && !canRefund && depositAmountStr) {
    refundLine = `Your deposit of ${depositAmountStr} is non-refundable as the cancellation was made less than ${refundWindowHoursDisplay} hours before the start of your booking.`;
  } else if (hadPaidDeposit && canRefund && !refundSucceeded && depositAmountStr) {
    refundLine = `We were unable to process your refund automatically. Please contact the venue directly to arrange your refund of ${depositAmountStr}.`;
  } else {
    refundLine = '';
  }

  const prefix = (options.refundMessagePrefix ?? '').trim();
  const refundMsgCombined =
    prefix && refundLine
      ? `${prefix} ${refundLine}`
      : prefix
        ? prefix
        : refundLine || null;

  const bookingTime = typeof booking.booking_time === 'string' ? booking.booking_time.slice(0, 5) : '';
  const cancelBookingEmail: BookingEmailData = {
    id: bookingId,
    guest_name: formatGuestDisplayName(guestRow?.first_name, guestRow?.last_name),
    guest_email: guestRow?.email ?? null,
    guest_phone: guestRow?.phone ?? null,
    booking_date: booking.booking_date as string,
    booking_time: bookingTime,
    party_size: booking.party_size as number,
    deposit_amount_pence: depositPenceForMessage ?? (booking.deposit_amount_pence as number | null) ?? null,
    deposit_status: booking.deposit_status as string | null,
  };
  const cancelVenueEmail = venueRowToEmailData({
    name: venueRow?.name ?? 'Venue',
    address: venueRow?.address ?? null,
    phone: venueRow?.phone ?? null,
    email: (venueRow as { email?: string | null } | null)?.email ?? null,
    reply_to_email: (venueRow as { reply_to_email?: string | null } | null)?.reply_to_email ?? null,
  });

  const cancelledBookingForWaitlist = {
    id: bookingId,
    venue_id: venueId,
    booking_date: String(booking.booking_date),
    booking_time: String(booking.booking_time),
    practitioner_id: booking.practitioner_id as string | null | undefined,
    calendar_id: booking.calendar_id as string | null | undefined,
    appointment_service_id: booking.appointment_service_id as string | null | undefined,
    service_item_id: booking.service_item_id as string | null | undefined,
    booking_model: (booking as { booking_model?: string | null }).booking_model,
    experience_event_id: booking.experience_event_id as string | null | undefined,
    class_instance_id: booking.class_instance_id as string | null | undefined,
    resource_id: booking.resource_id as string | null | undefined,
    event_session_id: booking.event_session_id as string | null | undefined,
  };

  try {
    await offerAppointmentWaitlistOnCancel(admin, cancelledBookingForWaitlist);
  } catch (waitlistErr) {
    console.error('[staff-cancel-booking] waitlist offer failed:', waitlistErr, { bookingId });
  }

  let scheduleNotification: (() => Promise<void>) | undefined;
  if (guestRow && venueRow?.name) {
    scheduleNotification = async () => {
      try {
        const enriched = await enrichBookingEmailForComms(admin, bookingId, cancelBookingEmail);
        await sendCancellationNotification(enriched, cancelVenueEmail, venueId, refundMsgCombined);
      } catch (commsErr) {
        console.error('[staff-cancel-booking] cancellation notification failed:', commsErr);
      }
    };
  }

  return { cancelled: true, scheduleNotification };
}
