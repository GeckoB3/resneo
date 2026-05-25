'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/ui/dashboard/PageHeader';

interface RecRow {
  id: string;
  venue_id: string;
  class_type_id: string;
  status: string;
  next_materialize_on: string | null;
  last_error: string | null;
  rule: {
    weekday?: number;
    start_time?: string;
    end_date?: string;
    max_occurrences?: number;
    interval_weeks?: number;
  } | null;
}

interface CatalogType {
  id: string;
  name: string;
  venue_id: string;
}

interface TimetableSlot {
  class_type_id: string;
  day_of_week: number;
  start_time: string;
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function formatRule(rule: RecRow['rule']): string {
  if (!rule || rule.weekday == null || !rule.start_time) return 'Rule not configured';
  const day = WEEKDAY_NAMES[rule.weekday] ?? `weekday ${rule.weekday}`;
  const time = String(rule.start_time).slice(0, 5);
  const interval =
    rule.interval_weeks && rule.interval_weeks > 1 ? ` every ${rule.interval_weeks} weeks` : ' weekly';
  const end = rule.end_date ? ` until ${rule.end_date}` : '';
  const max = rule.max_occurrences ? ` (max ${rule.max_occurrences})` : '';
  return `${day} ${time}${interval}${end}${max}`;
}

function friendlyError(raw: string | null): string | null {
  if (!raw) return null;
  if (/Class type not found/i.test(raw)) return 'This class type has been removed by the venue. Delete this rule.';
  if (/No upcoming sessions|No matching dates|No matching dates in window/i.test(raw))
    return "The venue has no scheduled sessions for this class. We'll check again next week.";
  if (/Auto-booking is only supported/i.test(raw))
    return "This class requires payment, so it can't be booked automatically. Book it manually each week.";
  if (/Invalid or missing rule/i.test(raw)) return 'This rule is invalid. Delete it and create a new one.';
  if (/max_occurrences reached/i.test(raw)) return 'Booked the full series. You can delete this rule.';
  return raw;
}

export function AccountRecurringSection() {
  const [rows, setRows] = useState<RecRow[]>([]);
  const [types, setTypes] = useState<Array<{ id: string; name: string }>>([]);
  const [venues, setVenues] = useState<Array<{ id: string; name: string }>>([]);
  const [catalog, setCatalog] = useState<{
    venues: Array<{ id: string; name: string }>;
    class_types: CatalogType[];
    timetable_slots: TimetableSlot[];
  }>({ venues: [], class_types: [], timetable_slots: [] });
  const [venueId, setVenueId] = useState('');
  const [classTypeId, setClassTypeId] = useState('');
  const [slotKey, setSlotKey] = useState('');
  const [endDate, setEndDate] = useState('');
  const [maxOccurrences, setMaxOccurrences] = useState('');
  const [intervalWeeks, setIntervalWeeks] = useState('1');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/account/class-recurring');
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Could not load');
      return;
    }
    setRows((data.reservations ?? []) as RecRow[]);
    setTypes((data.class_types ?? []) as Array<{ id: string; name: string }>);
    setVenues((data.venues ?? []) as Array<{ id: string; name: string }>);
    const rc = (data as { recurring_catalog?: { venues?: unknown[]; class_types?: unknown[]; timetable_slots?: unknown[] } })
      .recurring_catalog;
    setCatalog({
      venues: (rc?.venues ?? []) as Array<{ id: string; name: string }>,
      class_types: (rc?.class_types ?? []) as CatalogType[],
      timetable_slots: (rc?.timetable_slots ?? []) as TimetableSlot[],
    });
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  const resolvedVenueId = venueId || catalog.venues[0]?.id || '';

  const typeChoices = useMemo(
    () => catalog.class_types.filter((t) => t.venue_id === resolvedVenueId),
    [catalog.class_types, resolvedVenueId],
  );

  const firstTypeId = typeChoices[0]?.id ?? '';
  const effectiveClassTypeId =
    classTypeId && typeChoices.some((t) => t.id === classTypeId) ? classTypeId : firstTypeId;

  const slotChoices = useMemo(() => {
    if (!effectiveClassTypeId) return [] as TimetableSlot[];
    return catalog.timetable_slots
      .filter((s) => s.class_type_id === effectiveClassTypeId)
      .map((s) => ({ ...s, start_time: String(s.start_time).slice(0, 5) }));
  }, [catalog.timetable_slots, effectiveClassTypeId]);

  const firstSlotKey = slotChoices[0] ? `${slotChoices[0].day_of_week}|${slotChoices[0].start_time}` : '';
  const effectiveSlotKey = slotKey && slotChoices.some((s) => `${s.day_of_week}|${s.start_time}` === slotKey)
    ? slotKey
    : firstSlotKey;

  const typeName = (id: string) => types.find((t) => t.id === id)?.name ?? id.slice(0, 8);
  const venueName = (id: string) => venues.find((v) => v.id === id)?.name ?? id.slice(0, 8);

