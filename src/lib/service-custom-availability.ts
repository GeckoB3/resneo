/**
 * Per-service online availability: intersected with venue + practitioner calendar in the appointment engine.
 * Supports legacy weekly maps and v2 rule sets (weekly + specific dates + date-range patterns, unioned).
 */

import type {
  AppointmentService,
  ServiceCustomRule,
  ServiceCustomScheduleStored,
  ServiceCustomScheduleV2,
  TimeRange,
  WorkingHours,
} from '@/types/booking-models';
import type { OpeningHours } from '@/types/availability';
import { getDayOfWeek } from '@/lib/availability/engine';
import { minutesToTime, timeToMinutes } from '@/lib/availability';
import type { AvailabilityBlock } from '@/types/availability';
import { resolveVenueWideAllowedMinuteRanges } from '@/lib/availability/venue-wide-business-hours';

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export const DAY_ORDER: Array<{ key: string; label: string }> = [
  { key: '1', label: 'Monday' },
  { key: '2', label: 'Tuesday' },
  { key: '3', label: 'Wednesday' },
  { key: '4', label: 'Thursday' },
  { key: '5', label: 'Friday' },
  { key: '6', label: 'Saturday' },
  { key: '0', label: 'Sunday' },
];

function dayKeyForDate(dateStr: string): string {
  return String(getDayOfWeek(dateStr));
}

function dayNameForDate(dateStr: string): string {
  const dow = getDayOfWeek(dateStr);
  return DAY_NAMES[dow]!;
}

