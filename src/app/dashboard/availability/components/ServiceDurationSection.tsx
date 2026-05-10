'use client';

import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { NumericInput } from '@/components/ui/NumericInput';
import { useDebouncedCallback } from '@/lib/use-debounced-callback';
import type { PartySizeDuration } from '@/app/dashboard/availability/service-settings-types';
import { DAY_LABELS, DURATION_SMART_DEFAULTS } from '@/app/dashboard/availability/service-settings-types';

const AUTOSAVE_MS = 650;

const FIELD_CLASS =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100';

interface Props {
  serviceId: string;
  serviceName: string;
  durations: PartySizeDuration[];
  showToast: (msg: string) => void;
  onDurationsChange: (next: PartySizeDuration[]) => void;
}

function DurationBandFields({
  data,
  onChange,
}: {
  data: Pick<PartySizeDuration, 'min_party_size' | 'max_party_size' | 'duration_minutes' | 'day_of_week'>;
  onChange: (patch: Partial<Pick<PartySizeDuration, 'min_party_size' | 'max_party_size' | 'duration_minutes' | 'day_of_week'>>) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr]">
      <div className="rounded-2xl border border-brand-100 bg-brand-50/50 p-4">
        <label className="mb-1 block text-sm font-semibold text-slate-900">Party size band</label>
        <p className="mb-3 text-xs text-slate-600">Guests this duration applies to.</p>
        <div className="flex items-center gap-2">
          <NumericInput min={1} value={data.min_party_size} onChange={(v) => onChange({ min_party_size: v })} className={FIELD_CLASS} aria-label="Minimum party size" />
          <span className="text-xs text-slate-400">to</span>
          <NumericInput min={1} value={data.max_party_size} onChange={(v) => onChange({ max_party_size: v })} className={FIELD_CLASS} aria-label="Maximum party size" />
        </div>
      </div>
      <div className="rounded-2xl border border-brand-100 bg-brand-50/50 p-4">
        <label className="mb-1 block text-sm font-semibold text-slate-900">Dining time</label>
        <p className="mb-3 text-xs text-slate-600">From seating to departure.</p>
        <NumericInput min={15} value={data.duration_minutes} onChange={(v) => onChange({ duration_minutes: v })} className={FIELD_CLASS} />
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="mb-1 block text-sm font-semibold text-slate-900">Applies on</label>
        <p className="mb-3 text-xs text-slate-500">Use a day override when needed.</p>
        <select value={data.day_of_week ?? ''} onChange={(e) => onChange({ day_of_week: e.target.value ? parseInt(e.target.value, 10) : null })} className={FIELD_CLASS}>
          <option value="">All days</option>
          {DAY_LABELS.map((d, i) => (
            <option key={i} value={i}>
              {d}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

async function createDurationApi(
  serviceId: string,
  minPs: number,
  maxPs: number,
  dur: number,
  dayOfWeek: number | null = null,
): Promise<PartySizeDuration> {
  const res = await fetch('/api/venue/party-size-durations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: serviceId,
      min_party_size: minPs,
      max_party_size: maxPs,
      duration_minutes: dur,
      day_of_week: dayOfWeek,
    }),
  });
  if (!res.ok) throw new Error('Failed to create duration');
  const data = (await res.json()) as { duration: PartySizeDuration };
  return data.duration;
}

export function ServiceDurationSection({ serviceId, serviceName, durations, showToast, onDurationsChange }: Props) {
  const durationsRef = useRef(durations);
  durationsRef.current = durations;

  const [creating, setCreating] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);

  const persistDuration = useDebouncedCallback(async (row: PartySizeDuration) => {
    try {
      const res = await fetch('/api/venue/party-size-durations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(row),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      const saved = data.duration as PartySizeDuration;
      onDurationsChange(durationsRef.current.map((d) => (d.id === saved.id ? saved : d)));
    } catch {
      showToast('Failed to save duration');
    }
  }, AUTOSAVE_MS);

  function applyDurationChange(row: PartySizeDuration, patch: Partial<PartySizeDuration>) {
    const merged = { ...row, ...patch };
    onDurationsChange(durations.map((d) => (d.id === row.id ? merged : d)));
    persistDuration(merged as PartySizeDuration);
  }

  async function handleCreate(minPs: number, maxPs: number, dur: number, dayOfWeek: number | null) {
    setBulkSaving(true);
    try {
      const duration = await createDurationApi(serviceId, minPs, maxPs, dur, dayOfWeek);
      onDurationsChange([...durations, duration]);
      setCreating(false);
    } catch {
      showToast('Failed to add duration');
    } finally {
      setBulkSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await fetch('/api/venue/party-size-durations', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      onDurationsChange(durations.filter((d) => d.id !== id));
    } catch {
      showToast('Failed to delete');
    }
  }

  async function seedDefaults() {
    setBulkSaving(true);
    try {
      const created: PartySizeDuration[] = [];
      for (const { min, max, dur } of DURATION_SMART_DEFAULTS) {
        created.push(await createDurationApi(serviceId, min, max, dur));
      }
      onDurationsChange([...durations, ...created]);
    } catch {
      showToast('Failed to add default durations');
    } finally {
      setBulkSaving(false);
    }
  }

  const sorted = [...durations].sort((a, b) => a.min_party_size - b.min_party_size);

  return (
    <section className="space-y-4 border-t border-slate-100 pt-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-bold text-slate-900">Dining duration</h3>
          <p className="text-sm text-slate-500">How long parties of each size hold a table during {serviceName}.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {sorted.length === 0 && (
            <button
              type="button"
              onClick={() => void seedDefaults()}
              disabled={bulkSaving}
              className="rounded-xl border border-brand-200 bg-white px-3 py-2 text-xs font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-50"
            >
              Add smart defaults
            </button>
          )}
          <button type="button" onClick={() => setCreating(true)} className="rounded-xl bg-brand-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-brand-700">
            Add band
          </button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-5 text-center">
          <p className="text-sm font-semibold text-slate-800">Add duration bands</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
            Defaults are a good starting point: smaller tables turn faster, larger groups get more time.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {sorted.map((dur) => (
            <div key={dur.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-4 flex flex-col gap-2 border-b border-slate-100 pb-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Band</p>
                  <p className="text-sm font-semibold text-slate-800">
                    {dur.min_party_size}-{dur.max_party_size} guests · {dur.duration_minutes} min
                    {dur.day_of_week != null ? ` · ${DAY_LABELS[dur.day_of_week]} override` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleDelete(dur.id)}
                  className="self-start rounded-xl border border-red-100 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 sm:self-auto"
                >
                  Delete
                </button>
              </div>
              <DurationBandFields data={dur} onChange={(patch) => applyDurationChange(dur, patch)} />
            </div>
          ))}
        </div>
      )}

      {creating && (
        <CreateDurationBandInline
          saving={bulkSaving}
          renderForm={(data, onChange) => <DurationBandFields data={data} onChange={onChange} />}
          onCreate={(min, max, dur, day) => void handleCreate(min, max, dur, day)}
          onCancel={() => setCreating(false)}
        />
      )}
    </section>
  );
}

function CreateDurationBandInline({
  saving,
  renderForm,
  onCreate,
  onCancel,
}: {
  saving: boolean;
  renderForm: (
    data: Pick<PartySizeDuration, 'min_party_size' | 'max_party_size' | 'duration_minutes' | 'day_of_week'>,
    onChange: (patch: Partial<Pick<PartySizeDuration, 'min_party_size' | 'max_party_size' | 'duration_minutes' | 'day_of_week'>>) => void,
  ) => ReactNode;
  onCreate: (min: number, max: number, dur: number, dayOfWeek: number | null) => void;
  onCancel: () => void;
}) {
  const [min, setMin] = useState(1);
  const [max, setMax] = useState(4);
  const [dur, setDur] = useState(90);
  const [dayOfWeek, setDayOfWeek] = useState<number | null>(null);

  return (
    <div className="space-y-4 rounded-2xl border border-brand-200 bg-white p-5 shadow-sm ring-4 ring-brand-50">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">New duration band</p>
        <h4 className="mt-1 text-base font-bold text-slate-900">Add a party-size duration</h4>
      </div>
      {renderForm(
        { min_party_size: min, max_party_size: max, duration_minutes: dur, day_of_week: dayOfWeek },
        (patch) => {
          if (patch.min_party_size !== undefined) setMin(patch.min_party_size);
          if (patch.max_party_size !== undefined) setMax(patch.max_party_size);
          if (patch.duration_minutes !== undefined) setDur(patch.duration_minutes);
          if (patch.day_of_week !== undefined) setDayOfWeek(patch.day_of_week);
        },
      )}
      <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
        <button type="button" onClick={() => onCreate(min, max, dur, dayOfWeek)} disabled={saving} className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
          Add band
        </button>
        <button type="button" onClick={onCancel} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">
          Cancel
        </button>
      </div>
    </div>
  );
}
