/**
 * Google Calendar "template" URLs for "Add to calendar" in confirmation emails.
 * Uses venue-local start/end derived from booking wall time + default duration by booking model.
 */

import type { BookingEmailData, VenueEmailData } from '@/lib/emails/types';
import type { BookingModel } from '@/types/booking-models';
import { venueLocalWallTimeToUtcMs } from '@/lib/venue/venue-local-clock';

function formatGoogleUtcEpochMs(utcMs: number): string {
  const d = new Date(utcMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const h = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  const s = String(d.getUTCSeconds()).padStart(2, '0');
  return `${y}${m}${day}T${h}${min}${s}Z`;
}

function defaultDurationMinutes(booking: BookingEmailData): number {
  if (typeof booking.calendar_duration_minutes === 'number' && booking.calendar_duration_minutes > 0) {
    return Math.min(24 * 60, booking.calendar_duration_minutes);
  }
  const m = booking.booking_model;
  if (m === 'event_ticket') return 180;
  if (m === 'class_session') return 90;
  if (m === 'resource_booking') return 90;
  if (m === 'unified_scheduling' || m === 'practitioner_appointment') return 60;
  return 90;
}

function confirmationEventTitle(booking: BookingEmailData, venueName: string): string {
  const m = booking.booking_model as BookingModel | undefined;
  if (m === 'event_ticket') {
    return booking.appointment_service_name?.trim()
      ? `${venueName} – ${booking.appointment_service_name.trim()}`
      : `${venueName} – Event`;
  }
  if (m === 'class_session') {
    return booking.appointment_service_name?.trim()
      ? `${venueName} – ${booking.appointment_service_name.trim()}`
      : `${venueName} – Class`;
  }
  if (m === 'resource_booking') {
    return booking.appointment_service_name?.trim()
      ? `${venueName} – ${booking.appointment_service_name.trim()}`
      : `${venueName} – Booking`;
  }
  if (
    booking.email_variant === 'appointment' ||
    booking.practitioner_name ||
    booking.appointment_service_name
  ) {
    const svc = booking.appointment_service_name?.trim();
    return svc ? `${venueName} – ${svc}` : `${venueName} – Appointment`;
  }
  return `${venueName} – Table reservation`;
}

function confirmationEventDetails(booking: BookingEmailData, venue: VenueEmailData): string {
  const lines: string[] = [`Booking at ${venue.name}`];
  if (booking.appointment_service_name?.trim()) {
    lines.push(booking.appointment_service_name.trim());
  }
  if (booking.practitioner_name?.trim()) {
    lines.push(`With ${booking.practitioner_name.trim()}`);
  }
  lines.push(`Party size: ${booking.party_size}`);
  if (booking.manage_booking_link) {
    lines.push(`Manage booking: ${booking.manage_booking_link}`);
  }
  return lines.join('\n');
}

/**
 * Returns a Google Calendar URL that opens with fields pre-filled, or null if date/time is unusable.
 */
export function buildGoogleCalendarAddUrlForBooking(
  booking: BookingEmailData,
  venue: VenueEmailData,
): string | null {
  if (!booking.booking_date || !booking.booking_time) return null;
  const tz = venue.timezone?.trim() || 'Europe/London';
  const hm = booking.booking_time.trim().slice(0, 5);
  if (!/^\d{1,2}:\d{2}$/.test(hm)) return null;

  let startMs: number;
  try {
    startMs = venueLocalWallTimeToUtcMs(booking.booking_date, `${hm}:00`, tz);
  } catch {
    return null;
  }
  if (!Number.isFinite(startMs)) return null;

  const durationMins = defaultDurationMinutes(booking);
  const endMs = startMs + durationMins * 60 * 1000;
  const dates = `${formatGoogleUtcEpochMs(startMs)}/${formatGoogleUtcEpochMs(endMs)}`;

  const title = confirmationEventTitle(booking, venue.name);
  const details = confirmationEventDetails(booking, venue);
  // Calendar location follows the service delivery location: client's own address for
  // at-home services, the join link for online ones, else the venue address.
  const loc = booking.booking_location;
  const location =
    loc?.kind === 'client_address'
      ? loc.client_address?.trim() ?? ''
      : loc?.kind === 'online'
        ? loc.online_url?.trim() || 'Online'
        : venue.address?.trim() ?? '';

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates,
    details,
  });
  if (location) params.set('location', location);

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
