'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ResourceExceptionsCalendar,
  type CalendarUnavailabilityDayValue,
} from '@/app/dashboard/resource-timeline/ResourceExceptionsCalendar';
import type { PractitionerLeaveType } from '@/types/booking-models';
import type { AvailabilityBlock, OpeningHours } from '@/types/availability';
import { resolveVenueWideAllowedMinuteRanges } from '@/lib/availability/venue-wide-business-hours';
import { timeToMinutes } from '@/lib/availability';
import {
  AMENDED_HOURS_MAX_DATES,
  enumerateDatesInclusive,
  type AmendedHoursEntry,
  type HoursPeriod,
} from '@/lib/availability/calendar-amended-hours';

export interface LeavePeriodRow {
  id: string;
  practitioner_id: string;
  practitioner_name: string;
  start_date: string;
  end_date: string;
  leave_type: PractitionerLeaveType;
  notes: string | null;
  created_at: string;
  unavailable_start_time?: string | null;
  unavailable_end_time?: string | null;
}

/** One run of amended hours as `GET /api/venue/calendar-amended-hours` lists it. */
export interface AmendedHoursRow extends AmendedHoursEntry {
  calendar_id: string;
  calendar_name: string;
}

interface CalendarOption {
  id: string;
  name: string;
}

/**
 * DERIVED from the stored times, never chosen. See the note on the form below.
 */
type CalendarBlockType = 'closed' | 'partial';

/**
 * The two things a date can carry here. A closure is leave (`practitioner_leave_periods`,
 * hard: nothing books through it). Amended hours are a per-date override
 * (`unified_calendars.availability_exceptions`): the calendar works exactly these hours on
 * that date instead of its usual ones, which is also how a day it does not normally work
 * gets opened. Leave outranks amended hours everywhere, and the API refuses an override on
 * a full-day-leave date rather than saving something that would do nothing.
 * See Docs/calendar-amended-hours-plan.md.
 */
type EntryKind = 'closed' | 'hours';

interface DraftState {
  kind: EntryKind;
  date_start: string;
  date_end: string;
  time_start: string | null;
  time_end: string | null;
  leave_type: PractitionerLeaveType;
  notes: string;
  periods: HoursPeriod[];
  apply_to_all_active: boolean;
}

type Editing = { kind: 'closed'; id: string } | { kind: 'hours'; date_start: string; date_end: string } | null;

/**
 * Labels for an EXISTING closure, derived from whether it carries times.
 *
 * These used to be a choice on the form: "Closure" and "Unavailable window", which wrote
 * byte-identical rows. The helper text conceded it -- "Closure blocks the whole day unless
 * you add optional times" -- at which point it was an Unavailable window. `block_type` never
 * reached the server; both options set the same two columns, and the only real difference
 * was whether the time inputs were required. Picking between them changed nothing, which is
 * the kind of choice that quietly erodes trust in everything else on the screen.
 *
 * The form now has one shape with optional times, and these labels just describe what is
 * stored. Plan §4 Stage 6a item 5, `[R3-84]`.
 */
const BLOCK_TYPE_LABELS: Record<CalendarBlockType, string> = {
  closed: 'All day',
  partial: 'Part day',
};

const BLOCK_TYPE_COLORS: Record<CalendarBlockType, string> = {
  closed: 'bg-red-100 text-red-700',
  partial: 'bg-rose-100 text-rose-700',
};

const AMENDED_CHIP = 'bg-amber-100 text-amber-800';
const MAX_PERIODS = 3;

function emptyDraft(): DraftState {
  return {
    kind: 'closed',
    date_start: '',
    date_end: '',
    time_start: null,
    time_end: null,
    leave_type: 'annual',
    notes: '',
    periods: [{ start: '', end: '' }],
    apply_to_all_active: false,
  };
}

function isFullDayLeave(p: Pick<LeavePeriodRow, 'unavailable_start_time' | 'unavailable_end_time'>): boolean {
  return (
    (p.unavailable_start_time == null || p.unavailable_start_time === '') &&
    (p.unavailable_end_time == null || p.unavailable_end_time === '')
  );
}

function draftFromPeriod(p: LeavePeriodRow): DraftState {
  const fullDay = isFullDayLeave(p);
  return {
    ...emptyDraft(),
    kind: 'closed',
    date_start: p.start_date,
    date_end: p.end_date,
    time_start: fullDay ? null : (p.unavailable_start_time?.slice(0, 5) ?? null),
    time_end: fullDay ? null : (p.unavailable_end_time?.slice(0, 5) ?? null),
    leave_type: p.leave_type,
    notes: p.notes ?? '',
  };
}

function draftFromAmended(a: AmendedHoursRow): DraftState {
  return {
    ...emptyDraft(),
    kind: 'hours',
    date_start: a.date_start,
    date_end: a.date_end,
    notes: a.reason ?? '',
    periods: a.periods.length > 0 ? a.periods.map((p) => ({ ...p })) : [{ start: '', end: '' }],
  };
}

