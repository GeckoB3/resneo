'use client';

import { useCallback, useState } from 'react';
import type { VenueSettings, AvailabilityConfigSettings, FixedIntervalsSettings, NamedSittingsSettings, NamedSittingSettings } from '../types';
import { NumericInput } from '@/components/ui/NumericInput';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { readResponseJson } from '@/lib/http/read-response-json';

const DAYS = [
  { key: '0', label: 'Sun' },
  { key: '1', label: 'Mon' },
  { key: '2', label: 'Tue' },
  { key: '3', label: 'Wed' },
  { key: '4', label: 'Thu' },
  { key: '5', label: 'Fri' },
  { key: '6', label: 'Sat' },
];

const defaultFixed: FixedIntervalsSettings = {
  model: 'fixed_intervals',
  interval_minutes: 30,
  max_covers_by_day: { '0': 0, '1': 40, '2': 40, '3': 40, '4': 40, '5': 40, '6': 40 },
  turn_time_enabled: false,
  sitting_duration_minutes: 90,
};

const defaultNamed: NamedSittingsSettings = {
  model: 'named_sittings',
  sittings: [
    { id: '1', name: 'Lunch', start_time: '12:00', end_time: '15:00', max_covers: 30 },
    { id: '2', name: 'Dinner', start_time: '18:00', end_time: '22:00', max_covers: 40 },
  ],
};

function isFixed(c: AvailabilityConfigSettings | null): c is FixedIntervalsSettings {
  return c?.model === 'fixed_intervals';
}

interface AvailabilityConfigSectionProps {
  venue: VenueSettings;
  onUpdate: (patch: Partial<VenueSettings>) => void;
  isAdmin: boolean;
}

