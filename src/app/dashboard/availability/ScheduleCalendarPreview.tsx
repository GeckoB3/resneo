'use client';

import { useEffect, useMemo, useState } from 'react';
import type { OpeningHours } from '@/types/availability';
import type { TimeRange, WorkingHours } from '@/types/booking-models';
import { venueDayContext } from '@/lib/calendar/venue-hours-context';
import { getDayOfWeek } from '@/lib/availability/engine';
import {
  resolveScheduleForDate,
  type CalendarSchedule,
  type ScheduleSource,
} from '@/lib/availability/working-hours-rota';

/**
 * The planning calendar on the Availability tab: every day of a month with the hours
 * the calendar is actually bookable (its hours for that date, inside the venue's
 * business hours, minus days off and leave), tinted by which schedule period
 * produced them. Read-only; picking a day hands the date to the parent.
 * See Docs/rotating-schedule-plan.md.
 */

export interface LeaveRow {
  start_date: string;
  end_date: string;
  unavailable_start_time?: string | null;
  unavailable_end_time?: string | null;
}

export type DayReason = 'base' | 'period' | 'no-hours' | 'day-off' | 'venue-closed' | 'leave';

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

/** Tints for periods, by index in the timeline. */
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

function intersectWithVenue(ranges: TimeRange[], venue: Array<{ open: string; close: string }> | null): Array<{ start: number; end: number }> {
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
      const start = Math.max(s, toMinutes(v.open));
      const end = Math.min(e, toMinutes(v.close));
      if (end > start) out.push({ start, end });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Everything the cell shows for one date. Pure, so the calendar and its tests agree. */
export function summariseDay(input: {
  date: string;
  baseHours: WorkingHours;
  schedule: CalendarSchedule | null;
  daysOff: readonly string[];
  venueHours: OpeningHours | null | undefined;
  leave: readonly LeaveRow[];
}): DaySummary {
  const { date } = input;
  const resolution = resolveScheduleForDate({ working_hours: input.baseHours, schedule_periods: input.schedule }, date);
  const dow = getDayOfWeek(date);
  const base = { date, source: resolution.source, partialLeave: null as string | null };

  const leaveToday = input.leave.filter((l) => l.start_date <= date && date <= l.end_date);
  const fullDayLeave = leaveToday.some((l) => !l.unavailable_start_time || !l.unavailable_end_time);
  if (fullDayLeave) return { ...base, text: 'Leave', reason: 'leave' };
  if (input.daysOff.includes(date) || input.daysOff.includes(DAY_NAMES[dow]!)) return { ...base, text: 'Day off', reason: 'day-off' };

  const venue = venueDayContext(input.venueHours, String(dow));
  if (venue.kind === 'closed') return { ...base, text: 'Venue closed', reason: 'venue-closed' };

  const ranges = intersectWithVenue(rangesForDay(resolution.hours, dow), venue.kind === 'open' ? venue.periods : null);
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
  onPickDate?: (date: string) => void;
  /** Loads leave for a date range; defaults to the practitioner-leave route. Injected for tests. */
  loadLeave?: (calendarId: string, from: string, to: string) => Promise<LeaveRow[]>;
  /** The month shown first; defaults to the current month. */
  initialMonth?: { year: number; monthIndex: number };
}

async function defaultLoadLeave(calendarId: string, from: string, to: string): Promise<LeaveRow[]> {
  const params = new URLSearchParams({ from, to, practitioner_id: calendarId });
  const res = await fetch(`/api/venue/practitioner-leave?${params}`);
  if (!res.ok) return [];
  const data = (await res.json().catch(() => ({}))) as { periods?: LeaveRow[] };
  return Array.isArray(data.periods) ? data.periods : [];
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
  initialMonth,
}: ScheduleCalendarPreviewProps) {
  const [month, setMonth] = useState(() => {
    if (initialMonth) return initialMonth;
    const now = new Date();
    return { year: now.getFullYear(), monthIndex: now.getMonth() };
  });
  const [leave, setLeave] = useState<LeaveRow[]>([]);

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

  const summaries = useMemo(() => {
    const map = new Map<string, DaySummary>();
    for (const c of cells) {
      if (c) map.set(c, summariseDay({ date: c, baseHours, schedule, daysOff, venueHours, leave }));
    }
    return map;
  }, [cells, baseHours, schedule, daysOff, venueHours, leave]);

  const today = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }, []);

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
            onClick={() => {
              const now = new Date();
              setMonth({ year: now.getFullYear(), monthIndex: now.getMonth() });
            }}
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
              onClick={() => onPickDate?.(cell)}
              className={`flex min-h-[64px] flex-col items-start rounded-lg border p-1.5 text-left transition-colors hover:border-brand-400 ${tint} ${
                closed ? 'text-slate-400' : 'text-slate-800'
              } ${selected ? 'ring-2 ring-brand-500' : ''} ${cell === today ? 'font-semibold' : ''}`}
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
