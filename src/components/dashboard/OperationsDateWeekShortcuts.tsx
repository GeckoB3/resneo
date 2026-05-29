'use client';

import {
  STAFF_BOOKING_WEEK_OFFSETS,
  addWeeksLocalYmd,
} from '@/components/booking/ResourceCalendarMonth';

function formatWeekShortcutLabel(weeks: number, ymd: string): string {
  const d = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return `+${weeks} wk`;
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  return `+${weeks} wk · ${day}`;
}

export interface OperationsDateWeekShortcutsProps {
  /** Currently selected operations date (YYYY-MM-DD). */
  selectedDate: string;
  onSelectDate: (ymd: string) => void;
}

/** Quick-pick +2 … +6 weeks ahead of the selected date (operations toolbar calendar). */
export function OperationsDateWeekShortcuts({
  selectedDate,
  onSelectDate,
}: OperationsDateWeekShortcutsProps) {
  const parsed = new Date(`${selectedDate}T00:00:00`);
  const base = Number.isNaN(parsed.getTime()) ? new Date() : parsed;

  return (
    <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3">
      {STAFF_BOOKING_WEEK_OFFSETS.map((weeks) => {
        const ymd = addWeeksLocalYmd(weeks, base);
        const isSelected = selectedDate === ymd;
        return (
          <button
            key={weeks}
            type="button"
            title={formatWeekShortcutLabel(weeks, ymd)}
            onClick={() => onSelectDate(ymd)}
            className={`rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold transition-colors ${
              isSelected
                ? 'bg-slate-800 text-white shadow-sm'
                : 'bg-slate-100 text-slate-700 hover:bg-brand-50 hover:text-brand-800'
            }`}
          >
            <span className="block tabular-nums">+{weeks} wk</span>
          </button>
        );
      })}
    </div>
  );
}
