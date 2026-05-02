'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useDismissibleLayer } from '@/lib/ui/use-dismissible-layer';

// ─── Date helpers ────────────────────────────────────────────────────────────

const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
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

// ─── Strip date item ──────────────────────────────────────────────────────────

interface StripDateItem {
  iso: string;
  dayShort: string;
  dayNum: number;
  isToday: boolean;
  isSelected: boolean;
}

function buildStrip(centerDate: string, windowDays: number): StripDateItem[] {
  const today = todayISO();
  const half = Math.floor(windowDays / 2);
  const items: StripDateItem[] = [];
  for (let i = -half; i <= half; i++) {
    const iso = addDays(centerDate, i);
    const d = parseISO(iso);
    items.push({
      iso,
      dayShort: DAYS_SHORT[d.getDay()]!,
      dayNum: d.getDate(),
      isToday: iso === today,
      isSelected: iso === centerDate,
    });
  }
  return items;
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
    <div className="w-64 select-none p-3">
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
          <div key={d} className="py-1 text-[10px] font-medium text-slate-400">{d}</div>
        ))}
        {cells.map((day, idx) => {
          if (!day) return <div key={`e-${idx}`} />;
          const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const isSelected = iso === selected;
          const isToday = iso === today;
          return (
            <button
              key={iso}
              type="button"
              onClick={() => onSelect(iso)}
              className={`relative flex h-8 w-full items-center justify-center rounded-full text-xs font-medium transition-colors ${
                isSelected
                  ? 'bg-brand-600 text-white'
                  : isToday
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

// ─── Time Range Picker ────────────────────────────────────────────────────────

interface TimeRangeDropdownProps {
  startHour: number;
  endHour: number;
  onApply: (start: number, end: number) => void;
  onClose: () => void;
}

function TimeRangeDropdown({ startHour, endHour, onApply, onClose }: TimeRangeDropdownProps) {
  const [localStart, setLocalStart] = useState(startHour);
  const [localEnd, setLocalEnd] = useState(endHour);
  const HOURS = Array.from({ length: 24 }, (_, i) => i);

  function apply() {
    const s = Math.min(localStart, localEnd - 1);
    const e = Math.max(localEnd, localStart + 1);
    onApply(s, e);
    onClose();
  }

  return (
    <div className="w-56 p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Time range</p>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">From</label>
          <select
            value={localStart}
            onChange={(e) => setLocalStart(parseInt(e.target.value))}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            {HOURS.filter((h) => h < localEnd).map((h) => (
              <option key={h} value={h}>{formatHour(h)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Until</label>
          <select
            value={localEnd}
            onChange={(e) => setLocalEnd(parseInt(e.target.value))}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            {HOURS.filter((h) => h > localStart).map((h) => (
              <option key={h} value={h}>{formatHour(h)}</option>
            ))}
          </select>
        </div>
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={apply}
            className="flex-1 rounded-lg bg-brand-600 px-3 py-2 text-xs font-medium text-white hover:bg-brand-700"
          >
            Apply
          </button>
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
  /** How many days to show in the scrollable strip on each side of the selected date. Default 10 (21 total). */
  stripRadius?: number;
}

type OpenDropdown = 'calendar' | 'time' | null;

export function CalendarDateTimePicker({
  date,
  onDateChange,
  startHour,
  endHour,
  onTimeRangeChange,
  stripRadius = 10,
}: CalendarDateTimePickerProps) {
  const today = todayISO();
  const [openDropdown, setOpenDropdown] = useState<OpenDropdown>(null);
  const [calMonth, setCalMonth] = useState<number>(() => parseISO(date).getMonth());
  const [calYear, setCalYear] = useState<number>(() => parseISO(date).getFullYear());

  const stripRef = useRef<HTMLDivElement>(null);
  const selectedItemRef = useRef<HTMLButtonElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLDivElement>(null);

  const strip = buildStrip(date, stripRadius * 2 + 1);

  // Scroll selected date into centre of strip
  useEffect(() => {
    if (selectedItemRef.current && stripRef.current) {
      const container = stripRef.current;
      const item = selectedItemRef.current;
      const containerLeft = container.getBoundingClientRect().left;
      const itemLeft = item.getBoundingClientRect().left;
      const itemWidth = item.offsetWidth;
      const containerWidth = container.offsetWidth;
      const scrollLeft = container.scrollLeft + itemLeft - containerLeft - containerWidth / 2 + itemWidth / 2;
      container.scrollTo({ left: scrollLeft, behavior: 'smooth' });
    }
  }, [date]);

  // Sync dropdown calendar month when date changes (strip / external navigation)
  /* eslint-disable react-hooks/set-state-in-effect -- mini-calendar view must follow selected `date` */
  useEffect(() => {
    const d = parseISO(date);
    setCalMonth(d.getMonth());
    setCalYear(d.getFullYear());
  }, [date]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useDismissibleLayer({
    open: openDropdown !== null,
    refs: [calendarRef, timeRef],
    onDismiss: () => setOpenDropdown(null),
  });

  function toggleDropdown(which: OpenDropdown) {
    setOpenDropdown((prev) => (prev === which ? null : which));
  }

  function handleCalendarSelect(iso: string) {
    onDateChange(iso);
    setOpenDropdown(null);
  }

  function prevMonth() {
    if (calMonth === 0) { setCalMonth(11); setCalYear((y) => y - 1); }
    else setCalMonth((m) => m - 1);
  }

  function nextMonth() {
    if (calMonth === 11) { setCalMonth(0); setCalYear((y) => y + 1); }
    else setCalMonth((m) => m + 1);
  }

  const selectedDate = parseISO(date);
  const isToday = date === today;
  const shortLabel = isToday
    ? 'Today'
    : `${MONTHS_SHORT[selectedDate.getMonth()]} ${selectedDate.getDate()}`;

  const timeLabel = `${formatHour(startHour)} · ${formatHour(endHour)}`;

  const scrollStrip = useCallback((dir: -1 | 1) => {
    onDateChange(addDays(date, dir));
  }, [date, onDateChange]);

  return (
    <div className="space-y-2">
      {/* Top bar: centred controls */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {/* Date label / calendar trigger */}
        <div className="relative" ref={calendarRef}>
          <button
            type="button"
            onClick={() => toggleDropdown('calendar')}
            className={`flex min-h-[38px] items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium shadow-sm transition-colors ${
              openDropdown === 'calendar'
                ? 'border-brand-400 bg-brand-50 text-brand-700'
                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
            }`}
            aria-haspopup="true"
            aria-expanded={openDropdown === 'calendar'}
          >
            <svg className="h-4 w-4 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
            </svg>
            <span>{shortLabel}</span>
            <svg
              className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${openDropdown === 'calendar' ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          </button>

          {openDropdown === 'calendar' && (
            <div className="absolute inset-x-0 top-full z-50 mt-1 flex justify-center px-1">
              <div className="max-h-[min(70vh,24rem)] max-w-[calc(100vw-1rem)] min-w-0 overflow-auto rounded-xl border border-slate-200 bg-white shadow-lg">
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
            </div>
          )}
        </div>

        {/* Time range trigger */}
        <div className="relative" ref={timeRef}>
          <button
            type="button"
            onClick={() => toggleDropdown('time')}
            className={`flex min-h-[38px] items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium shadow-sm transition-colors ${
              openDropdown === 'time'
                ? 'border-brand-400 bg-brand-50 text-brand-700'
                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
            }`}
            aria-haspopup="true"
            aria-expanded={openDropdown === 'time'}
          >
            <svg className="h-4 w-4 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
            <span>{timeLabel}</span>
            <svg
              className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${openDropdown === 'time' ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          </button>

          {openDropdown === 'time' && (
            <div className="absolute inset-x-0 top-full z-50 mt-1 flex justify-center px-1">
              <div className="max-h-[min(70vh,28rem)] max-w-[calc(100vw-1rem)] min-w-0 overflow-auto rounded-xl border border-slate-200 bg-white shadow-lg">
              <TimeRangeDropdown
                key={`${startHour}-${endHour}`}
                startHour={startHour}
                endHour={endHour}
                onApply={onTimeRangeChange}
                onClose={() => setOpenDropdown(null)}
              />
            </div>
            </div>
          )}
        </div>

        {/* Jump to today */}
        {!isToday && (
          <button
            type="button"
            onClick={() => onDateChange(today)}
            className="min-h-[38px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 shadow-sm hover:bg-slate-50"
          >
            Today
          </button>
        )}
      </div>

      {/* Scrollable date strip — dates centred when they fit; horizontal scroll when needed */}
      <div className="flex w-full items-center justify-center gap-1">
        <button
          type="button"
          onClick={() => scrollStrip(-1)}
          className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          aria-label="Previous day"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </button>

        <div
          ref={stripRef}
          className="flex min-w-0 flex-1 justify-center overflow-x-auto scroll-smooth [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        >
          <div className="flex w-max gap-1">
            {strip.map((item) => (
              <button
                key={item.iso}
                ref={item.isSelected ? selectedItemRef : undefined}
                type="button"
                onClick={() => onDateChange(item.iso)}
                className={`flex min-h-[52px] w-10 shrink-0 flex-col items-center justify-center rounded-xl py-1.5 text-center transition-colors sm:w-11 ${
                  item.isSelected
                    ? 'bg-brand-600 text-white shadow-sm'
                    : item.isToday
                      ? 'border border-brand-300 bg-brand-50 text-brand-700 hover:bg-brand-100'
                      : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <span className={`text-[10px] font-semibold uppercase tracking-wide ${item.isSelected ? 'text-brand-100' : item.isToday ? 'text-brand-500' : 'text-slate-400'}`}>
                  {item.dayShort}
                </span>
                <span className={`text-sm font-bold leading-tight ${item.isSelected ? 'text-white' : item.isToday ? 'text-brand-700' : 'text-slate-800'}`}>
                  {item.dayNum}
                </span>
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => scrollStrip(1)}
          className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          aria-label="Next day"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
          </svg>
        </button>
      </div>
    </div>
  );
}
