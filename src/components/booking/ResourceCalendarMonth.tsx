'use client';

import { useEffect, useRef, useState } from 'react';
import { formatIsoDateInTimeZone } from '@/lib/date/format-iso-date-in-timezone';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Today in local timezone as YYYY-MM-DD. */
export function todayYmdLocal(): string {
  const t = new Date();
  return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;
}

/**
 * Today in the venue's IANA timezone as YYYY-MM-DD.
 * Use this for the minimum bookable day so a guest in another timezone is not
 * offered (or denied) a day based on their own browser clock.
 */
export function todayYmdInTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return todayYmdLocal();
  return formatIsoDateInTimeZone(new Date(), timeZone);
}

/** Weeks ahead of today for staff booking date shortcuts (+2 … +6). */
export const STAFF_BOOKING_WEEK_OFFSETS = [2, 3, 4, 5, 6] as const;

/** Local calendar date N weeks from today (or from `base`). */
export function addWeeksLocalYmd(weeksFromToday: number, base: Date = new Date()): string {
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + weeksFromToday * 7);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Local Date the +N week shortcuts count forward from, parsed from a YYYY-MM-DD
 * anchor. Returns undefined for missing/invalid input so callers fall back to
 * today (the {@link addWeeksLocalYmd} default). Staff rebook passes the source
 * booking's date — upcoming → that booking, previous → today — so the offsets
 * read as "N weeks after that booking" rather than after today.
 */
