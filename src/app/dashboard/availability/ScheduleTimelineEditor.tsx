'use client';

import { useMemo, useState, type ReactNode } from 'react';
import type { AvailabilityBlock, OpeningHours } from '@/types/availability';
import type { WorkingHours } from '@/types/booking-models';
import {
  removeSchedulePeriod,
  schedulePeriodHasEnded,
  scheduleForRow,
  type CalendarSchedule,
  type SchedulePeriod,
} from '@/lib/availability/working-hours-rota';
import { SchedulePeriodForm, describeYmd, describeYmdShort, todayYmdLocal } from './SchedulePeriodForm';
import { PERIOD_TINTS, ScheduleCalendarPreview, type DaySummary, type LeaveRow } from './ScheduleCalendarPreview';

/**
 * "Plan your hours ahead" on the Availability tab: the timeline of schedule
 * changes for one calendar, the form to add or edit one, and the planning
 * calendar that shows the bookable hours on any date. The parent owns saving;
 * remount this component (change its `key`) when the stored value changes.
 *
 * The list shows the changes that still matter: the one running now and any
 * still to come. Changes that have ended stay in the stored timeline, so the
 * planning calendar can page back through them, but they sit behind a "past
 * changes" toggle rather than growing the list for good. See
 * Docs/rotating-schedule-plan.md.
 */

export interface ScheduleTimelineEditorProps {
  calendarId: string;
  calendarName: string;
  /** `unified_calendars.schedule_periods` as stored. */
  value: unknown;
  /** `unified_calendars.working_hours_rota`, read only while `value` is null. */
  legacyRota?: unknown;
  weeklyHours: WorkingHours;
  daysOff: readonly string[];
  venueHours: OpeningHours | null | undefined;
  onSave: (schedule: CalendarSchedule | null) => Promise<void> | void;
  saving: boolean;
  readOnly?: boolean;
  renderDayContext?: (dayKey: string, periods: Array<{ open: string; close: string }> | null) => ReactNode;
  copyTargets?: Array<{ id: string; name: string }>;
  onCopyTo?: (calendarIds: string[], schedule: CalendarSchedule) => Promise<void> | void;
  /** Injected for tests; see ScheduleCalendarPreview. */
  loadLeave?: (calendarId: string, from: string, to: string) => Promise<LeaveRow[]>;
  loadVenueBlocks?: () => Promise<AvailabilityBlock[]>;
  initialMonth?: { year: number; monthIndex: number };
  /** Today, `YYYY-MM-DD`; defaults to the browser's date. Injected for tests. */
  todayYmd?: string;
}

type Mode = { kind: 'idle' } | { kind: 'add'; from: string | null } | { kind: 'edit'; id: string };

export function describePeriod(p: SchedulePeriod): string {
  const pattern = p.weeks.length === 1 ? 'same hours every week' : `${p.weeks.length}-week rota`;
  const runs = p.until ? `until ${describeYmdShort(p.until)}` : 'until further notice';
  return `From ${describeYmdShort(p.from)}, ${runs}: ${pattern}`;
}

