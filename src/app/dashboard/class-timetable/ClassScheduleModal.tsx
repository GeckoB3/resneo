'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { monthGrid, ymd } from '@/lib/calendar/month-grid';

const DAY_LABELS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEK_HEADER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export interface ClassScheduleClassType {
  id: string;
  name: string;
  colour: string;
  capacity: number;
}

export interface ClassScheduleInstance {
  id: string;
  class_type_id: string;
  instance_date: string;
  start_time: string;
  is_cancelled: boolean;
  cancel_reason: string | null;
  capacity_override?: number | null;
  booked_spots?: number;
}

type Notice = { kind: 'success' | 'error'; message: string };

type ScheduleMode = 'single' | 'weekly' | 'interval_days';

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function expandEveryNDays(
  startIso: string,
  intervalDays: number,
  endMode: 'until' | 'count',
  untilIso: string | null,
  occurrenceCount: number,
): string[] {
  const max = 100;
  const dates: string[] = [];
  let cur = startIso;

  if (endMode === 'count') {
    const n = Math.min(Math.max(occurrenceCount, 1), max);
    for (let i = 0; i < n; i++) {
      dates.push(cur);
      cur = addDays(cur, intervalDays);
    }
    return dates;
  }

  if (!untilIso || untilIso < startIso) {
    return [startIso];
  }
  while (cur <= untilIso && dates.length < max) {
    dates.push(cur);
    cur = addDays(cur, intervalDays);
  }
  return dates;
}

function dowFromIso(iso: string): number {
  return new Date(iso + 'T12:00:00').getDay();
}

/** First calendar date on or after `iso` whose weekday matches `targetDow` (0–6). */
function firstDowOnOrAfter(iso: string, targetDow: number): string {
  const d = new Date(iso + 'T12:00:00');
  while (d.getDay() !== targetDow) {
    d.setDate(d.getDate() + 1);
  }
  return d.toISOString().slice(0, 10);
}

/**
 * Bookable dates for “same weekday every N weeks” from an anchor day.
 * - weeks: occurrences from anchor until before anchor + horizonWeeks × 7 days.
 * - range: occurrences between rangeStart and rangeEnd (inclusive) on that weekday.
 */
function expandWeeklyInstanceDates(
  anchorIso: string,
  intervalWeeks: number,
  weeklyScope: 'weeks' | 'range',
  horizonWeeks: number,
  rangeStart: string,
  rangeEnd: string,
): string[] {
  const max = 100;
  const dow = dowFromIso(anchorIso);
  const stepDays = Math.min(8, Math.max(1, intervalWeeks)) * 7; // interval_weeks × 7 days
  const dates: string[] = [];

  if (weeklyScope === 'weeks') {
    const h = Math.min(52, Math.max(1, horizonWeeks));
    const endExclusive = addDays(anchorIso, h * 7);
    let cur = anchorIso;
    while (cur < endExclusive && dates.length < max) {
      dates.push(cur);
      cur = addDays(cur, stepDays);
    }
    return dates;
  }

  if (!rangeStart || !rangeEnd || rangeStart > rangeEnd) {
    return [];
  }
  let cur = firstDowOnOrAfter(rangeStart, dow);
  if (cur > rangeEnd) {
    return [];
  }
  while (cur <= rangeEnd && dates.length < max) {
    dates.push(cur);
    cur = addDays(cur, stepDays);
  }
  return dates;
}

