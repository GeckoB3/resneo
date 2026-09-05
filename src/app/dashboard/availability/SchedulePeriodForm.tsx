'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { WorkingHoursControl } from '@/components/scheduling/WorkingHoursControl';
import type { WorkingHours } from '@/types/booking-models';
import {
  ROTA_MAX_CYCLES,
  ROTA_MAX_WEEKS,
  ROTA_MIN_WEEKS,
  SCHEDULE_MAX_PERIODS,
  insertSchedulePeriod,
  mondayOnOrBefore,
  periodCyclesForEnd,
  periodEndForCycles,
  pruneEndedSchedulePeriods,
  sundayOnOrAfter,
  validateCalendarSchedule,
  type CalendarSchedule,
  type SchedulePeriod,
  type ScheduleTrim,
} from '@/lib/availability/working-hours-rota';

/**
 * Add or edit one schedule period: the Monday it starts, one to six weekly shapes,
 * and how long it runs. Saving inserts it into the timeline, trimming or splitting
 * whatever it overlaps, and the form says so before the save. A full timeline makes
 * room by dropping the change that ended longest ago, and the form says that too.
 * See Docs/rotating-schedule-plan.md.
 */

type RepeatMode = 'forever' | 'cycles' | 'until';

export interface SchedulePeriodFormProps {
  /** The current timeline; the saved result replaces it. */
  schedule: CalendarSchedule | null;
  /** The period being edited, or null when adding. */
  editing: SchedulePeriod | null;
  /** Prefilled start for a new period (any date; snapped to its Monday). */
  initialFrom?: string | null;
  /** The calendar's ordinary weekly hours; new weeks start as a copy of them. */
  weeklyHours: WorkingHours;
  onSave: (schedule: CalendarSchedule) => Promise<void> | void;
  onCancel: () => void;
  saving: boolean;
  renderDayContext?: (dayKey: string, periods: Array<{ open: string; close: string }> | null) => ReactNode;
  /** Today, `YYYY-MM-DD`; defaults to the browser's date. Injected for tests. */
  todayYmd?: string;
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "Monday 7 September 2026" from "2026-09-07". Built by hand so wording never varies by machine. */
export function describeYmd(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(y!, m! - 1, d!);
  return `${WEEKDAY_NAMES[date.getDay()]} ${d} ${MONTH_NAMES[m! - 1]} ${y}`;
}

/** "Mon 7 Sep 2026". */
export function describeYmdShort(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(y!, m! - 1, d!);
  return `${WEEKDAY_NAMES[date.getDay()]!.slice(0, 3)} ${d} ${MONTH_NAMES[m! - 1]!.slice(0, 3)} ${y}`;
}

export function todayYmdLocal(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function newPeriodId(): string {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return `sp-${rand}`;
}

function cloneHours(hours: WorkingHours): WorkingHours {
  return Object.fromEntries(Object.entries(hours).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
}

function describeTrim(trim: ScheduleTrim, byId: Map<string, SchedulePeriod>): string {
  const label = byId.has(trim.id) ? `the change from ${describeYmdShort(byId.get(trim.id)!.from)}` : 'an existing change';
  switch (trim.kind) {
    case 'removed':
      return `Replaces ${label} entirely.`;
    case 'shortened':
      return `Shortens ${label} to end on ${describeYmdShort(trim.until)}.`;
    case 'starts_later':
      return `Moves the start of ${label} to ${describeYmdShort(trim.from)}.`;
    case 'split':
      return `Splits ${label}: it pauses on ${describeYmdShort(trim.until)} and resumes on ${describeYmdShort(trim.resumesFrom)}, keeping its rhythm.`;
  }
}

interface Draft {
  from: string;
  weeks: WorkingHours[];
  repeatMode: RepeatMode;
  cycles: number;
  until: string;
}

function initialDraft(editing: SchedulePeriod | null, initialFrom: string | null | undefined, weeklyHours: WorkingHours, today: string): Draft {
  if (editing) {
    const cycles = periodCyclesForEnd(editing);
    return {
      from: editing.from,
      weeks: editing.weeks.map(cloneHours),
      repeatMode: editing.until == null ? 'forever' : cycles != null ? 'cycles' : 'until',
      cycles: cycles ?? 4,
      until: editing.until ?? '',
    };
  }
  return {
    from: mondayOnOrBefore(initialFrom || today),
    weeks: [cloneHours(weeklyHours)],
    repeatMode: 'forever',
    cycles: 4,
    until: '',
  };
}

const inputCls =
  'rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-slate-50 disabled:text-slate-500';

export function SchedulePeriodForm({
  schedule,
  editing,
  initialFrom,
  weeklyHours,
  onSave,
  onCancel,
  saving,
  renderDayContext,
  todayYmd,
}: SchedulePeriodFormProps) {
  const today = todayYmd ?? todayYmdLocal();
  const [draft, setDraft] = useState<Draft>(() => initialDraft(editing, initialFrom, weeklyHours, today));
  const [activeWeek, setActiveWeek] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const until = useMemo(() => {
    if (draft.repeatMode === 'forever') return null;
    if (draft.repeatMode === 'cycles') return periodEndForCycles(draft.from, draft.weeks.length, draft.cycles);
    return draft.until ? sundayOnOrAfter(draft.until) : null;
  }, [draft]);

  const candidate = useMemo<SchedulePeriod>(
    () => ({
      id: editing?.id ?? 'candidate',
      from: draft.from,
      until,
      // A period keeps its rhythm only while its start is unchanged; a moved start restarts it.
      cycle_start: editing && editing.from === draft.from ? editing.cycle_start : draft.from,
      weeks: draft.weeks,
    }),
    [draft, until, editing],
  );

  const preview = useMemo(() => {
    const inserted = insertSchedulePeriod(schedule, candidate, () => 'preview');
    const pruned = pruneEndedSchedulePeriods(inserted.schedule, today);
    return { trims: inserted.trims, dropped: pruned.removed };
  }, [schedule, candidate, today]);
  const byId = useMemo(() => new Map((schedule?.periods ?? []).map((p) => [p.id, p])), [schedule]);

  function setCycleLength(next: number) {
    setDraft((d) => {
      const weeks = d.weeks.slice(0, next);
      while (weeks.length < next) weeks.push(cloneHours(weeks[weeks.length - 1] ?? weeklyHours));
      return { ...d, weeks };
    });
    setActiveWeek((i) => Math.min(i, next - 1));
  }

  async function save() {
    setError(null);
    if (draft.repeatMode === 'until' && !draft.until) {
      setError('Choose the last day, or pick another way to repeat.');
      return;
    }
    const id = editing?.id ?? newPeriodId();
    const { schedule: inserted } = insertSchedulePeriod(schedule, { ...candidate, id }, newPeriodId);
    const checked = validateCalendarSchedule(pruneEndedSchedulePeriods(inserted, today).schedule);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    await onSave(checked.schedule);
  }

  return (
    <div className="space-y-4 rounded-2xl border border-brand-200 bg-brand-50/30 p-4" role="group" aria-label={editing ? 'Edit schedule change' : 'Add schedule change'}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="sp-from" className="mb-1 block text-sm font-medium text-slate-700">
            New hours from
          </label>
          <input
            id="sp-from"
            type="date"
            value={draft.from}
            disabled={saving}
            onChange={(e) => e.target.value && setDraft((d) => ({ ...d, from: mondayOnOrBefore(e.target.value) }))}
            className={`${inputCls} w-full`}
          />
          <p className="mt-1 text-xs text-slate-500">{describeYmd(draft.from)}. Changes start on a Monday.</p>
        </div>
        <div>
          <label htmlFor="sp-pattern" className="mb-1 block text-sm font-medium text-slate-700">
            Pattern
          </label>
          <select
            id="sp-pattern"
            value={draft.weeks.length}
            disabled={saving}
            onChange={(e) => setCycleLength(Number(e.target.value))}
            className={`${inputCls} w-full`}
          >
            {Array.from({ length: ROTA_MAX_WEEKS - ROTA_MIN_WEEKS + 1 }, (_, i) => ROTA_MIN_WEEKS + i).map((n) => (
              <option key={n} value={n}>
                {n === 1 ? 'Same hours every week' : `${n}-week rota`}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        {draft.weeks.length > 1 ? (
          <div role="tablist" aria-label="Weeks in the cycle" className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
            {draft.weeks.map((_, i) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={activeWeek === i}
                onClick={() => setActiveWeek(i)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  activeWeek === i ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Week {i + 1}
              </button>
            ))}
          </div>
        ) : null}
        <div className="mt-3" role="tabpanel" aria-label={draft.weeks.length > 1 ? `Week ${activeWeek + 1} hours` : 'Hours'}>
          <WorkingHoursControl
            value={draft.weeks[activeWeek] ?? {}}
            disabled={saving}
            onChange={(next) => setDraft((d) => ({ ...d, weeks: d.weeks.map((w, i) => (i === activeWeek ? next : w)) }))}
            renderDayContext={renderDayContext}
          />
        </div>
      </div>

      <fieldset>
        <legend className="mb-1 text-sm font-medium text-slate-700">Runs</legend>
        <div className="space-y-2 text-sm text-slate-700">
          <label className="flex items-center gap-2">
            <input type="radio" name="sp-repeat" checked={draft.repeatMode === 'forever'} disabled={saving} onChange={() => setDraft((d) => ({ ...d, repeatMode: 'forever' }))} className="text-brand-600 focus:ring-brand-500" />
            Until further notice
          </label>
          <label className="flex flex-wrap items-center gap-2">
            <input type="radio" name="sp-repeat" checked={draft.repeatMode === 'cycles'} disabled={saving} onChange={() => setDraft((d) => ({ ...d, repeatMode: 'cycles' }))} className="text-brand-600 focus:ring-brand-500" />
            For
            <input
              type="number"
              aria-label={draft.weeks.length > 1 ? 'Number of cycles' : 'Number of weeks'}
              min={1}
              max={ROTA_MAX_CYCLES}
              value={draft.cycles}
              disabled={saving || draft.repeatMode !== 'cycles'}
              onChange={(e) => setDraft((d) => ({ ...d, cycles: Math.max(1, Math.min(ROTA_MAX_CYCLES, Math.floor(Number(e.target.value) || 1))) }))}
              className={`${inputCls} w-20`}
            />
            {draft.weeks.length > 1 ? `cycle${draft.cycles === 1 ? '' : 's'}` : `week${draft.cycles === 1 ? '' : 's'}`}
            {draft.repeatMode === 'cycles' && until ? <span className="text-xs text-slate-500">(ends on {describeYmd(until)})</span> : null}
          </label>
          <label className="flex flex-wrap items-center gap-2">
            <input type="radio" name="sp-repeat" checked={draft.repeatMode === 'until'} disabled={saving} onChange={() => setDraft((d) => ({ ...d, repeatMode: 'until' }))} className="text-brand-600 focus:ring-brand-500" />
            Until
            <input
              type="date"
              aria-label="Last week of the change"
              value={draft.until}
              min={draft.from}
              disabled={saving || draft.repeatMode !== 'until'}
              onChange={(e) => setDraft((d) => ({ ...d, until: e.target.value }))}
              className={`${inputCls} w-44`}
            />
            {draft.repeatMode === 'until' && until ? <span className="text-xs text-slate-500">(ends on {describeYmd(until)}, the end of that week)</span> : null}
          </label>
        </div>
      </fieldset>

      {preview.trims.length > 0 || preview.dropped.length > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">
          <p className="font-medium">Saving will adjust what it overlaps:</p>
          <ul className="mt-1 list-disc pl-5">
            {preview.trims.map((t, i) => (
              <li key={`${t.id}-${i}`}>{describeTrim(t, byId)}</li>
            ))}
            {preview.dropped.map((p) => (
              <li key={`dropped-${p.id}`}>
                Drops the past change from {describeYmdShort(p.from)} (ended {describeYmdShort(p.until!)}) to stay within{' '}
                {SCHEDULE_MAX_PERIODS} changes.
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : editing ? 'Save changes' : 'Add to schedule'}
        </button>
        <button type="button" onClick={onCancel} disabled={saving} className="text-sm font-medium text-slate-600 hover:text-slate-900 disabled:opacity-50">
          Cancel
        </button>
      </div>
    </div>
  );
}