export function ScheduleTimelineEditor({
  calendarId,
  calendarName,
  value,
  legacyRota = null,
  weeklyHours,
  daysOff,
  venueHours,
  onSave,
  saving,
  readOnly = false,
  renderDayContext,
  copyTargets = [],
  onCopyTo,
  loadLeave,
  loadVenueBlocks,
  initialMonth,
  todayYmd,
}: ScheduleTimelineEditorProps) {
  const today = todayYmd ?? todayYmdLocal();
  const schedule = useMemo(
    () => scheduleForRow({ schedule_periods: value, working_hours_rota: legacyRota }),
    [value, legacyRota],
  );
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });
  const [selected, setSelected] = useState<{ date: string; summary: DaySummary } | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [copySelection, setCopySelection] = useState<Set<string>>(() => new Set());

  const editing = mode.kind === 'edit' ? schedule?.periods.find((p) => p.id === mode.id) ?? null : null;

  // Tints follow the index in the full timeline, past changes included, so a
  // change keeps its colour on the calendar whether or not the list shows it.
  const periods = schedule?.periods ?? [];
  const tintFor = (p: SchedulePeriod) => PERIOD_TINTS[periods.indexOf(p) % PERIOD_TINTS.length]!.swatch;
  const pastPeriods = periods.filter((p) => schedulePeriodHasEnded(p, today));
  const currentPeriods = periods.filter((p) => !schedulePeriodHasEnded(p, today));

  const selectedDate = selected?.date ?? null;
  const selectedSummary = selected?.summary ?? null;

  async function saveSchedule(next: CalendarSchedule | null) {
    await onSave(next);
    setMode({ kind: 'idle' });
  }

  async function remove(period: SchedulePeriod) {
    const ended = schedulePeriodHasEnded(period, today);
    const question = ended
      ? `Remove the change from ${describeYmdShort(period.from)}? It has already ended; removing it only changes what the calendar below shows for those past dates.`
      : `Remove the change from ${describeYmdShort(period.from)}? Those dates go back to the standard weekly hours.`;
    if (typeof window !== 'undefined' && !window.confirm(question)) {
      return;
    }
    await saveSchedule(removeSchedulePeriod(schedule, period.id));
  }

  function renderPeriodRow(p: SchedulePeriod, ended: boolean) {
    return (
      <li
        key={p.id}
        className={`flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 px-3 py-2 text-sm ${ended ? 'bg-slate-50' : ''}`}
      >
        <span className={`h-3 w-3 shrink-0 rounded-sm ${tintFor(p)}`} aria-hidden="true" />
        <span className={`min-w-0 flex-1 ${ended ? 'text-slate-500' : 'text-slate-800'}`}>
          {describePeriod(p)}
          {ended ? ' (ended)' : ''}
        </span>
        {!readOnly ? (
          <span className="flex items-center gap-2">
            <button type="button" onClick={() => setMode({ kind: 'edit', id: p.id })} disabled={saving} className="text-xs font-medium text-brand-600 hover:text-brand-800 disabled:opacity-50">
              Edit
            </button>
            <button type="button" onClick={() => void remove(p)} disabled={saving} className="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50">
              Remove
            </button>
          </span>
        ) : null}
      </li>
    );
  }

  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5" aria-labelledby="schedule-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="schedule-heading" className="text-sm font-semibold text-slate-900">
            Plan your hours ahead
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Change this calendar&apos;s hours from a date in the future, or set a pattern that rotates week by week, without
            touching the dates before it. The standard weekly hours above apply to any date no change covers. Breaks, days
            off and closures still apply.
          </p>
        </div>
        {!readOnly && mode.kind === 'idle' ? (
          <button
            type="button"
            onClick={() => setMode({ kind: 'add', from: selectedDate })}
            disabled={saving}
            className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            Add a change from a date
          </button>
        ) : null}
      </div>

      <ol className="mt-4 space-y-2" aria-label="Schedule timeline">
        <li className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2 text-sm">
          <span className="h-3 w-3 shrink-0 rounded-sm border border-slate-300 bg-white" aria-hidden="true" />
          <span className="text-slate-700">Standard weekly hours (set above), on every date the changes below do not cover</span>
        </li>
        {currentPeriods.map((p) => renderPeriodRow(p, false))}
        {currentPeriods.length === 0 ? (
          <li className="rounded-xl border border-dashed border-slate-200 px-3 py-2 text-sm text-slate-500">
            No changes planned. The standard weekly hours apply from today onwards.
          </li>
        ) : null}
      </ol>

      {pastPeriods.length > 0 ? (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowPast((v) => !v)}
            aria-expanded={showPast}
            className="text-xs font-medium text-slate-600 hover:text-slate-900"
          >
            {showPast ? 'Hide past changes' : `Show ${pastPeriods.length} past change${pastPeriods.length === 1 ? '' : 's'}`}
          </button>
          {showPast ? (
            <ol className="mt-2 space-y-2" aria-label="Past schedule changes">
              {pastPeriods.map((p) => renderPeriodRow(p, true))}
            </ol>
          ) : null}
        </div>
      ) : null}

      {mode.kind !== 'idle' ? (
        <div className="mt-4">
          <SchedulePeriodForm
            key={mode.kind === 'edit' ? mode.id : `add-${mode.from ?? ''}`}
            schedule={schedule}
            editing={editing}
            initialFrom={mode.kind === 'add' ? mode.from : null}
            weeklyHours={weeklyHours}
            onSave={saveSchedule}
            onCancel={() => setMode({ kind: 'idle' })}
            saving={saving}
            renderDayContext={renderDayContext}
            todayYmd={today}
          />
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr,18rem]">
        <div>
          <p className="mb-2 text-xs text-slate-500">
            Bookable hours by date: this calendar&apos;s hours inside your business hours and closures, minus days off and
            leave. Page back to see what the hours were, or ahead to what they will be. Pick a day to see which rule applies.
          </p>
          <ScheduleCalendarPreview
            calendarId={calendarId}
            baseHours={weeklyHours}
            schedule={schedule}
            daysOff={daysOff}
            venueHours={venueHours}
            selectedDate={selectedDate}
            onPickDate={(date, summary) => setSelected({ date, summary })}
            loadLeave={loadLeave}
            loadVenueBlocks={loadVenueBlocks}
            initialMonth={initialMonth}
            todayYmd={today}
          />
        </div>
        <aside className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm" aria-live="polite">
          {selectedDate && selectedSummary ? (
            <>
              <p className="font-semibold text-slate-900">{describeYmd(selectedDate)}</p>
              <p className="mt-1 text-slate-800">
                {selectedSummary.text}
                {selectedSummary.partialLeave ? ` (leave ${selectedSummary.partialLeave})` : ''}
              </p>
              <p className="mt-2 text-xs text-slate-500">
                {selectedSummary.source.kind === 'period'
                  ? `Rule: change from ${describeYmdShort(selectedSummary.source.period.from)}${
                      selectedSummary.source.period.weeks.length > 1 ? `, week ${selectedSummary.source.weekIndex + 1} of ${selectedSummary.source.period.weeks.length}` : ''
                    }.`
                  : 'Rule: standard weekly hours.'}
                {selectedSummary.reason === 'day-off' ? ' This is a day off.' : ''}
                {selectedSummary.reason === 'leave' ? ' This calendar is on leave.' : ''}
                {selectedSummary.reason === 'venue-closed' ? ' Your venue is closed on this weekday.' : ''}
                {selectedSummary.reason === 'venue-closure' ? ' Your venue has a closure on this date.' : ''}
              </p>
              {!readOnly && mode.kind === 'idle' ? (
                <div className="mt-3 flex flex-col gap-1.5">
                  <button type="button" onClick={() => setMode({ kind: 'add', from: selectedDate })} disabled={saving} className="text-left text-xs font-medium text-brand-600 hover:text-brand-800 disabled:opacity-50">
                    Change hours from this week
                  </button>
                  {selectedSummary.source.kind === 'period' ? (
                    <button type="button" onClick={() => setMode({ kind: 'edit', id: (selectedSummary.source as { period: SchedulePeriod }).period.id })} disabled={saving} className="text-left text-xs font-medium text-brand-600 hover:text-brand-800 disabled:opacity-50">
                      Edit this change
                    </button>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-xs text-slate-500">Pick a day on the calendar to see its hours and which rule sets them.</p>
          )}
        </aside>
      </div>

      {schedule && !readOnly && onCopyTo && copyTargets.length > 0 ? (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-sm font-medium text-slate-800">Copy this schedule to other calendars</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Copies every change above as saved, past changes included. Each calendar keeps its own standard weekly hours,
            breaks and days off.
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
            onClick={() => void onCopyTo([...copySelection], schedule)}
            className="mt-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            Copy to {copySelection.size} calendar{copySelection.size === 1 ? '' : 's'}
          </button>
        </div>
      ) : null}
      <span className="sr-only">{calendarName}</span>
    </section>
  );
}
