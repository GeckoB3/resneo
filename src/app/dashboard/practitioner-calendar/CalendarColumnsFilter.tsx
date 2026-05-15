'use client';

import { useMemo, useRef, useState } from 'react';
import { useDismissibleLayer } from '@/lib/ui/use-dismissible-layer';

export interface CalendarColumnOption {
  id: string;
  name: string;
}

export interface CalendarColumnsChecklistProps {
  columns: CalendarColumnOption[];
  /** Bookable calendars this staff user manages — used for “Mine” labels. */
  myCalendarIds: string[];
  /** `null` = all calendars; otherwise visible column ids (non-empty subset). */
  value: string[] | null;
  onChange: (next: string[] | null) => void;
  /** Max height class for the scroll area (popover vs standalone dropdown). */
  maxHeightClass?: string;
}

function orderIdsLikeColumns(columns: CalendarColumnOption[], ids: Set<string>): string[] {
  return columns.filter((c) => ids.has(c.id)).map((c) => c.id);
}

/**
 * Checkbox list: “All calendars” or any non-empty subset of columns (embedded in toolbar filter popover).
 */
export function CalendarColumnsChecklist({
  columns,
  myCalendarIds,
  value,
  onChange,
  maxHeightClass = 'max-h-60',
}: CalendarColumnsChecklistProps) {
  const isAll = value === null;

  if (columns.length === 0) {
    return (
      <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
        No calendars
      </p>
    );
  }

  return (
    <div role="group" aria-label="Calendars to show" className="space-y-1">
      <label className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1.5 text-sm text-slate-800">
        <input
          type="checkbox"
          className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          checked={isAll}
          onChange={(e) => {
            if (e.target.checked) onChange(null);
            else onChange(columns.map((c) => c.id));
          }}
        />
        <span className="font-medium">All calendars</span>
      </label>
      <div className="border-t border-slate-100" />
      <div className={`${maxHeightClass} space-y-0.5 overflow-y-auto pr-1`}>
        {columns.map((col) => {
          const mine = myCalendarIds.includes(col.id);
          const label =
            mine && myCalendarIds.length === 1
              ? col.name
              : mine
                ? `Mine — ${col.name}`
                : col.name;
          const checked = isAll || (value !== null && value.includes(col.id));
          return (
            <label
              key={col.id}
              className={`flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1.5 text-sm ${
                isAll ? 'text-slate-400' : 'text-slate-800'
              }`}
            >
              <input
                type="checkbox"
                disabled={isAll}
                className="rounded border-slate-300 text-brand-600 focus:ring-brand-500 disabled:opacity-40"
                checked={checked}
                onChange={(e) => {
                  if (isAll) return;
                  const next = new Set(value ?? []);
                  if (e.target.checked) next.add(col.id);
                  else next.delete(col.id);
                  const ordered = orderIdsLikeColumns(columns, next);
                  if (ordered.length === 0) return;
                  if (ordered.length === columns.length) onChange(null);
                  else onChange(ordered);
                }}
              />
              <span className="truncate">{label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Standalone dropdown: “All calendars” or any combination of team calendar columns.
 */
export function CalendarColumnsFilter({ columns, myCalendarIds, value, onChange }: CalendarColumnsChecklistProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const summary = useMemo(() => {
    if (value === null || columns.length === 0) return 'All calendars';
    if (value.length >= columns.length) return 'All columns';
    if (value.length === 1) {
      const name = columns.find((c) => c.id === value[0])?.name ?? 'Calendar';
      return name;
    }
    return `${value.length} calendars`;
  }, [value, columns]);

  useDismissibleLayer({
    open,
    refs: [rootRef],
    onDismiss: () => setOpen(false),
  });

  if (columns.length === 0) {
    return (
      <span className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-500">
        No calendars
      </span>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((o) => !o)}
        className="w-full cursor-pointer rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-left text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      >
        <span className="inline-flex items-center gap-1.5">
          <span className="font-medium text-slate-800">{summary}</span>
          <svg
            className={`h-4 w-4 shrink-0 text-slate-500 transition ${open ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </span>
      </button>
      {open && (
        <div
          className="absolute left-0 z-50 mt-1 min-w-[min(20rem,calc(100vw-2rem))] max-w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white py-2 pl-3 pr-2 shadow-xl"
          role="listbox"
          aria-multiselectable
        >
          <CalendarColumnsChecklist columns={columns} myCalendarIds={myCalendarIds} value={value} onChange={onChange} />
        </div>
      )}
    </div>
  );
}
