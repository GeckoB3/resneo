import { currencySymbolFromCode } from '@/lib/money/currency-symbol';

/**
 * Booking-status badge classes used by practitioner-calendar instance detail
 * sheets (class & event). Distinct from public-booking pills because the
 * dashboard shows ring-shaded pastel chips inside attendee tables.
 */
export const PRACTITIONER_BOOKING_STATUS_BADGE: Record<string, string> = {
  Pending: 'bg-orange-100 text-orange-950 ring-1 ring-orange-300',
  Booked: 'bg-sky-100 text-sky-950 ring-1 ring-sky-500',
  Confirmed: 'bg-indigo-100 text-indigo-950 ring-1 ring-indigo-500',
  Seated: 'bg-emerald-100 text-emerald-950 ring-1 ring-emerald-400',
  Completed: 'bg-slate-200 text-slate-800 ring-1 ring-slate-400',
  'No-Show': 'bg-red-100 text-red-950 ring-1 ring-red-400',
  Cancelled: 'bg-slate-200 text-slate-600 ring-1 ring-slate-400',
};

/**
 * Format pence as a dashboard money string. Renders an em-dash for null
 * (vs the guest-facing "Free" semantics in `format-price-display.ts`).
 */
export function formatDashboardMoneyPence(
  pence: number | null | undefined,
  currency: string,
): string {
  if (pence == null) return '—';
  return `${currencySymbolFromCode(currency)}${(pence / 100).toFixed(2)}`;
}
