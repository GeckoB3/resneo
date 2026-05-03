import type { ReactNode } from 'react';
import { bookingStatusVisualForKey } from '@/lib/table-management/booking-status-visual';

export function BookingStatusPill({
  statusKey,
  children,
  dot = false,
  className = '',
}: {
  /** Booking lifecycle status string (e.g. `Booked`, `Confirmed`) or other map key in {@link bookingStatusVisualForKey}. */
  statusKey: string;
  children: ReactNode;
  dot?: boolean;
  className?: string;
}) {
  const v = bookingStatusVisualForKey(statusKey);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium ${v.pill} ${className}`}
    >
      {dot ? <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${v.dot}`} /> : null}
      {children}
    </span>
  );
}
