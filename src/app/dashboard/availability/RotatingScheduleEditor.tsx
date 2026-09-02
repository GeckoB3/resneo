'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { WorkingHoursControl } from '@/components/scheduling/WorkingHoursControl';
import type { WorkingHours } from '@/types/booking-models';
import {
  ROTA_MAX_CYCLES,
  ROTA_MAX_WEEKS,
  ROTA_MIN_WEEKS,
  mondayOnOrBefore,
  parseWorkingHoursRota,
  rotaCyclesForEndDate,
  rotaEndDateForCycles,
  type WorkingHoursRota,
} from '@/lib/availability/working-hours-rota';

/**
 * Rotating schedule editor for one calendar (Availability tab). A cycle of two to
 * six weekly shapes, the Monday it starts, and how long it repeats. The parent owns
 * saving; remount this component (change its `key`) when the stored value changes,
 * because the draft is seeded once from `value`.
 * See Docs/rotating-schedule-plan.md.
 */

type RepeatMode = 'forever' | 'cycles' | 'until';

export interface RotatingScheduleEditorProps {
  calendarName: string;
  /** The stored rota, or null. Malformed values are treated as none. */
  value: unknown;
  /** The calendar's ordinary weekly hours; new rota weeks start as a copy of them. */
  weeklyHours: WorkingHours;
  onSave: (rota: WorkingHoursRota | null) => Promise<void> | void;
  saving: boolean;
  readOnly?: boolean;
  renderDayContext?: (dayKey: string, periods: Array<{ open: string; close: string }> | null) => ReactNode;
  /** Other calendars the saved rota can be copied to; empty hides the control. */
  copyTargets?: Array<{ id: string; name: string }>;
  onCopyTo?: (calendarIds: string[], rota: WorkingHoursRota) => Promise<void> | void;
}