export function AvailabilityConfigSection({ venue, onUpdate, isAdmin }: AvailabilityConfigSectionProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const config = venue.availability_config ?? defaultFixed;
  const [local, setLocal] = useState<AvailabilityConfigSettings>(config);
  const [blockedDateInput, setBlockedDateInput] = useState('');

  const save = useCallback(async () => {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch('/api/venue/availability-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(local),
      });
      const body = await readResponseJson<{ error?: string; availability_config?: AvailabilityConfigSettings }>(res);
      if (!res.ok) {
        throw new Error(body.error ?? 'Failed to save');
      }
      if (!body.availability_config) {
        throw new Error('Failed to save');
      }
      onUpdate({ availability_config: body.availability_config });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [local, onUpdate]);

  const setModel = useCallback((model: 'fixed_intervals' | 'named_sittings') => {
    if (model === 'fixed_intervals') setLocal(defaultFixed);
    else setLocal(defaultNamed);
  }, []);

  const updateFixed = useCallback((patch: Partial<FixedIntervalsSettings>) => {
    setLocal((prev) => (isFixed(prev) ? { ...prev, ...patch } : { ...defaultFixed, ...patch }));
  }, []);

  const updateNamedSittings = useCallback((sittings: NamedSittingSettings[]) => {
    setLocal((prev) => (prev.model === 'named_sittings' ? { ...prev, sittings } : { ...defaultNamed, sittings }));
  }, []);

  const updateBlockedDates = useCallback((blocked_dates: string[]) => {
    setLocal((prev) => ({ ...prev, blocked_dates }));
  }, []);

  const addSitting = useCallback(() => {
    const prev = local.model === 'named_sittings' ? local : defaultNamed;
    const id = String(Date.now());
    updateNamedSittings([...prev.sittings, { id, name: 'New sitting', start_time: '19:00', end_time: '21:00', max_covers: 30 }]);
  }, [local, updateNamedSittings]);

  const removeSitting = useCallback((id: string) => {
    const prev = local.model === 'named_sittings' ? local : defaultNamed;
    updateNamedSittings(prev.sittings.filter((s) => s.id !== id));
  }, [local, updateNamedSittings]);

  const updateSitting = useCallback((id: string, patch: Partial<NamedSittingSettings>) => {
    const prev = local.model === 'named_sittings' ? local : defaultNamed;
    updateNamedSittings(prev.sittings.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, [local, updateNamedSittings]);

  return (
    <SectionCard elevated>
      <SectionCard.Header eyebrow="Capacity" title="Availability config" />
      <SectionCard.Body>
      {isAdmin && (
        <div className="mb-4 flex gap-4">
          <label className="flex items-center gap-2">
            <input type="radio" name="slotModel" checked={local.model === 'fixed_intervals'} onChange={() => setModel('fixed_intervals')} className="rounded" />
            <span className="text-sm">Fixed intervals</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="slotModel" checked={local.model === 'named_sittings'} onChange={() => setModel('named_sittings')} className="rounded" />
            <span className="text-sm">Named sittings</span>
          </label>
        </div>
      )}

      {local.model === 'fixed_intervals' ? (
        <div className="space-y-4">
          <div>
            <span className="block text-sm font-medium text-neutral-700 mb-1">Interval</span>
            <select
              value={local.interval_minutes}
              onChange={(e) => updateFixed({ interval_minutes: Number(e.target.value) as 15 | 30 })}
              disabled={!isAdmin}
              className="rounded border border-neutral-300 px-3 py-2 disabled:bg-neutral-50"
            >
              <option value={15}>15 minutes</option>
              <option value={30}>30 minutes</option>
            </select>
          </div>
          <div>
            <span className="block text-sm font-medium text-neutral-700 mb-2">Max covers per slot (by day)</span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {DAYS.map(({ key, label }) => (
                <div key={key}>
                  <label className="block text-xs text-neutral-500">{label}</label>
                  <NumericInput
                    min={0}
                    value={local.max_covers_by_day?.[key] ?? 0}
                    onChange={(v) => updateFixed({ max_covers_by_day: { ...local.max_covers_by_day, [key]: v } })}
                    disabled={!isAdmin}
                    className="w-full rounded border border-neutral-300 px-2 py-1 text-sm disabled:bg-neutral-50"
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={local.turn_time_enabled ?? false}
                onChange={(e) => updateFixed({ turn_time_enabled: e.target.checked })}
                disabled={!isAdmin}
                className="rounded"
              />
              <span className="text-sm">Turn-time (sitting duration)</span>
            </label>
          </div>
          {local.turn_time_enabled && (
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">Sitting duration (minutes)</label>
              <NumericInput
                min={60}
                max={180}
                value={local.sitting_duration_minutes ?? 90}
                onChange={(v) => updateFixed({ sitting_duration_minutes: v })}
                disabled={!isAdmin}
                className="w-24 rounded border border-neutral-300 px-3 py-2 disabled:bg-neutral-50"
              />
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-neutral-600">Add or edit sittings (e.g. Lunch, Dinner). Each has name, start/end time, and max covers.</p>
          {(local as NamedSittingsSettings).sittings.map((s) => (
            <div key={s.id} className="rounded border border-neutral-200 p-4 flex flex-wrap items-center gap-4">
              <input
                type="text"
                value={s.name}
                onChange={(e) => updateSitting(s.id, { name: e.target.value })}
                disabled={!isAdmin}
                placeholder="Sitting name"
                className="rounded border border-neutral-300 px-3 py-2 w-32 disabled:bg-neutral-50"
              />
              <input type="time" value={s.start_time} onChange={(e) => updateSitting(s.id, { start_time: e.target.value })} disabled={!isAdmin} className="rounded border border-neutral-300 px-2 py-1 disabled:bg-neutral-50" />
              <span className="text-neutral-500">–</span>
              <input type="time" value={s.end_time} onChange={(e) => updateSitting(s.id, { end_time: e.target.value })} disabled={!isAdmin} className="rounded border border-neutral-300 px-2 py-1 disabled:bg-neutral-50" />
              <label className="flex items-center gap-1">
                <span className="text-sm text-neutral-600">Max covers</span>
                <NumericInput
                  min={0}
                  value={s.max_covers}
                  onChange={(v) => updateSitting(s.id, { max_covers: v })}
                  disabled={!isAdmin}
                  className="w-20 rounded border border-neutral-300 px-2 py-1 text-sm disabled:bg-neutral-50"
                />
              </label>
              {isAdmin && (
                <button type="button" onClick={() => removeSitting(s.id)} className="text-sm text-red-600 hover:underline">
                  Remove
                </button>
              )}
            </div>
          ))}
          {isAdmin && (
            <button type="button" onClick={addSitting} className="text-sm text-blue-600 hover:underline">
              + Add sitting
            </button>
          )}
        </div>
      )}

      <div className="mt-4 rounded border border-neutral-200 bg-neutral-50 p-3">
        <p className="mb-2 text-sm font-medium text-neutral-700">Blocked dates</p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={blockedDateInput}
            onChange={(e) => setBlockedDateInput(e.target.value)}
            disabled={!isAdmin}
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm disabled:bg-neutral-100"
          />
          <button
            type="button"
            disabled={!isAdmin || !blockedDateInput}
            onClick={() => {
              if (!blockedDateInput) return;
              const next = new Set(local.blocked_dates ?? []);
              next.add(blockedDateInput);
              updateBlockedDates([...next].sort());
              setBlockedDateInput('');
            }}
            className="rounded bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            Add blocked date
          </button>
        </div>
        {(local.blocked_dates ?? []).length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(local.blocked_dates ?? []).map((dateValue) => (
              <button
                key={dateValue}
                type="button"
                disabled={!isAdmin}
                onClick={() => updateBlockedDates((local.blocked_dates ?? []).filter((d) => d !== dateValue))}
                className="rounded-full border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-100 disabled:opacity-60"
              >
                {dateValue} ×
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs text-neutral-500">No blocked dates configured.</p>
        )}
      </div>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {isAdmin && (
        <button type="button" onClick={save} disabled={saving} className="mt-4 rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save availability config'}
        </button>
      )}
      </SectionCard.Body>
    </SectionCard>
  );
}
