'use client';

import type { WorkingHours } from '@/types/booking-models';
import type { ReactNode } from 'react';
import {
  WeeklyHoursEditor,
  type HoursPeriod,
  type NormalisedWeek,
  type WeeklyHoursEditorDay,
} from '@/components/scheduling/WeeklyHoursEditor';

/**
 * Calendar working hours, as an adapter over the shared {@link WeeklyHoursEditor}
 * (decision (K), step 4).
 *
 * The only thing this file still owns is the storage shape. `WorkingHours` is a bare
 * `{ [day]: [{ start, end }] }` where an ABSENT KEY means not working, and the previous
 * implementation deleted the key rather than storing an empty array. That is preserved
 * exactly: `toWorkingHours` omits closed days rather than writing `[]`, because callers
 * persist this object as-is and an empty array is not the same stored value.
 */

const DAYS: WeeklyHoursEditorDay[] = [
  { key: '1', label: 'Monday' },
  { key: '2', label: 'Tuesday' },
  { key: '3', label: 'Wednesday' },
  { key: '4', label: 'Thursday' },
  { key: '5', label: 'Friday' },
  { key: '6', label: 'Saturday' },
  { key: '0', label: 'Sunday' },
];

function toNormalised(value: WorkingHours): NormalisedWeek {
  const out: NormalisedWeek = {};
  for (const { key } of DAYS) {
    const ranges = value[key];
    out[key] = ranges?.length ? ranges.map((r) => ({ open: r.start, close: r.end })) : null;
  }
  return out;
}

function toWorkingHours(next: NormalisedWeek, previous: WorkingHours): WorkingHours {
  // Start from the previous object so any key outside DAYS survives untouched rather than
  // being dropped by an editor that never displayed it.
  const out: WorkingHours = { ...previous };
  for (const { key } of DAYS) {
    const periods = next[key];
    if (periods?.length) out[key] = periods.map((p) => ({ start: p.open, end: p.close }));
    else delete out[key];
  }
  return out;
}

/**
 * Controlled working-hours editor (Mon–Sun, keys "1".."6","0"). Matches dashboard
 * Availability behaviour.
 */
export function WorkingHoursControl({
  value,
  onChange,
  disabled = false,
  renderDayContext,
}: {
  value: WorkingHours;
  onChange: (next: WorkingHours) => void;
  disabled?: boolean;
  /** Venue-hours context per day (decision (K), step 6). */
  renderDayContext?: (dayKey: string, periods: HoursPeriod[] | null) => ReactNode;
}) {
  return (
    <WeeklyHoursEditor
      days={DAYS}
      value={toNormalised(value)}
      onChange={(next) => onChange(toWorkingHours(next, value))}
      disabled={disabled}
      addLabel="+ Add split"
      openLabel="working"
      separator="to"
      renderDayContext={renderDayContext}
    />
  );
}
