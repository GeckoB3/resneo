'use client';

import { useMemo, useRef, useState } from 'react';
import { useDismissibleLayer } from '@/lib/ui/use-dismissible-layer';

interface Column {
  id: string;
  name: string;
}

interface Props {
  columns: Column[];
  /** Bookable calendars this staff user manages — used for “Mine” labels. */
  myCalendarIds: string[];
  /** `null` = all calendars; otherwise visible column ids (non-empty subset). */
  value: string[] | null;
  onChange: (next: string[] | null) => void;
}

function orderIdsLikeColumns(columns: Column[], ids: Set<string>): string[] {
  return columns.filter((c) => ids.has(c.id)).map((c) => c.id);
}

/**
 * “All calendars” or any combination of team calendar columns (unified scheduling grid).
 */
export function CalendarColumnsFilter({ columns, myCalendarIds, value, onChange }: Props) {
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

  const isAll = value === null;

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
          <label className="flex cursor-pointer items-center gap-2 py-1.5 text-sm text-slate-800">
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
          <div className="my-1 border-t border-slate-100" />
          <div className="max-h-60 space-y-0.5 overflow-y-auto pr-1">
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
                  className={`flex cursor-pointer items-center gap-2 rounded-md py-1.5 pl-0.5 text-sm ${
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
                  <span>{label}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
