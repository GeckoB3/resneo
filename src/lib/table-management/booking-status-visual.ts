import {
  isAttendanceConfirmed,
  type BookingStaffIndicatorInput,
} from '@/lib/booking/booking-staff-indicators';

/**
 * Shared booking status colours for dashboard surfaces (table timeline, bookings list, detail).
 * Palette matches `dashboard/table-grid` timeline blocks.
 *
 * Richer fills and saturated left stripes improve at-a-glance scanning on tablets.
 * **Pending** — warm amber/orange · **Booked** — cyan-leaning sky · **Confirmed** — brand navy (hue split from Booked) · **Seated** — emerald · **Arrived** — amber · **Completed / Cancelled** — slate.
 */
export interface BookingStatusCalendarBlock {
  bg: string;
  text: string;
  border: string;
  /** Left stripe on practitioner calendar booking bars. */
  accent: string;
}

export interface BookingStatusVisual {
  /** Timeline / drag overlay — includes left accent border. */
  timeline: string;
  /** Rounded status pill — uniform border, no left accent. */
  pill: string;
  dot: string;
  /** Booking row left stripe (e.g. `border-l-[3px]` colour). */
  listBorderLeft: string;
  /** Practitioner calendar day/week grid booking bar (inline styles). */
  calendarBlock: BookingStatusCalendarBlock;
}

const DEFAULT_CALENDAR_BLOCK: BookingStatusCalendarBlock = {
  bg: '#F1F5F9',
  text: '#1E293B',
  border: '#CBD5E1',
  accent: '#94A3B8',
};

const DEFAULT_BOOKING_STATUS_VISUAL: BookingStatusVisual = {
  timeline: 'bg-slate-100 border-slate-300 border-l-slate-400 text-slate-800',
  pill: 'border-slate-200 bg-slate-50 text-slate-700',
  dot: 'bg-slate-400',
  listBorderLeft: 'border-l-slate-400',
  calendarBlock: DEFAULT_CALENDAR_BLOCK,
};