export function weekShortcutAnchorDate(ymd: string | null | undefined): Date | undefined {
  if (!ymd) return undefined;
  const d = new Date(`${ymd}T00:00:00`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function formatWeekShortcutLabel(weeks: number, ymd: string): string {
  const d = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return `+${weeks} wk`;
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  return `+${weeks} wk · ${day}`;
}

const NAV_BTN_BASE =
  'min-h-10 min-w-10 shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2';
const NAV_BTN_PUBLIC = 'ap-calendar-nav shrink-0 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors';

export function ResourceCalendarMonth({
  year,
  month,
  availableDates,
  selectedDate,
  onSelectDate,
  onPrevMonth,
  onNextMonth,
  minSelectableDate,
  maxSelectableDate,
  loading = false,
  accentPublic = false,
  weekOffsetShortcuts = false,
  weekShortcutBaseDate,
}: {
  year: number;
  month: number;
  availableDates: Set<string>;
  selectedDate: string | null;
  onSelectDate: (ymd: string) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  /** First date users may book (inclusive), YYYY-MM-DD. */
  minSelectableDate: string;
  /** Last date users may book (inclusive), YYYY-MM-DD. Omit for no upper limit. */
  maxSelectableDate?: string;
  loading?: boolean;
  /** When true, nav/selection use appointment-public accent classes. */
  accentPublic?: boolean;
  /** Staff booking: quick-pick +2 … +6 weeks below the grid. */
  weekOffsetShortcuts?: boolean;
  /**
   * Anchor date (YYYY-MM-DD) the +2 … +6 week shortcuts count forward from.
   * Defaults to today when omitted. Staff rebook passes the source booking's
   * date so the offsets read as "N weeks after that booking", not after today.
   */
  weekShortcutBaseDate?: string;
}) {
  const first = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0).getDate();
  const leading = (first.getDay() + 6) % 7;
  const cells: Array<number | null> = [];
  for (let i = 0; i < leading; i++) cells.push(null);
  for (let d = 1; d <= lastDay; d++) cells.push(d);

  const title = `${MONTH_NAMES[month - 1]} ${year}`;
  const navClass = accentPublic ? NAV_BTN_PUBLIC : NAV_BTN_BASE;

  // Anchor the +N week shortcuts (defaults to today; staff rebook supplies the
  // source booking's date so the offsets count forward from that booking).
  const weekShortcutBase = weekShortcutAnchorDate(weekShortcutBaseDate);

  // Roving-tabindex focus target for arrow-key grid navigation. Defaults to the
  // selected day, else the first focusable (non-disabled) day, else day 1.
  const dayRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const isFocusable = (d: number): boolean => {
    const ymd = `${year}-${pad2(month)}-${pad2(d)}`;
    const isPast = ymd < minSelectableDate;
    const overMax = maxSelectableDate != null && ymd > maxSelectableDate;
    const hasAvail = availableDates.has(ymd);
    const isSelected = selectedDate === ymd;
    return !(isPast || overMax || (!hasAvail && !isSelected));
  };
  const firstFocusableDay = (): number => {
    if (selectedDate) {
      const [sy, sm, sd] = selectedDate.split('-').map(Number);
      if (sy === year && sm === month && sd >= 1 && sd <= lastDay) return sd;
    }
    for (let d = 1; d <= lastDay; d++) {
      if (isFocusable(d)) return d;
    }
    return 1;
  };
  const [focusDay, setFocusDay] = useState<number>(firstFocusableDay);

  // Re-seat the roving focus when the month or availability changes (keeps the
  // tabbable day valid after navigation without stealing focus on every render).
  useEffect(() => {
    setFocusDay(firstFocusableDay());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, selectedDate, lastDay]);

  const moveFocusTo = (d: number) => {
    if (d < 1 || d > lastDay) return;
    setFocusDay(d);
    const el = dayRefs.current.get(d);
    el?.focus();
  };

  const onDayKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, d: number) => {
    let next: number | null = null;
    switch (event.key) {
      case 'ArrowRight':
        next = d + 1;
        break;
      case 'ArrowLeft':
        next = d - 1;
        break;
      case 'ArrowDown':
        next = d + 7;
        break;
      case 'ArrowUp':
        next = d - 7;
        break;
      case 'Home':
        next = d - ((leading + d - 1) % 7);
        break;
      case 'End': {
        const col = (leading + d - 1) % 7;
        next = Math.min(lastDay, d + (6 - col));
        break;
      }
      default:
        return;
    }
    if (next == null) return;
    event.preventDefault();
    if (next >= 1 && next <= lastDay) {
      moveFocusTo(next);
    }
  };

  return (
    <div
      className="relative min-w-0 max-w-full rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm sm:p-4"
      aria-busy={loading}
    >
      <div className="mb-3 flex min-w-0 items-center justify-between gap-2">
        <button type="button" onClick={onPrevMonth} className={navClass} aria-label="Previous month">
          ←
        </button>
        <div className="min-w-0 truncate text-center text-sm font-semibold tracking-tight text-slate-900">{title}</div>
        <button type="button" onClick={onNextMonth} className={navClass} aria-label="Next month">
          →
        </button>
      </div>

      <div
        role="grid"
        aria-label={`${title} — choose a date`}
        aria-rowcount={Math.ceil(cells.length / 7) + 1}
        aria-colcount={7}
      >
        <div
          role="row"
          className="grid min-w-0 grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500"
        >
          {WEEKDAYS.map((w) => (
            <div key={w} role="columnheader" className="py-1">
              {w}
            </div>
          ))}
        </div>

        <div className="mt-1">
          <div className="grid min-w-0 grid-cols-7 gap-1 auto-rows-[minmax(2.5rem,auto)]">
            {cells.map((d, idx) => {
              if (d === null) {
                return <div key={`e-${idx}`} role="gridcell" className="min-h-[2.5rem]" aria-hidden />;
              }
              const ymd = `${year}-${pad2(month)}-${pad2(d)}`;
              const isPast = ymd < minSelectableDate;
              const overMax = maxSelectableDate != null && ymd > maxSelectableDate;
              const hasAvail = availableDates.has(ymd);
              const isSelected = selectedDate === ymd;
              const disabled = isPast || overMax || (!hasAvail && !isSelected);

              let cellClass =
                'flex min-h-[2.5rem] min-w-0 items-center justify-center rounded-lg text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 sm:min-h-[2.75rem] ';
              if (isSelected) {
                cellClass += accentPublic
                  ? 'ap-cal-day-selected cursor-pointer '
                  : 'cursor-pointer bg-slate-800 text-white shadow-sm ring-2 ring-slate-800 ring-offset-1 ';
              } else if (disabled) {
                cellClass += isPast || overMax
                  ? 'cursor-not-allowed text-slate-300 '
                  : 'cursor-not-allowed bg-slate-50 text-slate-400 ';
              } else if (hasAvail) {
                cellClass +=
                  'cursor-pointer bg-emerald-50 text-emerald-900 ring-1 ring-emerald-300 hover:bg-emerald-100 ';
              } else {
                cellClass += 'text-slate-400 ';
              }

              return (
                <button
                  key={ymd}
                  ref={(el) => {
                    if (el) dayRefs.current.set(d, el);
                    else dayRefs.current.delete(d);
                  }}
                  type="button"
                  role="gridcell"
                  disabled={disabled}
                  // Roving tabindex: only the focus target is tabbable; arrow keys move focus
                  // between days. Disabled days remain reachable so the grid never traps focus.
                  tabIndex={d === focusDay ? 0 : -1}
                  onKeyDown={(e) => onDayKeyDown(e, d)}
                  onFocus={() => setFocusDay(d)}
                  onClick={() => {
                    if (!disabled) onSelectDate(ymd);
                  }}
                  className={cellClass}
                  aria-label={`${ymd}${hasAvail && !isPast ? ', has availability' : ''}${isSelected ? ', selected' : ''}`}
                  aria-pressed={isSelected}
                  aria-disabled={disabled}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {weekOffsetShortcuts ? (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3">
            {STAFF_BOOKING_WEEK_OFFSETS.map((weeks) => {
              const ymd = addWeeksLocalYmd(weeks, weekShortcutBase);
              const outOfRange =
                ymd < minSelectableDate || (maxSelectableDate != null && ymd > maxSelectableDate);
              const isSelected = selectedDate === ymd;
              return (
                <button
                  key={weeks}
                  type="button"
                  disabled={outOfRange}
                  title={formatWeekShortcutLabel(weeks, ymd)}
                  onClick={() => {
                    if (!outOfRange) onSelectDate(ymd);
                  }}
                  className={`rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    isSelected
                      ? accentPublic
                        ? 'ap-cal-day-selected'
                        : 'bg-slate-800 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-700 hover:bg-brand-50 hover:text-brand-800'
                  }`}
                >
                  <span className="block tabular-nums">+{weeks} wk</span>
                </button>
              );
            })}
        </div>
      ) : null}

      <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-400 ring-1 ring-emerald-300" aria-hidden />
          Has availability
        </span>
        {!loading && availableDates.size === 0 ? (
          <span className="text-slate-400">No bookable days this month — try another month.</span>
        ) : null}
      </p>
    </div>
  );
}
