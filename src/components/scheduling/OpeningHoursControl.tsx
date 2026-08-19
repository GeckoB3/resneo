'use client';

import type { OpeningHoursDaySettings, OpeningHoursSettings } from '@/app/dashboard/settings/types';

const DAYS: { key: string; label: string }[] = [
  { key: '0', label: 'Sunday' },
  { key: '1', label: 'Monday' },
  { key: '2', label: 'Tuesday' },
  { key: '3', label: 'Wednesday' },
  { key: '4', label: 'Thursday' },
  { key: '5', label: 'Friday' },
  { key: '6', label: 'Saturday' },
];

function getDayConfig(oh: OpeningHoursSettings | null, day: string): OpeningHoursDaySettings {
  const d = oh?.[day] as
    | { closed?: boolean; periods?: { open: string; close: string }[]; open?: string; close?: string }
    | undefined;
  if (!d) return { closed: true };
  if (d.periods?.length) return { periods: d.periods };
  if (d.closed === true) return { closed: true };
  if (typeof d.open === 'string' && typeof d.close === 'string') return { periods: [{ open: d.open, close: d.close }] };
  return { closed: true };
}

function cloneOpeningDayConfig(config: OpeningHoursDaySettings): OpeningHoursDaySettings {
  if ('closed' in config && config.closed) return { closed: true };
  if ('periods' in config && config.periods?.length) {
    return { periods: config.periods.map((p) => ({ open: p.open, close: p.close })) };
  }
  return { closed: true };
}

function isOpeningDayOpen(oh: OpeningHoursSettings | null, dayKey: string): boolean {
  const c = oh?.[dayKey] ? getDayConfig(oh, dayKey) : getDayConfig(null, dayKey);
  return !('closed' in c && c.closed);
}

const END_OF_DAY_MIN = 24 * 60 - 1; // 23:59

function toMinutes(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
}

function toHhMm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Is there room in the day for another period after the last one?
 *
 * Without this the Add button clamps against the end of the day and hands back a period
 * identical to the one before it. On a venue closing at 22:00 the second period defaults to
 * 23:00-23:59, and a third then produced 23:00-23:59 again: two identical rows, both valid
 * on their own, neither what anyone asked for. Found by clicking Add twice in the app;
 * nothing in the type system or the schema objects to it.
 */
function canAddPeriod(periods: { open: string; close: string }[]): boolean {
  const last = periods[periods.length - 1];
  if (!last) return true;
  return toMinutes(last.close) + 60 <= END_OF_DAY_MIN;
}

/**
 * A starting point for a newly added period: an hour's gap after the previous one closes,
 * an hour long. Beats a fixed 17:00-22:00, which was wrong for any venue whose second
 * period had already moved past it. Only called when {@link canAddPeriod} is true, so the
 * result can never collide with the period before it.
 */
function nextPeriodAfter(previous: { open: string; close: string } | undefined): { open: string; close: string } {
  const closeMin = previous ? toMinutes(previous.close) : 17 * 60;
  const start = closeMin + 60;
  return { open: toHhMm(start), close: toHhMm(Math.min(start + 60, END_OF_DAY_MIN)) };
}

interface OpeningHoursControlProps {
  value: OpeningHoursSettings;
  onChange: (next: OpeningHoursSettings) => void;
  disabled?: boolean;
}

/**
 * The day's service periods, however many there are.
 *
 * This was hardcoded to a first and an optional second period, which is where the 2-period
 * cap came from: the schema enforced `.max(2)` because this control could not draw a third,
 * and without the cap a stored third period would have been silently dropped on save.
 * Rendering the array removes the reason for the cap (decision (K)).
 */