const BOOKING_STATUS_VISUAL_MAP: Record<string, BookingStatusVisual> = {
  Pending: {
    timeline: 'bg-[#FFEDD5] border-[#FDBA74] border-l-[#EA580C] text-[#9A3412]',
    pill: 'border-[#FDBA74] bg-[#FFEDD5] text-[#9A3412]',
    dot: 'bg-[#EA580C]',
    listBorderLeft: 'border-l-[#EA580C]',
    calendarBlock: { bg: '#FFEDD5', text: '#9A3412', border: '#FDBA74', accent: '#EA580C' },
  },
  Booked: {
    timeline: 'bg-[#E0F2FE] border-[#38BDF8] border-l-[#0369A1] text-[#0C4A6E]',
    pill: 'border-[#38BDF8] bg-[#E0F2FE] text-[#0C4A6E]',
    dot: 'bg-[#0369A1]',
    listBorderLeft: 'border-l-[#0369A1]',
    calendarBlock: { bg: '#E0F2FE', text: '#0C4A6E', border: '#38BDF8', accent: '#0369A1' },
  },
  Confirmed: {
    timeline: 'bg-[#C6D8E9] border-[#003B6F] border-l-[#003B6F] text-[#00264A]',
    pill: 'border-[#003B6F] bg-[#C6D8E9] text-[#00264A]',
    dot: 'bg-[#003B6F]',
    listBorderLeft: 'border-l-[#003B6F]',
    calendarBlock: { bg: '#C6D8E9', text: '#00264A', border: '#003B6F', accent: '#003B6F' },
  },
  Seated: {
    timeline: 'bg-[#D1FAE5] border-[#34D399] border-l-[#047857] text-[#064E3B]',
    pill: 'border-[#34D399] bg-[#D1FAE5] text-[#064E3B]',
    dot: 'bg-[#047857]',
    listBorderLeft: 'border-l-[#047857]',
    calendarBlock: { bg: '#D1FAE5', text: '#064E3B', border: '#34D399', accent: '#047857' },
  },
  Arrived: {
    timeline: 'bg-[#FEF3C7] border-[#FBBF24] border-l-[#D97706] text-[#78350F]',
    pill: 'border-[#FBBF24] bg-[#FEF3C7] text-[#78350F]',
    dot: 'bg-[#D97706]',
    listBorderLeft: 'border-l-[#D97706]',
    calendarBlock: { bg: '#FEF3C7', text: '#78350F', border: '#FBBF24', accent: '#D97706' },
  },
  Completed: {
    timeline:
      'bg-[#E5E7EB] border-[#9CA3AF] border-l-[#4B5563] text-[#374151] ring-1 ring-inset ring-slate-300/70',
    pill: 'border-[#9CA3AF] bg-[#E5E7EB] text-[#374151] ring-1 ring-inset ring-slate-300/70',
    dot: 'bg-[#4B5563]',
    listBorderLeft: 'border-l-[#4B5563]',
    calendarBlock: { bg: '#E5E7EB', text: '#374151', border: '#9CA3AF', accent: '#4B5563' },
  },
  'No-Show': {
    timeline: 'bg-[#FEE2E2] border-[#F87171] border-l-[#DC2626] text-[#991B1B]',
    pill: 'border-[#F87171] bg-[#FEE2E2] text-[#991B1B]',
    dot: 'bg-[#DC2626]',
    listBorderLeft: 'border-l-[#DC2626]',
    calendarBlock: { bg: '#FEE2E2', text: '#991B1B', border: '#F87171', accent: '#DC2626' },
  },
  Cancelled: {
    timeline: 'bg-[#E5E7EB] border-[#D1D5DB] border-l-[#4B5563] text-[#4B5563]',
    pill: 'border-[#D1D5DB] bg-[#E5E7EB] text-[#4B5563]',
    dot: 'bg-[#4B5563]',
    listBorderLeft: 'border-l-[#4B5563]',
    calendarBlock: { bg: '#E5E7EB', text: '#4B5563', border: '#D1D5DB', accent: '#4B5563' },
  },
  'Deposit Pending': {
    timeline: 'bg-[#FFEDD5] border-[#FB923C] text-[#9A3412]',
    pill: 'border-[#FB923C] bg-[#FFEDD5] text-[#9A3412]',
    dot: 'bg-[#EA580C]',
    listBorderLeft: 'border-l-[#EA580C]',
    calendarBlock: { bg: '#FFEDD5', text: '#9A3412', border: '#FB923C', accent: '#EA580C' },
  },
};

export function bookingStatusVisualForKey(statusKey: string): BookingStatusVisual {
  return BOOKING_STATUS_VISUAL_MAP[statusKey] ?? DEFAULT_BOOKING_STATUS_VISUAL;
}

export interface BookingStatusVisualRow extends BookingStaffIndicatorInput {
  status: string;
  client_arrived_at?: string | null;
}

/** Guest marked arrived while still pending / booked / confirmed (waiting to start). */
export function isArrivedWaitingDisplay(
  row: Pick<BookingStatusVisualRow, 'client_arrived_at' | 'status'>,
): boolean {
  if (!row.client_arrived_at) return false;
  return row.status === 'Pending' || row.status === 'Booked' || row.status === 'Confirmed';
}

/**
 * Canonical visual key for booking bars and list stripes (lifecycle + attendance + arrived).
 * Calendar bars use the same resolver via {@link calendarBookingVisualKey}.
 */
export function bookingDisplayVisualKey(row: BookingStatusVisualRow): string {
  const status = row.status;
  if (status === 'Cancelled') return 'Cancelled';
  if (status === 'No-Show') return 'No-Show';
  if (status === 'Completed') return 'Completed';
  if (status === 'Seated') return 'Seated';
  if (isArrivedWaitingDisplay(row)) return 'Arrived';
  if (status === 'Confirmed') return 'Confirmed';
  if (status === 'Pending' || status === 'Booked') {
    if (isAttendanceConfirmed(row)) return 'Confirmed';
    if (status === 'Pending') return 'Pending';
    return 'Booked';
  }
  return 'Booked';
}

export function bookingStatusVisualKeyForRow(row: BookingStatusVisualRow): string {
  return bookingDisplayVisualKey(row);
}

