import type { BookingModel } from '@/types/booking-models';
import { BOOKING_START_PRIMARY_BUTTON_CLASSES } from '@/lib/table-management/booking-status-visual';

/** Icon size + touch behaviour for toolbar controls in expanded booking/contact panels. */
export const EXP_BOOKING_ICO = 'h-3.5 w-3.5 shrink-0';

/** Shared shape / motion for ExpandedBookingContent action toolbar. */
export const EXP_BOOKING_BTN =
  'inline-flex min-h-8 shrink-0 cursor-pointer touch-manipulation items-center justify-center gap-1.5 rounded-lg px-[9px] py-1.5 text-[11px] leading-none tracking-tight shadow-sm outline-none transition-colors duration-150 [-webkit-tap-highlight-color:transparent] disabled:pointer-events-none disabled:opacity-45';

export const EXP_BOOKING_ST_FOCUS =
  'focus-visible:ring-2 focus-visible:ring-brand-400/35 focus-visible:ring-offset-1 focus-visible:ring-offset-white';

/** Lifecycle forward-action fill (brand) — e.g. Confirm booking → Booked, Seated → Complete; matches Expanded panel. */
export const EXP_BOOKING_LIFECYCLE_PRIMARY_SURFACE =
  'border border-brand-800/[0.16] bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800';

export const EXP_BOOKING_PRIMARY =
  `${EXP_BOOKING_BTN} ${EXP_BOOKING_ST_FOCUS} font-semibold ${EXP_BOOKING_LIFECYCLE_PRIMARY_SURFACE}`;

/** → Seated for non-table bookings (label “Start”) — same emerald as Walk-in toolbar. */
export const EXP_BOOKING_START =
  `${EXP_BOOKING_BTN} focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-white focus-visible:ring-emerald-400/35 font-semibold ${BOOKING_START_PRIMARY_BUTTON_CLASSES}`;

export const EXP_BOOKING_NEUTRAL =
  `${EXP_BOOKING_BTN} ${EXP_BOOKING_ST_FOCUS} font-semibold border border-slate-200/95 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50`;

/** Same base as neutral; stronger hover for primary staff shortcuts (+ New / Rebook / Modify). */
export const EXP_BOOKING_NEUTRAL_PROMINENT =
  `${EXP_BOOKING_BTN} ${EXP_BOOKING_ST_FOCUS} font-semibold border border-slate-200/95 bg-white text-slate-800 hover:border-slate-400 hover:bg-slate-100 hover:shadow-md active:bg-slate-100`;

export const EXP_BOOKING_SOFT =
  `${EXP_BOOKING_BTN} ${EXP_BOOKING_ST_FOCUS} font-medium border border-slate-200/90 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900`;

export const EXP_BOOKING_AMBER_ATTN =
  `${EXP_BOOKING_BTN} focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-white focus-visible:ring-amber-400/35 font-semibold border border-amber-400/90 bg-amber-50 text-amber-950 hover:border-amber-500 hover:bg-amber-100`;

export const EXP_BOOKING_REVERT =
  `${EXP_BOOKING_BTN} focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-white focus-visible:ring-amber-400/35 font-semibold border border-amber-200 bg-amber-50 text-amber-900 hover:border-amber-300 hover:bg-amber-100`;

/** Staff confirm attendance — matches Confirmed `#1E40AF`. */
export const EXP_BOOKING_ATTEND =
  `${EXP_BOOKING_BTN} focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-white focus-visible:ring-[#1E40AF]/35 font-semibold border border-[#1E3A8A] bg-[#1E40AF] text-white hover:bg-[#1E3A8A]`;

/** Undo attendance confirmation / lifecycle “Undo confirm” — outline `#1E40AF` (other reverts stay amber). */
export const EXP_BOOKING_ATTEND_UNDO =
  `${EXP_BOOKING_BTN} focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-white focus-visible:ring-[#1E40AF]/35 font-semibold border border-[#1E40AF] bg-white text-[#1E40AF] hover:bg-[#EFF6FF]`;

export const EXP_BOOKING_DANGER =
  `${EXP_BOOKING_BTN} ${EXP_BOOKING_ST_FOCUS} font-semibold border border-red-100 bg-white text-red-700 hover:border-red-300/90 hover:bg-red-50`;

export const EXP_BOOKING_DANGER_ROSE =
  `${EXP_BOOKING_BTN} ${EXP_BOOKING_ST_FOCUS} font-semibold border border-rose-100 bg-white text-rose-700 hover:border-rose-300/90 hover:bg-rose-50`;

export const EXP_BOOKING_SPIN_NA = `${EXP_BOOKING_ICO} animate-spin rounded-full border-2 border-slate-400/35 border-t-slate-700`;
export const EXP_BOOKING_SPIN_AM = `${EXP_BOOKING_ICO} animate-spin rounded-full border-2 border-amber-500/35 border-t-amber-900`;

/** Stable empty list — avoid `enabledModels ?? []` identity churn in memos. */
export const NO_EXTRA_ENABLED_BOOKING_MODELS: BookingModel[] = [];
