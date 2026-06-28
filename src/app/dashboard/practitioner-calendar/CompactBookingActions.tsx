'use client';

import type { BookingStatus } from '@/lib/table-management/booking-status';
import { bookingTransitionButtonSurface } from '@/lib/table-management/booking-status-visual';

/**
 * Minimal shape of a booking needed to render its quick actions. The full grid `Booking`
 * (defined in PractitionerCalendarView) is structurally compatible.
 */
export interface CompactActionBooking {
  id: string;
  status: string;
  client_arrived_at?: string | null;
}

interface CompactActionDef {
  key: string;
  label: string;
  /** Tailwind colour surface for the button (matches the comfortable corner-tray buttons). */
  surface: string;
  ariaLabel?: string;
  onClick: () => void;
}

/** Arrived / Clear surfaces mirror the comfortable corner-tray (PractitionerCalendarView). */
const ARRIVED_SURFACE = 'border border-[#D97706] bg-[#FEF3C7] text-[#78350F] hover:bg-[#FDE68A]';
const CLEAR_SURFACE = 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50';

/**
 * Status → quick-action mapping for the compact day bars.
 *
 * Keep in sync with `countBookingRightColumnActions` / `collectBookingRightColumnActionNodes`
 * in PractitionerCalendarView.tsx — this is the same set of transitions, laid out horizontally
 * for short bars instead of the comfortable bottom-right vertical stack.
 */
export function getCompactBookingActions(
  b: CompactActionBooking,
  handlers: {
    onStatus: (id: string, next: BookingStatus) => void;
    onArrived: (id: string, arrived: boolean) => void;
  },
): CompactActionDef[] {
  if (b.status === 'Cancelled' || b.status === 'No-Show') return [];

  const arrived = Boolean(b.client_arrived_at);
  const out: CompactActionDef[] = [];

  if (b.status === 'Completed') {
    out.push({
      key: 'reopen',
      label: 'Reopen',
      surface: bookingTransitionButtonSurface('Seated'),
      onClick: () => handlers.onStatus(b.id, 'Seated'),
    });
    return out;
  }

  if (b.status === 'Pending' || b.status === 'Booked' || b.status === 'Confirmed') {
    out.push(
      arrived
        ? {
            key: 'arrived-clear',
            label: 'Clear',
            surface: CLEAR_SURFACE,
            onClick: () => handlers.onArrived(b.id, false),
          }
        : {
            key: 'arrived',
            label: 'Arrived',
            surface: ARRIVED_SURFACE,
            onClick: () => handlers.onArrived(b.id, true),
          },
    );
  }

  if (b.status === 'Pending') {
    out.push({
      key: 'confirm',
      label: 'Confirm',
      surface: bookingTransitionButtonSurface('Booked'),
      onClick: () => handlers.onStatus(b.id, 'Booked'),
    });
  }

  if (b.status === 'Booked' || b.status === 'Confirmed') {
    out.push({
      key: 'start',
      label: 'Start',
      surface: bookingTransitionButtonSurface('Seated'),
      onClick: () => handlers.onStatus(b.id, 'Seated'),
    });
  }

  if (b.status === 'Seated') {
    out.push({
      key: 'undo-start',
      label: 'Undo',
      ariaLabel: 'Undo start',
      surface: bookingTransitionButtonSurface('Booked'),
      onClick: () => handlers.onStatus(b.id, 'Booked'),
    });
    out.push({
      key: 'complete',
      label: 'Complete',
      surface: bookingTransitionButtonSurface('Completed'),
      onClick: () => handlers.onStatus(b.id, 'Completed'),
    });
  }

  return out;
}

/**
 * Horizontal quick-action row for the compact day view.
 *
 * Sits at the right edge of the bar, vertically centred, and sizes every button to the bar's
 * height so the controls stay fully visible and contained no matter how short the bar gets.
 * The bar lays the name (flex-1, truncating) and this row (flex-none) as flex siblings, so the
 * name always yields space to the buttons rather than running under them.
 */
/**
 * Always leave at least this much width for the client name — it must never be squeezed out.
 * Sized so that when a button *does* appear the name still reads several characters; on lanes
 * too narrow for that (tight overlap splits) we show a clean name-only bar instead of cramming
 * a button against a 2-character stub.
 */
const COMPACT_NAME_RESERVE_PX = 58;
/** Conservative width of one compact action button incl. its gap; used to budget how many fit. */
const COMPACT_PER_BUTTON_PX = 56;

export function CompactBookingActions({
  booking,
  busy,
  barHeightPx,
  availableWidthPx = null,
  narrow = false,
  onStatus,
  onArrived,
}: {
  booking: CompactActionBooking;
  busy: boolean;
  /** Rendered pixel height of the bar — drives button height so they fit within it. */
  barHeightPx: number;
  /**
   * Measured width available to the name + actions (excludes the stripe and drag grip). Used to
   * budget how many buttons fit while always reserving {@link COMPACT_NAME_RESERVE_PX} for the
   * name. `null` before the first measurement — we fall back to the `narrow` hint then.
   */
  availableWidthPx?: number | null;
  /** Overlap-lane hint used only until `availableWidthPx` is measured. */
  narrow?: boolean;
  onStatus: (id: string, next: BookingStatus) => void;
  onArrived: (id: string, arrived: boolean) => void;
}) {
  const allActions = getCompactBookingActions(booking, { onStatus, onArrived });
  if (allActions.length === 0) return null;

  // Decide how many buttons fit. The name is the hard requirement (always visible), so we
  // reserve space for it first and only show buttons that fit in what's left — dropping the
  // lower-priority arrival toggle / undo before the primary transition, never clipping a button.
  let maxButtons: number;
  if (availableWidthPx == null) {
    maxButtons = narrow ? 1 : allActions.length;
  } else {
    const budget = Math.max(0, availableWidthPx - COMPACT_NAME_RESERVE_PX);
    maxButtons = Math.min(allActions.length, Math.max(0, Math.floor(budget / COMPACT_PER_BUTTON_PX)));
  }
  // The primary status transition is always the last action (the arrival toggle / undo-start is
  // pushed first), so keeping the tail keeps the most important control.
  const actions = allActions.slice(allActions.length - maxButtons);
  if (actions.length === 0) return null;

  // Button height tracks the bar: a hair shorter than the bar, floored so it never disappears
  // and capped so it stays compact on the taller compact bars.
  const buttonHeightPx = Math.max(14, Math.min(barHeightPx - 4, 22));
  const fontSizePx = barHeightPx < 22 ? 9 : 10;

  return (
    <div
      className="pointer-events-auto flex shrink-0 items-center gap-1 pl-1.5 pr-0.5"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {actions.map((a) => (
        <button
          key={a.key}
          type="button"
          disabled={busy}
          aria-label={a.ariaLabel ?? a.label}
          onClick={(e) => {
            e.stopPropagation();
            a.onClick();
          }}
          style={{ height: buttonHeightPx, fontSize: fontSizePx, lineHeight: 1 }}
          className={`inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-md px-1.5 font-semibold shadow-sm transition disabled:opacity-50 ${a.surface}`}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}
