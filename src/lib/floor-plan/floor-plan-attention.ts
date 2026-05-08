/**
 * Derives host-stand attention signals for live floor plan table badges (single dot).
 */

import { showDepositPendingPill } from '@/lib/booking/booking-staff-indicators';

export interface FloorBookingAttentionInput {
  dietary_notes?: string | null;
  occasion?: string | null;
  deposit_status?: string | null;
  deposit_amount_pence?: number | null;
  internal_notes?: string | null;
}

/** One attention dot: red for dietary notes; green for other important booking signals. */
export type FloorBookingBadgeDot = 'dietary' | 'info';

export interface FloorBookingBadges {
  dot: FloorBookingBadgeDot;
}

/**
 * Single dot precedence: dietary note wins over other signals when both apply.
 */
export function computeFloorBookingBadges(booking: FloorBookingAttentionInput | null | undefined): FloorBookingBadges | null {
  if (!booking) return null;
  const hasDietary = Boolean(booking.dietary_notes?.trim());
  const occasion = Boolean(booking.occasion?.trim());
  const staffNote = Boolean(booking.internal_notes?.trim());
  const depositPending =
    showDepositPendingPill({
      deposit_status: booking.deposit_status,
      deposit_amount_pence: booking.deposit_amount_pence ?? null,
    }) || booking.deposit_status === 'Pending';

  const hasOtherImportant = occasion || depositPending || staffNote;

  if (hasDietary) return { dot: 'dietary' };
  if (hasOtherImportant) return { dot: 'info' };
  return null;
}
