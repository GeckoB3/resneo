'use client';

import { useMemo, useState } from 'react';
import { HelpTooltip } from '@/components/dashboard/HelpTooltip';
import { NumericInput } from '@/components/ui/NumericInput';
import {
  MAX_BOOKING_INTERVAL_MINUTES,
  MIN_BOOKING_INTERVAL_MINUTES,
  bookingIntervalGrid,
  bookingStartTimesToMinutes,
  describeBookingStartOffsets,
  describeBookingStartTimes,
  normalizeBookingIntervalMinutes,
  sanitizeBookingMinuteMarks,
  sanitizeBookingStartTimes,
} from '@/lib/appointments/booking-interval';

export interface BookingIntervalValue {
  booking_interval_minutes: number;
  booking_minute_marks: number[] | null;
  booking_start_times: string[] | null;
}

interface BookingIntervalEditorProps {
  intervalMinutes: number;
  /** `null` = no per-hour restriction (every interval mark is bookable). */
  minuteMarks: number[] | null;
  /** `null` = interval mode. Any list, including an empty one, means fixed times of day. */
  startTimes: string[] | null;
  /** Duration + buffer, used to warn when fixed times are closer together than the appointment. */
  spanMinutes: number;
  onChange: (next: BookingIntervalValue) => void;
  /** Distinct per form instance so input ids stay unique. */
  fieldIdSuffix: string;
}

function markLabel(offset: number): string {
  return `:${String(offset).padStart(2, '0')}`;
}

/** First pair of consecutive fixed times closer together than one appointment takes. */
function findTooCloseTimes(
  times: string[],
  spanMinutes: number,
): { earlier: string; later: string } | null {
  const minutes = bookingStartTimesToMinutes(times);
  for (let i = 1; i < minutes.length; i++) {
    if (minutes[i]! - minutes[i - 1]! < spanMinutes) {
      return { earlier: times[i - 1]!, later: times[i]! };
    }
  }
  return null;
}

/**
 * How a service offers start times, in one of two modes.
 *
 * Interval: a spacing of 1-60 minutes anchored to the top of the hour, plus an optional selector for
 * which minute marks within each hour are bookable, so a venue can carve out patterns like "first 30
 * minutes, every 5 minutes" or "on the hour and quarter past". The pattern repeats every hour.
 *
 * Fixed times: the exact times of day this service is offered, for businesses that take a handful of
 * bookings a day at times that do not repeat hourly (9:20, 11:30, 1:45, 3:30). Those times still sit
 * inside venue hours, calendar hours and any custom schedule, so a shorter day offers fewer of them.
 */