function compareIsoDate(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function isServiceCustomScheduleV2(x: unknown): x is ServiceCustomScheduleV2 {
  return (
    x !== null &&
    typeof x === 'object' &&
    !Array.isArray(x) &&
    (x as ServiceCustomScheduleV2).version === 2 &&
    Array.isArray((x as ServiceCustomScheduleV2).rules)
  );
}

export function isServiceCustomScheduleEmpty(s: ServiceCustomScheduleStored | null | undefined): boolean {
  if (s == null) return true;
  if (isServiceCustomScheduleV2(s)) return s.rules.length === 0;
  return Object.keys(s as WorkingHours).length === 0;
}

export function newRuleId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `r-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Editor bootstrap: legacy weekly map → v2; empty → no rules (user adds blocks explicitly). */
export function toServiceCustomScheduleV2(
  stored: ServiceCustomScheduleStored | Record<string, never>,
): ServiceCustomScheduleV2 {
  if (isServiceCustomScheduleV2(stored)) {
    return JSON.parse(JSON.stringify(stored)) as ServiceCustomScheduleV2;
  }
  const wh = stored as WorkingHours;
  if (wh && Object.keys(wh).length > 0) {
    return { version: 2, rules: [{ id: newRuleId(), kind: 'weekly', windows: JSON.parse(JSON.stringify(wh)) }] };
  }
  return { version: 2, rules: [] };
}

function rangesToMinutes(ranges: TimeRange[]): Array<{ start: number; end: number }> {
  return ranges.map((r) => ({
    start: timeToMinutes(String(r.start).slice(0, 5)),
    end: timeToMinutes(String(r.end).slice(0, 5)),
  }));
}

function minuteRangesForRuleOnDate(rule: ServiceCustomRule, dateStr: string): Array<{ start: number; end: number }> {
  const dow = getDayOfWeek(dateStr);
  switch (rule.kind) {
    case 'weekly':
      return getMinuteRangesFromWorkingHoursForDate(rule.windows, dateStr);
    case 'specific_dates': {
      const out: Array<{ start: number; end: number }> = [];
      for (const e of rule.entries) {
        if (e.date === dateStr) out.push(...rangesToMinutes(e.ranges));
      }
      return out;
    }
    case 'date_range_pattern': {
      if (compareIsoDate(dateStr, rule.start_date) < 0 || compareIsoDate(dateStr, rule.end_date) > 0) return [];
      if (!rule.days_of_week.includes(dow)) return [];
      return rangesToMinutes(rule.ranges);
    }
    default:
      return [];
  }
}

/**
 * Union of all service custom rules for a calendar date (minutes since midnight).
 */
export function getServiceCustomMinuteRangesForDate(
  schedule: ServiceCustomScheduleStored | null | undefined,
  dateStr: string,
): Array<{ start: number; end: number }> {
  if (!schedule) return [];
  if (isServiceCustomScheduleV2(schedule)) {
    const all: Array<{ start: number; end: number }> = [];
    for (const rule of schedule.rules) {
      all.push(...minuteRangesForRuleOnDate(rule, dateStr));
    }
    return mergeUnionRanges(all);
  }
  return getMinuteRangesFromWorkingHoursForDate(schedule as WorkingHours, dateStr);
}

/** Minute ranges for one calendar date from a WorkingHours map (keys "0"–"6" or sun–sat). */
export function getMinuteRangesFromWorkingHoursForDate(
  wh: WorkingHours | null | undefined,
  dateStr: string,
): Array<{ start: number; end: number }> {
  if (!wh || typeof wh !== 'object') return [];
  const dayKey = dayKeyForDate(dateStr);
  const dayName = dayNameForDate(dateStr);
  const ranges = wh[dayKey] ?? wh[dayName];
  if (!ranges || !Array.isArray(ranges) || ranges.length === 0) return [];
  return ranges.map((r) => ({
    start: timeToMinutes(String(r.start).slice(0, 5)),
    end: timeToMinutes(String(r.end).slice(0, 5)),
  }));
}

/** Intersect two lists of [start,end) minute ranges (same as appointment-engine). */
export function intersectMinuteRanges(
  a: Array<{ start: number; end: number }>,
  b: Array<{ start: number; end: number }>,
): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  for (const ra of a) {
    for (const rb of b) {
      const s = Math.max(ra.start, rb.start);
      const e = Math.min(ra.end, rb.end);
      if (s < e) out.push({ start: s, end: e });
    }
  }
  return out.sort((x, y) => x.start - y.start);
}

/**
 * After venue + calendar clipping: optionally intersect with per-service schedule (weekly and/or v2 rules).
 */
export function intersectEffectiveRangesWithServiceCustom(
  effectiveWorkingRanges: Array<{ start: number; end: number }>,
  svc: AppointmentService,
  dateStr: string,
): Array<{ start: number; end: number }> {
  if (!svc.custom_availability_enabled || !svc.custom_working_hours) {
    return effectiveWorkingRanges;
  }
  const custom = getServiceCustomMinuteRangesForDate(svc.custom_working_hours, dateStr);
  if (custom.length === 0) return [];
  return intersectMinuteRanges(effectiveWorkingRanges, custom);
}

/** Human-readable summary for UI (legacy weekly map). */
export function formatWorkingHoursSummary(wh: WorkingHours | null | undefined): string {
  if (!wh || typeof wh !== 'object') return 'No custom hours set.';
  const parts: string[] = [];
  for (const { key, label } of DAY_ORDER) {
    const ranges = wh[key];
    if (!ranges?.length) continue;
    const seg = ranges.map((r) => `${r.start}–${r.end}`).join(', ');
    parts.push(`${label}: ${seg}`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'Closed every day.';
}

function friendlyIsoDate(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  const d = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

/** Short human-readable description of a single rule (single line). */
export function formatServiceCustomRuleSummary(rule: ServiceCustomRule): string {
  switch (rule.kind) {
    case 'weekly': {
      const days = DAY_ORDER.filter(({ key }) => (rule.windows[key]?.length ?? 0) > 0);
      if (days.length === 0) return 'Weekly: no days selected yet.';
      return days
        .map(({ key, label }) => {
          const ranges = rule.windows[key] ?? [];
          const seg = ranges.map((r) => `${r.start}–${r.end}`).join(', ');
          return `${label.slice(0, 3)} ${seg}`;
        })
        .join(' · ');
    }
    case 'specific_dates': {
      if (rule.entries.length === 0) return 'No dates added yet.';
      const shown = rule.entries
        .slice(0, 3)
        .map((e) => `${friendlyIsoDate(e.date)} ${e.ranges.map((r) => `${r.start}–${r.end}`).join(', ')}`);
      const extra = rule.entries.length > 3 ? ` + ${rule.entries.length - 3} more` : '';
      return `${shown.join(' · ')}${extra}`;
    }
    case 'date_range_pattern': {
      const days = [...rule.days_of_week].sort((a, b) => a - b);
      const dayLabels = days
        .map((d) => {
          const idx = DAY_ORDER.findIndex(({ key }) => Number(key) === d);
          return idx >= 0 ? DAY_ORDER[idx]!.label.slice(0, 3) : '';
        })
        .filter(Boolean)
        .join(', ');
      const times = rule.ranges.map((r) => `${r.start}–${r.end}`).join(', ');
      return `${friendlyIsoDate(rule.start_date)} → ${friendlyIsoDate(rule.end_date)} · ${dayLabels} · ${times}`;
    }
    default:
      return '';
  }
}

function sanitizeTimeRange(item: unknown): TimeRange | null {
  if (!item || typeof item !== 'object') return null;
  const start = typeof (item as { start?: unknown }).start === 'string' ? (item as { start: string }).start : '';
  const end = typeof (item as { end?: unknown }).end === 'string' ? (item as { end: string }).end : '';
  if (!start || !end) return null;
  return { start: start.slice(0, 5), end: end.slice(0, 5) };
}

function sanitizeRule(raw: unknown): ServiceCustomRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === 'string' && o.id.length > 0 ? o.id : newRuleId();
  const kind = o.kind;
  if (kind === 'weekly' && o.windows && typeof o.windows === 'object' && !Array.isArray(o.windows)) {
    const wh = parseLegacyWorkingHoursObject(o.windows as Record<string, unknown>);
    if (!wh || Object.keys(wh).length === 0) return null;
    return { id, kind: 'weekly', windows: wh };
  }
  if (kind === 'specific_dates' && Array.isArray(o.entries)) {
    const entries: Array<{ date: string; ranges: TimeRange[] }> = [];
    for (const ent of o.entries) {
      if (!ent || typeof ent !== 'object') continue;
      const date = typeof (ent as { date?: unknown }).date === 'string' ? (ent as { date: string }).date.slice(0, 10) : '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const rangesRaw = (ent as { ranges?: unknown }).ranges;
      if (!Array.isArray(rangesRaw)) continue;
      const ranges = rangesRaw.map(sanitizeTimeRange).filter((x): x is TimeRange => x != null);
      if (ranges.length > 0) entries.push({ date, ranges });
    }
    if (entries.length === 0) return null;
    return { id, kind: 'specific_dates', entries };
  }
  if (kind === 'date_range_pattern') {
    const start_date =
      typeof o.start_date === 'string' ? o.start_date.slice(0, 10) : '';
    const end_date = typeof o.end_date === 'string' ? o.end_date.slice(0, 10) : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(end_date)) return null;
    if (compareIsoDate(start_date, end_date) > 0) return null;
    const daysRaw = o.days_of_week;
    const days_of_week = Array.isArray(daysRaw)
      ? [...new Set(daysRaw.filter((x): x is number => typeof x === 'number' && x >= 0 && x <= 6))]
      : [];
    if (days_of_week.length === 0) return null;
    const rangesRaw = o.ranges;
    if (!Array.isArray(rangesRaw)) return null;
    const ranges = rangesRaw.map(sanitizeTimeRange).filter((x): x is TimeRange => x != null);
    if (ranges.length === 0) return null;
    return { id, kind: 'date_range_pattern', start_date, end_date, days_of_week, ranges };
  }
  return null;
}

function parseLegacyWorkingHoursObject(raw: Record<string, unknown>): WorkingHours | null {
  const out: WorkingHours = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!Array.isArray(v)) continue;
    const ranges: TimeRange[] = [];
    for (const item of v) {
      const tr = sanitizeTimeRange(item);
      if (tr) ranges.push(tr);
    }
    if (ranges.length > 0) out[k] = ranges;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Parse DB JSON: legacy weekly map or `{ version: 2, rules }`. */
export function parseCustomWorkingHoursFromDb(raw: unknown): ServiceCustomScheduleStored | null {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.version === 2 && Array.isArray(o.rules)) {
    const rules: ServiceCustomRule[] = [];
    for (const r of o.rules) {
      const sr = sanitizeRule(r);
      if (sr) rules.push(sr);
    }
    return rules.length > 0 ? { version: 2, rules } : null;
  }
  const wh = parseLegacyWorkingHoursObject(o);
  return wh;
}

export function formatServiceCustomScheduleSummary(schedule: ServiceCustomScheduleStored | null | undefined): string {
  if (!schedule) return 'No custom schedule.';
  if (!isServiceCustomScheduleV2(schedule)) {
    return formatWorkingHoursSummary(schedule as WorkingHours);
  }
  if (schedule.rules.length === 0) return 'No rules — service not bookable online with custom hours enabled.';
  const ruleTypeLabel: Record<ServiceCustomRule['kind'], string> = {
    weekly: 'Weekly',
    specific_dates: 'Specific dates',
    date_range_pattern: 'Date range',
  };
  return schedule.rules
    .map((rule) => `${ruleTypeLabel[rule.kind]}: ${formatServiceCustomRuleSummary(rule)}`)
    .join('\n');
}

/**
 * Venue minute ranges for the summary line, resolved by the SHARED resolver.
 *
 * This used to be a hand-rolled copy carrying a "keep in sync with
 * venueMinuteRangesForAppointmentDate" comment, and it was not in sync: it took the FIRST
 * matching exception in list order, while the engine had been fixed to prefer a closure
 * over an amended row. So a date with both showed amended hours in the service summary and
 * resolved closed in the engine. That function is now deleted, which would have left this
 * comment pointing at nothing.
 *
 * Returns null when the venue imposes no constraint, [] when it is shut for the day.
 */
function venueMinuteRangesForSummaryDate(
  venueOpeningHours: OpeningHours | null | undefined,
  dateStr: string,
  blocks: AvailabilityBlock[] | null | undefined,
): Array<{ start: number; end: number }> | null {
  const res = resolveVenueWideAllowedMinuteRanges(venueOpeningHours, dateStr, blocks ?? []);
  if (res.kind === 'unrestricted') return null;
  if (res.kind === 'closed') return [];
  return res.ranges;
}

/** Next calendar date from local today within `maxDays` where `getDay()` equals `dow` (0=Sun … 6=Sat). */
function nextCalendarDateForDowFromToday(dow: number, maxDays = 370): string {
  const now = new Date();
  for (let i = 0; i < maxDays; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    if (d.getDay() !== dow) continue;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function minuteRangesForWorkingHoursDay(
  wh: WorkingHours | null | undefined,
  dow: number,
): Array<{ start: number; end: number }> {
  if (!wh || typeof wh !== 'object') return [];
  const key = String(dow);
  const dayName = DAY_NAMES[dow];
  const ranges = wh[key] ?? wh[dayName];
  if (!ranges || !Array.isArray(ranges) || ranges.length === 0) return [];
  return ranges.map((r) => ({
    start: timeToMinutes(String(r.start).slice(0, 5)),
    end: timeToMinutes(String(r.end).slice(0, 5)),
  }));
}

function mergeUnionRanges(ranges: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const out: Array<{ start: number; end: number }> = [];
  let cur = { ...sorted[0]! };
  for (let i = 1; i < sorted.length; i++) {
    const r = sorted[i]!;
    if (r.start <= cur.end) {
      cur.end = Math.max(cur.end, r.end);
    } else {
      out.push(cur);
      cur = { ...r };
    }
  }
  out.push(cur);
  return out;
}

/** Next ISO date (from local today) within `maxDays` where schedule has any custom window and weekday = `dow`. */
function findSampleDateForWeekdaySummary(
  schedule: ServiceCustomScheduleStored,
  dow: number,
  maxDays = 370,
): string | null {
  const now = new Date();
  for (let i = 0; i < maxDays; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    if (d.getDay() !== dow) continue;
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (getServiceCustomMinuteRangesForDate(schedule, ymd).length > 0) return ymd;
  }
  return null;
}

export interface OnlineBookableWeeklySummaryParts {
  /** When set, show this instead of the week grid (no linked calendars). */
  noCalendarsMessage: string | null;
  /** Shown above the week grid when custom rules include specific dates or a date band (not weekly-only). */
  contextualNote: string | null;
  /** Monday–Sunday lines: venue × calendars × custom schedule (sample). */
  weekLines: string;
  /**
   * When non-null, lists the concrete calendar date used per weekday row for venue + this service
   * (one-off / seasonal service rules).
   */
  previewDatesNote: string | null;
}

/**
 * Structured summary for UI: separate “why the grid looks this way” from Mon–Sun lines.
 * For custom schedules with specific dates or date-range rules, each weekday uses the next matching calendar date
 * within about a year (see `findSampleDateForWeekdaySummary`).
 */
export function getOnlineBookableWeeklySummaryParts(params: {
  venueOpeningHours: OpeningHours | null | undefined;
  venueWideBlocks?: AvailabilityBlock[] | null;
  linkedCalendars: Array<{ id: string; working_hours: WorkingHours | null | undefined }>;
  customAvailabilityEnabled: boolean;
  customWorkingHours: ServiceCustomScheduleStored | null | undefined;
}): OnlineBookableWeeklySummaryParts {
  const { venueOpeningHours, venueWideBlocks, linkedCalendars, customAvailabilityEnabled, customWorkingHours } =
    params;
  if (linkedCalendars.length === 0) {
    return {
      noCalendarsMessage: 'Link at least one calendar to this service to see a sample week.',
      contextualNote: null,
      weekLines: '',
      previewDatesNote: null,
    };
  }

  const hasComplexCustom =
    customAvailabilityEnabled &&
    customWorkingHours &&
    isServiceCustomScheduleV2(customWorkingHours) &&
    customWorkingHours.rules.some((r) => r.kind !== 'weekly');

  const contextualNote = hasComplexCustom
    ? "This service uses date-specific rules, so real availability can change by week. Each row picks one sample date (first matching weekday in the next ~12 months where online booking is allowed). The preview combines venue hours for that date, each linked calendar's recurring weekly hours, and this service's hours. Staff blocks and one-off calendar changes are not included."
    : null;

  const lines: string[] = [];
  const previewDateParts: string[] = [];

  for (const { key, label } of DAY_ORDER) {
    const dow = parseInt(key, 10);

    let customRanges: Array<{ start: number; end: number }> = [];
    let serviceSampleYmd: string | null = null;

    if (customAvailabilityEnabled && customWorkingHours) {
      if (isServiceCustomScheduleV2(customWorkingHours)) {
        serviceSampleYmd = findSampleDateForWeekdaySummary(customWorkingHours, dow);
        customRanges = serviceSampleYmd
          ? getServiceCustomMinuteRangesForDate(customWorkingHours, serviceSampleYmd)
          : [];
      } else {
        customRanges = minuteRangesForWorkingHoursDay(customWorkingHours as WorkingHours, dow);
      }
    }

    const anchorYmd =
      customAvailabilityEnabled && customWorkingHours && isServiceCustomScheduleV2(customWorkingHours)
        ? (serviceSampleYmd ?? nextCalendarDateForDowFromToday(dow))
        : nextCalendarDateForDowFromToday(dow);

    if (hasComplexCustom) {
      previewDateParts.push(`${label.slice(0, 3)} ${anchorYmd}`);
    }

    const venueRanges = venueMinuteRangesForSummaryDate(venueOpeningHours, anchorYmd, venueWideBlocks);
    const all: Array<{ start: number; end: number }> = [];
    for (const cal of linkedCalendars) {
      const calRanges = minuteRangesForWorkingHoursDay(cal.working_hours, dow);
      if (calRanges.length === 0) continue;
      const eff = venueRanges === null ? calRanges : intersectMinuteRanges(calRanges, venueRanges);
      all.push(...eff);
    }
    let union = mergeUnionRanges(all);
    if (customAvailabilityEnabled && customWorkingHours) {
      if (customRanges.length === 0) {
        union = [];
      } else {
        union = mergeUnionRanges(intersectMinuteRanges(union, customRanges));
      }
    }
    if (union.length === 0) {
      lines.push(`${label}: Closed`);
    } else {
      const segs = union.map((r) => `${minutesToTime(r.start)}–${minutesToTime(r.end)}`).join(', ');
      lines.push(`${label}: ${segs}`);
    }
  }

  const complexDatesNote =
    previewDateParts.length > 0
      ? `Dates used for venue + this service in each row: ${previewDateParts.join(' · ')}.`
      : null;

  const venueExceptionNote =
    !hasComplexCustom && venueWideBlocks && venueWideBlocks.length > 0
      ? 'Venue closed or amended days on the calendar use the next occurrence of each weekday from today (service hours follow the usual weekly pattern).'
      : null;

  const previewFootnotes = [complexDatesNote, venueExceptionNote].filter(Boolean);
  const previewDatesNote = previewFootnotes.length > 0 ? previewFootnotes.join(' ') : null;

  return {
    noCalendarsMessage: null,
    contextualNote,
    weekLines: lines.join('\n'),
    previewDatesNote,
  };
}

export interface ServiceAvailabilityForDate {
  /** Merged bookable minute ranges for the date (empty = closed for online booking). */
  ranges: Array<{ start: number; end: number }>;
  /** True when there are no linked calendars at all (calendar view cannot render). */
  noCalendars: boolean;
  /** True when venue is closed on this date (via weekly hours or exception). */
  venueClosed: boolean;
  /** True when every linked calendar has no hours configured for this weekday. */
  calendarsClosed: boolean;
  /** True when the service's custom schedule excludes this date (only if custom enabled). */
  serviceCustomExcludes: boolean;
}

/**
 * Final online-bookable ranges for one concrete calendar date:
 * venue hours (+ exceptions) ∩ union(linked calendars' weekly hours) ∩ service custom schedule.
 * Staff blocks and one-off calendar changes are not modelled here.
 */
export function computeServiceAvailabilityForDate(
  params: {
    venueOpeningHours: OpeningHours | null | undefined;
    venueWideBlocks?: AvailabilityBlock[] | null;
    linkedCalendars: Array<{ id: string; working_hours: WorkingHours | null | undefined }>;
    customAvailabilityEnabled: boolean;
    customWorkingHours: ServiceCustomScheduleStored | null | undefined;
  },
  dateStr: string,
): ServiceAvailabilityForDate {
  const {
    venueOpeningHours,
    venueWideBlocks,
    linkedCalendars,
    customAvailabilityEnabled,
    customWorkingHours,
  } = params;

  if (linkedCalendars.length === 0) {
    return {
      ranges: [],
      noCalendars: true,
      venueClosed: false,
      calendarsClosed: true,
      serviceCustomExcludes: false,
    };
  }

  const dow = getDayOfWeek(dateStr);
  const venueRanges = venueMinuteRangesForSummaryDate(venueOpeningHours, dateStr, venueWideBlocks);
  const venueClosed = venueRanges !== null && venueRanges.length === 0;

  const calendarEffective: Array<{ start: number; end: number }> = [];
  let anyCalendarHasHours = false;
  for (const cal of linkedCalendars) {
    const calRanges = minuteRangesForWorkingHoursDay(cal.working_hours, dow);
    if (calRanges.length === 0) continue;
    anyCalendarHasHours = true;
    const eff = venueRanges === null ? calRanges : intersectMinuteRanges(calRanges, venueRanges);
    calendarEffective.push(...eff);
  }
  let union = mergeUnionRanges(calendarEffective);

  let serviceCustomExcludes = false;
  if (customAvailabilityEnabled && customWorkingHours) {
    const custom = getServiceCustomMinuteRangesForDate(customWorkingHours, dateStr);
    if (custom.length === 0) {
      serviceCustomExcludes = true;
      union = [];
    } else {
      union = mergeUnionRanges(intersectMinuteRanges(union, custom));
    }
  }

  return {
    ranges: union,
    noCalendars: false,
    venueClosed,
    calendarsClosed: !anyCalendarHasHours,
    serviceCustomExcludes,
  };
}

/** Format minute range as "9:00–17:00" (omits trailing ":00" for round hours). */
export function formatMinuteRangeShort(range: { start: number; end: number }): string {
  return `${minutesToTime(range.start)}–${minutesToTime(range.end)}`;
}

/** Single string for simple callers; dashboard uses {@link getOnlineBookableWeeklySummaryParts}. */
export function describeOnlineBookableWeeklySummary(params: {
  venueOpeningHours: OpeningHours | null | undefined;
  venueWideBlocks?: AvailabilityBlock[] | null;
  linkedCalendars: Array<{ id: string; working_hours: WorkingHours | null | undefined }>;
  customAvailabilityEnabled: boolean;
  customWorkingHours: ServiceCustomScheduleStored | null | undefined;
}): string {
  const r = getOnlineBookableWeeklySummaryParts(params);
  if (r.noCalendarsMessage) return r.noCalendarsMessage;
  return [r.contextualNote, r.weekLines, r.previewDatesNote].filter(Boolean).join('\n\n');
}
