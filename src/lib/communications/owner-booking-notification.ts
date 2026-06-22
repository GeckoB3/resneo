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

/**
 * Location block for the new-booking alert, written from the STAFF perspective —
 * where the team member needs to be — which is deliberately different from the
 * guest-facing copy in booking-location.ts:
 *   • online         → "Online" plus the join link and joining instructions, so
 *                       whoever delivers the service can connect.
 *   • client_address → the client's address, so the staff member knows where to
 *                       travel for the appointment.
 *   • business venue → the venue address (or nothing when the venue has no address).
 * Returns the "Location" detail-row value/link/extra for the HTML layout, plus the
 * matching plain-text lines. Falls back to the venue address whenever the booking
 * carries no location snapshot (legacy rows / non-appointment models).
 */
function resolveOwnerLocation(
  booking: BookingEmailData,
  venue: VenueEmailData,
): { rowValue: string | null; joinUrl: string | null; extra: string | null; textLines: string[] } {
  const loc = booking.booking_location;

  if (loc?.kind === 'online') {
    const url = loc.online_url?.trim() || null;
    const info = loc.online_info?.trim() || null;
    return {
      rowValue: 'Online',
      joinUrl: url,
      extra: info,
      textLines: [
        'Location: Online',
        ...(url ? [`Join link: ${url}`] : []),
        ...(info ? [`Joining info: ${info}`] : []),
      ],
    };
  }

  if (loc?.kind === 'client_address') {
    const addr = loc.client_address?.trim() || null;
    const value = addr ? `Client's address — ${addr}` : "Client's address";
    return { rowValue: value, joinUrl: null, extra: null, textLines: [`Location: ${value}`] };
  }

  const venueAddress = venue.address?.trim() || null;
  return {
    rowValue: venueAddress,
    joinUrl: null,
    extra: null,
    textLines: venueAddress ? [`Location: ${venueAddress}`] : [],
  };
}

export function renderOwnerBookingNotificationEmail(
  booking: BookingEmailData,
  venue: VenueEmailData,
): { subject: string; html: string; text: string } {
  const dateText = formatDate(booking.booking_date);
  const timeText = formatTime(booking.booking_time);
  const guestName = booking.guest_name?.trim() || 'A guest';
  const isAppt = booking.email_variant === 'appointment';
  const location = resolveOwnerLocation(booking, venue);

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
    venueAddress: location.rowValue,
    locationJoinUrl: location.joinUrl,
    locationExtra: location.extra,
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
    ...location.textLines,
    ...(contactLines.length ? [`Guest contact: ${contactLines.join(' / ')}`] : []),
    ...(booking.special_requests?.trim() ? [`Notes: ${booking.special_requests.trim()}`] : []),
    '',
    'You are receiving this because new booking alerts are switched on in your ResNeo communication settings.',
  ];

  return { subject, html, text: textLines.join('\n') };
}
