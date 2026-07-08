import { venueLocalWallTimeToUtcMs } from '@/lib/venue/venue-local-clock';

/**
 * ISO timestamp for the last moment a client can cancel and still receive a deposit refund:
 * appointment start minus `hoursBefore`. `bookingDate` + `bookingTime` are venue-local
 * wall clock (as stored on booking rows), so they must be interpreted in the venue
 * timezone, not as UTC: reading 09:30 BST as 09:30Z lands the deadline an hour late.
 * The display helpers below format in the same zone.
 */
export function cancellationDeadlineHoursBefore(
  bookingDate: string,
  bookingTime: string,
  hoursBefore: number,
  timeZone: string = 'Europe/London',
): string {
  const startMs = venueLocalWallTimeToUtcMs(bookingDate, bookingTime, timeZone);
  return new Date(startMs - hoursBefore * 3_600_000).toISOString();
}

/** Human-readable last moment for refund (London), aligned with `cancellationDeadlineHoursBefore`. */
export function formatRefundDeadlineDisplay(
  bookingDate: string,
  bookingTime: string,
  noticeHours: number,
): string {
  const iso = cancellationDeadlineHoursBefore(bookingDate, bookingTime, noticeHours);
  return formatRefundDeadlineIso(iso);
}

/** Human-readable instant for a stored cancellation_deadline ISO (same as computed deadline display). */
export function formatRefundDeadlineIso(deadlineIso: string): string {
  const d = new Date(deadlineIso);
  if (Number.isNaN(d.getTime())) return deadlineIso;
  return d.toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/London',
  });
}

/**
 * True if the guest can still cancel for a deposit refund at time `at`
 * (i.e. before the stored cancellation_deadline instant).
 */
export function isDepositRefundAvailableAt(deadlineIso: string, at: Date = new Date()): boolean {
  const t = new Date(deadlineIso).getTime();
  if (Number.isNaN(t)) return false;
  return at.getTime() < t;
}

export type GroupDepositRefundClass = 'all_refundable' | 'none_refundable' | 'mixed';

/** Classify each appointment slot for group bookings (same notice hours for all). */
export function classifyGroupDepositRefunds(
  slots: Array<{ date: string; time: string }>,
  noticeHours: number,
  at: Date = new Date(),
): GroupDepositRefundClass {
  if (slots.length === 0) return 'none_refundable';
  const flags = slots.map((s) =>
    isDepositRefundAvailableAt(cancellationDeadlineHoursBefore(s.date, s.time, noticeHours), at),
  );
  const any = flags.some(Boolean);
  const all = flags.every(Boolean);
  if (all) return 'all_refundable';
  if (!any) return 'none_refundable';
  return 'mixed';
}