export function BookingIntervalEditor({
  intervalMinutes,
  minuteMarks,
  startTimes,
  spanMinutes,
  onChange,
  fieldIdSuffix,
}: BookingIntervalEditorProps) {
  const interval = normalizeBookingIntervalMinutes(intervalMinutes);
  const grid = useMemo(() => bookingIntervalGrid(interval), [interval]);
  const usesFixedTimes = startTimes !== null;
  const restricted = minuteMarks !== null;
  const selected = useMemo(
    () => new Set(restricted ? sanitizeBookingMinuteMarks(minuteMarks, interval) : grid),
    [restricted, minuteMarks, interval, grid],
  );

  const selectedSorted = useMemo(() => [...selected].sort((a, b) => a - b), [selected]);

  // Remembered so switching modes to look at the other one is not destructive.
  const [rememberedTimes, setRememberedTimes] = useState<string[]>(() => startTimes ?? []);

  const rows = startTimes ?? [];
  const validTimes = sanitizeBookingStartTimes(rows);
  const filledRows = rows.filter((t) => t.trim().length > 0);
  const tooClose = findTooCloseTimes(validTimes, spanMinutes);

  function setMode(next: 'interval' | 'fixed') {
    if (next === 'fixed') {
      const seed = rememberedTimes.length > 0 ? rememberedTimes : [''];
      onChange({
        booking_interval_minutes: interval,
        booking_minute_marks: minuteMarks,
        booking_start_times: seed,
      });
      return;
    }
    onChange({
      booking_interval_minutes: interval,
      booking_minute_marks: minuteMarks,
      booking_start_times: null,
    });
  }

  function setTimes(next: string[]) {
    setRememberedTimes(next);
    onChange({
      booking_interval_minutes: interval,
      booking_minute_marks: minuteMarks,
      booking_start_times: next,
    });
  }

  function setInterval(next: number) {
    const nextInterval = normalizeBookingIntervalMinutes(next);
    // Re-anchor any existing restriction to the new grid (drop marks that no longer land on it).
    const nextMarks = restricted ? sanitizeBookingMinuteMarks(minuteMarks, nextInterval) : null;
    onChange({
      booking_interval_minutes: nextInterval,
      booking_minute_marks: nextMarks,
      booking_start_times: startTimes,
    });
  }

  function setRestricted(on: boolean) {
    onChange({
      booking_interval_minutes: interval,
      // Turning restriction on starts from "all marks selected" so the venue carves marks away.
      booking_minute_marks: on ? [...grid] : null,
      booking_start_times: startTimes,
    });
  }

  function toggleMark(offset: number) {
    const next = new Set(selected);
    if (next.has(offset)) next.delete(offset);
    else next.add(offset);
    onChange({
      booking_interval_minutes: interval,
      booking_minute_marks: [...next].sort((a, b) => a - b),
      booking_start_times: startTimes,
    });
  }

  function selectAll() {
    onChange({
      booking_interval_minutes: interval,
      booking_minute_marks: [...grid],
      booking_start_times: startTimes,
    });
  }

  function clearAll() {
    onChange({
      booking_interval_minutes: interval,
      booking_minute_marks: [],
      booking_start_times: startTimes,
    });
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
          When a booking can start. This applies to this service&apos;s online bookable slots.
        </p>
      </div>

      <div className="space-y-1.5">
        <ModeOption
          name={`booking-start-mode-${fieldIdSuffix}`}
          checked={!usesFixedTimes}
          onSelect={() => setMode('interval')}
          title="Repeat every few minutes"
          description="Slots run through the day on a set spacing, anchored to the top of each hour."
        />
        <ModeOption
          name={`booking-start-mode-${fieldIdSuffix}`}
          checked={usesFixedTimes}
          onSelect={() => setMode('fixed')}
          title="Fixed times of day"
          description="You name the exact times, for example 9:20, 11:30, 1:45 and 3:30."
        />
      </div>

      {!usesFixedTimes && (
        <>
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
              content="Off: bookings can start at every interval mark across the hour. On: choose exactly which marks are bookable, e.g. only the first half of the hour, or only on the hour and quarter past."
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
              <>No start times selected, so bookings will fall back to every {interval}-minute mark.</>
            ) : (
              <>
                Bookings can start at{' '}
                <span className="font-medium text-slate-800">{summary}</span> past each hour.
              </>
            )}
          </p>
        </>
      )}

      {usesFixedTimes && (
        <>
          <div className="space-y-2.5 rounded-lg border border-slate-100 bg-slate-50/70 p-3">
            <p className="text-xs font-medium text-slate-600">
              Times this service is offered:{' '}
              <HelpTooltip
                maxWidth={340}
                content="Guests are only offered these times. Each one still has to fit inside your opening hours, the calendar's working hours and any custom schedule below, so a shorter day simply offers fewer of them."
              />
            </p>
            <div className="space-y-2">
              {rows.map((time, i) => (
                <div key={i} className="flex min-w-0 flex-wrap items-center gap-2">
                  <input
                    type="time"
                    value={time}
                    aria-label={`Start time ${i + 1}`}
                    onChange={(e) => {
                      const next = [...rows];
                      next[i] = e.target.value;
                      setTimes(next);
                    }}
                    className="min-w-0 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800 shadow-sm"
                  />
                  {rows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setTimes(rows.filter((_, j) => j !== i))}
                      className="text-xs font-medium text-red-600 hover:underline"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setTimes([...rows, ''])}
              className="text-xs font-semibold text-brand-600 hover:text-brand-700"
            >
              + Add a time
            </button>
            {validTimes.length === 0 && (
              <p className="text-[11px] font-medium text-amber-800">
                Add at least one time, or switch back to &quot;Repeat every few minutes&quot;.
              </p>
            )}
            {filledRows.length > validTimes.length && (
              <p className="text-[11px] text-slate-500">
                Repeated times are only counted once.
              </p>
            )}
            {tooClose && (
              <p className="text-[11px] font-medium text-amber-800">
                {describeBookingStartTimes([tooClose.earlier])} and {describeBookingStartTimes([tooClose.later])} are
                closer together than this service takes ({spanMinutes} minutes), so guests will usually only be offered
                one of them.
              </p>
            )}
          </div>

          <p className="rounded-lg border border-slate-100 bg-white px-3 py-2 text-xs text-slate-600">
            {validTimes.length === 0 ? (
              <>No times set yet, so bookings will fall back to every {interval}-minute mark.</>
            ) : (
              <>
                Bookings can start at{' '}
                <span className="font-medium text-slate-800">{describeBookingStartTimes(validTimes)}</span>.
              </>
            )}
          </p>
        </>
      )}
    </div>
  );
}

function ModeOption({
  name,
  checked,
  onSelect,
  title,
  description,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  title: string;
  description: string;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 transition ${
        checked ? 'border-brand-300 bg-brand-50/50' : 'border-slate-200 bg-white hover:border-slate-300'
      }`}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        className="mt-0.5 text-brand-600 focus:ring-brand-500"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-800">{title}</span>
        <span className="mt-0.5 block text-xs text-slate-500">{description}</span>
      </span>
    </label>
  );
}
