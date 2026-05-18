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

/** Today in local timezone as YYYY-MM-DD. */
export function todayYmdLocal(): string {
  const t = new Date();
  return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;
}

export function ResourceCalendarMonth({
  year,
  month,
  availableDates,
  selectedDate,
  onSelectDate,
  onPrevMonth,
  onNextMonth,
  minSelectableDate,
  loading = false,
}: {
  year: number;
  month: number;
  availableDates: Set<string>;
  selectedDate: string | null;
  onSelectDate: (ymd: string) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  /** First date users may book (inclusive), YYYY-MM-DD. */
  minSelectableDate: string;
  loading?: boolean;
}) {
  const first = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0).getDate();
  const leading = (first.getDay() + 6) % 7;
  const cells: Array<number | null> = [];
  for (let i = 0; i < leading; i++) cells.push(null);
  for (let d = 1; d <= lastDay; d++) cells.push(d);

  const title = `${MONTH_NAMES[month - 1]} ${year}`;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm" aria-busy={loading}>
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

      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-1">
            {w}
          </div>
        ))}
      </div>

      <div
        className={`mt-1 grid grid-cols-7 gap-0.5 transition-opacity ${loading ? 'animate-pulse opacity-90' : ''}`}
      >
        {cells.map((d, idx) => {
          if (d === null) {
            return <div key={`e-${idx}`} className="aspect-square" aria-hidden />;
          }
          const ymd = `${year}-${pad2(month)}-${pad2(d)}`;
          const isPast = ymd < minSelectableDate;
          const hasAvail = availableDates.has(ymd);
          const isSelected = selectedDate === ymd;
          const disabled = isPast || !hasAvail;

          let cellClass =
            'flex aspect-square items-center justify-center rounded-md text-sm font-medium transition ';
          if (disabled) {
            cellClass += isPast ? 'cursor-not-allowed text-slate-300 ' : 'cursor-not-allowed bg-slate-50 text-slate-400 ';
          } else if (isSelected) {
            cellClass += 'ap-cal-selected ';
          } else if (hasAvail) {
            cellClass +=
              'cursor-pointer bg-emerald-50 text-emerald-900 ring-1 ring-emerald-300 hover:bg-emerald-100 ';
          } else {
            cellClass += 'text-slate-400 ';
          }

          return (
            <button
              key={ymd}
              type="button"
              disabled={disabled}
              onClick={() => {
                if (!disabled) onSelectDate(ymd);
              }}
              className={cellClass}
              aria-label={`${ymd}${hasAvail && !isPast ? ', has availability' : ''}${isSelected ? ', selected' : ''}`}
              aria-pressed={isSelected}
            >
              {d}
            </button>
          );
        })}
      </div>

      <p className="mt-3 text-xs text-slate-500">
        <span className="mr-2 inline-block h-2 w-2 rounded-sm bg-emerald-400 align-middle" aria-hidden />
        Day has availability
      </p>
    </div>
  );
}
