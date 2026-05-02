'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CustomClientFieldDefinition, GuestDetailResponse } from '@/types/contacts';

export function ContactCustomFieldsSection({
  guestId,
  detail,
  onUpdated,
}: {
  guestId: string;
  detail: GuestDetailResponse;
  onUpdated: () => void;
}) {
  const defs = useMemo(() => (detail.custom_field_definitions ?? []).filter((d) => d.is_active), [detail]);
  const [local, setLocal] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const bag = detail.guest.custom_fields ?? {};
    const next: Record<string, string> = {};
    for (const d of defs) {
      const v = bag[d.field_key];
      next[d.field_key] = v === null || v === undefined ? '' : String(v);
    }
    setLocal(next);
  }, [guestId, defs, detail.guest.custom_fields]);

  const onChange = (key: string, value: string) => {
    setLocal((prev) => ({ ...prev, [key]: value }));
  };

  const save = useCallback(async () => {
    const patch: Record<string, unknown> = {};
    for (const d of defs) {
      const raw = local[d.field_key]?.trim() ?? '';
      if (d.field_type === 'boolean') {
        patch[d.field_key] = raw === 'true' || raw === '1';
      } else if (d.field_type === 'number') {
        patch[d.field_key] = raw === '' ? null : Number(raw);
      } else if (d.field_type === 'date') {
        patch[d.field_key] = raw === '' ? null : raw;
      } else {
        patch[d.field_key] = raw === '' ? null : raw;
      }
    }
    if (Object.keys(patch).length === 0) return;

    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/venue/guests/${guestId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ custom_fields: patch }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(typeof j.error === 'string' ? j.error : 'Save failed');
      onUpdated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [guestId, defs, local, onUpdated]);

  if (defs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-600">
        No custom fields defined for this venue. Add them under venue settings or the custom-fields API.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <h3 className="text-sm font-semibold text-slate-800">Custom fields</h3>
      {err ? <p className="mt-2 text-sm text-red-600">{err}</p> : null}
      <div className="mt-3 space-y-3">
        {defs.map((d: CustomClientFieldDefinition) => (
          <div key={d.id}>
            <label className="block text-xs font-medium text-slate-500">{d.field_name}</label>
            {d.field_type === 'boolean' ? (
              <select
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                value={local[d.field_key] ?? ''}
                onChange={(e) => onChange(d.field_key, e.target.value)}
              >
                <option value="">—</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            ) : d.field_type === 'number' ? (
              <input
                type="number"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                value={local[d.field_key] ?? ''}
                onChange={(e) => onChange(d.field_key, e.target.value)}
              />
            ) : d.field_type === 'date' ? (
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                value={local[d.field_key] ?? ''}
                onChange={(e) => onChange(d.field_key, e.target.value)}
              />
            ) : (
              <input
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                value={local[d.field_key] ?? ''}
                onChange={(e) => onChange(d.field_key, e.target.value)}
              />
            )}
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled={saving}
        onClick={() => void save()}
        className="mt-3 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save custom fields'}
      </button>
    </div>
  );
}
