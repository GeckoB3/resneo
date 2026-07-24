import type { SupabaseClient } from '@supabase/supabase-js';
import type { BookingEmailData, VenueEmailData } from '@/lib/emails/types';
import { enrichBookingEmailForComms } from '@/lib/emails/booking-email-enrichment';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { ensureComplianceFormLinksForBooking } from '@/lib/compliance/auto-send';
import { renderCardHoldChargedEmail } from '@/lib/emails/templates/card-hold-charged';
import { renderPaymentReceiptEmail } from '@/lib/emails/templates/payment-receipt';
import { venueRowToEmailData } from '@/lib/emails/venue-email-data';
import { formatGuestDisplayName } from '@/lib/guests/name';
import type { BookingModel } from '@/types/booking-models';
import { sendOwnerBookingNotification } from './owner-booking-notification';
import { sendStaffPush } from './staff-push-notification';
import { sendPolicyMessage } from './outbound';
import { deliverEmailMessage } from './delivery';
import { inferCommunicationLaneFromBookingModel } from './policies';

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

/**
 * Card-hold deposits (§10.2): load the consented no-show fee from the booking's
 * OPEN hold row so the confirmation copy (payment status line, SMS suffix, hold
 * notice) can render it. Same field Phase 3 threads for the card-request
 * senders (`BookingEmailData.card_hold_fee_pence`); callers that already set it
 * win. `deposit_status` is backfilled from the row only when the caller did not
 * provide it (the hold copy is keyed on it).
 */
async function attachCardHoldFee(
  admin: SupabaseClient,
  booking: BookingEmailData,
): Promise<BookingEmailData> {
  if (!booking.id?.trim()) return booking;
  if (typeof booking.card_hold_fee_pence === 'number' && booking.card_hold_fee_pence > 0) {
    return booking;
  }
  try {
    const { data: hold } = await admin
      .from('booking_card_holds')
      .select('fee_pence, released_at')
      .eq('booking_id', booking.id)
      .maybeSingle();
    const h = hold as { fee_pence?: number | null; released_at?: string | null } | null;
    if (!h || h.released_at || typeof h.fee_pence !== 'number' || h.fee_pence <= 0) {
      return booking;
    }
    let depositStatus = booking.deposit_status ?? null;
    if (!depositStatus) {
      const { data: row } = await admin
        .from('bookings')
        .select('deposit_status')
        .eq('id', booking.id)
        .maybeSingle();
      depositStatus = (row as { deposit_status?: string | null } | null)?.deposit_status ?? null;
    }
    return { ...booking, card_hold_fee_pence: h.fee_pence, deposit_status: depositStatus };
  } catch (err) {
    console.error('[send-templated] attachCardHoldFee failed', { bookingId: booking.id, err });
    return booking;
  }
}