function bestLeaveForDay(periods: LeavePeriodRow[], iso: string): LeavePeriodRow | null {
  let best: LeavePeriodRow | null = null;
  let bestPri = -1;
  for (const p of periods) {
    if (iso < p.start_date || iso > p.end_date) continue;
    const pri = isFullDayLeave(p) ? 2 : 1;
    if (pri > bestPri) {
      best = p;
      bestPri = pri;
    }
  }
  return best;
}

/**
 * What the month grid shows per date. Full-day leave wins outright; an amended day shows
 * its hours even when a part-day window is also blocked inside it, because the hours are
 * the larger fact and the window is listed on the entry itself.
 */
function entriesToCalendarMap(
  periods: LeavePeriodRow[],
  amended: AmendedHoursRow[],
  year: number,
  month: number,
): Record<string, CalendarUnavailabilityDayValue> {
  const lastDay = new Date(year, month, 0).getDate();
  const map: Record<string, CalendarUnavailabilityDayValue> = {};
  for (let d = 1; d <= lastDay; d++) {
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const p = bestLeaveForDay(periods, iso);
    if (p && isFullDayLeave(p)) {
      map[iso] = { closed: true };
      continue;
    }
    const a = amended.find((row) => row.date_start <= iso && iso <= row.date_end);
    if (a && a.kind === 'hours') {
      map[iso] = { periods: a.periods };
      continue;
    }
    if (a && a.kind === 'closed') {
      map[iso] = { closed: true };
      continue;
    }
    if (!p) continue;
    const start = p.unavailable_start_time ?? '';
    const end = p.unavailable_end_time ?? '';
    if (start && end) map[iso] = { unavailableWindow: { start, end } };
  }
  return map;
}

function toHhMm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function describeDateShort(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getUTCDay()];
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][dt.getUTCMonth()];
  return `${weekday} ${dt.getUTCDate()} ${month}`;
}

function describeRange(a: string, b: string): string {
  return a === b ? a : `${a} – ${b}`;
}

/**
 * The venue's side of an amended day, for the note under the form. A calendar only sells
 * where its hours fall inside the venue's resolved hours, so opening a calendar on a day
 * the venue is closed, or past its close, lets staff book and shows guests nothing until
 * the venue's own Closures & special days amend that date too. Saving is still allowed:
 * the weekly editor allows the same, and the note is what turns a surprise into a choice.
 */
function venueHoursNote(
  draft: DraftState,
  venueHours: OpeningHours | null | undefined,
  venueBlocks: AvailabilityBlock[],
): string | null {
  if (draft.kind !== 'hours' || !draft.date_start || !draft.date_end || draft.date_end < draft.date_start) return null;
  if (!venueHours || typeof venueHours !== 'object' || Object.keys(venueHours).length === 0) return null;
  const periods = draft.periods
    .map((p) => ({ start: timeToMinutes(p.start), end: timeToMinutes(p.end) }))
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start);
  if (periods.length === 0) return null;
  const dates = enumerateDatesInclusive(draft.date_start, draft.date_end).slice(0, AMENDED_HOURS_MAX_DATES);
  const closedDates: string[] = [];
  let outside: { date: string; venue: string } | null = null;
  for (const date of dates) {
    const venue = resolveVenueWideAllowedMinuteRanges(venueHours, date, venueBlocks);
    if (venue.kind === 'closed') {
      closedDates.push(date);
      continue;
    }
    if (venue.kind !== 'allowed') continue;
    const fits = periods.every((p) => venue.ranges.some((v) => p.start >= v.start && p.end <= v.end));
    if (!fits && !outside) {
      outside = { date, venue: venue.ranges.map((r) => `${toHhMm(r.start)} to ${toHhMm(r.end)}`).join(', ') };
    }
  }
  const parts: string[] = [];
  if (closedDates.length === 1) {
    parts.push(`Your venue is closed on ${describeDateShort(closedDates[0]!)}, so guests cannot book this calendar that day.`);
  } else if (closedDates.length > 1) {
    parts.push(`Your venue is closed on ${closedDates.length} of these dates (first ${describeDateShort(closedDates[0]!)}), so guests cannot book this calendar on them.`);
  }
  if (outside) {
    parts.push(`Hours outside ${outside.venue} on ${describeDateShort(outside.date)} are not bookable by guests.`);
  }
  if (parts.length === 0) return null;
  return `${parts.join(' ')} Staff can still book. To open to guests as well, amend your business hours for these dates too.`;
}