function PeriodList({
  periods,
  onUpdate,
  onAdd,
  onRemove,
  disabled,
}: {
  periods: { open: string; close: string }[];
  onUpdate: (index: number, field: 'open' | 'close', value: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  disabled: boolean;
}) {
  const canAdd = canAddPeriod(periods);
  const timeInputClass =
    'min-h-10 w-full min-w-0 flex-1 rounded border border-slate-300 px-2 py-2 text-sm sm:w-auto sm:min-w-[7rem] sm:flex-none sm:py-1';

  return (
    <div className="min-w-0 max-w-full space-y-3">
      {periods.map((p, index) => (
        <div key={index} className="flex min-w-0 flex-wrap items-center gap-2">
          <input
            type="time"
            value={p.open}
            onChange={(e) => onUpdate(index, 'open', e.target.value)}
            disabled={disabled}
            className={timeInputClass}
            aria-label={`Period ${index + 1} opens`}
          />
          <span className="text-slate-500">–</span>
          <input
            type="time"
            value={p.close}
            onChange={(e) => onUpdate(index, 'close', e.target.value)}
            disabled={disabled}
            className={timeInputClass}
            aria-label={`Period ${index + 1} closes`}
          />
          {/* Never offer to remove the last period: a day with none is invalid, and
              "closed" is the Open toggle's job, not a side effect of removing a row. */}
          {periods.length > 1 && (
            <button
              type="button"
              onClick={() => onRemove(index)}
              disabled={disabled}
              className="min-h-10 text-sm text-red-600 hover:underline disabled:opacity-50"
            >
              Remove
            </button>
          )}
        </div>
      ))}
      {canAdd ? (
        <button
          type="button"
          onClick={onAdd}
          disabled={disabled}
          className="min-h-10 text-sm text-blue-600 hover:underline disabled:opacity-50"
        >
          + Add period
        </button>
      ) : (
        <p className="text-xs text-slate-500">
          The last period runs to the end of the day, so there is no room for another one.
        </p>
      )}
    </div>
  );
}

/**
 * Controlled venue opening hours, any number of periods per day (decision (K)). Same behaviour as Settings → Business Hours.
 */
export function OpeningHoursControl({ value, onChange, disabled = false }: OpeningHoursControlProps) {
  const setDay = (day: string, config: OpeningHoursDaySettings) => {
    onChange({ ...value, [day]: config });
  };

  function copyThisDayToOtherOpenDays(sourceKey: string) {
    const raw = value[sourceKey] ?? getDayConfig(null, sourceKey);
    if ('closed' in raw && raw.closed) return;
    const template = cloneOpeningDayConfig(raw);
    const otherOpen = DAYS.some(({ key }) => key !== sourceKey && isOpeningDayOpen(value, key));
    if (!otherOpen) return;
    const next: OpeningHoursSettings = { ...value };
    for (const { key } of DAYS) {
      if (key === sourceKey) continue;
      if (isOpeningDayOpen(value, key)) {
        next[key] = cloneOpeningDayConfig(template);
      }
    }
    onChange(next);
  }

  return (
    <div className="min-w-0 max-w-full space-y-3 sm:space-y-4">
      {DAYS.map(({ key, label }) => {
        const config = value[key] ?? getDayConfig(null, key);
        const closed = 'closed' in config && config.closed;
        const periods = !closed && 'periods' in config ? config.periods : [];
        const dayPeriods = periods.length > 0 ? periods : [{ open: '09:00', close: '17:00' }];
        const canCopyElsewhere =
          !closed &&
          !disabled &&
          DAYS.some(({ key: k }) => k !== key && isOpeningDayOpen(value, k));

        return (
          <div key={key} className="min-w-0 max-w-full rounded-xl border border-slate-200 p-3 sm:p-4">
            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex min-w-0 items-center justify-between gap-3">
                <span className="font-medium text-slate-800">{label}</span>
                {!disabled ? (
                  <label className="flex min-h-10 cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!closed}
                      onChange={(e) => {
                        if (e.target.checked) setDay(key, { periods: [{ open: '09:00', close: '17:00' }] });
                        else setDay(key, { closed: true });
                      }}
                      className="h-4 w-4 rounded"
                    />
                    <span className="text-sm">Open</span>
                  </label>
                ) : (
                  <span className="text-sm text-slate-600">
                    {closed ? 'Closed' : dayPeriods.map((p) => `${p.open}–${p.close}`).join(', ')}
                  </span>
                )}
              </div>

              {!closed && !disabled && (
                <div className="space-y-3 border-t border-slate-100 pt-3">
                  {canCopyElsewhere && (
                    <button
                      type="button"
                      onClick={() => copyThisDayToOtherOpenDays(key)}
                      className="min-h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 sm:w-auto"
                      title="Apply this day’s hours to every other day that is set to Open"
                    >
                      Copy to other open days
                    </button>
                  )}
                  <PeriodList
                    periods={dayPeriods}
                    disabled={disabled}
                    onUpdate={(index, field, nextVal) =>
                      setDay(key, {
                        periods: dayPeriods.map((p, i) => (i === index ? { ...p, [field]: nextVal } : p)),
                      })
                    }
                    onAdd={() =>
                      setDay(key, {
                        periods: [...dayPeriods, nextPeriodAfter(dayPeriods[dayPeriods.length - 1])],
                      })
                    }
                    onRemove={(index) =>
                      setDay(key, { periods: dayPeriods.filter((_, i) => i !== index) })
                    }
                  />
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function defaultOpeningHoursSettings(): OpeningHoursSettings {
  const o: OpeningHoursSettings = {};
  for (const k of ['1', '2', '3', '4', '5', '6'] as const) {
    o[k] = { periods: [{ open: '09:00', close: '17:00' }] };
  }
  o['0'] = { closed: true };
  return o;
}
