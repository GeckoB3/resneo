/**
 * Resolve the "Location" block for booking emails from the booking's service-location
 * snapshot. Business venue (or no snapshot) keeps today's behaviour: venue address +
 * Google Maps directions. Client-address services show the client's own address (no
 * directions button — the client lives there). Online services show "Online" with the
 * join link and any joining instructions.
 */

import type { BookingEmailData, VenueEmailData } from '@/lib/emails/types';
import { buildGoogleMapsDirectionsUrl } from '@/lib/emails/external-links';

export interface ResolvedEmailLocation {
  kind: 'business_venue' | 'client_address' | 'online';
  /** Value for a "Location" label/value detail row; null = omit the row. */
  rowValue: string | null;
  /** Secondary line under the value (online joining info). */
  rowExtra: string | null;
  /** Online join link; rendered as a button/link wherever the row appears. */
  joinUrl: string | null;
  /** Google Maps directions — business venue only. */
  mapsUrl: string | null;
  /** `location` param for the Google Calendar add link. */
  calendarLocation: string | null;
  /** Plain-text lines for text-part emails. */
  textLines: string[];
}

export function resolveEmailLocation(
  booking: BookingEmailData,
  venue: VenueEmailData,
): ResolvedEmailLocation {
  const loc = booking.booking_location;

  if (loc?.kind === 'online') {
    const url = loc.online_url?.trim() || null;
    const info = loc.online_info?.trim() || null;
    return {
      kind: 'online',
      rowValue: 'Online',
      rowExtra: info,
      joinUrl: url,
      mapsUrl: null,
      calendarLocation: url ?? 'Online',
      textLines: [
        `Location: Online`,
        ...(url ? [`Join online: ${url}`] : []),
        ...(info ? [info] : []),
      ],
    };
  }

  if (loc?.kind === 'client_address') {
    const addr = loc.client_address?.trim() || null;
    return {
      kind: 'client_address',
      rowValue: addr ? `Your address (${addr})` : 'Your address',
      rowExtra: null,
      joinUrl: null,
      mapsUrl: null,
      calendarLocation: addr,
      textLines: addr ? [`Location: Your address (${addr})`] : ['Location: Your address'],
    };
  }

  const venueAddress = venue.address?.trim() || null;
  const mapsUrl = buildGoogleMapsDirectionsUrl(venueAddress);
  return {
    kind: 'business_venue',
    rowValue: venueAddress,
    rowExtra: null,
    joinUrl: null,
    mapsUrl,
    calendarLocation: venueAddress,
    textLines: [
      ...(venueAddress ? [`Location: ${venueAddress}`] : []),
      ...(mapsUrl ? [`Location (Google Maps): ${mapsUrl}`] : []),
    ],
  };
}
