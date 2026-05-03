'use client';

import { useEffect, useMemo, useState } from 'react';
import { addCalendarDays } from '@/lib/calendar/schedule-blocks-grouping';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

const MONTH_LONG_EN = [
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
] as const;

function monthStartFromIso(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

function addMonthsAnchor(monthAnchorYyyyMm01: string, delta: number): string {
  const d = new Date(`${monthAnchorYyyyMm01}T12:00:00`);
  d.setMonth(d.getMonth() + delta);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

/**
 * Month grid for choosing a session date. Highlights dates in `highlightedDates` within `rangeFrom`–`rangeTo`.
 */
export function ClassOfferingsCalendar({
  rangeFrom,
  rangeTo,
  highlightedDates,
  selectedDate,
  selectedDates,
  onSelectDate,
  footerMessage = 'Dates with a session for this class are highlighted in green. Select a date to continue.',
}: {
  rangeFrom: string;
  rangeTo: string;
  highlightedDates: string[];
  selectedDate: string | null;
  selectedDates?: string[];
  onSelectDate: (iso: string) => void;
  /** Override helper text under the grid (e.g. event bookings). */
  footerMessage?: string;
}) {
  const highlightSet = useMemo(() => new Set(highlightedDates), [highlightedDates]);
  const selectedSet = useMemo(() => new Set(selectedDates ?? []), [selectedDates]);
  const [monthAnchor, setMonthAnchor] = useState(() =>
    monthStartFromIso(highlightedDates[0] ?? rangeFrom),
  );

  useEffect(() => {
    if (highlightedDates.length === 0) return;
    const first = highlightedDates[0]!;
    queueMicrotask(() => setMonthAnchor(monthStartFromIso(first)));
  }, [highlightedDates]);

  const cells = useMemo(() => {
    const first = new Date(`${monthAnchor}T12:00:00`);
    const mondayOffset = (first.getDay() + 6) % 7;
    const gridStart = addCalendarDays(monthAnchor, -mondayOffset);
    return Array.from({ length: 42 }, (_, i) => addCalendarDays(gridStart, i));
  }, [monthAnchor]);

  const rangeFromMs = new Date(`${rangeFrom}T12:00:00`).getTime();
  const rangeToMs = new Date(`${rangeTo}T12:00:00`).getTime();

  function inRange(iso: string): boolean {
    const t = new Date(`${iso}T12:00:00`).getTime();
    return t >= rangeFromMs && t <= rangeToMs;
  }

  const monthLabel = useMemo(() => {
    const d = new Date(`${monthAnchor}T12:00:00`);
    return `${MONTH_LONG_EN[d.getMonth()]} ${d.getFullYear()}`;
  }, [monthAnchor]);

  const anchorYm = monthAnchor.slice(0, 7);
  const fromYm = rangeFrom.slice(0, 7);
  const toYm = rangeTo.slice(0, 7);
  const canPrev = anchorYm > fromYm;
  const canNext = anchorYm < toYm;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <button
          type="button"
          disabled={!canPrev}
          onClick={() => setMonthAnchor((m) => addMonthsAnchor(m, -1))}
          className="rounded-lg border border-slate-200 px-2 py-1 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Previous month"
        >
          ←
        </button>
        <span className="text-sm font-semibold text-slate-900">{monthLabel}</span>
        <button
          type="button"
          disabled={!canNext}
          onClick={() => setMonthAnchor((m) => addMonthsAnchor(m, 1))}
          className="rounded-lg border border-slate-200 px-2 py-1 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Next month"
        >
          →
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium uppercase tracking-wide text-slate-500">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-1">
            {w}
          </div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-0.5">
        {cells.map((iso) => {
          const inMonth = iso.slice(0, 7) === monthAnchor.slice(0, 7);
          const hasSession = highlightSet.has(iso);
          const selectable = hasSession && inRange(iso);
          const isSelected = selectedDate === iso || selectedSet.has(iso);
          const dayNum = Number(iso.slice(8, 10));
          return (
            <button
              key={iso}
              type="button"
              disabled={!selectable}
              onClick={() => selectable && onSelectDate(iso)}
              className={`flex aspect-square items-center justify-center rounded-md text-sm font-medium transition-colors ${
                !inMonth ? 'text-slate-300' : 'text-slate-800'
              } ${
                isSelected
                  ? 'bg-brand-600 text-white shadow-sm'
                  : selectable
                    ? 'bg-emerald-50 text-emerald-900 ring-1 ring-emerald-300 hover:bg-emerald-100'
                    : inMonth
                      ? 'text-slate-400'
                      : ''
              } ${!selectable && inMonth ? 'cursor-default' : ''}`}
            >
              {dayNum}
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-slate-500">
        <span className="mr-2 inline-block h-2 w-2 rounded-sm bg-emerald-400 align-middle" aria-hidden />
        {footerMessage}
      </p>
    </div>
  );
}