export function ClassScheduleModal({
  open,
  onClose,
  classTypes,
  instances,
  onRefresh,
  onInstanceRemoved,
  setNotice,
  openEditInstance,
}: {
  open: boolean;
  onClose: () => void;
  classTypes: ClassScheduleClassType[];
  instances: ClassScheduleInstance[];
  onRefresh: () => Promise<void>;
  onInstanceRemoved?: (id: string) => void;
  setNotice: (n: Notice | null) => void;
  openEditInstance: (inst: ClassScheduleInstance) => void;
}) {
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [selectedClassTypeId, setSelectedClassTypeId] = useState<string>('');

  const classTypeById = useMemo(() => new Map(classTypes.map((c) => [c.id, c])), [classTypes]);
  const selectedClass = classTypeById.get(selectedClassTypeId) ?? classTypes[0] ?? null;

  const [sheetIso, setSheetIso] = useState<string | null>(null);
  const [mode, setMode] = useState<ScheduleMode>('single');

  const [singleTime, setSingleTime] = useState('09:00');
  const [singleCapacity, setSingleCapacity] = useState('');

  const [weeklyTime, setWeeklyTime] = useState('09:00');
  const [intervalWeeks, setIntervalWeeks] = useState(1);
  /** How long weekly repeats run: fixed week count, or explicit date range. */
  const [weeklyScope, setWeeklyScope] = useState<'weeks' | 'range'>('weeks');
  const [weeklyHorizonWeeks, setWeeklyHorizonWeeks] = useState('8');
  const [weeklyRangeStart, setWeeklyRangeStart] = useState('');
  const [weeklyRangeEnd, setWeeklyRangeEnd] = useState('');

  const [intervalDays, setIntervalDays] = useState(2);
  const [intervalTime, setIntervalTime] = useState('09:00');
  const [intervalEnd, setIntervalEnd] = useState<'until' | 'count'>('count');
  const [intervalUntil, setIntervalUntil] = useState('');
  const [intervalOccurrences, setIntervalOccurrences] = useState('8');

  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [instanceDeleteConfirm, setInstanceDeleteConfirm] = useState<ClassScheduleInstance | null>(null);
  const [instanceDeleteDialogError, setInstanceDeleteDialogError] = useState<string | null>(null);
  /** Shown inside this modal (parent page notice sits under the overlay). */
  const [scheduleFormError, setScheduleFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (instanceDeleteConfirm) {
          if (!deletingId) setInstanceDeleteConfirm(null);
          return;
        }
        if (sheetIso) setSheetIso(null);
        else onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, sheetIso, instanceDeleteConfirm, deletingId]);

  useEffect(() => {
    if (open) {
      const t = new Date();
      setViewYear(t.getFullYear());
      setViewMonth(t.getMonth());
      setSheetIso(null);
      setScheduleFormError(null);
      setInstanceDeleteConfirm(null);
      setInstanceDeleteDialogError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open || classTypes.length === 0) return;
    setSelectedClassTypeId((prev) => {
      if (prev && classTypes.some((c) => c.id === prev)) return prev;
      return classTypes[0]!.id;
    });
  }, [open, classTypes]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const rangeFrom = ymd(viewYear, viewMonth, 1);
  const rangeTo = ymd(viewYear, viewMonth, new Date(viewYear, viewMonth + 1, 0).getDate());

  const instancesInMonth = useMemo(() => {
    return instances.filter((i) => i.instance_date >= rangeFrom && i.instance_date <= rangeTo);
  }, [instances, rangeFrom, rangeTo]);

  const byDate = useMemo(() => {
    const m = new Map<string, ClassScheduleInstance[]>();
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

  const upcomingAllSorted = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return [...instances]
      .filter((i) => !i.is_cancelled && i.instance_date >= today)
      .sort(
        (a, b) =>
          a.instance_date.localeCompare(b.instance_date) ||
          a.start_time.localeCompare(b.start_time) ||
          a.class_type_id.localeCompare(b.class_type_id),
      );
  }, [instances]);

  const monthLabel = useMemo(
    () => new Date(viewYear, viewMonth, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
    [viewYear, viewMonth],
  );

  const grid = useMemo(() => monthGrid(viewYear, viewMonth), [viewYear, viewMonth]);
  const todayIso = new Date().toISOString().slice(0, 10);

  const openScheduleSheet = useCallback((iso: string) => {
    setScheduleFormError(null);
    setSheetIso(iso);
    setMode('single');
    setSingleTime('09:00');
    setSingleCapacity('');
    setWeeklyTime('09:00');
    setIntervalWeeks(1);
    setWeeklyScope('weeks');
    setWeeklyHorizonWeeks('8');
    setWeeklyRangeStart(iso);
    setWeeklyRangeEnd(addDays(iso, 56));
    setIntervalTime('09:00');
    setIntervalDays(2);
    setIntervalEnd('count');
    setIntervalOccurrences('8');
    setIntervalUntil('');
  }, []);

  const requestDeleteInstance = (inst: ClassScheduleInstance) => {
    setInstanceDeleteDialogError(null);
    setInstanceDeleteConfirm(inst);
  };

  const confirmDeleteInstance = async () => {
    const inst = instanceDeleteConfirm;
    if (!inst) return;
    setDeletingId(inst.id);
    setInstanceDeleteDialogError(null);
    try {
      const res = await fetch('/api/venue/classes', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: inst.id, entity_type: 'instance' }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setInstanceDeleteDialogError((json as { error?: string }).error ?? 'Could not remove session');
        return;
      }
      setInstanceDeleteConfirm(null);
      setScheduleFormError(null);
      setNotice({ kind: 'success', message: 'Session removed from the calendar.' });
      onInstanceRemoved?.(inst.id);
      await onRefresh();
    } catch {
      setInstanceDeleteDialogError('Could not remove session');
    } finally {
      setDeletingId(null);
    }
  };

  const handleSubmit = async () => {
    if (!sheetIso || !selectedClass) return;
    setScheduleFormError(null);
    setSaving(true);
    try {
      if (mode === 'single') {
        const body: Record<string, unknown> = {
          class_type_id: selectedClass.id,
          instance_date: sheetIso,
          start_time: singleTime,
        };
        if (singleCapacity.trim() !== '') {
          body.capacity_override = parseInt(singleCapacity, 10);
        }
        const res = await fetch('/api/venue/class-instances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = await res.json();
        if (!res.ok) {
          setScheduleFormError((json as { error?: string }).error ?? 'Could not add session');
          return;
        }
        setScheduleFormError(null);
        setNotice({ kind: 'success', message: 'Session added.' });
        setSheetIso(null);
        await onRefresh();
        return;
      }

      if (mode === 'weekly') {
        const h = parseInt(weeklyHorizonWeeks, 10);
        if (weeklyScope === 'weeks' && (Number.isNaN(h) || h < 1 || h > 52)) {
          setScheduleFormError('Enter a number of weeks between 1 and 52.');
          return;
        }
        if (weeklyScope === 'range') {
          if (!weeklyRangeStart.trim() || !weeklyRangeEnd.trim()) {
            setScheduleFormError('Choose a start and end date for scheduling.');
            return;
          }
          if (weeklyRangeStart > weeklyRangeEnd) {
            setScheduleFormError('End date must be on or after the start date.');
            return;
          }
        }

        const dates = expandWeeklyInstanceDates(
          sheetIso,
          intervalWeeks,
          weeklyScope === 'weeks' ? 'weeks' : 'range',
          weeklyScope === 'weeks' ? h : 0,
          weeklyRangeStart.trim(),
          weeklyRangeEnd.trim(),
        );

        if (dates.length === 0) {
          setScheduleFormError(
            weeklyScope === 'range'
              ? 'No sessions fall in that date range on this weekday. Check your dates.'
              : 'No sessions could be scheduled. Try a longer horizon.',
          );
          return;
        }
        if (dates.length > 100) {
          setScheduleFormError('That would create more than 100 sessions. Shorten the range or number of weeks.');
          return;
        }

        const t = weeklyTime.length === 5 ? `${weeklyTime}:00` : weeklyTime;
        const res = await fetch('/api/venue/class-instances/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            class_type_id: selectedClass.id,
            instances: dates.map((instance_date) => ({
              instance_date,
              start_time: t,
            })),
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          setScheduleFormError((json as { error?: string }).error ?? 'Could not schedule sessions');
          return;
        }
        const created = (json as { created?: number }).created ?? 0;
        const skipped = (json as { skipped?: number }).skipped ?? 0;
        setScheduleFormError(null);
        setNotice({
          kind: 'success',
          message:
            skipped > 0
              ? `Scheduled ${created} session(s). ${skipped} skipped (already on the calendar).`
              : `Scheduled ${created} session(s).`,
        });
        setSheetIso(null);
        await onRefresh();
        return;
      }

      if (mode === 'interval_days') {
        const occ = parseInt(intervalOccurrences, 10);
        const until =
          intervalEnd === 'until' && intervalUntil.trim() !== '' ? intervalUntil.trim() : null;
        if (intervalEnd === 'until' && !until) {
          setScheduleFormError('Choose an end date or switch to a number of sessions.');
          return;
        }
        if (intervalEnd === 'count' && (Number.isNaN(occ) || occ < 1)) {
          setScheduleFormError('Enter a valid number of sessions (1–100).');
          return;
        }

        if (intervalEnd === 'until' && until && until < sheetIso) {
          setScheduleFormError('End date must be on or after the start date.');
          return;
        }

        const dates = expandEveryNDays(
          sheetIso,
          Math.min(14, Math.max(1, intervalDays)),
          intervalEnd,
          until,
          intervalEnd === 'count' ? occ : 1,
        );

        if (dates.length === 0) {
          setScheduleFormError('No dates in range.');
          return;
        }

        const res = await fetch('/api/venue/class-instances/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            class_type_id: selectedClass.id,
            instances: dates.map((instance_date) => ({
              instance_date,
              start_time: intervalTime,
            })),
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          setScheduleFormError((json as { error?: string }).error ?? 'Could not create sessions');
          return;
        }
        const created = (json as { created?: number }).created ?? 0;
        const skipped = (json as { skipped?: number }).skipped ?? 0;
        setScheduleFormError(null);
        setNotice({
          kind: 'success',
          message:
            skipped > 0
              ? `Added ${created} session(s). ${skipped} skipped (already scheduled).`
              : `Added ${created} session(s).`,
        });
        setSheetIso(null);
        await onRefresh();
      }
    } catch {
      setScheduleFormError('Request failed');
    } finally {
      setSaving(false);
    }
  };

  if (!open || classTypes.length === 0) return null;

  const sheetTitle = sheetIso
    ? new Date(sheetIso + 'T12:00:00').toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : '';

  return (
    <Fragment>
    <div
      className="fixed inset-0 z-[45] flex items-center justify-center bg-black/50 p-3 sm:p-6"
      onClick={(e) => {
        if (instanceDeleteConfirm) return;
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[min(56rem,calc(100vh-1.5rem))] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xl shadow-slate-900/10"
        role="dialog"
        aria-modal="true"
        aria-labelledby="class-schedule-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 bg-gradient-to-br from-slate-50 via-white to-brand-50/30 px-5 py-5 sm:px-6">
          <div className="flex min-w-0 gap-4">
            <div
              className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-100 text-brand-700 sm:flex"
              aria-hidden
            >
              <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5a2.25 2.25 0 002.25-2.25m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5a2.25 2.25 0 012.25 2.25v7.5"
                />
              </svg>
            </div>
            <div className="min-w-0">
              <h2 id="class-schedule-title" className="text-xl font-semibold tracking-tight text-slate-900">
                Schedule classes
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                Pick a class type, then tap a day in the month grid to schedule. Use the side panel to choose one-off,
                weekly repeat, or every few days.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-xl p-2.5 text-slate-500 transition-colors hover:bg-white/80 hover:text-slate-900"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="min-h-0 flex-1 overflow-y-auto border-b border-slate-200/80 p-4 sm:p-5 lg:border-b-0 lg:border-r lg:border-slate-200/80">
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-900">Class type</label>
              <p className="mb-2 text-xs text-slate-500">Switch when you need to place sessions for a different template.</p>
              <div
                className="grid max-h-[min(36vh,13rem)] grid-cols-1 gap-1.5 overflow-y-auto pr-0.5 sm:grid-cols-2 lg:grid-cols-3"
                role="radiogroup"
                aria-label="Class type to schedule"
              >
                {classTypes.map((ct) => {
                  const selected = selectedClassTypeId === ct.id;
                  return (
                    <button
                      key={ct.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      title={`${ct.name} (up to ${ct.capacity} guests per session)`}
                      onClick={() => setSelectedClassTypeId(ct.id)}
                      className={`relative flex min-h-[2.75rem] w-full items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left transition-colors ${
                        selected
                          ? 'border-brand-500 bg-brand-50/60 shadow-sm ring-1 ring-brand-500/25'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/80'
                      }`}
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full ring-1 ring-black/5"
                        style={{ backgroundColor: ct.colour }}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium leading-tight text-slate-900">{ct.name}</span>
                        <span className="mt-px block truncate text-[10px] leading-tight text-slate-500">
                          Max <span className="font-medium text-slate-600">{ct.capacity}</span> guests
                        </span>
                      </span>
                      {selected ? (
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white">
                          <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </span>
                      ) : (
                        <span className="h-4 w-4 shrink-0 rounded-full border border-slate-200 bg-white" aria-hidden />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {selectedClass ? (
              <div className="mt-4 flex items-center gap-3 rounded-xl border border-slate-200/90 bg-white px-3 py-2.5 shadow-sm">
                <span
                  className="h-9 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: selectedClass.colour }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Scheduling for</p>
                  <p className="truncate text-sm font-semibold text-slate-900">{selectedClass.name}</p>
                  <p className="text-xs text-slate-500">Up to {selectedClass.capacity} guests per session</p>
                </div>
              </div>
            ) : null}

            <p className="mb-3 mt-5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Month view</p>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-slate-50/50 px-2 py-1.5">
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
                  const isSheet = sheetIso === iso;

                  return (
                    <div
                      key={iso}
                      className={`relative flex min-h-[5.5rem] cursor-pointer flex-col bg-white p-1.5 sm:min-h-[6.25rem] ${
                        isToday ? 'ring-1 ring-inset ring-brand-400/70' : ''
                      } ${isSheet ? 'bg-brand-50/50 ring-2 ring-inset ring-brand-300' : 'hover:bg-slate-50/90'}`}
                      title="Click to schedule on this day"
                      onClick={() => openScheduleSheet(iso)}
                    >
                      <div className="flex items-start">
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
                          return (
                          <div
                            key={inst.id}
                            onClick={(e) => e.stopPropagation()}
                            className={`flex min-w-0 items-center gap-0.5 rounded px-0.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ring-slate-200/80 ${
                              inst.is_cancelled ? 'bg-slate-100 text-slate-500' : 'bg-white text-slate-800'
                            }`}
                            style={{ borderLeftWidth: 3, borderLeftColor: accent }}
                          >
                            <button
                              type="button"
                              title={`${label} · ${inst.start_time.slice(0, 5)}`}
                              onClick={() => openEditInstance(inst)}
                              className={`min-w-0 flex-1 truncate text-left hover:underline ${
                                inst.is_cancelled ? 'line-through' : ''
                              }`}
                            >
                              <span className="block truncate font-semibold leading-tight">{label}</span>
                              <span className="block truncate text-[9px] font-normal opacity-90">
                                {inst.start_time.slice(0, 5)}
                              </span>
                            </button>
                            <button
                              type="button"
                              title="Remove session"
                              disabled={deletingId === inst.id}
                              className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                              onClick={(e) => {
                                e.stopPropagation();
                                requestDeleteInstance(inst);
                              }}
                              aria-label="Remove session"
                            >
                              {deletingId === inst.id ? (
                                <span className="text-[9px]">…</span>
                              ) : (
                                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              )}
                            </button>
                          </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <p className="mt-3 text-[11px] text-slate-500">
              <span className="font-medium text-slate-600">Tip:</span> each class keeps its colour on the grid; match
              it to the summary bar.
            </p>

            <div className="mt-4 rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2.5 text-xs leading-relaxed text-slate-600">
              <span className="font-semibold text-slate-700">Calendar:</span> tap anywhere in a day cell to open the
              scheduler. Tap a session to edit; use{' '}
              <span className="font-mono font-medium text-slate-800">×</span> on a chip to remove it.
            </div>
          </div>

          <div className="flex w-full shrink-0 flex-col border-t border-slate-200/80 bg-gradient-to-b from-slate-50/90 to-slate-50 lg:w-[min(28rem,100%)] lg:border-l lg:border-t-0">
            {scheduleFormError && (
              <div
                className="border-b border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800"
                role="alert"
              >
                {scheduleFormError}
              </div>
            )}
            {sheetIso ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="border-b border-slate-200/80 bg-slate-50/50 px-4 py-4">
                  <button
                    type="button"
                    onClick={() => setSheetIso(null)}
                    className="mb-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-800"
                  >
                    <span aria-hidden>←</span> Back to calendar
                  </button>
                  <p className="text-base font-semibold text-slate-900">{sheetTitle}</p>
                  <p className="text-xs text-slate-500">{DAY_LABELS_FULL[dowFromIso(sheetIso)]}</p>
                  {selectedClass ? (
                    <div className="mt-3 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
                      <span
                        className="h-8 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: selectedClass.colour }}
                        aria-hidden
                      />
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Adding to</p>
                        <p className="text-sm font-semibold text-slate-900">{selectedClass.name}</p>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="flex gap-1 border-b border-slate-200/80 bg-slate-100/50 px-2 py-2">
                  {(
                    [
                      ['single', 'One-off session', 'Single date'],
                      ['weekly', 'Weekly repeat', 'Same weekday'],
                      ['interval_days', 'Every few days', 'Spaced dates'],
                    ] as const
                  ).map(([k, label, hint]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setMode(k)}
                      className={`flex min-h-[3rem] flex-1 flex-col justify-center rounded-lg px-1.5 py-1.5 text-center transition-all ${
                        mode === k
                          ? 'bg-white text-brand-900 shadow-sm ring-2 ring-brand-500/20'
                          : 'text-slate-600 hover:bg-white/90'
                      }`}
                    >
                      <span className="text-[11px] font-semibold leading-tight">{label}</span>
                      <span className="mt-0.5 text-[9px] font-normal text-slate-500">{hint}</span>
                    </button>
                  ))}
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                  {mode === 'single' && (
                    <div className="space-y-3">
                      <p className="text-xs text-slate-600">
                        Adds one bookable session on this date. Does not create a repeating rule.
                      </p>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-600">Start time</label>
                        <input
                          type="time"
                          value={singleTime}
                          onChange={(e) => setSingleTime(e.target.value)}
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-600">
                          Capacity override <span className="font-normal text-slate-400">(optional)</span>
                        </label>
                        <input
                          type="text"
                          inputMode="numeric"
                          autoComplete="off"
                          placeholder={selectedClass ? 'Leave blank for class default' : 'optional'}
                          value={singleCapacity}
                          onChange={(e) => setSingleCapacity(e.target.value.replace(/[^0-9]/g, ''))}
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                        />
                      </div>
                    </div>
                  )}

                  {mode === 'weekly' && (
                    <div className="space-y-3">
                      <p className="text-xs text-slate-600">
                        Adds sessions on <span className="font-medium text-slate-800">{DAY_LABELS_FULL[dowFromIso(sheetIso)]}s</span>{' '}
                        every {intervalWeeks === 1 ? 'week' : `${intervalWeeks} weeks`}. The weekday comes from the day
                        you picked on the calendar (or from Today when you start from the side panel).
                      </p>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-600">Start time</label>
                        <input
                          type="time"
                          value={weeklyTime}
                          onChange={(e) => setWeeklyTime(e.target.value)}
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-600">Every N weeks</label>
                        <select
                          value={intervalWeeks}
                          onChange={(e) => setIntervalWeeks(parseInt(e.target.value, 10) || 1)}
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                        >
                          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                            <option key={n} value={n}>
                              {n === 1 ? 'Every week' : `Every ${n} weeks`}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <p className="mb-2 text-xs font-medium text-slate-600">How far to schedule</p>
                        <div className="space-y-2 text-sm">
                          <label className="flex items-center gap-2">
                            <input
                              type="radio"
                              name="w-scope"
                              checked={weeklyScope === 'weeks'}
                              onChange={() => setWeeklyScope('weeks')}
                            />
                            For the next
                            <input
                              type="text"
                              inputMode="numeric"
                              autoComplete="off"
                              disabled={weeklyScope !== 'weeks'}
                              value={weeklyHorizonWeeks}
                              onChange={(e) => setWeeklyHorizonWeeks(e.target.value.replace(/[^0-9]/g, ''))}
                              className="w-14 rounded-lg border border-slate-200 px-2 py-1 text-sm disabled:opacity-50"
                            />
                            <span className="text-slate-600">weeks</span>
                          </label>
                          <label className="flex flex-wrap items-center gap-2">
                            <input
                              type="radio"
                              name="w-scope"
                              checked={weeklyScope === 'range'}
                              onChange={() => setWeeklyScope('range')}
                            />
                            <span>Between dates</span>
                          </label>
                          {weeklyScope === 'range' && (
                            <div className="ml-6 flex flex-col gap-2 sm:flex-row sm:items-center">
                              <input
                                type="date"
                                value={weeklyRangeStart}
                                onChange={(e) => setWeeklyRangeStart(e.target.value)}
                                className="w-full max-w-[11rem] rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                              />
                              <span className="text-slate-500">to</span>
                              <input
                                type="date"
                                value={weeklyRangeEnd}
                                onChange={(e) => setWeeklyRangeEnd(e.target.value)}
                                className="w-full max-w-[11rem] rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {mode === 'interval_days' && (
                    <div className="space-y-3">
                      <p className="text-xs text-slate-600">
                        Creates separate dated sessions starting on this day, then every N days (e.g. every 2 days for a
                        short course).
                      </p>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-600">Start time</label>
                        <input
                          type="time"
                          value={intervalTime}
                          onChange={(e) => setIntervalTime(e.target.value)}
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-600">Repeat every</label>
                        <select
                          value={intervalDays}
                          onChange={(e) => setIntervalDays(parseInt(e.target.value, 10))}
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                        >
                          {Array.from({ length: 14 }, (_, i) => i + 1).map((n) => (
                            <option key={n} value={n}>
                              {n} day{n > 1 ? 's' : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <p className="mb-2 text-xs font-medium text-slate-600">Stop after</p>
                        <label className="mb-2 flex items-center gap-2 text-sm">
                          <input
                            type="radio"
                            name="int-end"
                            checked={intervalEnd === 'count'}
                            onChange={() => setIntervalEnd('count')}
                          />
                          Number of sessions
                        </label>
                        {intervalEnd === 'count' && (
                          <input
                            type="text"
                            inputMode="numeric"
                            autoComplete="off"
                            value={intervalOccurrences}
                            onChange={(e) => setIntervalOccurrences(e.target.value.replace(/[^0-9]/g, ''))}
                            className="mb-3 ml-6 w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                          />
                        )}
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="radio"
                            name="int-end"
                            checked={intervalEnd === 'until'}
                            onChange={() => setIntervalEnd('until')}
                          />
                          End date (inclusive)
                        </label>
                        {intervalEnd === 'until' && (
                          <input
                            type="date"
                            value={intervalUntil}
                            onChange={(e) => setIntervalUntil(e.target.value)}
                            className="ml-6 mt-1 w-full max-w-xs rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                          />
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-auto border-t border-slate-100 bg-white px-4 py-3">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleSubmit()}
                    className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
                  >
                    {saving
                      ? 'Saving…'
                      : mode === 'single'
                        ? 'Add session'
                        : mode === 'weekly'
                          ? 'Schedule classes'
                          : 'Create sessions'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <h3 className="text-sm font-semibold text-slate-900">Upcoming sessions</h3>
                    <button
                      type="button"
                      onClick={() => openScheduleSheet(todayIso)}
                      className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white shadow-md shadow-brand-900/10 transition hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/15">
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                        </svg>
                      </span>
                      Schedule classes
                    </button>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-slate-600">
                    Tap a day in the calendar to pick a date, or start from today with the button above. Both open this
                    same form. List is soonest first.
                  </p>
                  <ul className="mt-2 max-h-64 space-y-1.5 overflow-y-auto text-xs">
                    {upcomingAllSorted.slice(0, 40).map((inst) => {
                      const ctUp = classTypeById.get(inst.class_type_id);
                      return (
                      <li
                        key={inst.id}
                        className="flex flex-wrap items-center justify-between gap-1 rounded-lg border border-slate-100 bg-white px-2 py-1.5"
                      >
                        <span className={`flex min-w-0 flex-1 items-center gap-1.5 ${inst.is_cancelled ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: ctUp?.colour ?? '#94a3b8' }}
                          />
                          <span className="truncate font-medium text-slate-800">{ctUp?.name ?? 'Class'}</span>
                          <span className="text-slate-600">
                            {inst.instance_date} · {inst.start_time.slice(0, 5)}
                          </span>
                          {(inst.booked_spots ?? 0) > 0 && (
                            <span className="shrink-0 text-slate-400">· {inst.booked_spots} booked</span>
                          )}
                        </span>
                        <span className="flex shrink-0 gap-2">
                          <button
                            type="button"
                            className="font-medium text-brand-600 hover:underline"
                            onClick={() => openEditInstance(inst)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="font-medium text-red-600 hover:underline disabled:opacity-50"
                            disabled={deletingId === inst.id}
                            onClick={() => requestDeleteInstance(inst)}
                          >
                            {deletingId === inst.id ? '…' : 'Remove'}
                          </button>
                        </span>
                      </li>
                      );
                    })}
                    {upcomingAllSorted.length === 0 && (
                      <li className="rounded-lg border border-dashed border-slate-200 bg-white/60 px-3 py-4 text-center text-xs text-slate-500">
                        No future sessions yet. Tap a day in the calendar, or use the button above to start from today.
                      </li>
                    )}
                    {upcomingAllSorted.length > 40 && (
                      <li className="text-slate-400">Showing 40 of {upcomingAllSorted.length}…</li>
                    )}
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>

    {instanceDeleteConfirm && (
      <div
        className="fixed inset-0 z-[55] flex items-center justify-center bg-slate-900/30 p-4 backdrop-blur-[2px]"
        onClick={() => {
          if (!deletingId) setInstanceDeleteConfirm(null);
        }}
      >
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="schedule-remove-session-title"
          aria-describedby="schedule-remove-session-desc"
          className="w-full max-w-md rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xl shadow-slate-900/15 ring-1 ring-slate-100"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 id="schedule-remove-session-title" className="text-base font-semibold text-slate-900">
            Remove this session?
          </h3>
          <p id="schedule-remove-session-desc" className="mt-2 text-sm text-slate-600">
            Remove{' '}
            <span className="font-medium text-slate-800">
              {classTypeById.get(instanceDeleteConfirm.class_type_id)?.name ?? 'Class'}
            </span>{' '}
            on {instanceDeleteConfirm.instance_date} at {instanceDeleteConfirm.start_time.slice(0, 5)}?
            {(instanceDeleteConfirm.booked_spots ?? 0) > 0 ? (
              <>
                {' '}
                {instanceDeleteConfirm.booked_spots} booking(s) will stay on file but will no longer be linked to this
                class time.
              </>
            ) : null}
          </p>
          {instanceDeleteDialogError ? (
            <div
              role="alert"
              className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              {instanceDeleteDialogError}
            </div>
          ) : null}
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setInstanceDeleteConfirm(null)}
              disabled={deletingId !== null}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void confirmDeleteInstance()}
              disabled={deletingId !== null}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700 disabled:opacity-50"
            >
              {deletingId ? 'Removing…' : 'Remove session'}
            </button>
          </div>
        </div>
      </div>
    )}
    </Fragment>
  );
}
