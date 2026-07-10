import type { BookingDetail } from '@/app/dashboard/bookings/booking-detail-panel-model';

/**
 * Overlay a `/summary` response on richer detail already on screen (a cache
 * seed or an earlier full GET). The summary omits the full GET's enrichment
 * fields (card_hold, service_payment_requirement, practitioner_name,
 * refund_notice_hours) and stubs events, communications and combination
 * notes; replacing the detail wholesale makes labels like "Paid in full"
 * flash deposit copy and the card-hold actions vanish until the full payload
 * lands. Fields the summary DOES carry win, so status changes still refresh.
 */
export function mergeBookingSummaryOverDetail(
  prev: BookingDetail | null,
  summary: BookingDetail,
): BookingDetail {
  if (!prev || prev.id !== summary.id) return summary;
  return {
    ...prev,
    ...summary,
    events: summary.events?.length ? summary.events : prev.events,
    communications: summary.communications?.length ? summary.communications : prev.communications,
    combination_staff_notes: summary.combination_staff_notes ?? prev.combination_staff_notes,
  };
}
