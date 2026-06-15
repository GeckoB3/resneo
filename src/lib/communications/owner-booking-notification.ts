import { getSupabaseAdminClient } from '@/lib/supabase';
import type { BookingEmailData, VenueEmailData } from '@/lib/emails/types';
import { renderTransactionalEmailHtml } from '@/lib/emails/templates/booking-confirmation-layout';
import { escapeHtml, formatDate, formatTime } from '@/lib/emails/templates/base-template';
import { inferCommunicationLaneFromBookingModel } from './policies';
import { deliverEmailMessage, type CommunicationSendResult } from './delivery';

/**
 * New booking alert to the business owner (Communications settings).
 *
 * Venue-level, email-only and off by default: when `venues.owner_booking_notification_enabled`
 * is on, every confirmed booking emails the venue. The recipient is
 * `owner_booking_notification_email` when set, otherwise the venue profile email.
 *
 * Independent of the guest `booking_confirmation` policy — the owner is alerted even when
 * guest confirmations are switched off. Logged with `mode: 'dedupe'`, so resends and
 * status flips never alert the owner twice for the same booking.
 */
export async function sendOwnerBookingNotification(
  booking: BookingEmailData,
  venue: VenueEmailData,
  venueId: string,
): Promise<CommunicationSendResult> {
  try {
    const admin = getSupabaseAdminClient();
    const { data } = await admin
      .from('venues')
      .select('owner_booking_notification_enabled, owner_booking_notification_email, email, booking_model')
      .eq('id', venueId)
      .maybeSingle();

    const row = data as {
      owner_booking_notification_enabled?: boolean | null;
      owner_booking_notification_email?: string | null;
      email?: string | null;
      booking_model?: string | null;
    } | null;

    if (!row?.owner_booking_notification_enabled) {
      return { sent: false, reason: 'disabled' };
    }

    const recipient =
      row.owner_booking_notification_email?.trim() || row.email?.trim() || null;
    if (!recipient) {
      return { sent: false, reason: 'no_email' };
    }

    const lane = inferCommunicationLaneFromBookingModel(
      booking.booking_model ?? row.booking_model,
    );
    const rendered = renderOwnerBookingNotificationEmail(booking, venue);

    return await deliverEmailMessage(
      {
        venueId,
        bookingId: booking.id,
        lane,
        messageType: 'owner_booking_notification_email',
        recipient,
        emailFromDisplayName: 'ResNeo',
        // Owner replies go straight to the guest.
        emailReplyTo: booking.guest_email?.trim() || null,
      },
      rendered,
      'dedupe',
    );
  } catch (err) {
    console.error('[sendOwnerBookingNotification] failed:', { bookingId: booking.id, err });
    return { sent: false, reason: 'send_error' };
  }
}

export function renderOwnerBookingNotificationEmail(
  booking: BookingEmailData,
  venue: VenueEmailData,
): { subject: string; html: string; text: string } {
  const dateText = formatDate(booking.booking_date);
  const timeText = formatTime(booking.booking_time);
  const guestName = booking.guest_name?.trim() || 'A guest';
  const isAppt = booking.email_variant === 'appointment';

  const subject = `New booking: ${guestName} — ${dateText} at ${timeText}`;

  const contactLines: string[] = [];
  if (booking.guest_email?.trim()) contactLines.push(booking.guest_email.trim());
  if (booking.guest_phone?.trim()) contactLines.push(booking.guest_phone.trim());
  const contactHtml = contactLines.length
    ? `<p style="margin:10px 0 0">Guest contact: ${contactLines.map((line) => escapeHtml(line)).join(' &middot; ')}</p>`
    : '';

  const mainContent =
    `<p style="margin:0">${escapeHtml(guestName)} has just made a booking at ${escapeHtml(venue.name)}.</p>` +
    contactHtml;

  const html = renderTransactionalEmailHtml({
    venueName: venue.name,
    venueLogoUrl: venue.logo_url,
    heading: 'New booking received',
    mainContent,
    bookingDate: dateText,
    bookingTime: timeText,
    partySize: booking.party_size,
    specialRequests: booking.special_requests?.trim() || null,
    emailVariant: booking.email_variant,
    practitionerName: booking.practitioner_name,
    serviceName: booking.appointment_service_name,
    priceDisplay: booking.appointment_price_display,
    groupAppointments: booking.group_appointments,
    addonLines: booking.addon_lines,
    footerNote:
      'You are receiving this because new booking alerts are switched on in your ResNeo communication settings.',
  });

  const textLines = [
    `${guestName} has just made a booking at ${venue.name}.`,
    '',
    `Date: ${dateText}`,
    `Time: ${timeText}`,
    ...(isAppt && booking.appointment_service_name ? [`Service: ${booking.appointment_service_name}`] : []),
    ...(isAppt && booking.practitioner_name ? [`With: ${booking.practitioner_name}`] : []),
    ...(!isAppt || booking.party_size > 1
      ? [`${isAppt ? 'People' : 'Guests'}: ${booking.party_size}`]
      : []),
    ...(contactLines.length ? [`Guest contact: ${contactLines.join(' / ')}`] : []),
    ...(booking.special_requests?.trim() ? [`Notes: ${booking.special_requests.trim()}`] : []),
    '',
    'You are receiving this because new booking alerts are switched on in your ResNeo communication settings.',
  ];

  return { subject, html, text: textLines.join('\n') };
}
