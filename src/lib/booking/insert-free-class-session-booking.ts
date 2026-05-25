import { after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { computeClassAvailability, fetchClassInput } from '@/lib/availability/class-session-engine';
import { cancellationDeadlineHoursBefore } from '@/lib/booking/cancellation-deadline';
import { resolveCancellationNoticeHoursForCreate } from '@/lib/booking/resolve-cancellation-notice-hours';
import { generateConfirmToken, hashConfirmToken } from '@/lib/confirm-token';
import { venueRowToEmailData } from '@/lib/emails/venue-email-data';
import type { GuestRecord } from '@/lib/guests';
import { formatGuestDisplayName } from '@/lib/guests/name';
import { sendBookingConfirmationNotifications } from '@/lib/communications/send-templated';
import { createOrGetBookingShortLink } from '@/lib/booking-short-links';
import type { ClassPaymentRequirement } from '@/types/booking-models';

export interface InsertFreeClassSessionBookingParams {
  admin: SupabaseClient;
  venueId: string;
  venue: Record<string, unknown>;
  guest: GuestRecord;
  guestName: string;
  guestEmail: string | null;
  guestPhoneE164: string;
  classInstanceId: string;
  partySize: number;
  source: 'online' | 'widget' | 'booking_page';
  groupBookingId: string | null;
  /** When true, skip confirmation email/SMS (e.g. recurring materialization batch). */
  skipGuestNotifications?: boolean;
  /**
   * When true, allow creating a Booked class row even if the class type normally requires card prepayment
   * (caller has already verified credits, course entitlement, or membership).
   */
  settleWithoutOnlineCard?: boolean;
  /** When set, the booking is attributed to this recurring reservation rule for lineage tracking. */
  classRecurringReservationId?: string | null;
}

/**
 * Creates a **Booked** class_session row when no online card charge is required
 * (`payment_requirement = none` or zero price). Sends confirmation email like `/api/booking/create`.
 */
export async function insertFreeClassSessionBooking(
  params: InsertFreeClassSessionBookingParams,
): Promise<{ ok: true; bookingId: string } | { ok: false; status: number; error: string }> {
  const {
    admin,
    venueId,
    venue,
    guest,
    guestName,
    guestEmail,
    guestPhoneE164,
    classInstanceId,
    partySize,
    source,
    groupBookingId,
    skipGuestNotifications = false,
    settleWithoutOnlineCard = false,
    classRecurringReservationId = null,
  } = params;

  const { data: inst, error: instErr } = await admin
    .from('class_instances')
    .select('id, instance_date, start_time, is_cancelled, class_type_id')
    .eq('id', classInstanceId)
    .maybeSingle();

  if (instErr || !inst) {
    return { ok: false, status: 404, error: 'Class session not found' };
  }

  const row = inst as unknown as {
    instance_date: string;
    start_time: string;
    is_cancelled: boolean;
    class_type_id: string;
  };

  if (row.is_cancelled) {
    return { ok: false, status: 409, error: 'This class session is not available' };
  }

  const { data: ctRow, error: ctErr } = await admin
    .from('class_types')
    .select('payment_requirement, price_pence, deposit_amount_pence, duration_minutes, name')
    .eq('id', row.class_type_id)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (ctErr || !ctRow) {
    return { ok: false, status: 404, error: 'Class type not found' };
  }

  const ct = ctRow as {
    payment_requirement?: ClassPaymentRequirement;
    price_pence?: number | null;
    deposit_amount_pence?: number | null;
    duration_minutes?: number;
    name?: string;
  };
  const payReq = ct?.payment_requirement ?? 'none';
  const priceP = ct?.price_pence ?? 0;
  const depPer = ct?.deposit_amount_pence ?? 0;
  const requiresPaid =
    (payReq === 'full_payment' && priceP > 0) || (payReq === 'deposit' && depPer > 0 && priceP > 0);
  if (requiresPaid && !settleWithoutOnlineCard) {
    return {
      ok: false,
      status: 400,
      error: 'This class requires online payment; use the standard booking or credit flow.',
    };
  }

  const bookingDate = row.instance_date;
  const timeForDb =
    String(row.start_time).length === 5 ? `${String(row.start_time)}:00` : String(row.start_time);
  const timeStr = timeForDb.slice(0, 5);

  const input = await fetchClassInput({
    supabase: admin,
    venueId,
    date: bookingDate,
    forPublicBooking: true,
  });
  const result = computeClassAvailability(input);
  const cls = result.find((c) => c.instance_id === classInstanceId);
  if (!cls || cls.remaining < partySize) {
    return { ok: false, status: 409, error: 'This class is full or unavailable' };
  }

  const durationMin = ct?.duration_minutes ?? 60;
  const [y, mo, d] = bookingDate.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const endDate = new Date(Date.UTC(y!, mo! - 1, d!, hh!, mm!, 0));
  endDate.setUTCMinutes(endDate.getUTCMinutes() + durationMin);
  const estimatedEndTime = endDate.toISOString();

  const refundWindowHours = await resolveCancellationNoticeHoursForCreate({
    supabase: admin,
    venueId,
    effectiveModel: 'class_session',
    classInstanceId,
  });
  const cancellation_deadline = cancellationDeadlineHoursBefore(bookingDate, timeForDb, refundWindowHours);
  const cancellationPolicySnapshot = {
    refund_window_hours: refundWindowHours,
    policy: `Full refund if cancelled ${refundWindowHours}+ hours before your booking start time. No refund within ${refundWindowHours} hours of the start or for no-shows.`,
  };

  const pp = cls.price_pence ?? priceP;
  const classPriceDisplay = pp > 0 ? `£${((pp * partySize) / 100).toFixed(2)}` : null;

  const bookingInsert: Record<string, unknown> = {
    venue_id: venueId,
    guest_id: guest.id,
    booking_date: bookingDate,
    booking_time: timeForDb,
    party_size: partySize,
    booking_model: 'class_session',
    status: 'Booked',
    source,
    dietary_notes: null,
    occasion: null,
    special_requests: null,
    guest_email: guestEmail,
    guest_first_name: guest.first_name,
    guest_last_name: guest.last_name,
    guest_phone: guestPhoneE164 || guest.phone || null,
    deposit_amount_pence: null,
    deposit_status: 'Not Required',
    cancellation_deadline,
    cancellation_policy_snapshot: cancellationPolicySnapshot,
    estimated_end_time: estimatedEndTime,
    class_instance_id: classInstanceId,
    capacity_used: partySize,
    group_booking_id: groupBookingId,
    class_recurring_reservation_id: classRecurringReservationId,
  };

  const { data: booking, error: bookErr } = await admin
    .from('bookings')
    .insert(bookingInsert)
    .select('id')
    .single();

  if (bookErr || !booking) {
    console.error('[insertFreeClassSessionBooking] insert failed', bookErr);
    return { ok: false, status: 500, error: 'Failed to create booking' };
  }

  const bookingId = (booking as { id: string }).id;

  const manageToken = generateConfirmToken();
  await admin
    .from('bookings')
    .update({
      confirm_token_hash: hashConfirmToken(manageToken),
      updated_at: new Date().toISOString(),
    })
    .eq('id', bookingId);

  const manageBookingLink = await createOrGetBookingShortLink({
    venueId,
    bookingId,
    purpose: 'manage',
  });

  if (!skipGuestNotifications && (guest.email || guest.phone)) {
    after(async () => {
      try {
        const { email, sms } = await sendBookingConfirmationNotifications(
          {
            id: bookingId,
            guest_name: formatGuestDisplayName(guest.first_name, guest.last_name) || guestName,
            guest_email: guest.email ?? guestEmail,
            guest_phone: guest.phone ?? guestPhoneE164,
            booking_date: bookingDate,
            booking_time: timeStr,
            party_size: partySize,
            dietary_notes: null,
            deposit_amount_pence: null,
            deposit_status: 'Not Required',
            manage_booking_link: manageBookingLink,
            email_variant: 'appointment',
            booking_model: 'class_session',
            appointment_service_name: cls.class_name,
            practitioner_name: null,
            appointment_price_display: classPriceDisplay,
          },
          venueRowToEmailData({
            name: venue.name as string,
            address: (venue.address as string | null) ?? null,
            email: (venue as { email?: string | null }).email ?? null,
            reply_to_email: (venue as { reply_to_email?: string | null }).reply_to_email ?? null,
          }),
          venueId,
        );
        if (!email.sent) console.warn('[insertFreeClassSessionBooking] email not sent:', email.reason);
        if (!sms.sent && sms.reason !== 'skipped' && sms.reason !== 'no_phone') {
          console.warn('[insertFreeClassSessionBooking] sms not sent:', sms.reason);
        }
      } catch (err) {
        console.error('[insertFreeClassSessionBooking] notifications failed', err);
      }
    });
  }

  return { ok: true, bookingId };
}
