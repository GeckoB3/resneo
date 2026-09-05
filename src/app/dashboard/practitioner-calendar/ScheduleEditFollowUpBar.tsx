'use client';

import { useLayoutEffect, useRef } from 'react';

/**
 * Set on the document root while the bar is mounted, to the bar's height plus
 * a gap. The toast host adds it to its own bottom offset so toasts stack above
 * the bar instead of landing on its buttons.
 */
export const FOLLOW_UP_BAR_TOAST_OFFSET_VAR = '--toast-bottom-offset';

const FOLLOW_UP_BAR_TOAST_GAP_PX = 8;

export interface ScheduleEditFollowUpChange {
  kind: 'move' | 'resize';
  guestName: string;
  /** The column's staff name when the booking moved to another calendar; null when it stayed. */
  staffName: string | null;
  fromDate: string;
  /** For a move, the old start; for a resize, the old end. */
  fromTime: string;
  toDate: string;
  /** For a move, the new start; for a resize, the new end. */
  toTime: string;
  /** The booking's status colour, drawn as the bar's accent strip. */
  accent: string;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDay(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** One line saying what changed: "Moved Sam Jones to 11:15 on Tue 8 Sep with Alex". */
export function scheduleEditFollowUpHeadline(change: ScheduleEditFollowUpChange): string {
  if (change.kind === 'resize') {
    return `${change.guestName} now ends at ${change.toTime} (was ${change.fromTime})`;
  }
  let line = `Moved ${change.guestName} to ${change.toTime}`;
  if (change.toDate !== change.fromDate) line += ` on ${formatDay(change.toDate)}`;
  if (change.staffName) line += ` with ${change.staffName}`;
  return line;
}

/**
 * Notify / skip / undo offered straight after a drag move or resize, as a bar
 * pinned to the bottom of the screen.
 *
 * It used to sit on the booking bar itself, which clipped it: bars are as tall
 * as the appointment is long, and lanes as narrow as the overlap makes them,
 * so a short or overlapped booking cut the prompt off exactly when staff
 * needed it. Down here it has the full width, never covers the diary, and the
 * moved bar is outlined so it is clear which booking the prompt is about.
 */
export function ScheduleEditFollowUpBar({
  change,
  countdownSec,
  disabled,
  onNotifyNow,
  onSkip,
  onUndo,
}: {
  change: ScheduleEditFollowUpChange;
  /** Seconds until the customer is notified automatically; null once that clock has stopped. */
  countdownSec: number | null;
  disabled: boolean;
  onNotifyNow: () => void;
  onSkip: () => void;
  onUndo: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const apply = () => {
      const height = Math.ceil(el.getBoundingClientRect().height);
      root.style.setProperty(FOLLOW_UP_BAR_TOAST_OFFSET_VAR, `${height + FOLLOW_UP_BAR_TOAST_GAP_PX}px`);
    };
    apply();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(apply);
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      root.style.removeProperty(FOLLOW_UP_BAR_TOAST_OFFSET_VAR);
    };
  }, []);

  const headline = scheduleEditFollowUpHeadline(change);
  const status =
    countdownSec != null && countdownSec > 0
      ? `The customer will be notified in ${countdownSec}s unless you skip or undo.`
      : 'Notify the customer about this change?';

  return (
    <div
      ref={ref}
      role="region"
      aria-label={
        change.kind === 'resize'
          ? 'Notify the customer, skip, or undo this duration change'
          : 'Notify the customer, skip, or undo this move'
      }
      className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom,0px))] z-[90] sm:inset-x-auto sm:left-1/2 sm:w-max sm:max-w-[calc(100vw-1.5rem)] sm:-translate-x-1/2"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-slate-200 bg-white/95 px-3 py-2 shadow-[0_16px_40px_rgba(15,23,42,0.18)] ring-1 ring-slate-900/[0.05] backdrop-blur-sm">
        <span
          className="h-8 w-1 shrink-0 rounded-full"
          style={{ backgroundColor: change.accent }}
          aria-hidden
        />
        <div className="min-w-0 flex-1 basis-48">
          <p className="truncate text-sm font-semibold text-slate-800">{headline}</p>
          <p className="text-xs text-slate-600">{status}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={disabled}
            onClick={onNotifyNow}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold leading-none text-white shadow-sm shadow-brand-900/20 transition hover:bg-brand-700 disabled:opacity-50"
          >
            Notify now
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={onSkip}
            className="rounded-lg border border-slate-300/90 bg-white px-3 py-1.5 text-xs font-semibold leading-none text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
          >
            Skip notify
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={onUndo}
            className="rounded-lg border border-slate-300/90 bg-white px-3 py-1.5 text-xs font-semibold leading-none text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
          >
            Undo
          </button>
        </div>
      </div>
    </div>
  );
}
