'use client';

import { useMemo, useRef, useState } from 'react';
import type {
  ServiceCustomRule,
  ServiceCustomScheduleV2,
  TimeRange,
  WorkingHours,
} from '@/types/booking-models';
import { WorkingHoursControl } from '@/components/scheduling/WorkingHoursControl';
import {
  ServiceAvailabilityMonthGrid,
  isoDateRangeToSet,
  type DayVisualState,
  ymdFromParts,
} from '@/components/scheduling/ServiceAvailabilityMonthGrid';
import {
  DAY_ORDER,
  formatServiceCustomRuleSummary,
  newRuleId,
} from '@/lib/service-custom-availability';

type RuleType = ServiceCustomRule['kind'];

const RULE_TYPE_META: Record<RuleType, {
  label: string;
  badge: string;
  description: string;
}> = {
  weekly: {
    label: 'Weekly hours',
    badge: 'Weekly',
    description: 'Same pattern every week (e.g. Mon–Fri 9–5).',
  },
  specific_dates: {
    label: 'Specific dates',
    badge: 'Dates',
    description: 'Extra time slots on individual dates you hand-pick.',
  },
  date_range_pattern: {
    label: 'Date range',
    badge: 'Range',
    description: 'A season or block of dates with its own weekly pattern.',
  },
};

const DEFAULT_WEEKLY_WINDOWS: WorkingHours = {
  '1': [{ start: '09:00', end: '17:00' }],
  '2': [{ start: '09:00', end: '17:00' }],
  '3': [{ start: '09:00', end: '17:00' }],
  '4': [{ start: '09:00', end: '17:00' }],
  '5': [{ start: '09:00', end: '17:00' }],
};

function todayIsoDate(): string {
  const d = new Date();
  return ymdFromParts(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function cloneSchedule(s: ServiceCustomScheduleV2): ServiceCustomScheduleV2 {
  return JSON.parse(JSON.stringify(s)) as ServiceCustomScheduleV2;
}

function newRule(kind: RuleType): ServiceCustomRule {
  if (kind === 'weekly') {
    return {
      id: newRuleId(),
      kind: 'weekly',
      windows: JSON.parse(JSON.stringify(DEFAULT_WEEKLY_WINDOWS)) as WorkingHours,
    };
  }
  if (kind === 'specific_dates') {
    return { id: newRuleId(), kind: 'specific_dates', entries: [] };
  }
  const start = todayIsoDate();
  return {
    id: newRuleId(),
    kind: 'date_range_pattern',
    start_date: start,
    end_date: start,
    days_of_week: [1, 2, 3, 4, 5],
    ranges: [{ start: '09:00', end: '17:00' }],
  };
}

export interface ServiceCustomAvailabilityEditorProps {
  value: ServiceCustomScheduleV2;
  onChange: (next: ServiceCustomScheduleV2) => void;
  /** Legacy read-only flag (e.g. non-admin). */
  disabled?: boolean;
  /**
   * When provided, the editor renders the master enable toggle itself and
   * auto-seeds a weekly rule the first time a venue turns it on. Recommended.
   */
  enabled?: boolean;
  onEnabledChange?: (next: boolean) => void;
}

export function ServiceCustomAvailabilityEditor({
  value,
  onChange,
  disabled = false,
  enabled,
  onEnabledChange,
}: ServiceCustomAvailabilityEditorProps) {
  const controlsEnable = typeof enabled === 'boolean' && typeof onEnabledChange === 'function';
  const active = controlsEnable ? enabled! : true;
  const readonly = disabled || (controlsEnable && !enabled);

  function setRules(nextRules: ServiceCustomRule[]) {
    onChange({ version: 2, rules: nextRules });
  }

  function addRule(kind: RuleType) {
    setRules([...value.rules, newRule(kind)]);
  }

  function removeRuleAt(index: number) {
    setRules(value.rules.filter((_, i) => i !== index));
  }

  function replaceRuleAt(index: number, rule: ServiceCustomRule) {
    const next = [...value.rules];
    next[index] = rule;
    setRules(next);
  }

  function handleToggleEnable(next: boolean) {
    if (!controlsEnable) return;
    onEnabledChange!(next);
  }

  return (
    <div className="min-w-0 max-w-full space-y-4">
      {controlsEnable && (
        <EnableToggle
          active={active}
          disabled={disabled}
          onChange={handleToggleEnable}
        />
      )}

      {active && (
        <>
          {value.rules.length === 0 ? (
            <EmptyState disabled={readonly} onAddRule={addRule} />
          ) : (
            <div className="space-y-3">
              {value.rules.map((rule, i) => (
                <RuleCard
                  key={rule.id}
                  rule={rule}
                  disabled={readonly}
                  onRemove={() => removeRuleAt(i)}
                  onChange={(next) => replaceRuleAt(i, next)}
                />
              ))}
            </div>
          )}

          {!readonly && value.rules.length > 0 && (
            <AddRuleMenu
              existingKinds={new Set(value.rules.map((r) => r.kind))}
              onAdd={addRule}
            />
          )}

          {active && value.rules.length === 0 && !readonly && (
            <p className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-xs text-amber-900">
              Custom scheduling is on but has no rules. Add at least one, or turn the toggle off,
              otherwise this service will not be bookable online.
            </p>
          )}

          {active && value.rules.length > 0 && <PlainLanguageSummary schedule={value} />}
        </>
      )}
    </div>
  );
}

function EnableToggle({
  active,
  disabled,
  onChange,
}: {
  active: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition ${
        active
          ? 'border-brand-300 bg-brand-50/50 shadow-sm'
          : 'border-slate-200 bg-white hover:border-slate-300'
      } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
    >
      <input
        type="checkbox"
        checked={active}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
      />
      <div className="flex-1">
        <p className="text-sm font-semibold text-slate-900">
          Limit this service to a custom schedule
        </p>
        <p className="mt-0.5 text-xs text-slate-600">
          On top of venue opening hours and calendar availability, only allow online bookings during
          the rules below. Leave unchecked to use venue + calendar hours as-is.
        </p>
      </div>
    </label>
  );
}

function EmptyState({
  disabled,
  onAddRule,
}: {
  disabled: boolean;
  onAddRule: (kind: RuleType) => void;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 px-5 py-6 text-center">
      <p className="text-sm font-medium text-slate-700">Add your first rule</p>
      <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
        Most services just need weekly hours. You can add specific dates or a date range later.
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onAddRule('weekly')}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-50"
        >
          Add weekly hours
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onAddRule('specific_dates')}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-400 disabled:opacity-50"
        >
          Add specific dates
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onAddRule('date_range_pattern')}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-400 disabled:opacity-50"
        >
          Add date range
        </button>
      </div>
    </div>
  );
}

