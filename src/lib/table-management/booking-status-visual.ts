/**
 * Shared booking status colours for dashboard surfaces (table timeline, bookings list, detail).
 * Palette matches `dashboard/table-grid` timeline blocks.
 *
 * Lifecycle colours use the booking `status` field only — e.g. **Booked** stays blue even when
 * attendance is confirmed. Staff/guest **attendance confirmed** is a separate affordance (purple
 * pill and confirm buttons), not a tint on the Booked state.
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
    timeline: 'bg-[#EFF6FF] border-[#BFDBFE] border-l-[#3B82F6] text-[#1E40AF]',
    pill: 'border-[#BFDBFE] bg-[#EFF6FF] text-[#1E40AF]',
    dot: 'bg-[#3B82F6]',
    listBorderLeft: 'border-l-[#3B82F6]',
  },
  Confirmed: {
    timeline: 'bg-[#FAF5FF] border-[#E9D5FF] border-l-[#9333EA] text-[#581C87]',
    pill: 'border-[#E9D5FF] bg-[#FAF5FF] text-[#581C87]',
    dot: 'bg-[#9333EA]',
    listBorderLeft: 'border-l-[#9333EA]',
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

/** Solid CTA — staff confirm booking attendance (matches Confirmed purple, not Booked blue). */
export const BOOKING_ATTENDANCE_CONFIRM_SOLID_BUTTON =
  'border border-violet-600 bg-violet-600 text-white shadow-sm hover:bg-violet-700 focus:ring-violet-400/40';

/** Spinner on violet confirm buttons */
export const BOOKING_ATTENDANCE_CONFIRM_SPINNER =
  'border-violet-300/50 border-t-white';
