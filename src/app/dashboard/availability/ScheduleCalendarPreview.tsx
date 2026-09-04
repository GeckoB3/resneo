'use client';

import { useEffect, useMemo, useState } from 'react';
import type { AvailabilityBlock, OpeningHours } from '@/types/availability';
import type { TimeRange, WorkingHours } from '@/types/booking-models';
import { getDayOfWeek } from '@/lib/availability/engine';
import { resolveVenueWideAllowedMinuteRanges } from '@/lib/availability/venue-wide-business-hours';
import {
  resolveScheduleForDate,
  type CalendarSchedule,
  type ScheduleSource,
} from '@/lib/availability/working-hours-rota';

/**
 * The planning calendar on the Availability tab: every day of a month with the hours
 * the calendar is actually bookable (its hours for that date, inside the venue's
 * business hours and closures, minus days off and leave), tinted by which schedule
 * period produced them. Read-only; picking a day hands the date and its summary to
 * the parent. Pages back through past months as well as ahead, so a change that has
 * ended can still be seen where it applied. See Docs/rotating-schedule-plan.md.
 */

export interface LeaveRow {
  start_date: string;
  end_date: string;
  unavailable_start_time?: string | null;
  unavailable_end_time?: string | null;
}

export type DayReason = 'base' | 'period' | 'no-hours' | 'day-off' | 'venue-closed' | 'venue-closure' | 'leave';

export interface DaySummary {
  date: string;
  /** "09:00–17:00", "Closed", "Day off", "Venue closed", "Leave". */
  text: string;
  reason: DayReason;
  source: ScheduleSource;
  /** A part-day leave window, shown alongside the hours. */
  partialLeave: string | null;
}

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Tints for periods, by index in the full timeline (past changes included, so a colour never moves). */
export const PERIOD_TINTS = [
  { cell: 'bg-sky-50 border-sky-200', swatch: 'bg-sky-200' },
  { cell: 'bg-violet-50 border-violet-200', swatch: 'bg-violet-200' },
  { cell: 'bg-emerald-50 border-emerald-200', swatch: 'bg-emerald-200' },
  { cell: 'bg-amber-50 border-amber-200', swatch: 'bg-amber-200' },
  { cell: 'bg-rose-50 border-rose-200', swatch: 'bg-rose-200' },
  { cell: 'bg-teal-50 border-teal-200', swatch: 'bg-teal-200' },
];

function toMinutes(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
}

function toHhMm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function rangesForDay(hours: WorkingHours, dow: number): TimeRange[] {
  const numeric = hours[String(dow)];
  if (Array.isArray(numeric) && numeric.length > 0) return numeric;
  const named = hours[DAY_NAMES[dow]!];
  return Array.isArray(named) ? named : [];
}