  async function createRule() {
    setError(null);
    setInfo(null);
    if (!resolvedVenueId || !effectiveClassTypeId) {
      setError('Choose a venue and class type.');
      return;
    }
    if (!effectiveSlotKey) {
      setError('Pick a scheduled slot for this class type.');
      return;
    }
    const [weekdayStr, startTime] = effectiveSlotKey.split('|');
    const weekday = Number(weekdayStr);
    const rule: Record<string, unknown> = {
      weekday,
      start_time: startTime,
      interval_weeks: Math.max(1, Number(intervalWeeks) || 1),
    };
    if (endDate) rule.end_date = endDate;
    const maxNum = Number(maxOccurrences);
    if (maxOccurrences && Number.isFinite(maxNum) && maxNum > 0) rule.max_occurrences = Math.floor(maxNum);

    setBusy('create');
    try {
      const res = await fetch('/api/account/class-recurring', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venue_id: resolvedVenueId,
          class_type_id: effectiveClassTypeId,
          rule,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Create failed');
        return;
      }
      setInfo('Recurring rule created. The nightly cron will start materialising bookings.');
      setEndDate('');
      setMaxOccurrences('');
      setIntervalWeeks('1');
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function patchRule(id: string, body: Record<string, unknown>, key: string) {
    setError(null);
    setInfo(null);
    setBusy(key);
    try {
      const res = await fetch(`/api/account/class-recurring/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Update failed');
        return;
      }
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function deleteRule(id: string) {
    setError(null);
    setInfo(null);
    if (!window.confirm('Delete this recurring rule? Future bookings will no longer be made automatically.')) {
      return;
    }
    setBusy(`delete:${id}`);
    try {
      const res = await fetch(`/api/account/class-recurring/${id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? 'Delete failed');
        return;
      }
      await load();
    } finally {
      setBusy(null);
    }
  }

  const hasCatalog = catalog.venues.length > 0;
  const hasSlotsForType = slotChoices.length > 0;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Account"
        title="Recurring class reservations"
        subtitle="Set up a weekday + time and we'll book the class for you each week. Requires an active membership that allows recurring booking."
      />
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      ) : null}
      {info ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{info}</div>
      ) : null}

      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/5 sm:p-6">
        <h2 className="text-sm font-semibold text-slate-900">Your rules</h2>
        {rows.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">None yet.</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm">
            {rows.map((r) => {
              const friendly = friendlyError(r.last_error);
              return (
                <li key={r.id} className="rounded-lg bg-slate-50 px-3 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900">{typeName(r.class_type_id)}</div>
                      <div className="text-xs text-slate-600">
                        {venueName(r.venue_id)} · {r.status}
                        {r.next_materialize_on ? ` · next ${r.next_materialize_on}` : ''}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-700">{formatRule(r.rule)}</div>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs">
                      {r.status === 'active' ? (
                        <button
                          type="button"
                          disabled={busy === `pause:${r.id}`}
                          onClick={() => void patchRule(r.id, { status: 'paused', clear_error: true }, `pause:${r.id}`)}
                          className="rounded border border-slate-300 bg-white px-2 py-1 font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                        >
                          Pause
                        </button>
                      ) : r.status === 'paused' ? (
                        <button
                          type="button"
                          disabled={busy === `resume:${r.id}`}
                          onClick={() => void patchRule(r.id, { status: 'active', clear_error: true }, `resume:${r.id}`)}
                          className="rounded border border-slate-300 bg-white px-2 py-1 font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                        >
                          Resume
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={busy === `delete:${r.id}`}
                        onClick={() => void deleteRule(r.id)}
                        className="rounded border border-red-300 bg-white px-2 py-1 font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  {friendly ? (
                    <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900">
                      {friendly}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/5 sm:p-6">
        <h2 className="text-sm font-semibold text-slate-900">New rule</h2>
        {!hasCatalog ? (
          <p className="mt-3 text-sm text-slate-500">No active class types found.</p>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs text-slate-600">
              Venue
              <select
                value={resolvedVenueId}
                onChange={(e) => {
                  setVenueId(e.target.value);
                  setClassTypeId('');
                  setSlotKey('');
                }}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-2 text-sm"
              >
                {catalog.venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-600">
              Class type
              <select
                value={effectiveClassTypeId}
                onChange={(e) => {
                  setClassTypeId(e.target.value);
                  setSlotKey('');
                }}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-2 text-sm"
              >
                {typeChoices.length === 0 ? (
                  <option value="">No class types at this venue</option>
                ) : (
                  typeChoices.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))
                )}
              </select>
            </label>
            <label className="text-xs text-slate-600">
              Scheduled slot
              <select
                value={effectiveSlotKey}
                onChange={(e) => setSlotKey(e.target.value)}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-2 text-sm"
                disabled={!hasSlotsForType}
              >
                {!hasSlotsForType ? (
                  <option value="">No scheduled slots for this class type</option>
                ) : (
                  slotChoices.map((s) => {
                    const k = `${s.day_of_week}|${s.start_time}`;
                    return (
                      <option key={k} value={k}>
                        {WEEKDAY_NAMES[s.day_of_week]} at {s.start_time}
                      </option>
                    );
                  })
                )}
              </select>
            </label>
            <label className="text-xs text-slate-600">
              Repeat every
              <select
                value={intervalWeeks}
                onChange={(e) => setIntervalWeeks(e.target.value)}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-2 text-sm"
              >
                <option value="1">1 week (weekly)</option>
                <option value="2">2 weeks (fortnightly)</option>
                <option value="3">3 weeks</option>
                <option value="4">4 weeks (monthly)</option>
              </select>
            </label>
            <label className="text-xs text-slate-600">
              End date (optional)
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-2 text-sm"
              />
            </label>
            <label className="text-xs text-slate-600">
              Max bookings (optional)
              <input
                type="number"
                min={1}
                max={104}
                value={maxOccurrences}
                onChange={(e) => setMaxOccurrences(e.target.value)}
                placeholder="e.g. 12"
                className="mt-1 w-full rounded border border-slate-300 px-2 py-2 text-sm"
              />
            </label>
            <div className="sm:col-span-2">
              <button
                type="button"
                disabled={!effectiveClassTypeId || !hasSlotsForType || busy === 'create'}
                onClick={() => void createRule()}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy === 'create' ? 'Creating…' : 'Create rule'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