export function StaffLeaveCalendarPanel({
  practitioners,
  isAdmin,
  selfPractitionerId = null,
  venueHours = null,
  onError,
  onChanged,
  initialDate = null,
  initialCalendarId: initialCalendarIdProp = null,
}: {
  practitioners: CalendarOption[];
  isAdmin: boolean;
  selfPractitionerId?: string | null;
  /** The venue's weekly opening hours, for the note under an amended-hours entry. */
  venueHours?: OpeningHours | null;
  onError: (msg: string | null) => void;
  /** Called after amended hours change, so the page can refresh the calendars it holds. */
  onChanged?: () => void;
  /** yyyy-mm-dd to open on with that day picked (the diary's hours dialog). */
  initialDate?: string | null;
  /** Calendar to preselect when the user may choose (admins). */
  initialCalendarId?: string | null;
}) {
  const canManageUnavailability = isAdmin || Boolean(selfPractitionerId);

  const initialCalendarId =
    selfPractitionerId ??
    (initialCalendarIdProp && practitioners.some((p) => p.id === initialCalendarIdProp)
      ? initialCalendarIdProp
      : practitioners[0]?.id ?? '');

  const [calendarId, setCalendarId] = useState(initialCalendarId);
  const [periods, setPeriods] = useState<LeavePeriodRow[]>([]);
  const [amended, setAmended] = useState<AmendedHoursRow[]>([]);
  const [venueBlocks, setVenueBlocks] = useState<AvailabilityBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Opened from the diary's clock button, the panel lands on the day being
  // viewed with that day already picked, so one save covers the common case.
  const seededDate = initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate) ? initialDate : null;
  const nowDate = new Date();
  const [calYear, setCalYear] = useState(seededDate ? Number(seededDate.slice(0, 4)) : nowDate.getFullYear());
  const [calMonth, setCalMonth] = useState(seededDate ? Number(seededDate.slice(5, 7)) : nowDate.getMonth() + 1);
  const [rangeStart, setRangeStart] = useState<string | null>(seededDate);
  const [rangeEnd, setRangeEnd] = useState<string | null>(seededDate);
  const [editing, setEditing] = useState<Editing>(null);
  const [draft, setDraft] = useState<DraftState>(() =>
    seededDate ? { ...emptyDraft(), date_start: seededDate, date_end: seededDate } : emptyDraft(),
  );

  useEffect(() => {
    if (selfPractitionerId) {
      setCalendarId(selfPractitionerId);
      return;
    }
    if (!calendarId && practitioners[0]?.id) {
      setCalendarId(practitioners[0].id);
    }
  }, [selfPractitionerId, practitioners, calendarId]);

  const rangeFrom = `${calYear}-${String(calMonth).padStart(2, '0')}-01`;
  const rangeTo = `${calYear}-${String(calMonth).padStart(2, '0')}-${String(
    new Date(calYear, calMonth, 0).getDate(),
  ).padStart(2, '0')}`;

  const reload = useCallback(async () => {
    if (!calendarId) {
      setPeriods([]);
      setAmended([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    onError(null);
    try {
      const params = new URLSearchParams({ from: rangeFrom, to: rangeTo, practitioner_id: calendarId });
      const [leaveRes, amendedRes] = await Promise.all([
        fetch(`/api/venue/practitioner-leave?${params}`),
        fetch(`/api/venue/calendar-amended-hours?${params}`),
      ]);
      if (!leaveRes.ok) {
        const j = await leaveRes.json().catch(() => ({}));
        onError(typeof j.error === 'string' ? j.error : 'Could not load calendar unavailability');
        setPeriods([]);
      } else {
        const data = (await leaveRes.json()) as { periods: LeavePeriodRow[] };
        setPeriods(data.periods ?? []);
      }
      if (!amendedRes.ok) {
        const j = await amendedRes.json().catch(() => ({}));
        onError(typeof j.error === 'string' ? j.error : 'Could not load amended hours');
        setAmended([]);
      } else {
        const data = (await amendedRes.json()) as { entries: AmendedHoursRow[] };
        setAmended(data.entries ?? []);
      }
    } catch {
      onError('Could not load calendar unavailability');
      setPeriods([]);
      setAmended([]);
    } finally {
      setLoading(false);
    }
  }, [calendarId, rangeFrom, rangeTo, onError]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Venue-wide closures and amended hours, context for the note under the form only.
  useEffect(() => {
    let cancelled = false;
    void fetch('/api/venue/availability-blocks')
      .then(async (res) => {
        if (!res.ok) return [];
        const data = (await res.json().catch(() => ({}))) as { blocks?: AvailabilityBlock[] };
        return Array.isArray(data.blocks) ? data.blocks.filter((b) => b.service_id == null) : [];
      })
      .catch(() => [] as AvailabilityBlock[])
      .then((rows) => {
        if (!cancelled) setVenueBlocks(rows);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const calendarExceptions = useMemo(
    () => entriesToCalendarMap(periods, amended, calYear, calMonth),
    [periods, amended, calYear, calMonth],
  );

  const prevMonth = useCallback(() => {
    setCalMonth((m) => {
      if (m === 1) {
        setCalYear((y) => y - 1);
        return 12;
      }
      return m - 1;
    });
  }, []);

  const nextMonth = useCallback(() => {
    setCalMonth((m) => {
      if (m === 12) {
        setCalYear((y) => y + 1);
        return 1;
      }
      return m + 1;
    });
  }, []);

  const cancelEdit = useCallback(() => {
    setEditing(null);
    setDraft(emptyDraft());
    setRangeStart(null);
    setRangeEnd(null);
    setFormError(null);
  }, []);

  const editPeriod = useCallback((p: LeavePeriodRow) => {
    setEditing({ kind: 'closed', id: p.id });
    setDraft(draftFromPeriod(p));
    setRangeStart(p.start_date);
    setRangeEnd(p.end_date);
    setFormError(null);
  }, []);

  const editAmended = useCallback((a: AmendedHoursRow) => {
    setEditing({ kind: 'hours', date_start: a.date_start, date_end: a.date_end });
    setDraft(draftFromAmended(a));
    setRangeStart(a.date_start);
    setRangeEnd(a.date_end);
    setFormError(null);
  }, []);

  const handleDayClick = useCallback(
    (ymd: string) => {
      if (!canManageUnavailability) return;
      if (editing) {
        cancelEdit();
        return;
      }
      const onDay = periods.filter((p) => p.start_date <= ymd && p.end_date >= ymd);
      if (onDay.length === 1 && (isAdmin || onDay[0]!.practitioner_id === selfPractitionerId)) {
        editPeriod(onDay[0]!);
        return;
      }
      const amendedOnDay = amended.find((a) => a.kind === 'hours' && a.date_start <= ymd && ymd <= a.date_end);
      if (onDay.length === 0 && amendedOnDay) {
        editAmended(amendedOnDay);
        return;
      }
      if (!rangeStart) {
        setRangeStart(ymd);
        setRangeEnd(ymd);
        setDraft((d) => ({ ...d, date_start: ymd, date_end: ymd }));
      } else if (rangeStart === ymd && rangeEnd === ymd) {
        setRangeStart(null);
        setRangeEnd(null);
        setDraft((d) => ({ ...d, date_start: '', date_end: '' }));
      } else {
        const a = rangeStart <= ymd ? rangeStart : ymd;
        const b = rangeStart <= ymd ? ymd : rangeStart;
        setRangeStart(a);
        setRangeEnd(b);
        setDraft((d) => ({ ...d, date_start: a, date_end: b }));
      }
    },
    [canManageUnavailability, editing, cancelEdit, periods, amended, editPeriod, editAmended, isAdmin, selfPractitionerId, rangeStart, rangeEnd],
  );

  const saveClosure = useCallback(async (): Promise<boolean> => {
    // Blank both times = all day. One time on its own is not a window, and the engines
    // treat a half-set pair as a whole-day closure, so refusing it here stops the venue
    // storing something that means the opposite of what the form showed them.
    const hasAnyTime = Boolean(draft.time_start || draft.time_end);
    if (hasAnyTime && (!draft.time_start || !draft.time_end)) {
      setFormError('Enter both a start and an end time, or leave both blank to block the whole day.');
      return false;
    }
    if (draft.time_start && draft.time_end && draft.time_end <= draft.time_start) {
      setFormError('End time must be after start time.');
      return false;
    }
    const fullDay = !draft.time_start && !draft.time_end;
    const payload = {
      start_date: draft.date_start,
      end_date: draft.date_end,
      leave_type: draft.leave_type,
      notes: draft.notes.trim() || null,
      unavailable_start_time: fullDay ? null : draft.time_start,
      unavailable_end_time: fullDay ? null : draft.time_end,
    };
    if (editing?.kind === 'closed') {
      const res = await fetch('/api/venue/practitioner-leave', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editing.id, ...payload }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(typeof j.error === 'string' ? j.error : 'Update failed');
      }
      return true;
    }
    const res = await fetch('/api/venue/practitioner-leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apply_to_all_active: draft.apply_to_all_active,
        practitioner_id: draft.apply_to_all_active ? undefined : calendarId,
        ...payload,
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(typeof j.error === 'string' ? j.error : 'Could not save');
    }
    return true;
  }, [draft, editing, calendarId]);

  const saveAmendedHours = useCallback(async (): Promise<boolean> => {
    const periodsIn = draft.periods.filter((p) => p.start || p.end);
    if (periodsIn.length === 0) {
      setFormError('Enter the open and close time for these dates.');
      return false;
    }
    for (const p of periodsIn) {
      if (!p.start || !p.end) {
        setFormError('Enter both an open and a close time for each period.');
        return false;
      }
      if (p.end <= p.start) {
        setFormError('Close time must be after open time.');
        return false;
      }
    }
    const body = {
      apply_to_all_active: !editing && draft.apply_to_all_active ? true : undefined,
      practitioner_id: !editing && draft.apply_to_all_active ? undefined : calendarId,
      date_start: draft.date_start,
      date_end: draft.date_end,
      periods: periodsIn,
      reason: draft.notes.trim() || null,
      replace: editing?.kind === 'hours' ? { date_start: editing.date_start, date_end: editing.date_end } : null,
    };
    const send = (acknowledge: boolean) =>
      fetch(
        acknowledge
          ? '/api/venue/calendar-amended-hours?acknowledge_affected_bookings=true'
          : '/api/venue/calendar-amended-hours',
        { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      );
    let res = await send(false);
    if (res.status === 409) {
      const j = (await res.json().catch(() => ({}))) as { requires_confirmation?: boolean; message?: string; error?: string };
      if (j.requires_confirmation) {
        // Narrowing a day warns like a weekly-hours change: the bookings are kept, the
        // owner is told which ones now sit outside the hours, and decides.
        const ok = typeof window !== 'undefined' && window.confirm(`${j.message ?? 'Some upcoming bookings fall outside these hours.'}\n\nSave anyway?`);
        if (!ok) return false;
        res = await send(true);
      } else {
        throw new Error(typeof j.error === 'string' ? j.error : 'Could not save');
      }
    }
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(typeof j.error === 'string' ? j.error : 'Could not save');
    }
    onChanged?.();
    return true;
  }, [draft, editing, calendarId, onChanged]);

  const handleSave = useCallback(async () => {
    if (!canManageUnavailability) return;
    if (!draft.date_start || !draft.date_end) {
      setFormError('Select dates on the calendar or enter a start and end date.');
      return;
    }
    if (draft.date_end < draft.date_start) {
      setFormError('End date must be on or after start date.');
      return;
    }
    if (!editing && !draft.apply_to_all_active && !calendarId) {
      setFormError('Select a calendar.');
      return;
    }
    setSaving(true);
    setFormError(null);
    onError(null);
        try {
      // A validation failure (or a declined confirm) leaves the form as it is,
      // with the message showing; only a save clears it.
      const saved = draft.kind === 'hours' ? await saveAmendedHours() : await saveClosure();
      if (!saved) return;
      cancelEdit();
      await reload();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [canManageUnavailability, draft, editing, calendarId, saveAmendedHours, saveClosure, cancelEdit, reload, onError]);

  const handleDelete = useCallback(
    async (id: string) => {
      if (!confirm('Remove this closure from the calendar?')) return;
      setFormError(null);
      onError(null);
      try {
        const res = await fetch('/api/venue/practitioner-leave', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(typeof j.error === 'string' ? j.error : 'Delete failed');
        }
        if (editing?.kind === 'closed' && editing.id === id) cancelEdit();
        await reload();
      } catch (e) {
        setFormError(e instanceof Error ? e.message : 'Delete failed');
      }
    },
    [editing, cancelEdit, reload, onError],
  );

  const handleDeleteAmended = useCallback(
    async (a: AmendedHoursRow) => {
      if (!confirm('Remove these amended hours? The dates go back to the calendar’s usual hours.')) return;
      setFormError(null);
      onError(null);
      try {
        const res = await fetch('/api/venue/calendar-amended-hours', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ practitioner_id: a.calendar_id, date_start: a.date_start, date_end: a.date_end }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(typeof j.error === 'string' ? j.error : 'Delete failed');
        }
        if (editing?.kind === 'hours' && editing.date_start === a.date_start && editing.date_end === a.date_end) cancelEdit();
        onChanged?.();
        await reload();
      } catch (e) {
        setFormError(e instanceof Error ? e.message : 'Delete failed');
      }
    },
    [editing, cancelEdit, reload, onError, onChanged],
  );

  const today = new Date().toISOString().slice(0, 10);

  type ListItem = { key: string; sort: string; ended: boolean } & (
    | { type: 'closed'; row: LeavePeriodRow }
    | { type: 'hours'; row: AmendedHoursRow }
  );
  const listItems = useMemo<ListItem[]>(() => {
    const items: ListItem[] = periods.map((p) => ({ key: `leave-${p.id}`, sort: p.start_date, ended: p.end_date < today, type: 'closed', row: p }));
    for (const a of amended) {
      if (a.kind !== 'hours') continue;
      items.push({ key: `hours-${a.calendar_id}-${a.date_start}`, sort: a.date_start, ended: a.date_end < today, type: 'hours', row: a });
    }
    return items;
  }, [periods, amended, today]);
  const upcoming = useMemo(() => listItems.filter((i) => !i.ended).sort((a, b) => a.sort.localeCompare(b.sort)), [listItems]);
  const past = useMemo(() => listItems.filter((i) => i.ended).sort((a, b) => b.sort.localeCompare(a.sort)), [listItems]);

  const selectedCalendarName = practitioners.find((p) => p.id === calendarId)?.name ?? 'Calendar';

  const venueNote = useMemo(() => venueHoursNote(draft, venueHours, venueBlocks), [draft, venueHours, venueBlocks]);
  const leaveNote = useMemo(() => {
    if (draft.kind !== 'hours' || !draft.date_start || !draft.date_end || draft.date_end < draft.date_start) return null;
    const overlapping = periods.filter((p) => p.start_date <= draft.date_end && p.end_date >= draft.date_start);
    const full = overlapping.find((p) => isFullDayLeave(p));
    if (full) {
      const first = enumerateDatesInclusive(draft.date_start, draft.date_end).find((d) => full.start_date <= d && d <= full.end_date);
      return { blocking: true, text: `${selectedCalendarName} is closed all day on ${describeDateShort(first ?? full.start_date)}. Remove that closure first, or shorten the range.` };
    }
    const partial = overlapping.find((p) => !isFullDayLeave(p));
    if (partial) {
      return {
        blocking: false,
        text: `${selectedCalendarName} is unavailable ${partial.unavailable_start_time} to ${partial.unavailable_end_time} on ${describeDateShort(partial.start_date)}${partial.start_date === partial.end_date ? '' : ` to ${describeDateShort(partial.end_date)}`}. That window stays blocked inside the amended hours.`,
      };
    }
    return null;
  }, [draft, periods, selectedCalendarName]);

  const isEditingHours = editing?.kind === 'hours';
  const isEditingClosed = editing?.kind === 'closed';
  const isEditing = editing !== null;

  if (practitioners.length === 0) {
    return (
      <p className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
        Add a calendar first to set closures.
      </p>
    );
  }

  const inputClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm';

  return (
    <section className="space-y-6">
      <div className="max-w-xl space-y-1">
        <p className="text-sm text-slate-600">
          Take one calendar out for a date or a range, or give it different hours on those dates. Click dates on the
          calendar to select a range, then set the details below.
        </p>
        <p className="text-xs text-slate-500">
          Whole-venue closures and amended opening hours for every booking type are in{' '}
          <Link href="/dashboard/settings?tab=business-hours" className="font-medium text-brand-600 hover:underline">
            Settings → Business hours
          </Link>
          .
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Calendar closures and amended hours</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {canManageUnavailability
                ? `Managing: ${selectedCalendarName}`
                : `Viewing: ${selectedCalendarName}`}
            </p>
          </div>
          {isAdmin && !selfPractitionerId && (
            <div className="w-full sm:max-w-xs">
              <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="leave-calendar-picker">
                Calendar
              </label>
              <select
                id="leave-calendar-picker"
                value={calendarId}
                onChange={(e) => {
                  setCalendarId(e.target.value);
                  cancelEdit();
                }}
                className={inputClass}
              >
                {practitioners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex h-48 items-center justify-center text-sm text-slate-500">Loading calendar…</div>
        ) : (
          <>
            <ResourceExceptionsCalendar
              year={calYear}
              month={calMonth}
              onPrevMonth={prevMonth}
              onNextMonth={nextMonth}
              exceptions={calendarExceptions}
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
              editingDay={isEditing ? draft.date_start : null}
              onDayClick={handleDayClick}
              displayMode="calendar_unavailability"
            />

            {canManageUnavailability && (
              <div className="min-w-0 max-w-full rounded-xl border border-slate-100 bg-slate-50/50 p-4 space-y-3">
                <h3 className="text-sm font-semibold text-slate-800">
                  {isEditingHours ? 'Edit amended hours' : isEditingClosed ? 'Edit block' : 'New entry'}
                </h3>

                {!isEditing && (
                  <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Entry type">
                    {(
                      [
                        { kind: 'closed', label: 'Closed', hint: 'All day, or a window each day' },
                        { kind: 'hours', label: 'Working different hours', hint: 'Open on these dates with these hours' },
                      ] as Array<{ kind: EntryKind; label: string; hint: string }>
                    ).map((opt) => (
                      <button
                        key={opt.kind}
                        type="button"
                        role="radio"
                        aria-checked={draft.kind === opt.kind}
                        onClick={() => setDraft((d) => ({ ...d, kind: opt.kind }))}
                        className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                          draft.kind === opt.kind
                            ? 'border-brand-600 bg-brand-50 text-brand-900'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <span className="block font-medium">{opt.label}</span>
                        <span className="block text-[11px] text-slate-500">{opt.hint}</span>
                      </button>
                    ))}
                  </div>
                )}

                <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 [&_input]:min-w-0 [&_input]:max-w-full [&_select]:min-w-0 [&_select]:max-w-full">
                  <div className="min-w-0">
                    <label className="mb-1 block text-xs font-medium text-slate-600">Start date</label>
                    <input
                      type="date"
                      value={draft.date_start}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          date_start: e.target.value,
                          date_end: draft.date_end || e.target.value,
                        })
                      }
                      className={inputClass}
                    />
                  </div>
                  <div className="min-w-0">
                    <label className="mb-1 block text-xs font-medium text-slate-600">End date</label>
                    <input
                      type="date"
                      value={draft.date_end}
                      onChange={(e) => setDraft({ ...draft, date_end: e.target.value })}
                      className={inputClass}
                    />
                  </div>

                  {draft.kind === 'closed' ? (
                    <>
                      <div className="min-w-0 sm:col-span-2">
                        <p className="text-[11px] text-slate-500">
                          Leave both times blank to block the whole day. Enter a start and an end to block that window
                          on every date in the range.
                        </p>
                      </div>
                      <div className="min-w-0">
                        <label className="mb-1 block text-xs font-medium text-slate-600">
                          Start time (optional)
                        </label>
                        <input
                          type="time"
                          value={draft.time_start ?? ''}
                          onChange={(e) => setDraft({ ...draft, time_start: e.target.value || null })}
                          className={inputClass}
                        />
                      </div>
                      <div className="min-w-0">
                        <label className="mb-1 block text-xs font-medium text-slate-600">
                          End time (optional)
                        </label>
                        <input
                          type="time"
                          value={draft.time_end ?? ''}
                          onChange={(e) => setDraft({ ...draft, time_end: e.target.value || null })}
                          className={inputClass}
                        />
                      </div>

                      <div className="min-w-0 sm:col-span-2">
                        <label className="mb-1 block text-xs font-medium text-slate-600">Label (optional)</label>
                        <select
                          value={draft.leave_type}
                          onChange={(e) =>
                            setDraft({ ...draft, leave_type: e.target.value as PractitionerLeaveType })
                          }
                          className={inputClass}
                        >
                          <option value="annual">Closed</option>
                          <option value="sick">Unavailable</option>
                          <option value="other">Other</option>
                        </select>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="min-w-0 sm:col-span-2">
                        <p className="text-[11px] text-slate-500">
                          These hours replace the calendar&apos;s usual hours on every date in the range, including days it
                          does not normally work. Breaks still apply.
                        </p>
                      </div>
                      {draft.periods.map((p, idx) => (
                        <div key={idx} className="contents">
                          <div className="min-w-0">
                            <label className="mb-1 block text-xs font-medium text-slate-600">
                              {draft.periods.length > 1 ? `Period ${idx + 1} open` : 'Open'}
                            </label>
                            <input
                              type="time"
                              value={p.start}
                              onChange={(e) =>
                                setDraft({
                                  ...draft,
                                  periods: draft.periods.map((q, i) => (i === idx ? { ...q, start: e.target.value } : q)),
                                })
                              }
                              className={inputClass}
                            />
                          </div>
                          <div className="min-w-0">
                            <label className="mb-1 block text-xs font-medium text-slate-600">
                              {draft.periods.length > 1 ? `Period ${idx + 1} close` : 'Close'}
                            </label>
                            <div className="flex gap-2">
                              <input
                                type="time"
                                value={p.end}
                                onChange={(e) =>
                                  setDraft({
                                    ...draft,
                                    periods: draft.periods.map((q, i) => (i === idx ? { ...q, end: e.target.value } : q)),
                                  })
                                }
                                className={inputClass}
                              />
                              {draft.periods.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDraft({ ...draft, periods: draft.periods.filter((_, i) => i !== idx) })
                                  }
                                  className="shrink-0 rounded-lg border border-slate-200 px-2 text-xs text-slate-600 hover:bg-slate-50"
                                  aria-label={`Remove period ${idx + 1}`}
                                >
                                  Remove
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                      {draft.periods.length < MAX_PERIODS && (
                        <div className="min-w-0 sm:col-span-2">
                          <button
                            type="button"
                            onClick={() => setDraft({ ...draft, periods: [...draft.periods, { start: '', end: '' }] })}
                            className="text-xs font-medium text-brand-600 hover:text-brand-800"
                          >
                            + Add another period (for a break in the middle of the day)
                          </button>
                        </div>
                      )}
                    </>
                  )}

                  <div className="min-w-0 sm:col-span-2">
                    <label className="mb-1 block text-xs font-medium text-slate-600">Notes (optional)</label>
                    <input
                      type="text"
                      value={draft.notes}
                      onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                      placeholder={draft.kind === 'hours' ? 'e.g. Late opening for the fair' : 'e.g. Training day, equipment maintenance'}
                      maxLength={draft.kind === 'hours' ? 200 : 500}
                      className={inputClass}
                    />
                  </div>

                  {isAdmin && !selfPractitionerId && !isEditing && (
                    <div className="min-w-0 sm:col-span-2">
                      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-white p-3">
                        <input
                          type="checkbox"
                          checked={draft.apply_to_all_active}
                          onChange={(e) =>
                            setDraft({ ...draft, apply_to_all_active: e.target.checked })
                          }
                          className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600"
                        />
                        <span>
                          <span className="text-sm font-medium text-slate-900">Apply to all active calendars</span>
                          <span className="mt-0.5 block text-xs text-slate-500">
                            {draft.kind === 'hours'
                              ? 'Same dates and hours on every active calendar column at once.'
                              : 'Same dates and times on every active calendar column at once.'}
                          </span>
                        </span>
                      </label>
                    </div>
                  )}
                </div>

                {leaveNote && (
                  <p
                    className={`rounded-lg border px-3 py-2 text-xs ${
                      leaveNote.blocking ? 'border-red-200 bg-red-50 text-red-800' : 'border-slate-200 bg-white text-slate-700'
                    }`}
                  >
                    {leaveNote.text}
                  </p>
                )}
                {venueNote && (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    {venueNote}{' '}
                    <Link href="/dashboard/settings?tab=business-hours" className="font-medium underline">
                      Settings → Business hours
                    </Link>
                  </p>
                )}

                {formError && (
                  <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {formError}
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={saving || !draft.date_start || !draft.date_end}
                    onClick={() => void handleSave()}
                    className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                  >
                    {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Add to calendar'}
                  </button>
                  {isEditingClosed && (
                    <button
                      type="button"
                      onClick={() => void handleDelete(editing.id)}
                      className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                    >
                      Delete
                    </button>
                  )}
                  {isEditingHours && (
                    <button
                      type="button"
                      onClick={() => {
                        const row = amended.find((a) => a.date_start === editing.date_start && a.date_end === editing.date_end);
                        if (row) void handleDeleteAmended(row);
                      }}
                      className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                    >
                      Delete
                    </button>
                  )}
                  {isEditing && (
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                  )}
                  {!isEditing && rangeStart && (
                    <button
                      type="button"
                      onClick={() => {
                        setRangeStart(null);
                        setRangeEnd(null);
                        setDraft((d) => ({ ...d, date_start: '', date_end: '' }));
                      }}
                      className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                    >
                      Clear selection
                    </button>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {upcoming.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
          <h3 className="text-sm font-semibold text-slate-700">Upcoming</h3>
          {upcoming.map((item) => {
            if (item.type === 'hours') {
              const a = item.row;
              const active = isEditingHours && editing.date_start === a.date_start && editing.date_end === a.date_end;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => canManageUnavailability && editAmended(a)}
                  disabled={!canManageUnavailability}
                  className={`flex w-full items-start justify-between rounded-lg border p-3 text-left transition hover:bg-slate-50 disabled:cursor-default ${
                    active ? 'border-brand-300 bg-brand-50/30' : 'border-slate-100'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${AMENDED_CHIP}`}>Amended hours</span>
                      <span className="text-sm font-medium text-slate-700">{describeRange(a.date_start, a.date_end)}</span>
                      <span className="text-xs text-slate-400">
                        {a.periods.map((p) => `${p.start}–${p.end}`).join(', ')}
                      </span>
                    </div>
                    {a.reason && <p className="mt-1 text-xs text-slate-500">{a.reason}</p>}
                  </div>
                  {canManageUnavailability && <EditIcon />}
                </button>
              );
            }
            const p = item.row;
            const fullDay = isFullDayLeave(p);
            const blockType: CalendarBlockType = fullDay ? 'closed' : 'partial';
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => canManageUnavailability && editPeriod(p)}
                disabled={!canManageUnavailability}
                className={`flex w-full items-start justify-between rounded-lg border p-3 text-left transition hover:bg-slate-50 disabled:cursor-default ${
                  isEditingClosed && editing.id === p.id ? 'border-brand-300 bg-brand-50/30' : 'border-slate-100'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${BLOCK_TYPE_COLORS[blockType]}`}
                    >
                      {BLOCK_TYPE_LABELS[blockType]}
                    </span>
                    <span className="text-sm font-medium text-slate-700">{describeRange(p.start_date, p.end_date)}</span>
                    {!fullDay && p.unavailable_start_time && p.unavailable_end_time && (
                      <span className="text-xs text-slate-400">
                        {p.unavailable_start_time}–{p.unavailable_end_time} each day
                      </span>
                    )}
                  </div>
                  {p.notes && <p className="mt-1 text-xs text-slate-500">{p.notes}</p>}
                </div>
                {canManageUnavailability && <EditIcon />}
              </button>
            );
          })}
        </div>
      )}

      {past.length > 0 && (
        <details className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm text-sm">
          <summary className="cursor-pointer font-medium text-slate-500">
            Past entries ({past.length})
          </summary>
          <div className="mt-3 space-y-2">
            {past.map((item) => {
              const isHours = item.type === 'hours';
              const label = isHours ? 'Amended hours' : BLOCK_TYPE_LABELS[isFullDayLeave(item.row) ? 'closed' : 'partial'];
              const chip = isHours ? AMENDED_CHIP : BLOCK_TYPE_COLORS[isFullDayLeave(item.row) ? 'closed' : 'partial'];
              const range = isHours ? describeRange(item.row.date_start, item.row.date_end) : describeRange(item.row.start_date, item.row.end_date);
              const note = isHours ? item.row.reason : item.row.notes;
              return (
                <div
                  key={item.key}
                  className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs text-slate-400"
                >
                  <div>
                    <span className={`mr-2 rounded px-1.5 py-0.5 text-[10px] font-medium ${chip}`}>{label}</span>
                    {range}
                    {isHours ? ` – ${item.row.periods.map((p) => `${p.start}–${p.end}`).join(', ')}` : ''}
                    {note ? ` – ${note}` : ''}
                  </div>
                  {canManageUnavailability && (
                    <button
                      type="button"
                      onClick={() => void (isHours ? handleDeleteAmended(item.row) : handleDelete(item.row.id))}
                      className="rounded-lg p-1 text-slate-300 hover:bg-red-50 hover:text-red-500"
                      title="Delete"
                    >
                      <TrashIcon />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </details>
      )}

      {!loading && listItems.length === 0 && (
        <p className="text-center text-sm text-slate-400">
          No closures or amended hours for this calendar. Click dates on the calendar to add one.
        </p>
      )}

      {!canManageUnavailability && (
        <p className="text-sm text-slate-500">
          You cannot manage calendar unavailability until your account is assigned to a calendar. Ask an admin to link
          your staff profile to the right calendar column.
        </p>
      )}
    </section>
  );
}

function EditIcon() {
  return (
    <svg
      className="ml-2 mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
      />
    </svg>
  );
}
