'use client';

/**
 * The one weekly-hours editor (decision (K)).
 *
 * There were three: `OpeningHoursControl` for venue hours, `WorkingHoursControl` for
 * calendar hours, and an inline one in `resource-timeline-ui`. They agreed on the copy-day
 * rule by coincidence rather than construction, which is exactly the pattern that produced
 * the six working-hours implementations Stage 5 collapsed. This is the shared one; the
 * others become thin adapters over it.
 *
 * IT OWNS THE SHAPE, NOT THE STORAGE. Callers hand it a normalised week and convert on the
 * way in and out, because the two stored formats genuinely differ: venue hours use
 * `{ closed: true } | { periods: [{ open, close }] }`, calendar hours use a bare
 * `[{ start, end }]` where absent means not working. Normalising here rather than migrating
 * either format keeps this a UI change with no data migration attached.
 *
 * `null` for a day means closed / not working. An empty array is NOT a valid value: a day
 * that is open needs at least one period, and closing a day is the toggle's job.
 *
 * See Docs/Resneo_Scheduling_Resolver_Plan_August_2026.md §4 Stage 6a, decision (K).
 */

export interface HoursPeriod {
  open: string;
  close: string;
}

/** `null` = closed / not working that day. */
export type NormalisedWeek = Record<string, HoursPeriod[] | null>;

export interface WeeklyHoursEditorDay {
  key: string;
  label: string;
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
 * 23:00-23:59, and a third produced 23:00-23:59 again: two identical rows, both valid on
 * their own, neither what anyone asked for. Found by clicking Add twice in the app; nothing
 * in the types, the schema or the suite objects to it.
 */
export function canAddPeriod(periods: readonly HoursPeriod[]): boolean {
  const last = periods[periods.length - 1];
  if (!last) return true;
  return toMinutes(last.close) + 60 <= END_OF_DAY_MIN;
}

/**
 * A starting point for a newly added period: an hour's gap after the previous one closes,
 * an hour long. Beats a fixed default, which is wrong for any venue whose last period has
 * moved past it. Only called when {@link canAddPeriod} is true, so it cannot collide with
 * the period before it.
 */
export function nextPeriodAfter(previous: HoursPeriod | undefined, fallbackOpen = '09:00'): HoursPeriod {
  if (!previous) return { open: fallbackOpen, close: '17:00' };
  const start = toMinutes(previous.close) + 60;
  return { open: toHhMm(start), close: toHhMm(Math.min(start + 60, END_OF_DAY_MIN)) };
}

function clonePeriods(periods: readonly HoursPeriod[]): HoursPeriod[] {
  return periods.map((p) => ({ open: p.open, close: p.close }));
}

interface WeeklyHoursEditorProps {
  days: readonly WeeklyHoursEditorDay[];
  value: NormalisedWeek;
  onChange: (next: NormalisedWeek) => void;
  disabled?: boolean;
  /** Wording differs between the venue and calendar screens; behaviour does not. */
  addLabel?: string;
  openLabel?: string;
  separator?: string;
  defaultPeriod?: HoursPeriod;
}

export function WeeklyHoursEditor({
  days,
  value,
  onChange,
  disabled = false,
  addLabel = '+ Add period',
  openLabel = 'Open',
  separator = '–',
  defaultPeriod = { open: '09:00', close: '17:00' },
}: WeeklyHoursEditorProps) {
  const timeInputClass =
    'min-h-10 w-full min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-2 text-sm disabled:bg-slate-50 sm:w-auto sm:min-w-[7rem] sm:flex-none sm:py-1';

  function setDay(key: string, periods: HoursPeriod[] | null) {
    onChange({ ...value, [key]: periods });
  }

  function isOpen(key: string): boolean {
    const p = value[key];
    return Array.isArray(p) && p.length > 0;
  }

  function copyToOtherOpenDays(sourceKey: string) {
    const source = value[sourceKey];
    if (!source?.length) return;
    if (!days.some((d) => d.key !== sourceKey && isOpen(d.key))) return;

    const next: NormalisedWeek = { ...value };
    for (const d of days) {
      if (d.key === sourceKey) continue;
      if (isOpen(d.key)) next[d.key] = clonePeriods(source);
    }
    onChange(next);
  }

  return (
    <div className="min-w-0 max-w-full space-y-3">
      {days.map(({ key, label }) => {
        const periods = value[key];
        const open = Array.isArray(periods) && periods.length > 0;
        const dayPeriods = open ? periods : [];
        const canCopy = open && !disabled && days.some((d) => d.key !== key && isOpen(d.key));

        return (
          <div
            key={key}
            className="min-w-0 max-w-full rounded-xl border border-slate-200 bg-white px-3 py-3 sm:px-4"
          >
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <label className="flex min-h-10 cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={open}
                  onChange={() => setDay(key, open ? null : [{ ...defaultPeriod }])}
                  disabled={disabled}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 disabled:opacity-50"
                />
                <span className={`text-sm font-medium ${open ? 'text-slate-900' : 'text-slate-400'}`}>
                  {label}
                </span>
              </label>

              {open && !disabled && canCopy && (
                <button
                  type="button"
                  onClick={() => copyToOtherOpenDays(key)}
                  className="min-h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 sm:w-auto"
                  title={`Apply this day's hours to every other day that is set to ${openLabel}`}
                >
                  Copy to other open days
                </button>
              )}
            </div>

            {open && (
              <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 sm:border-t-0 sm:pl-7 sm:pt-2">
                {dayPeriods.map((p, index) => (
                  <div key={index} className="flex min-w-0 flex-wrap items-center gap-2">
                    <input
                      type="time"
                      value={p.open}
                      onChange={(e) =>
                        setDay(
                          key,
                          dayPeriods.map((q, i) => (i === index ? { ...q, open: e.target.value } : q)),
                        )
                      }
                      disabled={disabled}
                      className={timeInputClass}
                      aria-label={`${label} period ${index + 1} opens`}
                    />
                    <span className="text-sm text-slate-400">{separator}</span>
                    <input
                      type="time"
                      value={p.close}
                      onChange={(e) =>
                        setDay(
                          key,
                          dayPeriods.map((q, i) => (i === index ? { ...q, close: e.target.value } : q)),
                        )
                      }
                      disabled={disabled}
                      className={timeInputClass}
                      aria-label={`${label} period ${index + 1} closes`}
                    />
                    {/* Never offer to remove the last period: a day with none is invalid,
                        and closing a day is the toggle's job, not a side effect here. */}
                    {dayPeriods.length > 1 && !disabled && (
                      <button
                        type="button"
                        onClick={() => setDay(key, dayPeriods.filter((_, i) => i !== index))}
                        className="min-h-10 text-xs text-red-500 hover:underline"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}

                {!disabled &&
                  (canAddPeriod(dayPeriods) ? (
                    <button
                      type="button"
                      onClick={() =>
                        setDay(key, [
                          ...dayPeriods,
                          nextPeriodAfter(dayPeriods[dayPeriods.length - 1], defaultPeriod.open),
                        ])
                      }
                      className="min-h-10 text-left text-xs text-blue-600 hover:underline sm:min-h-0"
                    >
                      {addLabel}
                    </button>
                  ) : (
                    <p className="text-xs text-slate-500">
                      The last period runs to the end of the day, so there is no room for another one.
                    </p>
                  ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