export function bookingStatusVisualForRow(row: BookingStatusVisualRow): BookingStatusVisual {
  return bookingStatusVisualForKey(bookingStatusVisualKeyForRow(row));
}

/** Solid CTA — matches Confirmed accent (brand navy `#003B6F`). */
export const BOOKING_ATTENDANCE_CONFIRM_SOLID_BUTTON =
  'border border-[#003B6F] bg-[#003B6F] text-white shadow-sm hover:bg-[#00305C] focus:ring-[#003B6F]/35';

/** Spinner on solid confirm buttons */
export const BOOKING_ATTENDANCE_CONFIRM_SPINNER = 'border-white/35 border-t-white';

/** Outline — undo attendance confirmation (paired with {@link BOOKING_ATTENDANCE_CONFIRM_SOLID_BUTTON}). */
export const BOOKING_ATTENDANCE_UNDO_OUTLINE_BUTTON =
  'border border-[#003B6F] bg-white text-[#003B6F] shadow-sm hover:bg-[#E8EFF6] focus:ring-[#003B6F]/35';

/**
 * Light blue surface matching the **Booked** status pill (`bookingStatusVisualForKey('Booked')`).
 * Used for undo-confirm style actions in dense toolbars.
 */
export const BOOKING_BOOKED_LIGHT_BUTTON =
  'border border-[#38BDF8] bg-[#E0F2FE] text-[#0C4A6E] shadow-sm hover:bg-[#BAE6FD] focus:ring-[#0369A1]/40';

export const BOOKING_ATTENDANCE_UNDO_SPINNER = 'border-[#003B6F]/30 border-t-[#003B6F]';

/** Non-table primary “Start” (→ Seated); matches Walk-in toolbar (`OperationsWorkspaceToolbar` / `ViewToolbar`). */
export const BOOKING_START_PRIMARY_BUTTON_CLASSES =
  'border border-transparent bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 focus:ring-emerald-400/40 active:bg-emerald-800';

/** Sky solid — previews the **Booked** bar (e.g. Confirm a pending booking, Undo start). */
export const BOOKING_TO_BOOKED_BUTTON =
  'border border-[#0369A1] bg-[#0369A1] text-white shadow-sm hover:bg-[#075985] focus:ring-[#0369A1]/35';

/** Slate solid — previews the **Completed** bar. */
export const BOOKING_COMPLETE_BUTTON =
  'border border-[#4B5563] bg-[#4B5563] text-white shadow-sm hover:bg-[#374151] focus:ring-[#4B5563]/35';

/** Amber solid — previews the **Arrived** bar. */
export const BOOKING_TO_ARRIVED_BUTTON =
  'border border-[#D97706] bg-[#D97706] text-white shadow-sm hover:bg-[#B45309] focus:ring-[#D97706]/35';

/** Orange solid — previews the **Pending** bar (rare revert: mark pending). */
export const BOOKING_TO_PENDING_BUTTON =
  'border border-[#EA580C] bg-[#EA580C] text-white shadow-sm hover:bg-[#C2410C] focus:ring-[#EA580C]/35';

/**
 * Button surface whose colour previews the status the booking moves to when the
 * action is pressed — a visual hint of what each lifecycle button does. Shared by
 * the calendar action strips and the expanded booking toolbar so the two stay in sync.
 */
export function bookingTransitionButtonSurface(target: string): string {
  switch (target) {
    case 'Pending':
      return BOOKING_TO_PENDING_BUTTON;
    case 'Booked':
      return BOOKING_TO_BOOKED_BUTTON;
    case 'Confirmed':
      return BOOKING_ATTENDANCE_CONFIRM_SOLID_BUTTON;
    case 'Arrived':
      return BOOKING_TO_ARRIVED_BUTTON;
    case 'Seated':
      return BOOKING_START_PRIMARY_BUTTON_CLASSES;
    case 'Completed':
      return BOOKING_COMPLETE_BUTTON;
    default:
      return BOOKING_ATTENDANCE_CONFIRM_SOLID_BUTTON;
  }
}
