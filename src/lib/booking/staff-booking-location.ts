/**
 * Where a staff member has to be for a booking.
 *
 * Guests are told the location too, but their needs are the opposite of the team's: the guest email
 * deliberately omits directions for a client-address booking because the client lives there (see
 * `lib/emails/booking-location.ts`). Staff are the ones who have to travel, so here the address is a
 * Google Maps link and the online joining details are shown in full.
 *
 * Business-venue bookings resolve to null: the team already knows where their own venue is, and a
 * "Location: here" row on every booking would bury the ones that actually need attention. Legacy
 * rows created before the snapshot existed have a null `location_type` and resolve to null too.
 */

import { buildGoogleMapsDirectionsUrl } from '@/lib/emails/external-links';
import { formatClientAddressOneLine } from '@/lib/booking/service-location';

export type StaffBookingLocationKind = 'client_address' | 'online';

/** Why the useful part is absent, so the UI can say something better than nothing. */
export type StaffBookingLocationGap =
  | 'none'
  /** Client-address service saved without an address (legacy or staff-created booking). */
  | 'address_not_recorded'
  /** Linked-venue viewer without permission to see the other venue's client details. */
  | 'address_hidden'
  /** Online service with no meeting link set on the service. */
  | 'no_link';

export interface StaffBookingLocationView {
  kind: StaffBookingLocationKind;
  /** One-line client address; null when not recorded or hidden. */
  address: string | null;
  /** Google Maps link for the address; null when there is no address to search. */
  mapsUrl: string | null;
  /** Online joining link, read live from the service so a corrected link shows here. */
  joinUrl: string | null;
  /** Joining instructions shown to the client, so staff can answer questions about them. */
  joinInfo: string | null;
  gap: StaffBookingLocationGap;
}

export interface StaffBookingLocationInput {
  location_type?: string | null;
  client_address_line1?: string | null;
  client_address_line2?: string | null;
  client_address_city?: string | null;
  client_address_postcode?: string | null;
  /** Resolved live from the service; only present once the full booking detail has loaded. */
  online_meeting_url?: string | null;
  online_meeting_info?: string | null;
  /**
   * True when the viewer is a linked venue without PII rights, so the API nulled the address
   * fields. Without this the UI would tell staff the address was never recorded, which reads as a
   * data-entry mistake rather than a permission boundary.
   */
  addressHidden?: boolean;
}

/** Null when the booking is at the business venue, or predates the location snapshot. */
export function resolveStaffBookingLocation(
  input: StaffBookingLocationInput,
): StaffBookingLocationView | null {
  if (input.location_type === 'client_address') {
    const address = formatClientAddressOneLine({
      line1: input.client_address_line1,
      line2: input.client_address_line2,
      city: input.client_address_city,
      postcode: input.client_address_postcode,
    });
    return {
      kind: 'client_address',
      address,
      mapsUrl: buildGoogleMapsDirectionsUrl(address),
      joinUrl: null,
      joinInfo: null,
      gap: address ? 'none' : input.addressHidden ? 'address_hidden' : 'address_not_recorded',
    };
  }

  if (input.location_type === 'online') {
    const joinUrl = input.online_meeting_url?.trim() || null;
    return {
      kind: 'online',
      address: null,
      mapsUrl: null,
      joinUrl,
      joinInfo: input.online_meeting_info?.trim() || null,
      gap: joinUrl ? 'none' : 'no_link',
    };
  }

  return null;
}

/** Short marker for a collapsed list row, where there is only room for a couple of words. */
export function staffBookingLocationPillLabel(kind: StaffBookingLocationKind): string {
  return kind === 'online' ? 'Online' : 'Client address';
}
