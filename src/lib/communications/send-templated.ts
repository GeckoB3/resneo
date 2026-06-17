import type { SupabaseClient } from '@supabase/supabase-js';
import type { BookingEmailData, VenueEmailData } from '@/lib/emails/types';
import { enrichBookingEmailForComms } from '@/lib/emails/booking-email-enrichment';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { ensureComplianceFormLinksForBooking } from '@/lib/compliance/auto-send';
import { sendOwnerBookingNotification } from './owner-booking-notification';
import { sendStaffPush } from './staff-push-notification';
import { sendPolicyMessage } from './outbound';

/**
 * Auto-issue (or reuse) compliance form links for this booking and attach them so
 * the confirmation carries a "Forms to complete" block (Phase 1, G1+G2). No-op when
 * compliance / auto-send is off, the booking isn't Model B, or nothing is unmet.
 */
async function attachComplianceForms(
  admin: SupabaseClient,
  booking: BookingEmailData,
): Promise<BookingEmailData> {
  if (!booking.id?.trim()) return booking;
  try {
    const { data: row } = await admin
      .from('bookings')
      .select('venue_id, guest_id, appointment_service_id, service_item_id, booking_date, booking_time')
      .eq('id', booking.id)
      .maybeSingle();
    if (!row) return booking;
    const r = row as {
      venue_id: string;
      guest_id: string | null;
      appointment_service_id: string | null;
      service_item_id: string | null;
      booking_date: string;
      booking_time: string | null;
    };
    const forms = await ensureComplianceFormLinksForBooking(admin, {
      venueId: r.venue_id,
      guestId: r.guest_id,
      bookingId: booking.id,
      appointmentServiceId: r.appointment_service_id,
      serviceItemId: r.service_item_id,
      bookingDate: r.booking_date,
      bookingTime: r.booking_time,
    });
    return forms.length > 0 ? { ...booking, compliance_forms: forms } : booking;
  } catch (err) {
    console.error('[send-templated] attachComplianceForms failed', { bookingId: booking.id, err });
    return booking;
  }
}

async function enrichBookingForConfirmation(booking: BookingEmailData): Promise<BookingEmailData> {
  if (!booking.id?.trim()) return booking;
  const admin = getSupabaseAdminClient();
  try {
    const enriched = await enrichBookingEmailForComms(admin, booking.id, booking);
    return await attachComplianceForms(admin, enriched);
  } catch (err) {
    console.error('[send-templated] enrichBookingForConfirmation failed', {
      bookingId: booking.id,
      err,
    });
    return booking;
  }
}

interface SendResult {
  sent: boolean;
  reason?: string;
}

export async function sendBookingConfirmationEmail(
  booking: BookingEmailData,
  venue: VenueEmailData,
  venueId: string,
): Promise<SendResult> {
  return sendPolicyMessage({
    venueId,
    booking,
    venue,
    messageKey: 'booking_confirmation',
    channel: 'email',
    mode: 'dedupe',
  });
}

/**
 * Booking confirmation SMS — routed by `communication_policies` (lane + channels).
 * Default is email-only; venues enable SMS per lane under Communications settings.
 */
export async function sendBookingConfirmationSms(
  booking: BookingEmailData,
  venue: VenueEmailData,
  venueId: string,
  guestPhone?: string | null,
): Promise<SendResult> {
  return sendPolicyMessage({
    venueId,
    booking: {
      ...booking,
      guest_phone: guestPhone ?? booking.guest_phone ?? null,
    },
    venue,
    messageKey: 'booking_confirmation',
    channel: 'sms',
    mode: 'dedupe',
  });
}

export async function sendBookingConfirmationNotifications(
  booking: BookingEmailData,
  venue: VenueEmailData,
  venueId: string,
): Promise<{ email: SendResult; sms: SendResult }> {
  const enriched = await enrichBookingForConfirmation(booking);
  const email = await sendBookingConfirmationEmail(enriched, venue, venueId);
  const sms = await sendBookingConfirmationSms(enriched, venue, venueId);
  // New booking alert to the business owner — venue-level setting, independent of the
  // guest confirmation policy above. Deduped per booking inside the sender.
  await sendOwnerBookingNotification(enriched, venue, venueId);
  // Push the new booking to staff devices (per-user prefs honoured in the sender).
  await sendStaffPush(enriched, venue, venueId, 'new_booking');
  return { email, sms };
}