function AddRuleMenu({
  existingKinds,
  onAdd,
}: {
  existingKinds: Set<RuleType>;
  onAdd: (kind: RuleType) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={rootRef} className="relative flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50"
      >
        <span className="text-base leading-none">+</span> Add another rule
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-0 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 top-[calc(100%+6px)] z-10 w-72 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
            {(Object.keys(RULE_TYPE_META) as RuleType[]).map((kind) => {
              const meta = RULE_TYPE_META[kind];
              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() => {
                    onAdd(kind);
                    setOpen(false);
                  }}
                  className="block w-full rounded-lg px-3 py-2 text-left transition hover:bg-slate-50"
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                    {meta.label}
                    {existingKinds.has(kind) && (
                      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                        already added
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-500">{meta.description}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function RuleCard({
  rule,
  disabled,
  onChange,
  onRemove,
}: {
  rule: ServiceCustomRule;
  disabled: boolean;
  onChange: (next: ServiceCustomRule) => void;
  onRemove: () => void;
}) {
  const meta = RULE_TYPE_META[rule.kind];
  const summary = formatServiceCustomRuleSummary(rule);

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 bg-slate-50/80 px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-800">
              {meta.badge}
            </span>
            <h3 className="text-sm font-semibold text-slate-900">{meta.label}</h3>
          </div>
          <p className="mt-1 text-xs text-slate-500 line-clamp-2">{summary}</p>
        </div>
        {!disabled && (
          <button
            type="button"
            onClick={onRemove}
            className="rounded-lg px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 hover:text-red-700"
          >
            Remove
          </button>
        )}
      </header>
      <div className="p-4">
        {rule.kind === 'weekly' && (
          <WeeklyRuleEditor
            rule={rule}
            disabled={disabled}
            onChange={(next) => onChange(next)}
          />
        )}
        {rule.kind === 'specific_dates' && (
          <SpecificDatesRuleEditor
            rule={rule}
            disabled={disabled}
            onChange={(next) => onChange(next)}
          />
        )}
        {rule.kind === 'date_range_pattern' && (
          <DateRangeRuleEditor
            rule={rule}
            disabled={disabled}
            onChange={(next) => onChange(next)}
          />
        )}
      </div>
    </section>
  );
}

function WeeklyRuleEditor({
  rule,
  disabled,
  onChange,
}: {
  rule: Extract<ServiceCustomRule, { kind: 'weekly' }>;
  disabled: boolean;
  onChange: (next: ServiceCustomRule) => void;
}) {
  function applyPreset(preset: 'weekdays' | 'all' | 'clear') {
    if (disabled) return;
    if (preset === 'clear') {
      onChange({ ...rule, windows: {} });
      return;
    }
    const base: WorkingHours = {};
    const keys = preset === 'all' ? ['1', '2', '3', '4', '5', '6', '0'] : ['1', '2', '3', '4', '5'];
    for (const k of keys) base[k] = [{ start: '09:00', end: '17:00' }];
    onChange({ ...rule, windows: base });
  }

  return (
    <div className="space-y-3">
      {!disabled && (
        <div className="flex flex-wrap gap-1.5">
          <PresetButton label="Mon–Fri 9–5" onClick={() => applyPreset('weekdays')} />
          <PresetButton label="Every day 9–5" onClick={() => applyPreset('all')} />
          <PresetButton label="Clear" variant="ghost" onClick={() => applyPreset('clear')} />
        </div>
      )}
      <WorkingHoursControl
        value={rule.windows}
        disabled={disabled}
        onChange={(windows) => onChange({ ...rule, windows })}
      />
    </div>
  );
}

function PresetButton({
  label,
  onClick,
  variant = 'solid',
}: {
  label: string;
  onClick: () => void;
  variant?: 'solid' | 'ghost';
}) {
  const cls =
    variant === 'solid'
      ? 'rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200'
      : 'rounded-lg px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100';
  return (
    <button type="button" onClick={onClick} className={cls}>
      {label}
    </button>
  );
}

function TimeWindowsEditor({
  ranges,
  onChange,
  disabled,
}: {
  ranges: TimeRange[];
  onChange: (next: TimeRange[]) => void;
  disabled?: boolean;
}) {
  function updateRange(i: number, field: 'start' | 'end', v: string) {
    const next = [...ranges];
    next[i] = { ...next[i]!, [field]: v };
    onChange(next);
  }
  function addRange() {
    onChange([...ranges, { start: '09:00', end: '17:00' }]);
  }
  function removeRange(i: number) {
    const next = ranges.filter((_, j) => j !== i);
    onChange(next.length > 0 ? next : [{ start: '09:00', end: '17:00' }]);
  }

  return (
    <div className="min-w-0 max-w-full space-y-2">
      {ranges.map((r, i) => (
        <div key={i} className="flex min-w-0 flex-wrap items-center gap-2">
          <input
            type="time"
            value={r.start}
            onChange={(e) => updateRange(i, 'start', e.target.value)}
            disabled={disabled}
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-800 disabled:bg-slate-50 sm:flex-none"
          />
          <span className="text-xs text-slate-400">to</span>
          <input
            type="time"
            value={r.end}
            onChange={(e) => updateRange(i, 'end', e.target.value)}
            disabled={disabled}
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-800 disabled:bg-slate-50 sm:flex-none"
          />
          {ranges.length > 1 && !disabled && (
            <button
              type="button"
              onClick={() => removeRange(i)}
              className="text-xs font-medium text-red-600 hover:underline"
            >
              Remove
            </button>
          )}
        </div>
      ))}
      {!disabled && (
        <button
          type="button"
          onClick={addRange}
          className="text-xs font-semibold text-brand-600 hover:text-brand-700"
        >
          + Add time window
        </button>
      )}
    </div>
  );
}

function useMonthState(initialYear: number, initialMonth: number) {
  const [year, setYear] = useState(initialYear);
  const [month, setMonth] = useState(initialMonth);
  function prevMonth() {
    if (month <= 1) {
      setMonth(12);
      setYear((y) => y - 1);
    } else setMonth((m) => m - 1);
  }
  function nextMonth() {
    if (month >= 12) {
      setMonth(1);
      setYear((y) => y + 1);
    } else setMonth((m) => m + 1);
  }
  return { year, month, prevMonth, nextMonth };
}

function SpecificDatesRuleEditor({
  rule,
  disabled,
  onChange,
}: {
  rule: Extract<ServiceCustomRule, { kind: 'specific_dates' }>;
  disabled: boolean;
  onChange: (next: ServiceCustomRule) => void;
}) {
  const entries = rule.entries;
  const todayYmd = todayIsoDate();
  const [selectedIdx, setSelectedIdx] = useState(0);
  const sel = entries[Math.min(selectedIdx, Math.max(0, entries.length - 1))];

  const seedYear = entries[0]?.date
    ? Number(entries[0].date.slice(0, 4))
    : new Date().getFullYear();
  const seedMonth = entries[0]?.date
    ? Number(entries[0].date.slice(5, 7))
    : new Date().getMonth() + 1;
  const monthNav = useMonthState(seedYear, seedMonth);

  const dateSet = useMemo(() => new Set(entries.map((e) => e.date)), [entries]);

  function addOrSelectDate(ymd: string) {
    if (disabled) return;
    const idx = entries.findIndex((e) => e.date === ymd);
    if (idx >= 0) {
      setSelectedIdx(idx);
      return;
    }
    const nextEntries = [...entries, { date: ymd, ranges: [{ start: '09:00', end: '17:00' }] }].sort(
      (a, b) => a.date.localeCompare(b.date),
    );
    onChange({ ...rule, entries: nextEntries });
    setSelectedIdx(nextEntries.findIndex((e) => e.date === ymd));
  }

  function removeSelected() {
    if (disabled || !sel) return;
    const nextEntries = entries.filter((e) => e.date !== sel.date);
    onChange({ ...rule, entries: nextEntries });
    setSelectedIdx(Math.min(selectedIdx, Math.max(0, nextEntries.length - 1)));
  }

  function updateSelectedRanges(ranges: TimeRange[]) {
    if (disabled || !sel) return;
    const nextEntries = entries.map((e) => (e.date === sel.date ? { ...e, ranges } : e));
    onChange({ ...rule, entries: nextEntries });
  }

  function getDayState(ymd: string): DayVisualState {
    if (sel?.date === ymd) return 'selected-entry';
    if (dateSet.has(ymd)) return 'has-entry';
    if (ymd === todayYmd) return 'today';
    return 'default';
  }

  return (
    <div className="grid min-w-0 max-w-full gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(240px,300px)] lg:items-start">
      <ServiceAvailabilityMonthGrid
        year={monthNav.year}
        month={monthNav.month}
        todayYmd={todayYmd}
        onPrevMonth={monthNav.prevMonth}
        onNextMonth={monthNav.nextMonth}
        getDayState={getDayState}
        onDayClick={disabled ? undefined : addOrSelectDate}
        disabled={disabled}
        subtitle="Tap a day to add or select it"
      />
      <div className="space-y-3">
        {entries.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-3 py-5 text-center text-xs text-slate-600">
            No dates added yet. Tap a day on the calendar to add one.
          </p>
        ) : sel ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2">
              <span className="text-sm font-semibold text-slate-800">
                {new Date(sel.date + 'T12:00:00').toLocaleDateString(undefined, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </span>
              {!disabled && (
                <button
                  type="button"
                  onClick={removeSelected}
                  className="text-xs font-semibold text-red-600 hover:underline"
                >
                  Remove date
                </button>
              )}
            </div>
            <TimeWindowsEditor
              ranges={sel.ranges}
              onChange={updateSelectedRanges}
              disabled={disabled}
            />
          </>
        ) : null}
        {entries.length > 1 && (
          <div className="flex flex-wrap gap-1">
            {entries.map((e, i) => {
              const isSel = e.date === sel?.date;
              return (
                <button
                  key={e.date}
                  type="button"
                  disabled={disabled}
                  onClick={() => setSelectedIdx(i)}
                  className={`rounded-lg px-2 py-0.5 text-[11px] font-medium transition ${
                    isSel ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {e.date.slice(5)}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function DateRangeRuleEditor({
  rule,
  disabled,
  onChange,
}: {
  rule: Extract<ServiceCustomRule, { kind: 'date_range_pattern' }>;
  disabled: boolean;
  onChange: (next: ServiceCustomRule) => void;
}) {
  const todayYmd = todayIsoDate();
  const initY = Number(rule.start_date.slice(0, 4));
  const initM = Number(rule.start_date.slice(5, 7));
  const monthNav = useMonthState(
    Number.isFinite(initY) && initY > 0 ? initY : new Date().getFullYear(),
    Number.isFinite(initM) && initM >= 1 && initM <= 12 ? initM : new Date().getMonth() + 1,
  );
  const [tapPhase, setTapPhase] = useState(0);

  const rangeSet = isoDateRangeToSet(rule.start_date, rule.end_date);
  const lo = rule.start_date <= rule.end_date ? rule.start_date : rule.end_date;
  const hi = rule.start_date <= rule.end_date ? rule.end_date : rule.start_date;

  function getDayState(ymd: string): DayVisualState {
    if (ymd === lo || ymd === hi) return 'range-endpoint';
    if (rangeSet.has(ymd)) return 'in-range';
    if (ymd === todayYmd) return 'today';
    return 'default';
  }

  function onDayClick(ymd: string) {
    if (disabled) return;
    if (tapPhase % 2 === 0) {
      onChange({ ...rule, start_date: ymd, end_date: ymd });
    } else {
      const s = rule.start_date;
      const a = ymd < s ? ymd : s;
      const b = ymd < s ? s : ymd;
      onChange({ ...rule, start_date: a, end_date: b });
    }
    setTapPhase((p) => p + 1);
  }

  function toggleDow(dow: number) {
    if (disabled) return;
    const next = rule.days_of_week.includes(dow)
      ? rule.days_of_week.filter((d) => d !== dow)
      : [...rule.days_of_week, dow].sort((a, b) => a - b);
    if (next.length === 0) return;
    onChange({ ...rule, days_of_week: next });
  }

  return (
    <div className="grid min-w-0 max-w-full gap-4 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-start">
      <ServiceAvailabilityMonthGrid
        year={monthNav.year}
        month={monthNav.month}
        todayYmd={todayYmd}
        onPrevMonth={monthNav.prevMonth}
        onNextMonth={monthNav.nextMonth}
        getDayState={getDayState}
        onDayClick={onDayClick}
        disabled={disabled}
        subtitle="Tap twice: start then end"
        footerHint={
          tapPhase % 2 === 0
            ? 'Next tap sets the end date (same day twice = one day only).'
            : 'Next tap starts a new range.'
        }
      />
      <div className="min-w-0 max-w-full space-y-3">
        <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              From
            </label>
            <input
              type="date"
              value={rule.start_date}
              disabled={disabled}
              onChange={(e) =>
                onChange({
                  ...rule,
                  start_date: e.target.value,
                  end_date: e.target.value > rule.end_date ? e.target.value : rule.end_date,
                })
              }
              className="w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm shadow-sm disabled:bg-slate-50"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              To
            </label>
            <input
              type="date"
              value={rule.end_date}
              disabled={disabled}
              onChange={(e) =>
                onChange({
                  ...rule,
                  end_date: e.target.value,
                  start_date: e.target.value < rule.start_date ? e.target.value : rule.start_date,
                })
              }
              className="w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm shadow-sm disabled:bg-slate-50"
            />
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Weekdays
          </p>
          <div className="flex flex-wrap gap-1.5">
            {DAY_ORDER.map(({ key, label }) => {
              const dow = Number(key);
              const on = rule.days_of_week.includes(dow);
              return (
                <button
                  key={key}
                  type="button"
                  disabled={disabled}
                  onClick={() => toggleDow(dow)}
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${
                    on ? 'bg-brand-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  } disabled:opacity-50`}
                >
                  {label.slice(0, 3)}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Time windows
          </p>
          <TimeWindowsEditor
            ranges={rule.ranges}
            disabled={disabled}
            onChange={(ranges) => onChange({ ...rule, ranges })}
          />
        </div>
      </div>
    </div>
  );
}

function PlainLanguageSummary({ schedule }: { schedule: ServiceCustomScheduleV2 }) {
  if (schedule.rules.length === 0) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-3">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        Summary
      </p>
      <ul className="space-y-1 text-xs text-slate-700">
        {schedule.rules.map((rule) => (
          <li key={rule.id} className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0 rounded-full bg-white px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 ring-1 ring-slate-200">
              {RULE_TYPE_META[rule.kind].badge}
            </span>
            <span className="leading-relaxed">{formatServiceCustomRuleSummary(rule)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-slate-500">
        Rules are combined, a time is bookable if any rule allows it (still within venue and
        calendar hours).
      </p>
    </div>
  );
}

// Kept to satisfy existing import paths; no-op helper retained for compatibility.
export { cloneSchedule };
