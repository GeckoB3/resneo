'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import { monthGrid, ymd } from '@/lib/calendar/month-grid';
import type { ClassScheduleClassType } from './ClassScheduleModal';

const WEEK_HEADER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export type ReadOnlyCalendarClassType = Pick<ClassScheduleClassType, 'id' | 'name' | 'colour'>;

export interface ReadOnlyCalendarInstance {
  id: string;
  class_type_id: string;
  instance_date: string;
  start_time: string;
  is_cancelled: boolean;
}

interface ClassTimetableReadOnlyCalendarProps {
  classTypes: ReadOnlyCalendarClassType[];
  instances: ReadOnlyCalendarInstance[];
  filterClassTypeId: string;
  onFilterClassTypeIdChange: (classTypeId: string) => void;
  isAdmin?: boolean;
  /** When set, session chips may be clickable to edit. */
  onEditInstance?: (inst: ReadOnlyCalendarInstance) => void;
  /** If set, only matching instances are clickable (e.g. staff scoped to their calendar). */
  canEditInstance?: (inst: ReadOnlyCalendarInstance) => boolean;
  onOpenSchedule?: () => void;
  /** Venue-local "today" (YYYY-MM-DD). Defaults to browser-local; pass the venue value to avoid TZ drift. */
  todayIso?: string;
}

/**
 * Month grid matching the Schedule classes modal: all class instances in view, no add/remove controls.
 */
