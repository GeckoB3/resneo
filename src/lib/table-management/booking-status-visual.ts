/**
 * Shared booking status colours for dashboard surfaces (table timeline, bookings list, detail).
 * Palette matches `dashboard/table-grid` timeline blocks.
 *
 * Richer fills and saturated left stripes improve at-a-glance scanning on tablets.
 * **Pending** — warm amber/orange · **Booked** — cyan-leaning sky · **Confirmed** — indigo (hue split from Booked) · **Seated** — emerald · **Arrived** — amber · **Completed / Cancelled** — slate.
 */
export interface BookingStatusVisual {
  /** Timeline / drag overlay — includes left accent border. */
  timeline: string;
  /** Rounded status pill — uniform border, no left accent. */
  pill: string;
  dot: string;
  /** Booking row left stripe (e.g. `border-l-[3px]` colour). */
  listBorderLeft: string;
}

const DEFAULT_BOOKING_STATUS_VISUAL: BookingStatusVisual = {
  timeline: 'bg-slate-100 border-slate-300 border-l-slate-400 text-slate-800',
  pill: 'border-slate-200 bg-slate-50 text-slate-700',
  dot: 'bg-slate-400',
  listBorderLeft: 'border-l-slate-400',
};

const BOOKING_STATUS_VISUAL_MAP: Record<string, BookingStatusVisual> = {
  Pending: {
    timeline: 'bg-[#FFEDD5] border-[#FDBA74] border-l-[#EA580C] text-[#9A3412]',
    pill: 'border-[#FDBA74] bg-[#FFEDD5] text-[#9A3412]',
    dot: 'bg-[#EA580C]',
    listBorderLeft: 'border-l-[#EA580C]',
  },
  Booked: {
    timeline: 'bg-[#E0F2FE] border-[#38BDF8] border-l-[#0369A1] text-[#0C4A6E]',
    pill: 'border-[#38BDF8] bg-[#E0F2FE] text-[#0C4A6E]',
    dot: 'bg-[#0369A1]',
    listBorderLeft: 'border-l-[#0369A1]',
  },
  Confirmed: {
    timeline: 'bg-[#E0E7FF] border-[#818CF8] border-l-[#4338CA] text-[#312E81]',
    pill: 'border-[#818CF8] bg-[#E0E7FF] text-[#312E81]',
    dot: 'bg-[#4338CA]',
    listBorderLeft: 'border-l-[#4338CA]',
  },
  Seated: {
    timeline: 'bg-[#D1FAE5] border-[#34D399] border-l-[#047857] text-[#064E3B]',
    pill: 'border-[#34D399] bg-[#D1FAE5] text-[#064E3B]',
    dot: 'bg-[#047857]',
    listBorderLeft: 'border-l-[#047857]',
  },
  Arrived: {
    timeline: 'bg-[#FEF3C7] border-[#FBBF24] border-l-[#D97706] text-[#78350F]',
    pill: 'border-[#FBBF24] bg-[#FEF3C7] text-[#78350F]',
    dot: 'bg-[#D97706]',
    listBorderLeft: 'border-l-[#D97706]',
  },
  Completed: {
    timeline:
      'bg-[#E5E7EB] border-[#9CA3AF] border-l-[#4B5563] text-[#374151] ring-1 ring-inset ring-slate-300/70',
    pill: 'border-[#9CA3AF] bg-[#E5E7EB] text-[#374151] ring-1 ring-inset ring-slate-300/70',
    dot: 'bg-[#4B5563]',
    listBorderLeft: 'border-l-[#4B5563]',
  },
  'No-Show': {
    timeline: 'bg-[#FEE2E2] border-[#F87171] border-l-[#DC2626] text-[#991B1B]',
    pill: 'border-[#F87171] bg-[#FEE2E2] text-[#991B1B]',
    dot: 'bg-[#DC2626]',
    listBorderLeft: 'border-l-[#DC2626]',
  },
  Cancelled: {
    timeline: 'bg-[#E5E7EB] border-[#D1D5DB] border-l-[#4B5563] text-[#4B5563]',
    pill: 'border-[#D1D5DB] bg-[#E5E7EB] text-[#4B5563]',
    dot: 'bg-[#4B5563]',
    listBorderLeft: 'border-l-[#4B5563]',
  },
  'Deposit Pending': {
    timeline: 'bg-[#FFEDD5] border-[#FB923C] text-[#9A3412]',
    pill: 'border-[#FB923C] bg-[#FFEDD5] text-[#9A3412]',
    dot: 'bg-[#EA580C]',
    listBorderLeft: 'border-l-[#EA580C]',
  },
};

export function bookingStatusVisualForKey(statusKey: string): BookingStatusVisual {
  return BOOKING_STATUS_VISUAL_MAP[statusKey] ?? DEFAULT_BOOKING_STATUS_VISUAL;
}

/** Solid CTA — matches Confirmed accent (`#4338CA`). */
export const BOOKING_ATTENDANCE_CONFIRM_SOLID_BUTTON =
  'border border-[#4338CA] bg-[#4338CA] text-white shadow-sm hover:bg-[#3730A3] focus:ring-[#4338CA]/35';

/** Spinner on solid confirm buttons */
export const BOOKING_ATTENDANCE_CONFIRM_SPINNER = 'border-white/35 border-t-white';

/** Outline — undo attendance confirmation (paired with {@link BOOKING_ATTENDANCE_CONFIRM_SOLID_BUTTON}). */
export const BOOKING_ATTENDANCE_UNDO_OUTLINE_BUTTON =
  'border border-[#4338CA] bg-white text-[#4338CA] shadow-sm hover:bg-[#EEF2FF] focus:ring-[#4338CA]/35';

/**
 * Light blue surface matching the **Booked** status pill (`bookingStatusVisualForKey('Booked')`).
 * Used for undo-confirm style actions in dense toolbars.
 */
export const BOOKING_BOOKED_LIGHT_BUTTON =
  'border border-[#38BDF8] bg-[#E0F2FE] text-[#0C4A6E] shadow-sm hover:bg-[#BAE6FD] focus:ring-[#0369A1]/40';

export const BOOKING_ATTENDANCE_UNDO_SPINNER = 'border-[#4338CA]/30 border-t-[#4338CA]';

/** Non-table primary “Start” (→ Seated); matches Walk-in toolbar (`OperationsWorkspaceToolbar` / `ViewToolbar`). */
export const BOOKING_START_PRIMARY_BUTTON_CLASSES =
  'border border-transparent bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 focus:ring-emerald-400/40 active:bg-emerald-800';
