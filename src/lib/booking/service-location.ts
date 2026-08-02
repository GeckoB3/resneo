/**
 * Service location for bookings: resolve where an appointment service is delivered
 * (business venue / client's address / online), validate the client address captured by
 * the booking form, and build the booking-row snapshot fields.
 *
 * The snapshot lives on the booking so confirmation/reminder emails always show the
 * address agreed for THAT visit, even if the guest's contact record changes later.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { parseServiceLocationType, type ServiceLocationType } from '@/types/booking-models';

/** Optional client-address fields accepted by booking create endpoints. */
export const clientAddressRequestFields = {
  client_address_line1: z.string().trim().max(200).optional(),
  client_address_line2: z.string().trim().max(200).optional(),
  client_address_city: z.string().trim().max(100).optional(),
  client_address_postcode: z.string().trim().max(20).optional(),
};

export interface ClientAddressInput {
  client_address_line1?: string | null;
  client_address_line2?: string | null;
  client_address_city?: string | null;
  client_address_postcode?: string | null;
}

export function hasCompleteClientAddress(addr: ClientAddressInput): boolean {
  return Boolean(
    addr.client_address_line1?.trim() &&
      addr.client_address_city?.trim() &&
      addr.client_address_postcode?.trim(),
  );
}

export const CLIENT_ADDRESS_REQUIRED_ERROR =
  'This service takes place at your address, so please provide your address line 1, town or city, and postcode.';

/**
 * Resolve the delivery location of the booked service. Pass whichever anchor the booking
 * uses; `service_items` wins when both are given (mirrored ids share the same UUID).
 * Returns 'business_venue' when neither anchor matches a row (non-appointment models).
 */
export async function resolveServiceLocation(
  admin: SupabaseClient,
  venueId: string,
  anchors: { serviceItemId?: string | null; appointmentServiceId?: string | null },
): Promise<{ locationType: ServiceLocationType; onlineMeetingUrl: string | null; onlineMeetingInfo: string | null }> {
  const fallback = { locationType: 'business_venue' as ServiceLocationType, onlineMeetingUrl: null, onlineMeetingInfo: null };
  const id = anchors.serviceItemId ?? anchors.appointmentServiceId;
  if (!id) return fallback;

  if (anchors.serviceItemId) {
    const { data } = await admin
      .from('service_items')
      .select('location_type, online_meeting_url, online_meeting_info')
      .eq('id', anchors.serviceItemId)
      .eq('venue_id', venueId)
      .maybeSingle();
    if (data) {
      const row = data as { location_type?: string | null; online_meeting_url?: string | null; online_meeting_info?: string | null };
      return {
        locationType: parseServiceLocationType(row.location_type),
        onlineMeetingUrl: row.online_meeting_url ?? null,
        onlineMeetingInfo: row.online_meeting_info ?? null,
      };
    }
  }

  if (anchors.appointmentServiceId) {
    const { data } = await admin
      .from('appointment_services')
      .select('location_type, online_meeting_url, online_meeting_info')
      .eq('id', anchors.appointmentServiceId)
      .eq('venue_id', venueId)
      .maybeSingle();
    if (data) {
      const row = data as { location_type?: string | null; online_meeting_url?: string | null; online_meeting_info?: string | null };
      return {
        locationType: parseServiceLocationType(row.location_type),
        onlineMeetingUrl: row.online_meeting_url ?? null,
        onlineMeetingInfo: row.online_meeting_info ?? null,
      };
    }
  }

  return fallback;
}

/**
 * Booking-row snapshot columns for the resolved location. Address columns are written
 * only for client-address services; business venue stores just the type so history is
 * explicit (NULL = legacy row created before this feature).
 */
export function bookingLocationInsertFields(
  locationType: ServiceLocationType,
  addr: ClientAddressInput,
): Record<string, unknown> {
  if (locationType !== 'client_address') {
    return { location_type: locationType };
  }
  return {
    location_type: 'client_address',
    client_address_line1: addr.client_address_line1?.trim() || null,
    client_address_line2: addr.client_address_line2?.trim() || null,
    client_address_city: addr.client_address_city?.trim() || null,
    client_address_postcode: addr.client_address_postcode?.trim() || null,
  };
}

/** Single display line, e.g. "12 High St, Flat 2, Belfast, BT1 1AA". */
export function formatClientAddressOneLine(addr: {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  postcode?: string | null;
}): string | null {
  const parts = [addr.line1, addr.line2, addr.city, addr.postcode]
    .map((p) => (p ?? '').trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}
