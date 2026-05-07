'use client';

import { useState } from 'react';
import { HelpTooltip } from '@/components/dashboard/HelpTooltip';
import { helpContent } from '@/lib/help-content';
import { NumericInput } from '@/components/ui/NumericInput';
import type { ServiceCapacityRule } from '@/app/dashboard/availability/service-settings-types';
import { DAY_LABELS, defaultCapacityRule } from '@/app/dashboard/availability/service-settings-types';

const FIELD_CLASS =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100';

interface Props {
  serviceId: string;
  serviceName: string;
  rules: ServiceCapacityRule[];
  showToast: (msg: string) => void;
  onRulesChange: (next: ServiceCapacityRule[]) => void;
}

function describeRuleScope(rule: ServiceCapacityRule): string {
  const day = rule.day_of_week == null ? 'All days' : DAY_LABELS[rule.day_of_week];
  if (!rule.time_range_start && !rule.time_range_end) return day;
  return `${day}, ${rule.time_range_start ?? 'start'}-${rule.time_range_end ?? 'end'}`;
}

function omitRuleId(rule: ServiceCapacityRule): Omit<ServiceCapacityRule, 'id'> {
  const { id: _id, ...rest } = rule;
  return rest;
}

function CapacityRuleFields({
  data,
  onChange,
}: {
  data: Omit<ServiceCapacityRule, 'id'>;
  onChange: (d: Omit<ServiceCapacityRule, 'id'>) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-brand-100 bg-brand-50/50 p-4">
          <label className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            Guest capacity per arrival time <HelpTooltip content={helpContent.capacityRules.maxCoversPerSlot} />
          </label>
          <p className="mb-3 text-xs leading-relaxed text-slate-600">
            Total guests you are willing to seat at the same bookable time.
          </p>
          <NumericInput
            min={1}
            value={data.max_covers_per_slot}
            onChange={(v) => onChange({ ...data, max_covers_per_slot: v })}
            className={FIELD_CLASS}
          />
        </div>
        <div className="rounded-2xl border border-brand-100 bg-brand-50/50 p-4">
          <label className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            Booking count per arrival time <HelpTooltip content={helpContent.capacityRules.maxBookingsPerSlot} />
          </label>
          <p className="mb-3 text-xs leading-relaxed text-slate-600">Caps how many separate parties can arrive together.</p>
          <NumericInput
            min={1}
            value={data.max_bookings_per_slot}
            onChange={(v) => onChange({ ...data, max_bookings_per_slot: v })}
            className={FIELD_CLASS}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <label className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            Offer booking times every <HelpTooltip content={helpContent.capacityRules.slotInterval} />
          </label>
          <p className="mb-3 text-xs text-slate-500">Smaller intervals give guests more choice.</p>
          <select
            value={data.slot_interval_minutes}
            onChange={(e) => onChange({ ...data, slot_interval_minutes: parseInt(e.target.value, 10) })}
            className={FIELD_CLASS}
          >
            <option value={15}>15 minutes</option>
            <option value={30}>30 minutes</option>
            <option value={60}>60 minutes</option>
          </select>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <label className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            Turnaround buffer <HelpTooltip content={helpContent.capacityRules.bufferMinutes} />
          </label>
          <p className="mb-3 text-xs text-slate-500">Extra reset time after a party leaves.</p>
          <NumericInput min={0} max={120} value={data.buffer_minutes} onChange={(v) => onChange({ ...data, buffer_minutes: v })} className={FIELD_CLASS} />
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <p className="text-sm font-semibold text-slate-900">When this rule applies</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            Leave these as all days and no time range for the service default. Use overrides for peak periods or quieter days.
          </p>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
              Day <HelpTooltip content={helpContent.capacityRules.dayOverride} />
            </label>
            <select
              value={data.day_of_week ?? ''}
              onChange={(e) => onChange({ ...data, day_of_week: e.target.value ? parseInt(e.target.value, 10) : null })}
              className={FIELD_CLASS}
            >
              <option value="">All days</option>
              {DAY_LABELS.map((d, i) => (
                <option key={i} value={i}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
              Time window <HelpTooltip content={helpContent.capacityRules.timeOverride} />
            </label>
            <div className="flex items-center gap-2">
              <input
                type="time"
                value={data.time_range_start ?? ''}
                onChange={(e) => onChange({ ...data, time_range_start: e.target.value || null })}
                className={FIELD_CLASS}
                aria-label="Rule start time"
              />
              <span className="text-xs text-slate-400">to</span>
              <input
                type="time"
                value={data.time_range_end ?? ''}
                onChange={(e) => onChange({ ...data, time_range_end: e.target.value || null })}
                className={FIELD_CLASS}
                aria-label="Rule end time"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ServiceCapacitySection({ serviceId, serviceName, rules, showToast, onRulesChange }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<ServiceCapacityRule | null>(null);
  const [creating, setCreating] = useState(false);
  const [createDraft, setCreateDraft] = useState<Omit<ServiceCapacityRule, 'id'> | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (!createDraft) return;
    setSaving(true);
    try {
      const res = await fetch('/api/venue/capacity-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createDraft),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      onRulesChange([...rules, data.rule]);
      setCreating(false);
      setCreateDraft(null);
      showToast('Rule created');
    } catch {
      showToast('Failed to create rule');
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate() {
    if (!editDraft) return;
    setSaving(true);
    try {
      const res = await fetch('/api/venue/capacity-rules', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editDraft),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      onRulesChange(rules.map((r) => (r.id === editDraft.id ? data.rule : r)));
      setEditingId(null);
      setEditDraft(null);
      showToast('Rule updated');
    } catch {
      showToast('Failed to update rule');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this rule?')) return;
    try {
      await fetch('/api/venue/capacity-rules', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      onRulesChange(rules.filter((r) => r.id !== id));
      showToast('Rule deleted');
    } catch {
      showToast('Failed to delete rule');
    }
  }

  return (
    <div id="capacity" className="scroll-mt-24 space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-bold text-slate-900">Capacity rules</h3>
          <p className="text-sm text-slate-500">
            How many guests and bookings can arrive at each bookable time for {serviceName}.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setCreating(true);
            setCreateDraft(defaultCapacityRule(serviceId));
          }}
          className="shrink-0 rounded-xl bg-brand-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-brand-700"
        >
          Add rule
        </button>
      </div>

      {rules.length === 0 && !creating && (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-5 text-center">
          <p className="text-sm font-semibold text-slate-800">Start with a default capacity rule</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
            This tells Reserve NI how many guests and bookings to offer for each arrival time.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {rules.map((rule) => (
          <div key={rule.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            {editingId === rule.id && editDraft ? (
              <div className="space-y-4">
                <CapacityRuleFields
                  data={omitRuleId(editDraft)}
                  onChange={(d) => setEditDraft({ ...editDraft, ...d } as ServiceCapacityRule)}
                />
                <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                  <button
                    type="button"
                    onClick={handleUpdate}
                    disabled={saving}
                    className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(null);
                      setEditDraft(null);
                    }}
                    className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-bold text-slate-900">
                    {rule.max_covers_per_slot} guests / {rule.max_bookings_per_slot} bookings
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {describeRuleScope(rule)} - every {rule.slot_interval_minutes} min - {rule.buffer_minutes} min buffer
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(rule.id);
                      setEditDraft(rule);
                    }}
                    className="rounded-xl bg-brand-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-brand-700"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(rule.id)}
                    className="rounded-xl border border-red-100 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {creating && createDraft && (
        <div className="space-y-4 rounded-2xl border border-brand-200 bg-white p-5 shadow-sm ring-4 ring-brand-50">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">New capacity rule</p>
            <h4 className="mt-1 text-base font-bold text-slate-900">{serviceName}</h4>
          </div>
          <CapacityRuleFields data={createDraft} onChange={setCreateDraft} />
          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={handleCreate}
              disabled={saving}
              className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              Create rule
            </button>
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setCreateDraft(null);
              }}
              className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