export function ClassTimetableReadOnlyCalendar({
  classTypes,
  instances,
  filterClassTypeId,
  onFilterClassTypeIdChange,
  isAdmin = false,
  onEditInstance,
  canEditInstance,
  onOpenSchedule,
  todayIso: todayIsoProp,
}: ClassTimetableReadOnlyCalendarProps) {
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());

  const classTypeById = useMemo(() => new Map(classTypes.map((c) => [c.id, c])), [classTypes]);

  const rangeFrom = ymd(viewYear, viewMonth, 1);
  const rangeTo = ymd(viewYear, viewMonth, new Date(viewYear, viewMonth + 1, 0).getDate());

  const instancesInMonth = useMemo(() => {
    return instances.filter((i) => i.instance_date >= rangeFrom && i.instance_date <= rangeTo);
  }, [instances, rangeFrom, rangeTo]);

  const byDate = useMemo(() => {
    const m = new Map<string, ReadOnlyCalendarInstance[]>();
    for (const inst of instancesInMonth) {
      const list = m.get(inst.instance_date) ?? [];
      list.push(inst);
      m.set(inst.instance_date, list);
    }
    for (const [, list] of m) {
      list.sort((a, b) => {
        const t = a.start_time.localeCompare(b.start_time);
        if (t !== 0) return t;
        const na = classTypeById.get(a.class_type_id)?.name ?? '';
        const nb = classTypeById.get(b.class_type_id)?.name ?? '';
        return na.localeCompare(nb);
      });
    }
    return m;
  }, [instancesInMonth, classTypeById]);

  const monthLabel = useMemo(
    () => new Date(viewYear, viewMonth, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
    [viewYear, viewMonth],
  );

  const grid = useMemo(() => monthGrid(viewYear, viewMonth), [viewYear, viewMonth]);
  const todayIso = todayIsoProp ?? new Date().toISOString().slice(0, 10);

  const canClickInstance = (inst: ReadOnlyCalendarInstance) => {
    if (typeof onEditInstance !== 'function') return false;
    if (canEditInstance) return canEditInstance(inst);
    return Boolean(isAdmin);
  };

  return (
    <section
      className="rounded-xl border border-slate-200 bg-white shadow-sm"
      role="region"
      aria-label="Scheduled class sessions calendar"
    >
      <div className="border-b border-slate-100 bg-gradient-to-b from-slate-50/90 to-white px-4 py-4 sm:px-5 sm:py-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <div className="min-w-0 space-y-1">
            <h2 className="text-base font-semibold tracking-tight text-slate-900">Scheduled sessions</h2>
            <p className="text-sm leading-relaxed text-slate-600">
              Primary view of dated sessions. Open Schedule classes to add or adjust times.
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-end">
            <label className="block min-w-0 sm:min-w-48">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Filter class
              </span>
              <select
                value={filterClassTypeId}
                onChange={(e) => onFilterClassTypeIdChange(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-800 shadow-sm outline-none transition-colors focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              >
                <option value="all">All classes</option>
                {classTypes.map((ct) => (
                  <option key={ct.id} value={ct.id}>
                    {ct.name}
                  </option>
                ))}
              </select>
            </label>
            {onOpenSchedule ? (
              <button
                type="button"
                onClick={onOpenSchedule}
                className="inline-flex w-full shrink-0 items-center justify-center rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 sm:w-auto"
              >
                Schedule classes
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-5">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Month view</p>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-slate-50/50 px-2 py-1.5">
          <div className="flex flex-1 items-center justify-center gap-0.5 sm:justify-start">
            <button
              type="button"
              aria-label="Previous month"
              className="rounded-lg p-2 text-slate-600 transition-colors hover:bg-white hover:text-slate-900"
              onClick={() => {
                if (viewMonth === 0) {
                  setViewMonth(11);
                  setViewYear((y) => y - 1);
                } else setViewMonth((m) => m - 1);
              }}
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h3 className="min-w-[11rem] flex-1 text-center text-base font-semibold text-slate-900 sm:flex-none sm:text-left">
              {monthLabel}
            </h3>
            <button
              type="button"
              aria-label="Next month"
              className="rounded-lg p-2 text-slate-600 transition-colors hover:bg-white hover:text-slate-900"
              onClick={() => {
                if (viewMonth === 11) {
                  setViewMonth(0);
                  setViewYear((y) => y + 1);
                } else setViewMonth((m) => m + 1);
              }}
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
          <button
            type="button"
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
            onClick={() => {
              const t = new Date();
              setViewYear(t.getFullYear());
              setViewMonth(t.getMonth());
            }}
          >
            Today
          </button>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-100/80 text-center text-[11px] font-bold uppercase tracking-wide text-slate-600">
            {WEEK_HEADER.map((d) => (
              <div key={d} className="px-1 py-2.5">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-px bg-slate-200 p-px">
            {grid.map((day, i) => {
              if (day == null) {
                return <div key={`e-${i}`} className="min-h-[5.5rem] bg-slate-50/50 sm:min-h-[6.25rem]" />;
              }
              const iso = ymd(viewYear, viewMonth, day);
              const dayInst = byDate.get(iso) ?? [];
              const isToday = iso === todayIso;

              return (
                <div
                  key={iso}
                  className={`group relative flex min-h-[5.5rem] flex-col bg-white p-1.5 sm:min-h-[6.25rem] ${
                    isToday ? 'ring-1 ring-inset ring-brand-400/70' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-0.5">
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-medium ${
                        isToday ? 'bg-brand-600 text-white' : 'text-slate-800'
                      }`}
                    >
                      {day}
                    </span>
                  </div>
                  <div className="mt-0.5 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden">
                    {dayInst.map((inst) => {
                      const ctRow = classTypeById.get(inst.class_type_id);
                      const accent = ctRow?.colour ?? '#64748b';
                      const label = ctRow?.name ?? 'Class';
                      const inner = (
                        <>
                          <span className="block truncate text-[11px] font-semibold leading-tight">{label}</span>
                          <span className="block truncate text-[10px] font-normal opacity-90">
                            {inst.start_time.slice(0, 5)}
                          </span>
                        </>
                      );
                      const chipClass = `flex min-w-0 items-center rounded px-0.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ring-slate-200/80 ${
                        inst.is_cancelled ? 'bg-slate-100 text-slate-500' : 'bg-white text-slate-800'
                      }`;
                      const chipStyle: CSSProperties = {
                        borderLeftWidth: 3,
                        borderLeftColor: accent,
                      };

                      if (canClickInstance(inst)) {
                        return (
                          <button
                            key={inst.id}
                            type="button"
                            title={`${label} · ${inst.start_time.slice(0, 5)}`}
                            onClick={() => onEditInstance!(inst)}
                            className={`${chipClass} w-full truncate text-left hover:underline ${
                              inst.is_cancelled ? 'line-through' : ''
                            }`}
                            style={chipStyle}
                          >
                            {inner}
                          </button>
                        );
                      }

                      return (
                        <div
                          key={inst.id}
                          className={`${chipClass} ${inst.is_cancelled ? 'line-through' : ''}`}
                          style={chipStyle}
                          title={`${label} · ${inst.start_time.slice(0, 5)}`}
                        >
                          {inner}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {instancesInMonth.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-3 py-3 text-center text-xs text-slate-500">
            {filterClassTypeId === 'all'
              ? 'No sessions in this month.'
              : 'No sessions for this class in this month.'}{' '}
            Open Schedule classes to add dates, or move to another month.
          </p>
        ) : null}
      </div>
    </section>
  );
}
