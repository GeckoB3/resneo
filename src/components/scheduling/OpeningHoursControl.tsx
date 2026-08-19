'use client';

import type { OpeningHoursDaySettings, OpeningHoursSettings } from '@/app/dashboard/settings/types';
import {
  WeeklyHoursEditor,
  type NormalisedWeek,
  type WeeklyHoursEditorDay,
} from '@/components/scheduling/WeeklyHoursEditor';

/**
 * Venue opening hours, as an adapter over the shared {@link WeeklyHoursEditor}
 * (decision (K), step 3).
 *
 * The only thing this file still owns is the storage shape, which is genuinely different
 * from the calendar one: a day is `{ closed: true }` or `{ periods: [{ open, close }] }`,
 * and the LEGACY single `{ open, close }` form still has to be read (it is normalised to a
 * one-period day on the way in, exactly as before).
 *
 * The 2-period cap is gone. It existed because the old implementation rendered `periods[0]`
 * and `periods[1]` and could not draw a third, so `openingHoursDaySchema`'s `.max(2)` was
 * what stopped that truncation silently dropping a period on save. Both are removed.
 */

const DAYS: WeeklyHoursEditorDay[] = [
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

function toNormalised(value: OpeningHoursSettings): NormalisedWeek {
  const out: NormalisedWeek = {};
  for (const { key } of DAYS) {
    const config = getDayConfig(value, key);
    out[key] = 'periods' in config && config.periods?.length
      ? config.periods.map((p) => ({ open: p.open, close: p.close }))
      : null;
  }
  return out;
}

function toOpeningHours(next: NormalisedWeek, previous: OpeningHoursSettings): OpeningHoursSettings {
  const out: OpeningHoursSettings = { ...previous };
  for (const { key } of DAYS) {
    const periods = next[key];
    out[key] = periods?.length
      ? { periods: periods.map((p) => ({ open: p.open, close: p.close })) }
      : { closed: true };
  }
  return out;
}

interface OpeningHoursControlProps {
  value: OpeningHoursSettings;
  onChange: (next: OpeningHoursSettings) => void;
  disabled?: boolean;
}

/**
 * Controlled venue opening hours, any number of periods per day (decision (K)). Same
 * behaviour as Settings → Business Hours.
 */
export function OpeningHoursControl({ value, onChange, disabled = false }: OpeningHoursControlProps) {
  return (
    <WeeklyHoursEditor
      days={DAYS}
      value={toNormalised(value)}
      onChange={(next) => onChange(toOpeningHours(next, value))}
      disabled={disabled}
    />
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