function todayYmdLocal(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * "Monday 7 September 2026" from "2026-09-07". Built by hand rather than through
 * Intl so the wording is the same on every machine and in every test run.
 */
export function describeYmd(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(y!, m! - 1, d!);
  return `${WEEKDAY_NAMES[date.getDay()]} ${d} ${MONTH_NAMES[m! - 1]} ${y}`;
}

function cloneHours(hours: WorkingHours): WorkingHours {
  return Object.fromEntries(Object.entries(hours).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
}

interface Draft {
  cycleStart: string;
  weeks: WorkingHours[];
  repeatMode: RepeatMode;
  cycles: number;
  until: string;
}

function draftFromValue(stored: WorkingHoursRota | null, weeklyHours: WorkingHours): Draft {
  if (stored) {
    const cycles = rotaCyclesForEndDate(stored);
    return {
      cycleStart: stored.cycle_start,
      weeks: stored.weeks.map(cloneHours),
      repeatMode: stored.repeat_until == null ? 'forever' : cycles != null ? 'cycles' : 'until',
      cycles: cycles ?? 4,
      until: stored.repeat_until ?? '',
    };
  }
  return {
    cycleStart: mondayOnOrBefore(todayYmdLocal()),
    weeks: [cloneHours(weeklyHours), cloneHours(weeklyHours)],
    repeatMode: 'forever',
    cycles: 4,
    until: '',
  };
}

const inputCls =
  'rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-slate-50 disabled:text-slate-500';

export function RotatingScheduleEditor({
  calendarName,
  value,
  weeklyHours,
  onSave,
  saving,
  readOnly = false,
  renderDayContext,
  copyTargets = [],
  onCopyTo,
}: RotatingScheduleEditorProps) {
  const stored = useMemo(() => parseWorkingHoursRota(value), [value]);
  const [enabled, setEnabled] = useState<boolean>(stored != null);
  const [draft, setDraft] = useState<Draft>(() => draftFromValue(stored, weeklyHours));
  const [activeWeek, setActiveWeek] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [copySelection, setCopySelection] = useState<Set<string>>(() => new Set());

  const endDate = useMemo(() => {
    if (draft.repeatMode === 'forever') return null;
    if (draft.repeatMode === 'cycles') return rotaEndDateForCycles(draft.cycleStart, draft.weeks.length, draft.cycles);
    return draft.until || null;
  }, [draft]);

  function buildRota(): WorkingHoursRota | null {
    return parseWorkingHoursRota({
      version: 1,
      cycle_start: draft.cycleStart,
      weeks: draft.weeks,
      repeat_until: endDate,
    });
  }

  function setCycleLength(next: number) {
    setDraft((d) => {
      const weeks = d.weeks.slice(0, next);
      while (weeks.length < next) weeks.push(cloneHours(weeks[weeks.length - 1] ?? weeklyHours));
      return { ...d, weeks };
    });
    setActiveWeek((i) => Math.min(i, next - 1));
  }

  function setStart(raw: string) {
    if (!raw) return;
    setDraft((d) => ({ ...d, cycleStart: mondayOnOrBefore(raw) }));
  }

  async function save() {
    setError(null);
    const rota = buildRota();
    if (!rota) {
      setError('Check the start date, each week\'s hours, and the end date. The rota must start on a Monday and end on or after it starts.');
      return;
    }
    await onSave(rota);
  }

  async function remove() {
    if (typeof window !== 'undefined' && !window.confirm(`Remove the rotating schedule for ${calendarName}? The standard weekly hours above will apply every week.`)) return;
    setError(null);
    await onSave(null);
  }

  const summary = stored
    ? `Repeats every ${stored.weeks.length} weeks from ${describeYmd(stored.cycle_start)}, ${
        stored.repeat_until ? `until ${describeYmd(stored.repeat_until)}` : 'until further notice'
      }.`
    : null;

  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5" aria-labelledby="rota-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="rota-heading" className="text-sm font-semibold text-slate-900">
            Rotating schedule
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            For a calendar that works different hours each week. Set each week of the cycle and how long it
            repeats. The standard weekly hours above apply before it starts and after it ends; breaks, days off
            and closures still apply during it.
          </p>
          {summary ? <p className="mt-1 text-xs font-medium text-brand-700">{summary}</p> : null}
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            role="switch"
            aria-checked={enabled}
            checked={enabled}
            disabled={readOnly || saving}
            onChange={(e) => setEnabled(e.target.checked)}
            className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          This calendar works a rotating schedule
        </label>
      </div>

      {!enabled && stored && !readOnly ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          The saved rotating schedule is still in use. To stop it, click{' '}
          <button type="button" onClick={() => void remove()} disabled={saving} className="font-semibold underline">
            Remove rotating schedule
          </button>
          .
        </div>
      ) : null}

      {enabled ? (
        <div className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="rota-cycle-length" className="mb-1 block text-sm font-medium text-slate-700">
                Cycle length
              </label>
              <select
                id="rota-cycle-length"
                value={draft.weeks.length}
                disabled={readOnly || saving}
                onChange={(e) => setCycleLength(Number(e.target.value))}
                className={`${inputCls} w-full`}
              >
                {Array.from({ length: ROTA_MAX_WEEKS - ROTA_MIN_WEEKS + 1 }, (_, i) => ROTA_MIN_WEEKS + i).map((n) => (
                  <option key={n} value={n}>
                    {n} weeks
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="rota-start" className="mb-1 block text-sm font-medium text-slate-700">
                Week 1 starts on
              </label>
              <input
                id="rota-start"
                type="date"
                value={draft.cycleStart}
                disabled={readOnly || saving}
                onChange={(e) => setStart(e.target.value)}
                className={`${inputCls} w-full`}
              />
              <p className="mt-1 text-xs text-slate-500">{describeYmd(draft.cycleStart)}. Weeks run Monday to Sunday.</p>
            </div>
          </div>

          <div>
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
            <div className="mt-3" role="tabpanel" aria-label={`Week ${activeWeek + 1} hours`}>
              <WorkingHoursControl
                value={draft.weeks[activeWeek] ?? {}}
                disabled={readOnly || saving}
                onChange={(next) =>
                  setDraft((d) => ({ ...d, weeks: d.weeks.map((w, i) => (i === activeWeek ? next : w)) }))
                }
                renderDayContext={renderDayContext}
              />
            </div>
          </div>

          <fieldset>
            <legend className="mb-1 text-sm font-medium text-slate-700">Repeat</legend>
            <div className="space-y-2 text-sm text-slate-700">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="rota-repeat"
                  checked={draft.repeatMode === 'forever'}
                  disabled={readOnly || saving}
                  onChange={() => setDraft((d) => ({ ...d, repeatMode: 'forever' }))}
                  className="text-brand-600 focus:ring-brand-500"
                />
                Until further notice
              </label>
              <label className="flex flex-wrap items-center gap-2">
                <input
                  type="radio"
                  name="rota-repeat"
                  checked={draft.repeatMode === 'cycles'}
                  disabled={readOnly || saving}
                  onChange={() => setDraft((d) => ({ ...d, repeatMode: 'cycles' }))}
                  className="text-brand-600 focus:ring-brand-500"
                />
                For
                <input
                  type="number"
                  aria-label="Number of cycles"
                  min={1}
                  max={ROTA_MAX_CYCLES}
                  value={draft.cycles}
                  disabled={readOnly || saving || draft.repeatMode !== 'cycles'}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      cycles: Math.max(1, Math.min(ROTA_MAX_CYCLES, Math.floor(Number(e.target.value) || 1))),
                    }))
                  }
                  className={`${inputCls} w-20`}
                />
                cycle{draft.cycles === 1 ? '' : 's'}
                {draft.repeatMode === 'cycles' && endDate ? (
                  <span className="text-xs text-slate-500">(ends on {describeYmd(endDate)})</span>
                ) : null}
              </label>
              <label className="flex flex-wrap items-center gap-2">
                <input
                  type="radio"
                  name="rota-repeat"
                  checked={draft.repeatMode === 'until'}
                  disabled={readOnly || saving}
                  onChange={() => setDraft((d) => ({ ...d, repeatMode: 'until' }))}
                  className="text-brand-600 focus:ring-brand-500"
                />
                Until
                <input
                  type="date"
                  aria-label="Last day of the rotating schedule"
                  value={draft.until}
                  min={draft.cycleStart}
                  disabled={readOnly || saving || draft.repeatMode !== 'until'}
                  onChange={(e) => setDraft((d) => ({ ...d, until: e.target.value }))}
                  className={`${inputCls} w-44`}
                />
              </label>
            </div>
          </fieldset>

          {error ? (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          {!readOnly ? (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save rotating schedule'}
              </button>
              {stored ? (
                <button
                  type="button"
                  onClick={() => void remove()}
                  disabled={saving}
                  className="text-sm font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                >
                  Remove rotating schedule
                </button>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-slate-500">View only. Ask an admin to change this calendar&apos;s schedule.</p>
          )}

          {stored && !readOnly && onCopyTo && copyTargets.length > 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-medium text-slate-800">Copy this rotating schedule to other calendars</p>
              <p className="mt-0.5 text-xs text-slate-500">
                Copies the saved schedule as it is now. Each calendar keeps its own standard weekly hours, breaks and
                days off.
              </p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {copyTargets.map((t) => (
                  <label key={t.id} className="flex items-center gap-1.5 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={copySelection.has(t.id)}
                      disabled={saving}
                      onChange={(e) =>
                        setCopySelection((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(t.id);
                          else next.delete(t.id);
                          return next;
                        })
                      }
                      className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                    />
                    {t.name}
                  </label>
                ))}
              </div>
              <button
                type="button"
                disabled={saving || copySelection.size === 0}
                onClick={() => void onCopyTo([...copySelection], stored)}
                className="mt-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                Copy to {copySelection.size} calendar{copySelection.size === 1 ? '' : 's'}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
