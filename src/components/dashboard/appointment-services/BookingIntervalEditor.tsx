'use client';

import { useMemo } from 'react';
import { HelpTooltip } from '@/components/dashboard/HelpTooltip';
import { NumericInput } from '@/components/ui/NumericInput';
import {
  MAX_BOOKING_INTERVAL_MINUTES,
  MIN_BOOKING_INTERVAL_MINUTES,
  bookingIntervalGrid,
  describeBookingStartOffsets,
  normalizeBookingIntervalMinutes,
  sanitizeBookingMinuteMarks,
} from '@/lib/appointments/booking-interval';

export interface BookingIntervalValue {
  booking_interval_minutes: number;
  booking_minute_marks: number[] | null;
}

interface BookingIntervalEditorProps {
  intervalMinutes: number;
  /** `null` = no per-hour restriction (every interval mark is bookable). */
  minuteMarks: number[] | null;
  onChange: (next: BookingIntervalValue) => void;
  /** Distinct per form instance so input ids stay unique. */
  fieldIdSuffix: string;
}

function markLabel(offset: number): string {
  return `:${String(offset).padStart(2, '0')}`;
}

/**
 * Booking interval (1-60 min) plus an optional visual selector for which minute marks within each
 * hour are bookable. Restriction is opt-in; when on, every interval mark for one representative hour
 * is shown as a toggle so a venue can carve out patterns like "first 30 minutes, every 5 minutes" or
 * "on the hour and quarter past only". The pattern repeats every hour, anchored to the top of the hour.
 */
export function BookingIntervalEditor({
  intervalMinutes,
  minuteMarks,
  onChange,
  fieldIdSuffix,
}: BookingIntervalEditorProps) {
  const interval = normalizeBookingIntervalMinutes(intervalMinutes);
  const grid = useMemo(() => bookingIntervalGrid(interval), [interval]);
  const restricted = minuteMarks !== null;
  const selected = useMemo(
    () => new Set(restricted ? sanitizeBookingMinuteMarks(minuteMarks, interval) : grid),
    [restricted, minuteMarks, interval, grid],
  );

  const selectedSorted = useMemo(() => [...selected].sort((a, b) => a - b), [selected]);

  function setInterval(next: number) {
    const nextInterval = normalizeBookingIntervalMinutes(next);
    // Re-anchor any existing restriction to the new grid (drop marks that no longer land on it).
    const nextMarks = restricted ? sanitizeBookingMinuteMarks(minuteMarks, nextInterval) : null;
    onChange({ booking_interval_minutes: nextInterval, booking_minute_marks: nextMarks });
  }

  function setRestricted(on: boolean) {
    onChange({
      booking_interval_minutes: interval,
      // Turning restriction on starts from "all marks selected" so the venue carves marks away.
      booking_minute_marks: on ? [...grid] : null,
    });
  }

  function toggleMark(offset: number) {
    const next = new Set(selected);
    if (next.has(offset)) next.delete(offset);
    else next.add(offset);
    onChange({
      booking_interval_minutes: interval,
      booking_minute_marks: [...next].sort((a, b) => a - b),
    });
  }

  function selectAll() {
    onChange({ booking_interval_minutes: interval, booking_minute_marks: [...grid] });
  }

  function clearAll() {
    onChange({ booking_interval_minutes: interval, booking_minute_marks: [] });
  }

  const noneSelected = restricted && selectedSorted.length === 0;
  const summary =
    selectedSorted.length > 0
      ? describeBookingStartOffsets(selectedSorted)
      : describeBookingStartOffsets(grid);

  return (
    <div className="min-w-0 max-w-full space-y-3 rounded-lg border border-slate-200 p-3">
      <div>
        <p className="text-sm font-medium text-slate-800">Booking interval &amp; start times</p>
        <p className="mt-0.5 text-xs text-slate-500">
          How often a booking can start. Times are anchored to the top of each hour and apply to this
          service&apos;s online bookable slots.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor={`booking-interval-${fieldIdSuffix}`} className="mb-0.5 block text-sm text-slate-700">
            Interval (minutes){' '}
            <HelpTooltip
              maxWidth={300}
              content="The spacing between bookable start times, e.g. 15 means slots at :00, :15, :30, :45. Set any value from 1 to 60 minutes."
            />
          </label>
          <NumericInput
            id={`booking-interval-${fieldIdSuffix}`}
            min={MIN_BOOKING_INTERVAL_MINUTES}
            max={MAX_BOOKING_INTERVAL_MINUTES}
            value={interval}
            onChange={setInterval}
            className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={restricted}
          onChange={(e) => setRestricted(e.target.checked)}
          className="rounded border-slate-300"
        />
        Restrict start times within each hour
        <HelpTooltip
          maxWidth={320}
          content="Off: bookings can start at every interval mark across the hour. On: choose exactly which marks are bookable — e.g. only the first half of the hour, or only on the hour and quarter past."
        />
      </label>

      {restricted && (
        <div className="space-y-2.5 rounded-lg border border-slate-100 bg-slate-50/70 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium text-slate-600">Tap the minutes past the hour when bookings can start:</p>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={selectAll}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={clearAll}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
              >
                Clear
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {grid.map((offset) => {
              const on = selected.has(offset);
              return (
                <button
                  key={offset}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleMark(offset)}
                  className={`min-w-[2.75rem] rounded-full border px-2.5 py-1 text-xs font-semibold tabular-nums transition-colors ${
                    on
                      ? 'border-brand-500 bg-brand-600 text-white shadow-sm'
                      : 'border-slate-300 bg-white text-slate-500 hover:border-slate-400 hover:text-slate-700'
                  }`}
                >
                  {markLabel(offset)}
                </button>
              );
            })}
          </div>
          {noneSelected && (
            <p className="text-[11px] font-medium text-amber-800">
              Select at least one start time, or turn off &quot;Restrict start times&quot; to allow every interval.
            </p>
          )}
        </div>
      )}

      <p className="rounded-lg border border-slate-100 bg-white px-3 py-2 text-xs text-slate-600">
        {noneSelected ? (
          <>No start times selected — bookings will fall back to every {interval}-minute mark.</>
        ) : (
          <>
            Bookings can start at{' '}
            <span className="font-medium text-slate-800">{summary}</span> past each hour.
          </>
        )}
      </p>
    </div>
  );
}
