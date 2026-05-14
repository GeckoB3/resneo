'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { NumericInput } from '@/components/ui/NumericInput';
import { isRestaurantTableProductTier } from '@/lib/tier-enforcement';
import type { VenueSettings } from '../types';
import {
  ResourceExceptionsCalendar,
  type ExceptionDayValue,
} from '@/app/dashboard/resource-timeline/ResourceExceptionsCalendar';
import { Skeleton } from '@/components/ui/Skeleton';
import { readResponseJson } from '@/lib/http/read-response-json';

type BlockType = 'closed' | 'amended_hours' | 'reduced_capacity' | 'special_event';

interface Block {
  id: string;
  venue_id: string;
  service_id: string | null;
  block_type: BlockType;
  date_start: string;
  date_end: string;
  time_start: string | null;
  time_end: string | null;
  override_max_covers: number | null;
  reason: string | null;
  yield_overrides?: Record<string, number> | null;
  override_periods?: Array<{ open: string; close: string }> | null;
}

interface ServiceLite {
  id: string;
  name: string;
}

interface BusinessClosuresSectionProps {
  bookingModel: string;
  venue: VenueSettings;
  isAdmin: boolean;
  onUpdate: (patch: Partial<VenueSettings>) => void;
  onInitialLoadComplete?: () => void;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

const BLOCK_TYPE_LABELS: Record<string, string> = {
  closed: 'Closure',
  amended_hours: 'Amended Hours',
  reduced_capacity: 'Reduced Capacity',
  special_event: 'Special Event',
};

const BLOCK_TYPE_COLORS: Record<string, string> = {
  closed: 'bg-red-100 text-red-700',
  amended_hours: 'bg-amber-100 text-amber-700',
  reduced_capacity: 'bg-orange-100 text-orange-700',
  special_event: 'bg-blue-100 text-blue-700',
};

const BLOCK_PRIORITY: Record<string, number> = {
  closed: 3,
  special_event: 3,
  amended_hours: 2,
  reduced_capacity: 1,
};

function bestBlockForDay(blocks: Block[], ymd: string): Block | null {
  let best: Block | null = null;
  let bestPri = -1;
  for (const b of blocks) {
    if (ymd < b.date_start || ymd > b.date_end) continue;
    const pri = BLOCK_PRIORITY[b.block_type] ?? 0;
    if (pri > bestPri) {
      best = b;
      bestPri = pri;
    }
  }
  return best;
}

function blocksToCalendarMap(blocks: Block[], year: number, month: number): Record<string, ExceptionDayValue> {
  const lastDay = new Date(year, month, 0).getDate();
  const map: Record<string, ExceptionDayValue> = {};
  for (let d = 1; d <= lastDay; d++) {
    const ymd = `${year}-${pad2(month)}-${pad2(d)}`;
    const b = bestBlockForDay(blocks, ymd);
    if (!b) continue;
    if (b.block_type === 'closed' || b.block_type === 'special_event') {
      map[ymd] = { closed: true };
    } else if (b.block_type === 'amended_hours' && b.override_periods?.length) {
      map[ymd] = {
        periods: b.override_periods.map((p) => ({ start: p.open.slice(0, 5), end: p.close.slice(0, 5) })),
      };
    } else if (b.block_type === 'reduced_capacity') {
      map[ymd] = { reducedCapacity: true, maxCovers: b.override_max_covers ?? undefined };
    }
  }
  return map;
}

interface DraftState {
  block_type: BlockType;
  service_id: string;
  date_start: string;
  date_end: string;
  time_start: string | null;
  time_end: string | null;
  override_max_covers: number | null;
  reason: string;
  p1Open: string;
  p1Close: string;
  p2Open: string;
  p2Close: string;
  yield_max_bookings: number | null;
  yield_interval: number | null;
  yield_buffer: number | null;
  yield_duration: number | null;
}

function emptyDraft(): DraftState {
  return {
    block_type: 'closed',
    service_id: '',
    date_start: '',
    date_end: '',
    time_start: null,
    time_end: null,
    override_max_covers: null,
    reason: '',
    p1Open: '',
    p1Close: '',
    p2Open: '',
    p2Close: '',
    yield_max_bookings: null,
    yield_interval: null,
    yield_buffer: null,
    yield_duration: null,
  };
}

function draftFromBlock(b: Block): DraftState {
  const periods = b.override_periods ?? [];
  const yo = b.yield_overrides as Record<string, number> | null;
  return {
    block_type: b.block_type,
    service_id: b.service_id ?? '',
    date_start: b.date_start,
    date_end: b.date_end,
    time_start: b.time_start,
    time_end: b.time_end,
    override_max_covers: b.override_max_covers,
    reason: b.reason ?? '',
    p1Open: periods[0]?.open ?? '',
    p1Close: periods[0]?.close ?? '',
    p2Open: periods[1]?.open ?? '',
    p2Close: periods[1]?.close ?? '',
    yield_max_bookings: yo?.max_bookings_per_slot ?? null,
    yield_interval: yo?.slot_interval_minutes ?? null,
    yield_buffer: yo?.buffer_minutes ?? null,
    yield_duration: yo?.duration_minutes ?? null,
  };
}

function draftToPayload(d: DraftState) {
  const base: Record<string, unknown> = {
    block_type: d.block_type,
    service_id: d.service_id || null,
    date_start: d.date_start,
    date_end: d.date_end,
    time_start: d.block_type === 'closed' ? (d.time_start || null) : null,
    time_end: d.block_type === 'closed' ? (d.time_end || null) : null,
    reason: d.reason || null,
    override_max_covers: null,
    yield_overrides: null,
    override_periods: null,
  };
  if (d.block_type === 'amended_hours') {
    const periods: Array<{ open: string; close: string }> = [];
    if (d.p1Open && d.p1Close) periods.push({ open: d.p1Open, close: d.p1Close });
    if (d.p2Open && d.p2Close) periods.push({ open: d.p2Open, close: d.p2Close });
    base.override_periods = periods.length > 0 ? periods : null;
  }
  if (d.block_type === 'reduced_capacity') {
    base.override_max_covers = d.override_max_covers;
    const yo: Record<string, number> = {};
    if (d.yield_max_bookings != null) yo.max_bookings_per_slot = d.yield_max_bookings;
    if (d.yield_interval != null) yo.slot_interval_minutes = d.yield_interval;
    if (d.yield_buffer != null) yo.buffer_minutes = d.yield_buffer;
    if (d.yield_duration != null) yo.duration_minutes = d.yield_duration;
    base.yield_overrides = Object.keys(yo).length > 0 ? yo : null;
  }
  return base;
}

export function BusinessClosuresSection({
  bookingModel: _bm,
  venue,
  isAdmin,
  onUpdate: _onUpdate,
  onInitialLoadComplete,
}: BusinessClosuresSectionProps) {
  useEffect(() => {
    if (!isAdmin) onInitialLoadComplete?.();
  }, [isAdmin, onInitialLoadComplete]);

  if (!isAdmin) return null;
  return <UnifiedBlocksEditor venue={venue} onInitialLoadComplete={onInitialLoadComplete} />;
}

function UnifiedBlocksEditor({
  venue,
  onInitialLoadComplete,
}: {
  venue: VenueSettings;
  onInitialLoadComplete?: () => void;
}) {
  const isRestaurant = isRestaurantTableProductTier(venue.pricing_tier ?? null);

  const [blocks, setBlocks] = useState<Block[]>([]);
  const [services, setServices] = useState<ServiceLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nowDate = new Date();
  const [calYear, setCalYear] = useState(nowDate.getFullYear());
  const [calMonth, setCalMonth] = useState(nowDate.getMonth() + 1);
  const [rangeStart, setRangeStart] = useState<string | null>(null);
  const [rangeEnd, setRangeEnd] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftState>(emptyDraft);

  const reload = useCallback(async () => {
    try {
      const [blocksRes, servicesRes] = await Promise.all([
        fetch('/api/venue/availability-blocks'),
        isRestaurant ? fetch('/api/venue/services') : Promise.resolve(null),
      ]);
      if (blocksRes.ok) {
        const data = await blocksRes.json();
        setBlocks(data.blocks ?? []);
      }
      if (servicesRes?.ok) {
        const data = await servicesRes.json();
        setServices(data.services ?? []);
      }
    } finally {
      setLoading(false);
      onInitialLoadComplete?.();
    }
  }, [isRestaurant, onInitialLoadComplete]);

  useEffect(() => { reload(); }, [reload]);

  const calendarExceptions = useMemo(
    () => blocksToCalendarMap(blocks, calYear, calMonth),
    [blocks, calYear, calMonth],
  );

  const prevMonth = useCallback(() => {
    setCalMonth((m) => {
      if (m === 1) { setCalYear((y) => y - 1); return 12; }
      return m - 1;
    });
  }, []);
  const nextMonth = useCallback(() => {
    setCalMonth((m) => {
      if (m === 12) { setCalYear((y) => y + 1); return 1; }
      return m + 1;
    });
  }, []);

  const handleDayClick = useCallback(
    (ymd: string) => {
      if (editingId) {
        const b = blocks.find((x) => x.id === editingId);
        if (b) {
          setEditingId(null);
          setDraft(emptyDraft());
          setRangeStart(null);
          setRangeEnd(null);
        }
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
    [editingId, rangeStart, rangeEnd, blocks],
  );

  const editBlock = useCallback((b: Block) => {
    setEditingId(b.id);
    setDraft(draftFromBlock(b));
    setRangeStart(b.date_start);
    setRangeEnd(b.date_end);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setDraft(emptyDraft());
    setRangeStart(null);
    setRangeEnd(null);
    setError(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!draft.date_start || !draft.date_end) return;
    if (draft.block_type === 'amended_hours' && !draft.p1Open && !draft.p1Close) {
      setError('At least one open period is required for amended hours.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = draftToPayload(draft);
      const method = editingId ? 'PATCH' : 'POST';
      const body = editingId ? { id: editingId, ...payload } : payload;
      const res = await fetch('/api/venue/availability-blocks', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await readResponseJson<{ error?: string; block?: Block }>(res);
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save');
      }
      if (!data.block) {
        throw new Error('Failed to save');
      }
      if (editingId) {
        setBlocks((prev) => prev.map((b) => (b.id === editingId ? data.block! : b)));
      } else {
        setBlocks((prev) => [...prev, data.block!]);
      }
      cancelEdit();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [draft, editingId, cancelEdit]);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('Remove this block?')) return;
    try {
      await fetch('/api/venue/availability-blocks', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      setBlocks((prev) => prev.filter((b) => b.id !== id));
      if (editingId === id) cancelEdit();
    } catch {
      setError('Failed to delete');
    }
  }, [editingId, cancelEdit]);

  const today = new Date().toISOString().slice(0, 10);
  const futureBlocks = useMemo(
    () => blocks.filter((b) => b.date_end >= today).sort((a, b) => a.date_start.localeCompare(b.date_start)),
    [blocks, today],
  );
  const pastBlocks = useMemo(
    () => blocks.filter((b) => b.date_end < today).sort((a, b) => b.date_start.localeCompare(a.date_start)),
    [blocks, today],
  );

  const blockTypeOptions: { value: BlockType; label: string }[] = [
    { value: 'closed', label: 'Closure' },
    { value: 'amended_hours', label: 'Amended Hours' },
  ];
  if (isRestaurant) {
    blockTypeOptions.push({ value: 'reduced_capacity', label: 'Reduced Capacity' });
  }

  if (loading) {
    return (
      <Skeleton.Card className="space-y-4">
        <Skeleton.Line className="h-6 w-64" />
        <Skeleton.Line className="w-full max-w-xl" />
        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <Skeleton.Block className="h-80" />
          <div className="space-y-3">
            <Skeleton.Block className="h-11" />
            <Skeleton.Block className="h-11" />
            <Skeleton.Block className="h-24" />
          </div>
        </div>
      </Skeleton.Card>
    );
  }

  return (
    <section className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Closures, Amended Hours &amp; Capacity</h2>
        <p className="text-xs text-slate-500 leading-relaxed">
          Manage closures and amended hours (applied to all booking types) and reduced capacity (table bookings only).
          Click dates on the calendar to select a range, then fill in the details below.
        </p>

        <ResourceExceptionsCalendar
          year={calYear}
          month={calMonth}
          onPrevMonth={prevMonth}
          onNextMonth={nextMonth}
          exceptions={calendarExceptions}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          editingDay={editingId ? draft.date_start : null}
          onDayClick={handleDayClick}
        />

        {/* Form panel */}
        <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-slate-800">
            {editingId ? 'Edit Block' : 'New Block'}
          </h3>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-600">Type</label>
              <select
                value={draft.block_type}
                onChange={(e) => setDraft({ ...draft, block_type: e.target.value as BlockType })}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {blockTypeOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Start date</label>
              <input
                type="date"
                value={draft.date_start}
                onChange={(e) => setDraft({ ...draft, date_start: e.target.value, date_end: draft.date_end || e.target.value })}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">End date</label>
              <input
                type="date"
                value={draft.date_end}
                onChange={(e) => setDraft({ ...draft, date_end: e.target.value })}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              />
            </div>

            {draft.block_type === 'closed' && (
              <>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Start time (optional, for partial-day)</label>
                  <input
                    type="time"
                    value={draft.time_start ?? ''}
                    onChange={(e) => setDraft({ ...draft, time_start: e.target.value || null })}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">End time (optional)</label>
                  <input
                    type="time"
                    value={draft.time_end ?? ''}
                    onChange={(e) => setDraft({ ...draft, time_end: e.target.value || null })}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  />
                </div>
              </>
            )}

            {draft.block_type === 'amended_hours' && (
              <>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Period 1 open</label>
                  <input
                    type="time"
                    value={draft.p1Open}
                    onChange={(e) => setDraft({ ...draft, p1Open: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Period 1 close</label>
                  <input
                    type="time"
                    value={draft.p1Close}
                    onChange={(e) => setDraft({ ...draft, p1Close: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Period 2 open (optional)</label>
                  <input
                    type="time"
                    value={draft.p2Open}
                    onChange={(e) => setDraft({ ...draft, p2Open: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Period 2 close (optional)</label>
                  <input
                    type="time"
                    value={draft.p2Close}
                    onChange={(e) => setDraft({ ...draft, p2Close: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  />
                </div>
              </>
            )}

            {draft.block_type === 'reduced_capacity' && (
              <>
                {services.length > 0 && (
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-xs font-medium text-slate-600">Service scope</label>
                    <select
                      value={draft.service_id}
                      onChange={(e) => setDraft({ ...draft, service_id: e.target.value })}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                    >
                      <option value="">All services</option>
                      {services.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-medium text-slate-600">Override max covers</label>
                  <NumericInput
                    min={0}
                    value={draft.override_max_covers}
                    onChange={(v) => setDraft({ ...draft, override_max_covers: v })}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  />
                </div>
                <div className="sm:col-span-2 grid grid-cols-2 gap-2 rounded-lg border border-amber-100 bg-amber-50/30 p-2">
                  <p className="col-span-2 text-[10px] font-medium text-amber-900">Optional yield overrides</p>
                  <div>
                    <label className="text-[10px] text-slate-600">Max bookings / slot</label>
                    <NumericInput min={1} value={draft.yield_max_bookings} onChange={(v) => setDraft({ ...draft, yield_max_bookings: v })} className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-sm" />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-600">Slot interval (min)</label>
                    <NumericInput min={5} value={draft.yield_interval} onChange={(v) => setDraft({ ...draft, yield_interval: v })} className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-sm" />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-600">Buffer (min)</label>
                    <NumericInput min={0} value={draft.yield_buffer} onChange={(v) => setDraft({ ...draft, yield_buffer: v })} className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-sm" />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-600">Duration (min)</label>
                    <NumericInput min={15} value={draft.yield_duration} onChange={(v) => setDraft({ ...draft, yield_duration: v })} className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-sm" />
                  </div>
                </div>
              </>
            )}

            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-600">Reason (optional)</label>
              <input
                type="text"
                value={draft.reason}
                onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
                placeholder="e.g. Bank Holiday, Staff training, Private event"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              />
            </div>
          </div>

          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={saving || !draft.date_start || !draft.date_end}
              onClick={handleSave}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Add to Calendar'}
            </button>
            {editingId && (
              <>
                <button
                  type="button"
                  onClick={() => handleDelete(editingId)}
                  className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
              </>
            )}
            {!editingId && rangeStart && (
              <button
                type="button"
                onClick={() => { setRangeStart(null); setRangeEnd(null); setDraft((d) => ({ ...d, date_start: '', date_end: '' })); }}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Clear Selection
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Upcoming blocks */}
      {futureBlocks.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
          <h3 className="text-sm font-semibold text-slate-700">Upcoming</h3>
          {futureBlocks.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => editBlock(b)}
              className={`flex w-full items-start justify-between rounded-lg border p-3 text-left transition hover:bg-slate-50 ${editingId === b.id ? 'border-brand-300 bg-brand-50/30' : 'border-slate-100'}`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${BLOCK_TYPE_COLORS[b.block_type] ?? 'bg-slate-100 text-slate-700'}`}>
                    {BLOCK_TYPE_LABELS[b.block_type] ?? b.block_type}
                  </span>
                  <span className="text-sm font-medium text-slate-700">
                    {b.date_start === b.date_end ? b.date_start : `${b.date_start} – ${b.date_end}`}
                  </span>
                  {b.time_start && b.time_end && (
                    <span className="text-xs text-slate-400">{b.time_start}–{b.time_end}</span>
                  )}
                </div>
                {b.block_type === 'amended_hours' && b.override_periods?.length && (
                  <p className="mt-1 text-xs text-amber-600">
                    {b.override_periods.map((p) => `${p.open}–${p.close}`).join(', ')}
                  </p>
                )}
                {b.override_max_covers != null && (
                  <p className="mt-1 text-xs text-orange-600">Reduced to {b.override_max_covers} covers</p>
                )}
                {b.reason && <p className="mt-1 text-xs text-slate-500">{b.reason}</p>}
                {b.service_id && (
                  <p className="mt-0.5 text-xs text-slate-400">
                    Service: {services.find((s) => s.id === b.service_id)?.name ?? b.service_id.slice(0, 8)}
                  </p>
                )}
              </div>
              <svg className="h-4 w-4 flex-shrink-0 text-slate-400 ml-2 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" />
              </svg>
            </button>
          ))}
        </div>
      )}

      {/* Past blocks */}
      {pastBlocks.length > 0 && (
        <details className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm text-sm">
          <summary className="cursor-pointer font-medium text-slate-500">Past blocks ({pastBlocks.length})</summary>
          <div className="mt-3 space-y-2">
            {pastBlocks.map((b) => (
              <div key={b.id} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs text-slate-400">
                <div>
                  <span className={`mr-2 rounded px-1.5 py-0.5 text-[10px] font-medium ${BLOCK_TYPE_COLORS[b.block_type] ?? 'bg-slate-100 text-slate-700'}`}>
                    {BLOCK_TYPE_LABELS[b.block_type] ?? b.block_type}
                  </span>
                  {b.date_start === b.date_end ? b.date_start : `${b.date_start} – ${b.date_end}`}
                  {b.reason && ` – ${b.reason}`}
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(b.id)}
                  className="rounded-lg p-1 text-slate-300 hover:bg-red-50 hover:text-red-500"
                  title="Delete"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </details>
      )}

      {blocks.length === 0 && (
        <p className="text-center text-sm text-slate-400">No closures, amended hours, or capacity blocks configured.</p>
      )}
    </section>
  );
}
