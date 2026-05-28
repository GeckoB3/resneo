import type { Addon, AddonGroup } from '@/types/booking-models';

/** Shape inserted into `booking_addons`. */
export interface BookingAddonSnapshot {
  booking_id?: string; // filled in by caller for the bulk insert
  addon_id: string;
  addon_group_id: string;
  booking_segment_index: number | null;
  addon_name_snapshot: string;
  addon_group_name_snapshot: string | null;
  price_pence_at_booking: number;
  duration_minutes_at_booking: number;
  cost_to_business_pence_at_booking: number | null;
}

/**
 * Build the snapshot rows for a single booking (or one segment of a multi-service
 * booking, when `segmentIndex` is set). Pass `bookingId` to attach the FK to each row.
 */
export function buildAddonSnapshots(params: {
  selected: Addon[];
  groupsById: Map<string, AddonGroup>;
  bookingId?: string;
  segmentIndex?: number | null;
}): BookingAddonSnapshot[] {
  const { selected, groupsById, bookingId, segmentIndex = null } = params;
  return selected.map((a) => {
    const group = groupsById.get(a.addon_group_id);
    return {
      ...(bookingId ? { booking_id: bookingId } : {}),
      addon_id: a.id,
      addon_group_id: a.addon_group_id,
      booking_segment_index: segmentIndex,
      addon_name_snapshot: a.name,
      addon_group_name_snapshot: group?.name ?? null,
      price_pence_at_booking: a.additional_price_pence,
      duration_minutes_at_booking: a.additional_duration_minutes,
      cost_to_business_pence_at_booking: a.cost_to_business_pence ?? null,
    };
  });
}

/** Sum the price/duration aggregates across all snapshots (used for `bookings` columns). */
export function totalsFromSnapshots(snapshots: BookingAddonSnapshot[]): {
  total_price_pence: number;
  total_duration_minutes: number;
} {
  let price = 0;
  let duration = 0;
  for (const s of snapshots) {
    price += s.price_pence_at_booking;
    duration += s.duration_minutes_at_booking;
  }
  return { total_price_pence: price, total_duration_minutes: duration };
}