function intersectWithVenue(
  ranges: TimeRange[],
  venue: Array<{ start: number; end: number }> | null,
): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  for (const r of ranges) {
    const s = toMinutes(r.start);
    const e = toMinutes(r.end);
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue;
    if (!venue) {
      out.push({ start: s, end: e });
      continue;
    }
    for (const v of venue) {
      const start = Math.max(s, v.start);
      const end = Math.min(e, v.end);
      if (end > start) out.push({ start, end });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Everything the cell shows for one date. Pure, so the calendar and its tests agree.
 *
 * The venue side goes through `resolveVenueWideAllowedMinuteRanges`, the same
 * resolver the booking engines and the diary use, so a closure, an amended-hours
 * day and a weekday the venue does not trade all read here exactly as they book.
 */
export function summariseDay(input: {
  date: string;
  baseHours: WorkingHours;
  schedule: CalendarSchedule | null;
  daysOff: readonly string[];
  venueHours: OpeningHours | null | undefined;
  leave: readonly LeaveRow[];
  /** Venue-wide closures and amended hours; omit for the weekly hours alone. */
  venueWideBlocks?: readonly AvailabilityBlock[];
}): DaySummary {
  const { date } = input;
  const resolution = resolveScheduleForDate({ working_hours: input.baseHours, schedule_periods: input.schedule }, date);
  const dow = getDayOfWeek(date);
  const base = { date, source: resolution.source, partialLeave: null as string | null };

  const leaveToday = input.leave.filter((l) => l.start_date <= date && date <= l.end_date);
  const fullDayLeave = leaveToday.some((l) => !l.unavailable_start_time || !l.unavailable_end_time);
  if (fullDayLeave) return { ...base, text: 'Leave', reason: 'leave' };
  if (input.daysOff.includes(date) || input.daysOff.includes(DAY_NAMES[dow]!)) return { ...base, text: 'Day off', reason: 'day-off' };

  const venue = resolveVenueWideAllowedMinuteRanges(input.venueHours, date, [...(input.venueWideBlocks ?? [])]);
  if (venue.kind === 'closed') {
    return { ...base, text: 'Venue closed', reason: venue.cause === 'weekly' ? 'venue-closed' : 'venue-closure' };
  }

  const ranges = intersectWithVenue(rangesForDay(resolution.hours, dow), venue.kind === 'allowed' ? venue.ranges : null);
  const partial = leaveToday.find((l) => l.unavailable_start_time && l.unavailable_end_time);
  const partialLeave = partial ? `${partial.unavailable_start_time!.slice(0, 5)}–${partial.unavailable_end_time!.slice(0, 5)}` : null;
  if (ranges.length === 0) return { ...base, text: 'Closed', reason: 'no-hours', partialLeave };
  return {
    ...base,
    text: ranges.map((r) => `${toHhMm(r.start)}–${toHhMm(r.end)}`).join(', '),
    reason: resolution.source.kind === 'period' ? 'period' : 'base',
    partialLeave,
  };
}

/** Days of a month laid out Monday-first, with leading and trailing blanks. */
export function monthCells(year: number, monthIndex: number): Array<string | null> {
  const first = `${year}-${String(monthIndex + 1).padStart(2, '0')}-01`;
  const lead = (getDayOfWeek(first) + 6) % 7;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells: Array<string | null> = Array(lead).fill(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(`${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export interface ScheduleCalendarPreviewProps {
  calendarId: string;
  baseHours: WorkingHours;
  schedule: CalendarSchedule | null;
  daysOff: readonly string[];
  venueHours: OpeningHours | null | undefined;
  selectedDate?: string | null;
  onPickDate?: (date: string, summary: DaySummary) => void;
  /** Loads leave for a date range; defaults to the practitioner-leave route. Injected for tests. */
  loadLeave?: (calendarId: string, from: string, to: string) => Promise<LeaveRow[]>;
  /** Loads the venue's closures and amended hours; defaults to the availability-blocks route. Injected for tests. */
  loadVenueBlocks?: () => Promise<AvailabilityBlock[]>;
  /** The month shown first; defaults to the current month. */
  initialMonth?: { year: number; monthIndex: number };
  /** Today, `YYYY-MM-DD`; defaults to the browser's date. Injected for tests. */
  todayYmd?: string;
}

async function defaultLoadLeave(calendarId: string, from: string, to: string): Promise<LeaveRow[]> {
  const params = new URLSearchParams({ from, to, practitioner_id: calendarId });
  const res = await fetch(`/api/venue/practitioner-leave?${params}`);
  if (!res.ok) return [];
  const data = (await res.json().catch(() => ({}))) as { periods?: LeaveRow[] };
  return Array.isArray(data.periods) ? data.periods : [];
}

async function defaultLoadVenueBlocks(): Promise<AvailabilityBlock[]> {
  const res = await fetch('/api/venue/availability-blocks');
  if (!res.ok) return [];
  const data = (await res.json().catch(() => ({}))) as { blocks?: AvailabilityBlock[] };
  // Venue-wide rows only: a service-scoped block does not close the venue.
  return Array.isArray(data.blocks) ? data.blocks.filter((b) => b.service_id == null) : [];
}

function localTodayYmd(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function ScheduleCalendarPreview({
  calendarId,
  baseHours,
  schedule,
  daysOff,
  venueHours,
  selectedDate = null,
  onPickDate,
  loadLeave = defaultLoadLeave,
  loadVenueBlocks = defaultLoadVenueBlocks,
  initialMonth,
  todayYmd,
}: ScheduleCalendarPreviewProps) {
  const today = todayYmd ?? localTodayYmd();
  const [month, setMonth] = useState(() => {
    if (initialMonth) return initialMonth;
    return { year: Number(today.slice(0, 4)), monthIndex: Number(today.slice(5, 7)) - 1 };
  });
  const [leave, setLeave] = useState<LeaveRow[]>([]);
  const [venueWideBlocks, setVenueWideBlocks] = useState<AvailabilityBlock[]>([]);

  const cells = useMemo(() => monthCells(month.year, month.monthIndex), [month]);
  const firstDay = cells.find((c): c is string => c != null) ?? '';
  const lastDay = [...cells].reverse().find((c): c is string => c != null) ?? '';

  useEffect(() => {
    let cancelled = false;
    if (!firstDay || !lastDay) return;
    void loadLeave(calendarId, firstDay, lastDay).then((rows) => {
      if (!cancelled) setLeave(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [calendarId, firstDay, lastDay, loadLeave]);

  useEffect(() => {
    let cancelled = false;
    void loadVenueBlocks().then((rows) => {
      if (!cancelled) setVenueWideBlocks(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [loadVenueBlocks]);

  const summaries = useMemo(() => {
    const map = new Map<string, DaySummary>();
    for (const c of cells) {
      if (c) map.set(c, summariseDay({ date: c, baseHours, schedule, daysOff, venueHours, leave, venueWideBlocks }));
    }
    return map;
  }, [cells, baseHours, schedule, daysOff, venueHours, leave, venueWideBlocks]);

  function shift(delta: number) {
    setMonth((m) => {
      const d = new Date(m.year, m.monthIndex + delta, 1);
      return { year: d.getFullYear(), monthIndex: d.getMonth() };
    });
  }

  const periodIndexById = new Map((schedule?.periods ?? []).map((p, i) => [p.id, i]));

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <button type="button" onClick={() => shift(-1)} aria-label="Previous month" className="rounded-lg border border-slate-200 px-2 py-1 text-sm hover:bg-slate-50">
          ‹
        </button>
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold text-slate-900">
            {MONTH_NAMES[month.monthIndex]} {month.year}
          </h4>
          <button
            type="button"
            onClick={() => setMonth({ year: Number(today.slice(0, 4)), monthIndex: Number(today.slice(5, 7)) - 1 })}
            className="rounded-md border border-slate-200 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50"
          >
            Today
          </button>
        </div>
        <button type="button" onClick={() => shift(1)} aria-label="Next month" className="rounded-lg border border-slate-200 px-2 py-1 text-sm hover:bg-slate-50">
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500" aria-hidden="true">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1" role="grid" aria-label={`Bookable hours in ${MONTH_NAMES[month.monthIndex]} ${month.year}`}>
        {cells.map((cell, i) => {
          if (!cell) return <div key={`blank-${i}`} aria-hidden="true" />;
          const s = summaries.get(cell)!;
          const periodIndex = s.source.kind === 'period' ? periodIndexById.get(s.source.period.id) ?? 0 : null;
          const tint = periodIndex != null ? PERIOD_TINTS[periodIndex % PERIOD_TINTS.length]!.cell : 'bg-white border-slate-200';
          const closed = s.reason !== 'base' && s.reason !== 'period';
          const selected = selectedDate === cell;
          return (
            <button
              key={cell}
              type="button"
              role="gridcell"
              aria-selected={selected}
              aria-label={`${cell}: ${s.text}${s.partialLeave ? `, leave ${s.partialLeave}` : ''}`}
              onClick={() => onPickDate?.(cell, s)}
              className={`flex min-h-[64px] flex-col items-start rounded-lg border p-1.5 text-left transition-colors hover:border-brand-400 ${tint} ${
                closed ? 'text-slate-400' : 'text-slate-800'
              } ${selected ? 'ring-2 ring-brand-500' : ''} ${cell === today ? 'font-semibold' : ''} ${cell < today ? 'opacity-80' : ''}`}
            >
              <span className="flex w-full items-center justify-between text-xs">
                <span>{Number(cell.slice(8, 10))}</span>
                {s.source.kind === 'period' && s.source.period.weeks.length > 1 ? (
                  <span className="rounded bg-white/80 px-1 text-[10px] font-medium text-slate-600">W{s.source.weekIndex + 1}</span>
                ) : null}
              </span>
              <span className="mt-1 text-[11px] leading-tight">{s.text}</span>
              {s.partialLeave ? <span className="text-[10px] text-slate-500">leave {s.partialLeave}</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