async function enrichBookingForConfirmation(booking: BookingEmailData): Promise<BookingEmailData> {
  if (!booking.id?.trim()) return booking;
  const admin = getSupabaseAdminClient();
  try {
    const enriched = await enrichBookingEmailForComms(admin, booking.id, booking);
    const withHold = await attachCardHoldFee(admin, enriched);
    return await attachComplianceForms(admin, withHold);
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

/**
 * Card-hold bookings (card_hold deposits §10.3): ask the guest to add card
 * details to secure the booking. Mirrors sendDepositRequestNotifications:
 * email is always attempted subject to the venue's communication policy for
 * the message key; SMS is sent when the guest has a phone number, subject to
 * the same policy. `opts.reminder` switches to the `card_hold_payment_reminder`
 * key (reminder cron / re-sends); `feePence` is the consented no-show maximum.
 */
export async function sendCardHoldRequestNotifications(
  booking: BookingEmailData,
  venue: VenueEmailData,
  venueId: string,
  paymentLink: string,
  feePence: number,
  opts?: { reminder?: boolean },
): Promise<{ email: SendResult; sms: SendResult }> {
  const messageKey = opts?.reminder
    ? ('card_hold_payment_reminder' as const)
    : ('card_hold_request' as const);
  const holdBooking: BookingEmailData = { ...booking, card_hold_fee_pence: feePence };
  const email = await sendPolicyMessage({
    venueId,
    booking: holdBooking,
    venue,
    messageKey,
    channel: 'email',
    mode: 'dedupe',
    paymentLink,
  });
  let sms: SendResult = { sent: false, reason: 'no_phone' };
  if (booking.guest_phone) {
    sms = await sendPolicyMessage({
      venueId,
      booking: holdBooking,
      venue,
      messageKey,
      channel: 'sms',
      mode: 'dedupe',
      paymentLink,
    });
  }
  return { email, sms };
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

/**
 * No-show fee receipt (card_hold deposits §10.2.2), comm-log type
 * `card_hold_charged_email`. Deliberately NOT policy-gated: it is the receipt
 * of record for money taken, sent by the charge engine (synchronous success)
 * and the fee-PI webhook. Delivery uses dedupe mode so the route/webhook
 * overlap sends exactly one email per booking. Loads everything from ids so
 * both callers stay thin.
 */
export async function sendCardHoldChargedReceipt(params: {
  bookingId: string;
  venueId: string;
  chargedPence: number;
  chargedAt: string;
}): Promise<SendResult> {
  const { bookingId, venueId, chargedPence, chargedAt } = params;
  const admin = getSupabaseAdminClient();

  const { data: bookingRow } = await admin
    .from('bookings')
    .select('id, guest_id, guest_email, booking_date, booking_time, party_size, booking_model')
    .eq('id', bookingId)
    .maybeSingle();
  const b = bookingRow as
    | {
        guest_id: string | null;
        guest_email: string | null;
        booking_date: string;
        booking_time: string | null;
        party_size: number | null;
        booking_model: string | null;
      }
    | null;
  if (!b) return { sent: false, reason: 'booking_not_found' };

  const { data: venueRow } = await admin
    .from('venues')
    .select('name, address, phone, email, reply_to_email, logo_url, website_url, timezone, booking_model')
    .eq('id', venueId)
    .maybeSingle();
  const v = venueRow as
    | {
        name?: string | null;
        address?: string | null;
        phone?: string | null;
        email?: string | null;
        reply_to_email?: string | null;
        logo_url?: string | null;
        website_url?: string | null;
        timezone?: string | null;
        booking_model?: string | null;
      }
    | null;
  if (!v?.name) return { sent: false, reason: 'venue_not_found' };

  type GuestNameRow = {
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
  };
  let guest: GuestNameRow | null = null;
  if (b.guest_id) {
    const { data: guestRow } = await admin
      .from('guests')
      .select('first_name, last_name, email')
      .eq('id', b.guest_id)
      .maybeSingle();
    // `as typeof guest` would use the narrowed type (null) here; name the row type instead.
    guest = (guestRow ?? null) as GuestNameRow | null;
  }

  const recipientEmail = guest?.email?.trim() || b.guest_email?.trim() || null;
  if (!recipientEmail) return { sent: false, reason: 'no_email' };

  const bookingModel = (b.booking_model ?? v.booking_model ?? null) as BookingModel | null;
  const base: BookingEmailData = {
    id: bookingId,
    guest_name: formatGuestDisplayName(guest?.first_name, guest?.last_name),
    guest_email: recipientEmail,
    booking_date: b.booking_date,
    booking_time: typeof b.booking_time === 'string' ? b.booking_time.slice(0, 5) : '00:00',
    party_size: b.party_size ?? 1,
    ...(bookingModel ? { booking_model: bookingModel } : {}),
  };

  // Enrichment fills the bookingLabel noun (appointment_service_name) and
  // practitioner details for Model B and the secondary models.
  let booking = base;
  try {
    booking = await enrichBookingEmailForComms(admin, bookingId, base);
  } catch (err) {
    console.error('[sendCardHoldChargedReceipt] enrichment failed, sending plain', { bookingId, err });
  }

  const venueData = venueRowToEmailData({
    name: v.name,
    address: v.address ?? null,
    phone: v.phone ?? null,
    email: v.email ?? null,
    reply_to_email: v.reply_to_email ?? null,
    logo_url: v.logo_url ?? null,
    website_url: v.website_url ?? null,
    timezone: v.timezone ?? null,
  });

  const rendered = renderCardHoldChargedEmail(booking, venueData, { chargedPence, chargedAt });

  return deliverEmailMessage(
    {
      venueId,
      bookingId,
      lane: inferCommunicationLaneFromBookingModel(bookingModel),
      messageType: 'card_hold_charged_email',
      recipient: recipientEmail,
      emailFromDisplayName: venueData.name,
      emailReplyTo: venueData.reply_to_email ?? null,
    },
    rendered,
    'dedupe',
  );
}

/**
 * In-person payment receipt (§6.5), sent by the balance webhook on
 * `payment_intent.succeeded`. Email is the customer's record: a direct-charge
 * card-present payment has no Stripe-hosted email by default.
 *
 * Log mode is `upsert`, NOT `dedupe`: a booking can carry several balance
 * payments (equal-amount split payments, §6.3c) and each must send its own
 * receipt — dedupe would silently swallow every receipt after the first.
 * Webhook idempotency (the `webhook_events` claim) already prevents duplicate
 * sends for the same payment.
 */
export async function sendPaymentReceiptEmail(params: {
  bookingId: string;
  venueId: string;
  amountPaidPence: number;
  paidAt: string;
}): Promise<SendResult> {
  const { bookingId, venueId, amountPaidPence, paidAt } = params;
  const admin = getSupabaseAdminClient();

  const { data: bookingRow } = await admin
    .from('bookings')
    .select('id, guest_id, guest_email, booking_date, booking_time, party_size, booking_model')
    .eq('id', bookingId)
    .maybeSingle();
  const b = bookingRow as
    | {
        guest_id: string | null;
        guest_email: string | null;
        booking_date: string;
        booking_time: string | null;
        party_size: number | null;
        booking_model: string | null;
      }
    | null;
  if (!b) return { sent: false, reason: 'booking_not_found' };

  const { data: venueRow } = await admin
    .from('venues')
    .select('name, address, phone, email, reply_to_email, logo_url, website_url, timezone, booking_model')
    .eq('id', venueId)
    .maybeSingle();
  const v = venueRow as
    | {
        name?: string | null;
        address?: string | null;
        phone?: string | null;
        email?: string | null;
        reply_to_email?: string | null;
        logo_url?: string | null;
        website_url?: string | null;
        timezone?: string | null;
        booking_model?: string | null;
      }
    | null;
  if (!v?.name) return { sent: false, reason: 'venue_not_found' };

  type GuestNameRow = {
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
  };
  let guest: GuestNameRow | null = null;
  if (b.guest_id) {
    const { data: guestRow } = await admin
      .from('guests')
      .select('first_name, last_name, email')
      .eq('id', b.guest_id)
      .maybeSingle();
    guest = (guestRow ?? null) as GuestNameRow | null;
  }

  const recipientEmail = guest?.email?.trim() || b.guest_email?.trim() || null;
  if (!recipientEmail) return { sent: false, reason: 'no_email' };

  const bookingModel = (b.booking_model ?? v.booking_model ?? null) as BookingModel | null;
  const base: BookingEmailData = {
    id: bookingId,
    guest_name: formatGuestDisplayName(guest?.first_name, guest?.last_name),
    guest_email: recipientEmail,
    booking_date: b.booking_date,
    booking_time: typeof b.booking_time === 'string' ? b.booking_time.slice(0, 5) : '00:00',
    party_size: b.party_size ?? 1,
    ...(bookingModel ? { booking_model: bookingModel } : {}),
  };

  // Enrichment fills the bookingLabel noun (appointment_service_name) and
  // practitioner details for Model B and the secondary models.
  let booking = base;
  try {
    booking = await enrichBookingEmailForComms(admin, bookingId, base);
  } catch (err) {
    console.error('[sendPaymentReceiptEmail] enrichment failed, sending plain', { bookingId, err });
  }

  const venueData = venueRowToEmailData({
    name: v.name,
    address: v.address ?? null,
    phone: v.phone ?? null,
    email: v.email ?? null,
    reply_to_email: v.reply_to_email ?? null,
    logo_url: v.logo_url ?? null,
    website_url: v.website_url ?? null,
    timezone: v.timezone ?? null,
  });

  const rendered = renderPaymentReceiptEmail(booking, venueData, { amountPaidPence, paidAt });

  return deliverEmailMessage(
    {
      venueId,
      bookingId,
      lane: inferCommunicationLaneFromBookingModel(bookingModel),
      messageType: 'payment_receipt_email',
      recipient: recipientEmail,
      emailFromDisplayName: venueData.name,
      emailReplyTo: venueData.reply_to_email ?? null,
    },
    rendered,
    'upsert',
  );
}
