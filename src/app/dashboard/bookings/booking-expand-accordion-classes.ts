/**
 * Shared visual chrome for details/summary accordion blocks inside expanded booking rows
 * (table bookings + appointments). Matches list row cards: bordered tiles, subtle ring, rhythm.
 */

export const bookingExpandAccordionDetailsClass =
  'booking-accordion group overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.045)] transition-[box-shadow,border-color] duration-300 ease-out hover:border-slate-300/70 open:border-slate-200/90 open:shadow-[0_16px_36px_-18px_rgba(15,23,42,0.24)]';

export const bookingExpandAccordionSummaryClass =
  'flex cursor-pointer list-none items-center gap-3 px-4 py-4 text-sm font-semibold tracking-tight text-slate-800 outline-none marker:hidden bg-white transition-colors duration-200 hover:bg-slate-50/70 group-open:bg-slate-50/30 [&>:first-child]:mr-auto [&>:first-child]:shrink-0 [&>:nth-child(2)]:min-w-0 [&>:nth-child(2)]:truncate [&>:nth-child(2)]:text-right [&::-webkit-details-marker]:hidden focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/30 focus-visible:ring-inset sm:py-3.5 sm:text-[13px]';

export const bookingExpandAccordionBodyClass = 'border-t border-slate-100 bg-slate-50/40 p-3.5 sm:p-4';

export const bookingExpandAccordionMessagingBodyClass = 'border-t border-brand-100/60 bg-brand-50/35 p-3.5 sm:p-4';

export const bookingExpandActionsBarClass =
  'overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.045)]';

/** Outer shell for inline expanded booking rows (bookings list, day sheet, appointments). */
export const expandedBookingRowShellClass =
  'border-t border-slate-200/80 bg-slate-100/40 px-2 pb-3 pt-2.5 sm:px-3';
