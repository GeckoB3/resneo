/**
 * Shared booking status colours for dashboard surfaces (table timeline, bookings list, detail).
 * Palette matches `dashboard/table-grid` timeline blocks.
 *
 * **Booked** uses accent `#93C5FD`; **Confirmed** uses accent `#1E40AF` (darker blue). Lists and grids
 * may still tint some `Booked` rows using Confirmed visuals when attendance is flagged.
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
    timeline: 'bg-[#EFF6FF] border-[#BFDBFE] border-l-[#3B82F6] text-[#1E40AF]',
    pill: 'border-[#BFDBFE] bg-[#EFF6FF] text-[#1E40AF]',
    dot: 'bg-[#3B82F6]',
    listBorderLeft: 'border-l-[#3B82F6]',
  },
  Booked: {
    timeline: 'bg-[#EFF6FF] border-[#BFDBFE] border-l-[#93C5FD] text-[#1E3A8A]',
    pill: 'border-[#BFDBFE] bg-[#EFF6FF] text-[#1E3A8A]',
    dot: 'bg-[#93C5FD]',
    listBorderLeft: 'border-l-[#93C5FD]',
  },
  Confirmed: {
    timeline: 'bg-[#DBEAFE] border-[#93C5FD] border-l-[#1E40AF] text-[#1E3A8A]',
    pill: 'border-[#93C5FD] bg-[#DBEAFE] text-[#1E3A8A]',
    dot: 'bg-[#1E40AF]',
    listBorderLeft: 'border-l-[#1E40AF]',
  },
  Seated: {
    timeline: 'bg-[#ECFDF5] border-[#A7F3D0] border-l-[#059669] text-[#065F46]',
    pill: 'border-[#A7F3D0] bg-[#ECFDF5] text-[#065F46]',
    dot: 'bg-[#059669]',
    listBorderLeft: 'border-l-[#059669]',
  },
  Arrived: {
    timeline: 'bg-[#FFFBEB] border-[#FDE68A] border-l-[#F59E0B] text-[#92400E]',
    pill: 'border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]',
    dot: 'bg-[#F59E0B]',
    listBorderLeft: 'border-l-[#F59E0B]',
  },
  Completed: {
    timeline:
      'bg-slate-100 border-slate-200/90 border-l-slate-400 text-slate-600 ring-1 ring-inset ring-slate-200/60',
    pill: 'border-slate-200/90 bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200/60',
    dot: 'bg-slate-400',
    listBorderLeft: 'border-l-slate-400',
  },
  'No-Show': {
    timeline: 'bg-[#FEF2F2] border-[#FECACA] border-l-[#EF4444] text-[#991B1B]',
    pill: 'border-[#FECACA] bg-[#FEF2F2] text-[#991B1B]',
    dot: 'bg-[#EF4444]',
    listBorderLeft: 'border-l-[#EF4444]',
  },
  Cancelled: {
    timeline: 'bg-[#F3F4F6] border-[#E5E7EB] border-l-[#6B7280] text-[#6B7280]',
    pill: 'border-[#E5E7EB] bg-[#F3F4F6] text-[#6B7280]',
    dot: 'bg-[#6B7280]',
    listBorderLeft: 'border-l-[#6B7280]',
  },
  'Deposit Pending': {
    timeline: 'bg-orange-100 border-orange-300 text-orange-800',
    pill: 'border-orange-300 bg-orange-100 text-orange-800',
    dot: 'bg-orange-500',
    listBorderLeft: 'border-l-orange-500',
  },
};

export function bookingStatusVisualForKey(statusKey: string): BookingStatusVisual {
  return BOOKING_STATUS_VISUAL_MAP[statusKey] ?? DEFAULT_BOOKING_STATUS_VISUAL;
}

/** Solid CTA — matches Confirmed accent (`#1E40AF`). */
export const BOOKING_ATTENDANCE_CONFIRM_SOLID_BUTTON =
  'border border-[#1E40AF] bg-[#1E40AF] text-white shadow-sm hover:bg-[#1E3A8A] focus:ring-[#1E40AF]/35';

/** Spinner on solid confirm buttons */
export const BOOKING_ATTENDANCE_CONFIRM_SPINNER = 'border-white/35 border-t-white';

/** Outline — undo attendance confirmation (paired with {@link BOOKING_ATTENDANCE_CONFIRM_SOLID_BUTTON}). */
export const BOOKING_ATTENDANCE_UNDO_OUTLINE_BUTTON =
  'border border-[#1E40AF] bg-white text-[#1E40AF] shadow-sm hover:bg-[#EFF6FF] focus:ring-[#1E40AF]/35';

export const BOOKING_ATTENDANCE_UNDO_SPINNER = 'border-[#1E40AF]/30 border-t-[#1E40AF]';

/** Non-table primary “Start” (→ Seated); matches Walk-in toolbar (`OperationsWorkspaceToolbar` / `ViewToolbar`). */
export const BOOKING_START_PRIMARY_BUTTON_CLASSES =
  'border border-transparent bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 focus:ring-emerald-400/40 active:bg-emerald-800';
