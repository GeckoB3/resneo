'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ResourceExceptionsCalendar,
  type CalendarUnavailabilityDayValue,
} from '@/app/dashboard/resource-timeline/ResourceExceptionsCalendar';
import type { PractitionerLeaveType } from '@/types/booking-models';

export interface LeavePeriodRow {
  id: string;
  practitioner_id: string;
  practitioner_name: string;
  start_date: string;
  end_date: string;
  leave_type: PractitionerLeaveType;
  notes: string | null;
  created_at: string;
  unavailable_start_time?: string | null;
  unavailable_end_time?: string | null;
}

interface CalendarOption {
  id: string;
  name: string;
}

type CalendarBlockType = 'closed' | 'partial';

interface DraftState {
  block_type: CalendarBlockType;
  date_start: string;
  date_end: string;
  time_start: string | null;
  time_end: string | null;
  leave_type: PractitionerLeaveType;
  notes: string;
  apply_to_all_active: boolean;
}

const BLOCK_TYPE_LABELS: Record<CalendarBlockType, string> = {
  closed: 'Closure',
  partial: 'Unavailable window',
};

const BLOCK_TYPE_COLORS: Record<CalendarBlockType, string> = {
  closed: 'bg-red-100 text-red-700',
  partial: 'bg-rose-100 text-rose-700',
};

function emptyDraft(): DraftState {
  return {
    block_type: 'closed',
    date_start: '',
    date_end: '',
    time_start: null,
    time_end: null,
    leave_type: 'annual',
    notes: '',
    apply_to_all_active: false,
  };
}

function isFullDayLeave(p: Pick<LeavePeriodRow, 'unavailable_start_time' | 'unavailable_end_time'>): boolean {
  return (
    (p.unavailable_start_time == null || p.unavailable_start_time === '') &&
    (p.unavailable_end_time == null || p.unavailable_end_time === '')
  );
}

function draftFromPeriod(p: LeavePeriodRow): DraftState {
  const fullDay = isFullDayLeave(p);
  return {
    block_type: fullDay ? 'closed' : 'partial',
    date_start: p.start_date,
    date_end: p.end_date,
    time_start: fullDay ? null : (p.unavailable_start_time?.slice(0, 5) ?? null),
    time_end: fullDay ? null : (p.unavailable_end_time?.slice(0, 5) ?? null),
    leave_type: p.leave_type,
    notes: p.notes ?? '',
    apply_to_all_active: false,
  };
}

function bestLeaveForDay(periods: LeavePeriodRow[], iso: string): LeavePeriodRow | null {
  let best: LeavePeriodRow | null = null;
  let bestPri = -1;
  for (const p of periods) {
    if (iso < p.start_date || iso > p.end_date) continue;
    const pri = isFullDayLeave(p) ? 2 : 1;
    if (pri > bestPri) {
      best = p;
      bestPri = pri;
    }
  }
  return best;
}

function leavePeriodsToCalendarMap(
  periods: LeavePeriodRow[],
  year: number,
  month: number,
): Record<string, CalendarUnavailabilityDayValue> {
  const lastDay = new Date(year, month, 0).getDate();
  const map: Record<string, CalendarUnavailabilityDayValue> = {};
  for (let d = 1; d <= lastDay; d++) {
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const p = bestLeaveForDay(periods, iso);
    if (!p) continue;
    if (isFullDayLeave(p)) {
      map[iso] = { closed: true };
      continue;
    }
    const start = p.unavailable_start_time ?? '';
    const end = p.unavailable_end_time ?? '';
    if (start && end) map[iso] = { unavailableWindow: { start, end } };
  }
  return map;
}

