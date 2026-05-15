'use client';

import { useState } from 'react';

/** Marker for toolbar overlays — retained so outer dropdown dismiss logic stays harmless if reused later. */
export const CALENDAR_PICKER_SUBPOPOVER_SELECTOR = '[data-calendar-picker-subpopover]';

// ─── Date helpers ────────────────────────────────────────────────────────────

const MONTHS_LONG = [
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

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseISO(dateStr: string): Date {
  return new Date(`${dateStr}T12:00:00`);
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function formatHour(h: number): string {
  return `${String(h).padStart(2, '0')}:00`;
}

/** Half-open window [start, end) in whole hours; end may be 24. */
function clampHourWindow(start: number, end: number): { start: number; end: number } {
  let s = Math.min(Math.max(0, Math.floor(start)), 23);
  let e = Math.min(Math.max(1, Math.floor(end)), 24);
  if (e <= s) e = Math.min(24, s + 1);
  if (s >= e) s = Math.max(0, e - 1);
  return { start: s, end: e };
}

// ─── Mini month grid ──────────────────────────────────────────────────────────

interface MiniMonthGridProps {
  month: number;
  year: number;
  selected: string;
  today: string;
  onSelect: (iso: string) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
}

function MiniMonthGrid({ month, year, selected, today, onSelect, onPrevMonth, onNextMonth }: MiniMonthGridProps) {
  const firstDay = new Date(year, month, 1).getDay();
  const total = daysInMonth(year, month);
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= total; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="w-full select-none">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={onPrevMonth}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          aria-label="Previous month"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </button>
        <span className="text-sm font-semibold text-slate-800">
          {MONTHS_LONG[month]} {year}
        </span>
        <button
          type="button"
          onClick={onNextMonth}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          aria-label="Next month"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
          </svg>
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 text-center">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
          <div key={d} className="py-1 text-[10px] font-medium text-slate-400">
            {d}
          </div>
        ))}
        {cells.map((day, idx) => {
          if (!day) return <div key={`e-${idx}`} />;
          const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const isSelected = iso === selected;
          const isTodayCell = iso === today;
          return (
            <button
              key={iso}
              type="button"
              onClick={() => onSelect(iso)}
              className={`relative flex h-8 w-full items-center justify-center rounded-full text-xs font-medium transition-colors ${
                isSelected
                  ? 'bg-brand-600 text-white'
                  : isTodayCell
                    ? 'font-bold text-brand-600 ring-1 ring-brand-400'
                    : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Time range (compact) ────────────────────────────────────────────────────

interface TimeRangeCompactProps {
  startHour: number;
  endHour: number;
  onApply: (start: number, end: number) => void;
}

function SelectChevron({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
    </svg>
  );
}

function TimeRangeCompact({ startHour, endHour, onApply }: TimeRangeCompactProps) {
  const startOptions = Array.from({ length: 24 }, (_, h) => h).filter((h) => h < endHour);
  const endOptions = Array.from({ length: 25 }, (_, h) => h).filter((h) => h > startHour && h <= 24);

  const emitStart = (raw: number) => {
    const next = clampHourWindow(raw, endHour);
    onApply(next.start, next.end);
  };

  const emitEnd = (raw: number) => {
    const next = clampHourWindow(startHour, raw);
    onApply(next.start, next.end);
  };

  const selectClass =
    'w-full cursor-pointer appearance-none rounded-lg border border-slate-200/95 bg-white py-1 pl-2 pr-7 text-[13px] font-semibold tabular-nums text-slate-900 shadow-sm outline-none transition-colors hover:border-slate-300 focus:border-brand-400 focus:ring-2 focus:ring-brand-100';

  return (
    <div className="rounded-xl bg-gradient-to-b from-slate-50/95 to-white p-2 ring-1 ring-slate-100/90">
      <div className="grid grid-cols-[1fr_auto_1fr] gap-x-2 gap-y-1">
        <label htmlFor="calendar-time-start" className="text-[10px] font-medium text-slate-500">
          From
        </label>
        <div aria-hidden className="min-h-[14px]" />
        <label htmlFor="calendar-time-end" className="text-[10px] font-medium text-slate-500">
          Until
        </label>

        <div className="relative min-w-0">
          <select
            id="calendar-time-start"
            value={startHour}
            onChange={(e) => emitStart(parseInt(e.target.value, 10))}
            className={selectClass}
            aria-label="Start hour"
          >
            {startOptions.map((h) => (
              <option key={h} value={h}>
                {formatHour(h)}
              </option>
            ))}
          </select>
          <SelectChevron className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" />
        </div>

        <div className="flex min-h-[29px] items-center justify-center self-center" aria-hidden>
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm ring-1 ring-slate-200/90">
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.25} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
            </svg>
          </span>
        </div>

        <div className="relative min-w-0">
          <select
            id="calendar-time-end"
            value={endHour}
            onChange={(e) => emitEnd(parseInt(e.target.value, 10))}
            className={selectClass}
            aria-label="End hour (exclusive)"
          >
            {endOptions.map((h) => (
              <option key={h} value={h}>
                {h === 24 ? '24:00 · end of day' : formatHour(h)}
              </option>
            ))}
          </select>
          <SelectChevron className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" />
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export interface CalendarDateTimePickerProps {
  date: string;
  onDateChange: (date: string) => void;
  startHour: number;
  endHour: number;
  onTimeRangeChange: (start: number, end: number) => void;
}

export function CalendarDateTimePicker({ date, onDateChange, startHour, endHour, onTimeRangeChange }: CalendarDateTimePickerProps) {
  const today = todayISO();
  const [calMonth, setCalMonth] = useState<number>(() => parseISO(date).getMonth());
  const [calYear, setCalYear] = useState<number>(() => parseISO(date).getFullYear());
  const [prevDate, setPrevDate] = useState(date);

  if (date !== prevDate) {
    setPrevDate(date);
    const d = parseISO(date);
    setCalMonth(d.getMonth());
    setCalYear(d.getFullYear());
  }

  function handleCalendarSelect(iso: string) {
    onDateChange(iso);
  }

  function prevMonth() {
    if (calMonth === 0) {
      setCalMonth(11);
      setCalYear((y) => y - 1);
    } else setCalMonth((m) => m - 1);
  }

  function nextMonth() {
    if (calMonth === 11) {
      setCalMonth(0);
      setCalYear((y) => y + 1);
    } else setCalMonth((m) => m + 1);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="mx-auto w-full max-w-[17rem]">
        <MiniMonthGrid
          month={calMonth}
          year={calYear}
          selected={date}
          today={today}
          onSelect={handleCalendarSelect}
          onPrevMonth={prevMonth}
          onNextMonth={nextMonth}
        />
      </div>

      <div className="border-t border-slate-100 pt-2">
        <TimeRangeCompact startHour={startHour} endHour={endHour} onApply={onTimeRangeChange} />
      </div>
    </div>
  );
}
