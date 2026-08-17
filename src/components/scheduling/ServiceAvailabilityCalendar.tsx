'use client';

import { useMemo, useState } from 'react';
import {
  computeServiceAvailabilityForDate,
  type ServiceAvailabilityForDate,
} from '@/lib/service-custom-availability';
import type { OpeningHours } from '@/types/availability';
import type { VenueOpeningException } from '@/types/venue-opening-exceptions';
import type {
  ServiceCustomScheduleStored,
  WorkingHours,
} from '@/types/booking-models';
import { venueOpeningExceptionsToBlocks } from '@/lib/availability/venue-exceptions-adapter';
import type { AvailabilityBlock } from '@/types/availability';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function ymdOf(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function todayParts(): { year: number; month: number; ymd: string } {
  const d = new Date();
  const ymd = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  return { year: d.getFullYear(), month: d.getMonth() + 1, ymd };
}

function friendlyFullDate(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  const d = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** Compact time like "9" or "9:30" or "17:00". */
function compactTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}` : `${h}:${pad2(m)}`;
}

function compactRange(r: { start: number; end: number }): string {
  return `${compactTime(r.start)}–${compactTime(r.end)}`;
}

function fullTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

function fullRange(r: { start: number; end: number }): string {
  return `${fullTime(r.start)}–${fullTime(r.end)}`;
}

interface Props {
  venueOpeningHours: OpeningHours | null | undefined;
  venueOpeningExceptions?: VenueOpeningException[] | null;
  /** Real `availability_blocks` rows. Preferred over the legacy JSON when supplied. */
  venueWideBlocks?: AvailabilityBlock[] | null;
  linkedCalendars: Array<{ id: string; working_hours: WorkingHours | null | undefined }>;
  customAvailabilityEnabled: boolean;
  customWorkingHours: ServiceCustomScheduleStored | null | undefined;
  /** Shown below the calendar as a small footnote. */
  footnote?: string;
}

/**
 * Month-view calendar showing real online-bookable availability per date,
 * intersecting venue hours (+ exceptions), linked calendar weekly hours,
 * and the service's custom schedule. Staff blocks and one-off calendar
 * changes are not included.
 */
export function ServiceAvailabilityCalendar({
  venueOpeningHours,
  venueOpeningExceptions,
  venueWideBlocks,
  linkedCalendars,
  customAvailabilityEnabled,
  customWorkingHours,
  footnote,
}: Props) {
  /**
   * This surface is fed the LEGACY `venues.venue_opening_exceptions` JSON, not
   * `availability_blocks`, so it has never seen a real closure or amended-hours row --
   * and Q9 (2026-08-17) found no venue carrying any legacy JSON at all, which means the
   * summary has effectively been resolving "no venue exceptions" for everyone.
   *
   * Converting here puts it on the shared resolver so its answer matches the engine's.
   * Pointing it at `availability_blocks` is a data-fetch change in the dashboard view and
   * belongs with the Stage 4 UI work; recorded in the plan rather than left implied.
   */
  /**
   * Real blocks when the caller has them; otherwise the legacy
   * `venues.venue_opening_exceptions` JSON converted up to block shape.
   *
   * This surface used to read ONLY the legacy JSON, so it never saw a closure or an
   * amended-hours row -- and Q9 (2026-08-17) found no venue carrying any legacy JSON at
   * all, which means the summary was resolving "no venue exceptions" for everyone.
   */
  const resolvedVenueBlocks = useMemo(
    () =>
      venueWideBlocks && venueWideBlocks.length > 0
        ? venueWideBlocks
        : venueOpeningExceptionsToBlocks(venueOpeningExceptions ?? null, ''),
    [venueWideBlocks, venueOpeningExceptions],
  );

  const today = useMemo(() => todayParts(), []);
  const [year, setYear] = useState<number>(today.year);
  const [month, setMonth] = useState<number>(today.month);
  const [selected, setSelected] = useState<string>(today.ymd);

  const firstDayIdx = (new Date(year, month - 1, 1).getDay() + 6) % 7; // Mon=0
  const lastDate = new Date(year, month, 0).getDate();
  const cells: Array<number | null> = [];
  for (let i = 0; i < firstDayIdx; i++) cells.push(null);
  for (let d = 1; d <= lastDate; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const availabilityByYmd = useMemo(() => {
    const map = new Map<string, ServiceAvailabilityForDate>();
    for (let d = 1; d <= lastDate; d++) {
      const ymd = ymdOf(year, month, d);
      map.set(
        ymd,
        computeServiceAvailabilityForDate(
          {
            venueOpeningHours,
            venueWideBlocks: resolvedVenueBlocks,
            linkedCalendars,
            customAvailabilityEnabled,
            customWorkingHours,
          },
          ymd,
        ),
      );
    }
    return map;
  }, [
    year,
    month,
    lastDate,
    venueOpeningHours,
    resolvedVenueBlocks,
    linkedCalendars,
    customAvailabilityEnabled,
    customWorkingHours,
  ]);

  const bookableCount = useMemo(() => {
    let c = 0;
    for (const v of availabilityByYmd.values()) if (v.ranges.length > 0) c++;
    return c;
  }, [availabilityByYmd]);

  const selectedInfo = availabilityByYmd.get(selected) ?? null;

  function goPrev() {
    if (month === 1) {
      setMonth(12);
      setYear((y) => y - 1);
    } else {
      setMonth((m) => m - 1);
    }
  }
  function goNext() {
    if (month === 12) {
      setMonth(1);
      setYear((y) => y + 1);
    } else {
      setMonth((m) => m + 1);
    }
  }
  function goToday() {
    setYear(today.year);
    setMonth(today.month);
    setSelected(today.ymd);
  }

  const isCurrentMonth = year === today.year && month === today.month;
  const title = `${MONTH_NAMES[month - 1]} ${year}`;

  if (linkedCalendars.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 text-sm text-slate-600">
        Link at least one calendar to this service to preview when guests can book it online.
      </div>
    );
  }

  return (
    <div className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex min-w-0 items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/80 px-3 py-2.5">
        <button
          type="button"
          onClick={goPrev}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
          aria-label="Previous month"
        >
          <span className="text-lg leading-none" aria-hidden>‹</span>
        </button>
        <div className="min-w-0 text-center">
          <div className="text-sm font-semibold tracking-tight text-slate-900">{title}</div>
          <div className="text-[11px] font-medium text-slate-500">
            {bookableCount} bookable {bookableCount === 1 ? 'day' : 'days'} this month
          </div>
        </div>
        <div className="flex items-center gap-1">
          {!isCurrentMonth ? (
            <button
              type="button"
              onClick={goToday}
              className="hidden h-9 items-center rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 sm:flex"
            >
              Today
            </button>
          ) : null}
          <button
            type="button"
            onClick={goNext}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
            aria-label="Next month"
          >
            <span className="text-lg leading-none" aria-hidden>›</span>
          </button>
        </div>
      </div>

      <div className="min-w-0 p-3">
        {/* Weekday headers */}
        <div className="grid min-w-0 grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          {WEEKDAYS.map((w) => (
            <div key={w} className="py-1.5">{w}</div>
          ))}
        </div>

        {/* Day cells */}
        <div className="mt-1 grid min-w-0 grid-cols-7 gap-1">
          {cells.map((d, idx) => {
            if (d === null) {
              return <div key={`e-${idx}`} className="min-h-[3.75rem]" aria-hidden />;
            }
            const ymd = ymdOf(year, month, d);
            const info = availabilityByYmd.get(ymd);
            const isToday = ymd === today.ymd;
            const isSelected = ymd === selected;
            const isPast = ymd < today.ymd;
            const open = (info?.ranges.length ?? 0) > 0;

            const base =
              'flex min-w-0 min-h-[3.75rem] flex-col items-stretch justify-between rounded-xl border px-1 py-1 text-left transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-1 focus:ring-offset-white sm:px-1.5';

            let style = '';
            if (isSelected) {
              style = open
                ? 'border-brand-500 bg-brand-600 text-white shadow-md shadow-brand-600/25'
                : 'border-slate-400 bg-slate-700 text-white shadow-md shadow-slate-700/20';
            } else if (open) {
              style = isPast
                ? 'border-emerald-100 bg-emerald-50/50 text-emerald-900/70 hover:border-emerald-200 hover:bg-emerald-50'
                : 'border-emerald-200 bg-emerald-50 text-emerald-900 hover:border-emerald-300 hover:bg-emerald-100';
            } else {
              style = 'border-slate-100 bg-slate-50 text-slate-400 hover:border-slate-200 hover:bg-slate-100/70';
            }
            if (isToday && !isSelected) {
              style += ' ring-2 ring-brand-300/70';
            }

            const firstRange = info?.ranges[0];
            const extraCount = (info?.ranges.length ?? 0) - 1;

            return (
              <button
                key={ymd}
                type="button"
                onClick={() => setSelected(ymd)}
                className={`${base} ${style}`}
                aria-label={`${friendlyFullDate(ymd)}${open ? '' : ', not bookable'}`}
                aria-pressed={isSelected}
              >
                <span className="text-[13px] font-semibold leading-none">{d}</span>
                <span className="min-w-0 truncate text-[9px] leading-tight tabular-nums sm:text-[10px]">
                  {open && firstRange ? (
                    <>
                      {compactRange(firstRange)}
                      {extraCount > 0 ? (
                        <span className="opacity-75"> +{extraCount}</span>
                      ) : null}
                    </>
                  ) : (
                    <span className="opacity-70">Closed</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {/* Legend */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full border border-emerald-300 bg-emerald-100" aria-hidden />
            Bookable online
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full border border-slate-300 bg-slate-100" aria-hidden />
            Closed
          </span>
        </div>

        {/* Selected day detail */}
        <SelectedDayPanel ymd={selected} info={selectedInfo} />

        {footnote ? (
          <p className="mt-3 text-[11px] leading-relaxed text-slate-500">{footnote}</p>
        ) : null}
      </div>
    </div>
  );
}

function SelectedDayPanel({
  ymd,
  info,
}: {
  ymd: string;
  info: ServiceAvailabilityForDate | null;
}) {
  const open = info && info.ranges.length > 0;
  const heading = friendlyFullDate(ymd);

  let reason: string | null = null;
  if (info && !open) {
    if (info.venueClosed) {
      reason = 'Venue is closed on this date.';
    } else if (info.serviceCustomExcludes) {
      reason = "This service's custom schedule excludes this date.";
    } else if (info.calendarsClosed) {
      reason = "None of this service's linked calendars work this weekday.";
    } else {
      reason = 'No overlap between venue hours, calendar hours, and service hours on this date.';
    }
  }

  return (
    <div
      className={`mt-3 rounded-xl border p-3 ${
        open ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-slate-50/70'
      }`}
    >
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="min-w-0 break-words text-sm font-semibold text-slate-900">{heading}</p>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            open
              ? 'border border-emerald-300 bg-emerald-100 text-emerald-800'
              : 'border border-slate-300 bg-white text-slate-600'
          }`}
        >
          {open ? 'Bookable' : 'Closed'}
        </span>
      </div>
      {open ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {info!.ranges.map((r) => (
            <li
              key={`${r.start}-${r.end}`}
              className="rounded-lg border border-emerald-300/70 bg-white px-2 py-1 text-xs font-semibold tabular-nums text-emerald-900"
            >
              {fullRange(r)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{reason ?? '—'}</p>
      )}
    </div>
  );
}