export function StaffLeaveCalendarPanel({
  practitioners,
  isAdmin,
  selfPractitionerId = null,
  onError,
}: {
  practitioners: CalendarOption[];
  isAdmin: boolean;
  selfPractitionerId?: string | null;
  onError: (msg: string | null) => void;
}) {
  const canManageUnavailability = isAdmin || Boolean(selfPractitionerId);

  const initialCalendarId =
    selfPractitionerId ?? practitioners[0]?.id ?? '';

  const [calendarId, setCalendarId] = useState(initialCalendarId);
  const [periods, setPeriods] = useState<LeavePeriodRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const nowDate = new Date();
  const [calYear, setCalYear] = useState(nowDate.getFullYear());
  const [calMonth, setCalMonth] = useState(nowDate.getMonth() + 1);
  const [rangeStart, setRangeStart] = useState<string | null>(null);
  const [rangeEnd, setRangeEnd] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftState>(emptyDraft);

  useEffect(() => {
    if (selfPractitionerId) {
      setCalendarId(selfPractitionerId);
      return;
    }
    if (!calendarId && practitioners[0]?.id) {
      setCalendarId(practitioners[0].id);
    }
  }, [selfPractitionerId, practitioners, calendarId]);

  const rangeFrom = `${calYear}-${String(calMonth).padStart(2, '0')}-01`;
  const rangeTo = `${calYear}-${String(calMonth).padStart(2, '0')}-${String(
    new Date(calYear, calMonth, 0).getDate(),
  ).padStart(2, '0')}`;

  const reload = useCallback(async () => {
    if (!calendarId) {
      setPeriods([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    onError(null);
    try {
      const params = new URLSearchParams({ from: rangeFrom, to: rangeTo, practitioner_id: calendarId });
      const res = await fetch(`/api/venue/practitioner-leave?${params}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        onError(typeof j.error === 'string' ? j.error : 'Could not load calendar unavailability');
        setPeriods([]);
        return;
      }
      const data = (await res.json()) as { periods: LeavePeriodRow[] };
      setPeriods(data.periods ?? []);
    } catch {
      onError('Could not load calendar unavailability');
      setPeriods([]);
    } finally {
      setLoading(false);
    }
  }, [calendarId, rangeFrom, rangeTo, onError]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const calendarExceptions = useMemo(
    () => leavePeriodsToCalendarMap(periods, calYear, calMonth),
    [periods, calYear, calMonth],
  );

  const prevMonth = useCallback(() => {
    setCalMonth((m) => {
      if (m === 1) {
        setCalYear((y) => y - 1);
        return 12;
      }
      return m - 1;
    });
  }, []);

  const nextMonth = useCallback(() => {
    setCalMonth((m) => {
      if (m === 12) {
        setCalYear((y) => y + 1);
        return 1;
      }
      return m + 1;
    });
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setDraft(emptyDraft());
    setRangeStart(null);
    setRangeEnd(null);
    setFormError(null);
  }, []);

  const editPeriod = useCallback((p: LeavePeriodRow) => {
    setEditingId(p.id);
    setDraft(draftFromPeriod(p));
    setRangeStart(p.start_date);
    setRangeEnd(p.end_date);
    setFormError(null);
  }, []);

  const handleDayClick = useCallback(
    (ymd: string) => {
      if (!canManageUnavailability) return;
      if (editingId) {
        cancelEdit();
        return;
      }
      const onDay = periods.filter((p) => p.start_date <= ymd && p.end_date >= ymd);
      if (onDay.length === 1 && (isAdmin || onDay[0]!.practitioner_id === selfPractitionerId)) {
        editPeriod(onDay[0]!);
        return;
      }
      if (!rangeStart) {
        setRangeStart(ymd);
        setRangeEnd(ymd);
        setDraft((d) => ({ ...d, date_start: ymd, date_end: ymd }));
      } else if (rangeStart === ymd && rangeEnd === ymd) {
        setRangeStart(null);
        setRangeEnd(null);
        setDraft((d) => ({ ...d, date_start: '', date_end: '' }));
      } else {
        const a = rangeStart <= ymd ? rangeStart : ymd;
        const b = rangeStart <= ymd ? ymd : rangeStart;
        setRangeStart(a);
        setRangeEnd(b);
        setDraft((d) => ({ ...d, date_start: a, date_end: b }));
      }
    },
    [canManageUnavailability, editingId, cancelEdit, periods, editPeriod, isAdmin, selfPractitionerId, rangeStart, rangeEnd],
  );

  const handleSave = useCallback(async () => {
    if (!canManageUnavailability) return;
    if (!draft.date_start || !draft.date_end) {
      setFormError('Select dates on the calendar or enter a start and end date.');
      return;
    }
    if (draft.date_end < draft.date_start) {
      setFormError('End date must be on or after start date.');
      return;
    }
    if (draft.block_type === 'partial' && (!draft.time_start || !draft.time_end || draft.time_end <= draft.time_start)) {
      setFormError('Unavailable window requires a valid start and end time (end after start).');
      return;
    }
    if (!editingId && !draft.apply_to_all_active && !calendarId) {
      setFormError('Select a calendar.');
      return;
    }

    const fullDay = draft.block_type === 'closed' && !draft.time_start && !draft.time_end;
    const payload = {
      start_date: draft.date_start,
      end_date: draft.date_end,
      leave_type: draft.leave_type,
      notes: draft.notes.trim() || null,
      unavailable_start_time: fullDay ? null : draft.time_start,
      unavailable_end_time: fullDay ? null : draft.time_end,
    };

    setSaving(true);
    setFormError(null);
    onError(null);
    try {
      if (editingId) {
        const res = await fetch('/api/venue/practitioner-leave', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editingId, ...payload }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(typeof j.error === 'string' ? j.error : 'Update failed');
        }
      } else {
        const res = await fetch('/api/venue/practitioner-leave', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apply_to_all_active: draft.apply_to_all_active,
            practitioner_id: draft.apply_to_all_active ? undefined : calendarId,
            ...payload,
          }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(typeof j.error === 'string' ? j.error : 'Could not save');
        }
      }
      cancelEdit();
      await reload();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [canManageUnavailability, draft, editingId, calendarId, cancelEdit, reload, onError]);

  const handleDelete = useCallback(
    async (id: string) => {
      if (!confirm('Remove this closure from the calendar?')) return;
      setFormError(null);
      onError(null);
      try {
        const res = await fetch('/api/venue/practitioner-leave', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(typeof j.error === 'string' ? j.error : 'Delete failed');
        }
        if (editingId === id) cancelEdit();
        await reload();
      } catch (e) {
        setFormError(e instanceof Error ? e.message : 'Delete failed');
      }
    },
    [editingId, cancelEdit, reload, onError],
  );

  const today = new Date().toISOString().slice(0, 10);
  const futurePeriods = useMemo(
    () => periods.filter((p) => p.end_date >= today).sort((a, b) => a.start_date.localeCompare(b.start_date)),
    [periods, today],
  );
  const pastPeriods = useMemo(
    () => periods.filter((p) => p.end_date < today).sort((a, b) => b.start_date.localeCompare(a.start_date)),
    [periods, today],
  );

  const selectedCalendarName = practitioners.find((p) => p.id === calendarId)?.name ?? 'Calendar';

  if (practitioners.length === 0) {
    return (
      <p className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
        Add a calendar first to set closures and unavailable windows.
      </p>
    );
  }

  return (
    <section className="space-y-6">
      <div className="max-w-xl space-y-1">
        <p className="text-sm text-slate-600">
          Block online booking for one calendar column at a time. Click dates on the calendar to select a range, then
          set closure or unavailable window details below.
        </p>
        <p className="text-xs text-slate-500">
          Whole-venue closures and amended opening hours for every booking type are in{' '}
          <Link href="/dashboard/settings?tab=business-hours" className="font-medium text-brand-600 hover:underline">
            Settings → Business hours
          </Link>
          .
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Calendar closures</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {canManageUnavailability
                ? `Managing: ${selectedCalendarName}`
                : `Viewing: ${selectedCalendarName}`}
            </p>
          </div>
          {isAdmin && !selfPractitionerId && (
            <div className="w-full sm:max-w-xs">
              <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="leave-calendar-picker">
                Calendar
              </label>
              <select
                id="leave-calendar-picker"
                value={calendarId}
                onChange={(e) => {
                  setCalendarId(e.target.value);
                  cancelEdit();
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {practitioners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex h-48 items-center justify-center text-sm text-slate-500">Loading calendar…</div>
        ) : (
          <>
            <ResourceExceptionsCalendar
              year={calYear}
              month={calMonth}
              onPrevMonth={prevMonth}
              onNextMonth={nextMonth}
              exceptions={calendarExceptions}
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
              editingDay={editingId ? draft.date_start : null}
              onDayClick={handleDayClick}
              displayMode="calendar_unavailability"
            />

            {canManageUnavailability && (
              <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 space-y-3">
                <h3 className="text-sm font-semibold text-slate-800">
                  {editingId ? 'Edit block' : 'New block'}
                </h3>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-xs font-medium text-slate-600">Type</label>
                    <select
                      value={draft.block_type}
                      onChange={(e) => {
                        const block_type = e.target.value as CalendarBlockType;
                        setDraft((d) => ({
                          ...d,
                          block_type,
                          time_start: block_type === 'partial' ? d.time_start ?? '09:00' : null,
                          time_end: block_type === 'partial' ? d.time_end ?? '12:00' : null,
                        }));
                      }}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                    >
                      <option value="closed">Closure</option>
                      <option value="partial">Unavailable window</option>
                    </select>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Closure blocks the whole day unless you add optional times. Unavailable window blocks the same
                      time range on every day in the range.
                    </p>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">Start date</label>
                    <input
                      type="date"
                      value={draft.date_start}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          date_start: e.target.value,
                          date_end: draft.date_end || e.target.value,
                        })
                      }
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">End date</label>
                    <input
                      type="date"
                      value={draft.date_end}
                      onChange={(e) => setDraft({ ...draft, date_end: e.target.value })}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                    />
                  </div>

                  {(draft.block_type === 'closed' || draft.block_type === 'partial') && (
                    <>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-600">
                          {draft.block_type === 'partial'
                            ? 'Start time'
                            : 'Start time (optional, for partial-day)'}
                        </label>
                        <input
                          type="time"
                          value={draft.time_start ?? ''}
                          onChange={(e) =>
                            setDraft({ ...draft, time_start: e.target.value || null })
                          }
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-600">
                          {draft.block_type === 'partial' ? 'End time' : 'End time (optional)'}
                        </label>
                        <input
                          type="time"
                          value={draft.time_end ?? ''}
                          onChange={(e) => setDraft({ ...draft, time_end: e.target.value || null })}
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                        />
                      </div>
                    </>
                  )}

                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-xs font-medium text-slate-600">Label (optional)</label>
                    <select
                      value={draft.leave_type}
                      onChange={(e) =>
                        setDraft({ ...draft, leave_type: e.target.value as PractitionerLeaveType })
                      }
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                    >
                      <option value="annual">Closed</option>
                      <option value="sick">Unavailable</option>
                      <option value="other">Other</option>
                    </select>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-xs font-medium text-slate-600">Notes (optional)</label>
                    <input
                      type="text"
                      value={draft.notes}
                      onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                      placeholder="e.g. Training day, equipment maintenance"
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                    />
                  </div>

                  {isAdmin && !selfPractitionerId && !editingId && (
                    <div className="sm:col-span-2">
                      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-white p-3">
                        <input
                          type="checkbox"
                          checked={draft.apply_to_all_active}
                          onChange={(e) =>
                            setDraft({ ...draft, apply_to_all_active: e.target.checked })
                          }
                          className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600"
                        />
                        <span>
                          <span className="text-sm font-medium text-slate-900">Apply to all active calendars</span>
                          <span className="mt-0.5 block text-xs text-slate-500">
                            Same dates and times on every active calendar column at once.
                          </span>
                        </span>
                      </label>
                    </div>
                  )}
                </div>

                {formError && (
                  <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {formError}
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={saving || !draft.date_start || !draft.date_end}
                    onClick={() => void handleSave()}
                    className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                  >
                    {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add to calendar'}
                  </button>
                  {editingId && (
                    <>
                      <button
                        type="button"
                        onClick={() => void handleDelete(editingId)}
                        className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                    </>
                  )}
                  {!editingId && rangeStart && (
                    <button
                      type="button"
                      onClick={() => {
                        setRangeStart(null);
                        setRangeEnd(null);
                        setDraft((d) => ({ ...d, date_start: '', date_end: '' }));
                      }}
                      className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                    >
                      Clear selection
                    </button>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {futurePeriods.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
          <h3 className="text-sm font-semibold text-slate-700">Upcoming</h3>
          {futurePeriods.map((p) => {
            const fullDay = isFullDayLeave(p);
            const blockType: CalendarBlockType = fullDay ? 'closed' : 'partial';
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => canManageUnavailability && editPeriod(p)}
                disabled={!canManageUnavailability}
                className={`flex w-full items-start justify-between rounded-lg border p-3 text-left transition hover:bg-slate-50 disabled:cursor-default ${
                  editingId === p.id ? 'border-brand-300 bg-brand-50/30' : 'border-slate-100'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${BLOCK_TYPE_COLORS[blockType]}`}
                    >
                      {BLOCK_TYPE_LABELS[blockType]}
                    </span>
                    <span className="text-sm font-medium text-slate-700">
                      {p.start_date === p.end_date ? p.start_date : `${p.start_date} – ${p.end_date}`}
                    </span>
                    {!fullDay && p.unavailable_start_time && p.unavailable_end_time && (
                      <span className="text-xs text-slate-400">
                        {p.unavailable_start_time}–{p.unavailable_end_time} each day
                      </span>
                    )}
                  </div>
                  {p.notes && <p className="mt-1 text-xs text-slate-500">{p.notes}</p>}
                </div>
                {canManageUnavailability && (
                  <svg
                    className="ml-2 mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z"
                    />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}

      {pastPeriods.length > 0 && (
        <details className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm text-sm">
          <summary className="cursor-pointer font-medium text-slate-500">
            Past blocks ({pastPeriods.length})
          </summary>
          <div className="mt-3 space-y-2">
            {pastPeriods.map((p) => {
              const fullDay = isFullDayLeave(p);
              const blockType: CalendarBlockType = fullDay ? 'closed' : 'partial';
              return (
                <div
                  key={p.id}
                  className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs text-slate-400"
                >
                  <div>
                    <span
                      className={`mr-2 rounded px-1.5 py-0.5 text-[10px] font-medium ${BLOCK_TYPE_COLORS[blockType]}`}
                    >
                      {BLOCK_TYPE_LABELS[blockType]}
                    </span>
                    {p.start_date === p.end_date ? p.start_date : `${p.start_date} – ${p.end_date}`}
                    {p.notes ? ` – ${p.notes}` : ''}
                  </div>
                  {canManageUnavailability && (
                    <button
                      type="button"
                      onClick={() => void handleDelete(p.id)}
                      className="rounded-lg p-1 text-slate-300 hover:bg-red-50 hover:text-red-500"
                      title="Delete"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                        />
                      </svg>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </details>
      )}

      {!loading && periods.length === 0 && (
        <p className="text-center text-sm text-slate-400">
          No closures or unavailable windows for this calendar. Click dates on the calendar to add one.
        </p>
      )}

      {!canManageUnavailability && (
        <p className="text-sm text-slate-500">
          You cannot manage calendar unavailability until your account is assigned to a calendar. Ask an admin to link
          your staff profile to the right calendar column.
        </p>
      )}
    </section>
  );
}