export async function sendDepositRequestEmail(
  booking: BookingEmailData,
  venue: VenueEmailData,
  venueId: string,
  paymentLink: string,
): Promise<SendResult> {
  return sendPolicyMessage({
    venueId,
    booking,
    venue,
    messageKey: 'deposit_payment_request',
    channel: 'email',
    mode: 'dedupe',
    paymentLink,
    paymentDeadlineHours: 24,
  });
}

/**
 * Staff / pay-by-link flows only: send deposit request email and/or SMS per settings and tier.
 */
export async function sendDepositRequestNotifications(
  booking: BookingEmailData,
  venue: VenueEmailData,
  venueId: string,
  paymentLink: string,
): Promise<{ email: SendResult; sms: SendResult }> {
  const email = await sendDepositRequestEmail(booking, venue, venueId, paymentLink);
  let sms: SendResult = { sent: false, reason: 'no_phone' };
  if (booking.guest_phone) {
    sms = await sendDepositRequestSms(booking, venue, venueId, paymentLink, booking.guest_phone);
  }
  return { email, sms };
}

export async function sendDepositRequestSms(
  booking: BookingEmailData,
  venue: VenueEmailData,
  venueId: string,
  paymentLink: string,
  guestPhone: string,
): Promise<SendResult> {
  return sendPolicyMessage({
    venueId,
    booking: {
      ...booking,
      guest_phone: guestPhone,
    },
    venue,
    messageKey: 'deposit_payment_request',
    channel: 'sms',
    mode: 'dedupe',
    paymentLink,
    paymentDeadlineHours: 24,
  });
}

export async function sendDepositConfirmationEmail(
  booking: BookingEmailData,
  venue: VenueEmailData,
  venueId: string,
): Promise<SendResult> {
  return sendPolicyMessage({
    venueId,
    booking,
    venue,
    messageKey: 'deposit_confirmation',
    channel: 'email',
    mode: 'dedupe',
  });
}

/**
 * Send booking modification notification email and/or SMS based on venue settings.
 * No dedup - the same booking can be modified multiple times.
 */
export async function sendBookingModificationNotification(
  booking: BookingEmailData,
  venue: VenueEmailData,
  venueId: string,
): Promise<{ email: SendResult; sms: SendResult }> {
  const [email, sms] = await Promise.all([
    sendPolicyMessage({
      venueId,
      booking,
      venue,
      messageKey: 'booking_modification',
      channel: 'email',
      mode: 'upsert',
    }),
    sendPolicyMessage({
      venueId,
      booking,
      venue,
      messageKey: 'booking_modification',
      channel: 'sms',
      mode: 'upsert',
    }),
  ]);
  await sendStaffPush(booking, venue, venueId, 'reschedule');
  return { email, sms };
}

/**
 * Send booking cancellation notification email and/or SMS based on venue settings.
 * A booking can only be cancelled once, so trySendWithDedup would work, but we
 * use upsert for consistency with the modification pattern.
 */
export async function sendCancellationNotification(
  booking: BookingEmailData,
  venue: VenueEmailData,
  venueId: string,
  refundMessage?: string | null,
): Promise<{ email: SendResult; sms: SendResult }> {
  const [email, sms] = await Promise.all([
    sendPolicyMessage({
      venueId,
      booking,
      venue,
      messageKey: 'cancellation_confirmation',
      channel: 'email',
      mode: 'upsert',
      refundMessage: refundMessage ?? null,
      rebookLink: venue.booking_page_url ?? null,
    }),
    sendPolicyMessage({
      venueId,
      booking,
      venue,
      messageKey: 'cancellation_confirmation',
      channel: 'sms',
      mode: 'upsert',
      refundMessage: refundMessage ?? null,
      rebookLink: venue.booking_page_url ?? null,
    }),
  ]);
  await sendStaffPush(booking, venue, venueId, 'cancellation');
  return { email, sms };
}
