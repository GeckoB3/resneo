/**
 * Shared visual chrome for details/summary accordion blocks inside expanded booking rows
 * (table bookings + appointments). Matches list row cards: bordered tiles, subtle ring, rhythm.
 */

export const bookingExpandAccordionDetailsClass =
  'group overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-sm ring-1 ring-slate-900/[0.04] transition-[box-shadow,ring-color,border-color] duration-200 open:shadow-md open:ring-2 open:ring-brand-900/[0.08]';

export const bookingExpandAccordionSummaryClass =
  'flex cursor-pointer list-none items-center justify-between gap-2 px-3.5 py-3 text-xs font-semibold text-slate-800 outline-none marker:hidden rounded-t-xl border-b border-slate-100/95 bg-gradient-to-r from-slate-50 via-slate-50/95 to-white hover:from-slate-100/90 hover:to-slate-50/90 [&::-webkit-details-marker]:hidden transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/35 focus-visible:ring-inset sm:px-4';

export const bookingExpandAccordionBodyClass = 'bg-slate-50/45 p-3 sm:p-3.5';

export const bookingExpandAccordionMessagingBodyClass = 'bg-brand-50/45 p-3 sm:p-3.5';

export const bookingExpandActionsBarClass =
  'overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-sm ring-1 ring-slate-900/[0.04]';

/** Outer shell for inline expanded booking rows (bookings list, day sheet, appointments). */
export const expandedBookingRowShellClass =
  'border-t border-slate-100/95 bg-slate-50/30 px-2 pb-2.5 pt-2 sm:px-3';
