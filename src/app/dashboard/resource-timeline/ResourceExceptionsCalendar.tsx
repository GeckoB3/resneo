'use client';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export type ExceptionDayValue =
  | { closed: true }
  | { periods: Array<{ start: string; end: string }> }
  | { reducedCapacity: true; maxCovers?: number };

/** Per-calendar closures tab: full day off or a blocked time window (not venue amended opening hours). */
export type CalendarUnavailabilityDayValue =
  | { closed: true }
  | { unavailableWindow: { start: string; end: string } };

export type ResourceExceptionsDisplayMode = 'venue_exceptions' | 'calendar_unavailability';

function isCalendarUnavailabilityValue(
  ex: ExceptionDayValue | CalendarUnavailabilityDayValue,
): ex is CalendarUnavailabilityDayValue {
  return 'unavailableWindow' in ex;
}

function isInSelectionRange(ymd: string, rangeStart: string | null, rangeEnd: string | null): boolean {
  if (!rangeStart) return false;
  if (!rangeEnd) return ymd === rangeStart;
  const a = rangeStart <= rangeEnd ? rangeStart : rangeEnd;
  const b = rangeStart <= rangeEnd ? rangeEnd : rangeStart;
  return ymd >= a && ymd <= b;
}

export function ResourceExceptionsCalendar({
  year,
  month,
  onPrevMonth,
  onNextMonth,
  exceptions,
  rangeStart,
  rangeEnd,
  editingDay,
  onDayClick,
  displayMode = 'venue_exceptions',
}: {
  year: number;
  month: number;
  exceptions: Record<string, ExceptionDayValue | CalendarUnavailabilityDayValue>;
  rangeStart: string | null;
  rangeEnd: string | null;
  editingDay: string | null;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onDayClick: (ymd: string) => void;
  displayMode?: ResourceExceptionsDisplayMode;
}) {
  const calendarMode = displayMode === 'calendar_unavailability';
  const first = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0).getDate();
  const leading = (first.getDay() + 6) % 7;
  const cells: Array<number | null> = [];
  for (let i = 0; i < leading; i++) cells.push(null);
  for (let d = 1; d <= lastDay; d++) cells.push(d);

  const title = `${MONTH_NAMES[month - 1]} ${year}`;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onPrevMonth}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          aria-label="Previous month"
        >
          ←
        </button>
        <div className="text-center text-sm font-semibold text-slate-900">{title}</div>
        <button
          type="button"
          onClick={onNextMonth}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          aria-label="Next month"
        >
          →
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-1">
            {w}
          </div>
        ))}
      </div>

      {/*
        Do not use aspect-square on leading empty cells: it makes height = column width,
        which blows up the first row when the month does not start on Monday.
        Use the same min height as day buttons and uniform grid rows instead.
      */}
      <div className="mt-1 grid grid-cols-7 gap-1 auto-rows-[minmax(2.75rem,auto)]">
        {cells.map((d, idx) => {
          if (d === null) {
            return <div key={`e-${idx}`} className="min-h-[2.75rem]" aria-hidden />;
          }
          const ymd = `${year}-${pad2(month)}-${pad2(d)}`;
          const ex = exceptions[ymd];
          const inRange = isInSelectionRange(ymd, rangeStart, rangeEnd);
          const isEditing = editingDay === ymd;

          let bg = 'bg-white hover:bg-slate-50';
          let ring = 'ring-1 ring-slate-200';
          if (ex) {
            if ('closed' in ex) {
              bg = 'bg-red-50 hover:bg-red-100';
              ring = 'ring-1 ring-red-200';
            } else if (calendarMode && isCalendarUnavailabilityValue(ex) && 'unavailableWindow' in ex) {
              bg = 'bg-rose-50 hover:bg-rose-100';
              ring = 'ring-1 ring-rose-200';
            } else if ('reducedCapacity' in ex) {
              bg = 'bg-orange-50 hover:bg-orange-100';
              ring = 'ring-1 ring-orange-200';
            } else {
              bg = 'bg-amber-50 hover:bg-amber-100';
              ring = 'ring-1 ring-amber-200';
            }
          }
          if (inRange && !isEditing) {
            ring = 'ring-2 ring-brand-500 ring-offset-1';
          }
          if (isEditing) {
            ring = 'ring-2 ring-slate-900 ring-offset-1';
          }

          const label = ex
            ? 'closed' in ex
              ? 'Closed'
              : calendarMode && isCalendarUnavailabilityValue(ex) && 'unavailableWindow' in ex
                ? `Unavailable ${ex.unavailableWindow.start}–${ex.unavailableWindow.end}`
                : 'reducedCapacity' in ex
                  ? `Reduced capacity${ex.maxCovers != null ? ` (${ex.maxCovers} covers)` : ''}`
                  : 'periods' in ex
                    ? `Amended hours ${ex.periods[0]?.start ?? ''}–${ex.periods[0]?.end ?? ''}`
                    : ''
            : inRange
              ? 'Selected for new range'
              : '';

          return (
            <button
              key={ymd}
              type="button"
              onClick={() => onDayClick(ymd)}
              className={`flex min-h-[2.75rem] flex-col items-center justify-center rounded-md px-0.5 text-xs font-medium text-slate-800 transition ${bg} ${ring}`}
              title={label}
              aria-label={`${ymd}${label ? `. ${label}` : ''}`}
              aria-pressed={isEditing || inRange}
            >
              <span>{d}</span>
              {ex && (
                <span className="mt-0.5 max-w-full truncate px-0.5 text-[9px] font-normal leading-tight text-slate-600">
                  {'closed' in ex
                    ? 'Off'
                    : calendarMode && isCalendarUnavailabilityValue(ex) && 'unavailableWindow' in ex
                      ? 'Block'
                      : 'reducedCapacity' in ex
                        ? 'Cap'
                        : 'Hrs'}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded border border-red-200 bg-red-50" aria-hidden />
          Closed
        </span>
        {calendarMode ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded border border-rose-200 bg-rose-50" aria-hidden />
            Unavailable window
          </span>
        ) : (
          <>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded border border-amber-200 bg-amber-50" aria-hidden />
              Amended hours
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded border border-orange-200 bg-orange-50" aria-hidden />
              Reduced capacity
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded border-2 border-brand-500 bg-white" aria-hidden />
              New range
            </span>
          </>
        )}
      </div>
    </div>
  );
}
