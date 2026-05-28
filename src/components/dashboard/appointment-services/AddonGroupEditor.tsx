'use client';

import { useEffect, useRef, useState } from 'react';
import { Dialog } from '@/components/ui/primitives/Dialog';
import { Button } from '@/components/ui/primitives/Button';
import { NumericInput } from '@/components/ui/NumericInput';
import type { Addon, AddonGroup, AppointmentCatalogAddonGroup } from '@/types/booking-models';

/** Convert stored pence into a pounds string for the editor input (blank when 0). */
export function penceToPoundsInput(pence: number): string {
  if (!pence) return '';
  return (pence / 100).toFixed(2);
}

/** Parse a pounds input string back into integer pence (0 on invalid/negative). */
export function poundsInputToPence(input: string): number {
  const n = Number.parseFloat(String(input).replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

export interface AddonGroupEditorValue {
  /** Existing group id when editing; absent when creating. */
  id?: string;
  name: string;
  prompt_to_client: string;
  description: string;
  selection_type: 'single' | 'multi';
  /** For single: 0 = optional, 1 = required. For multi: any non-negative. */
  min_select: number;
  /** null = no upper bound (multi only). */
  max_select: number | null;
  hidden_from_online: boolean;
  is_active: boolean;
  sort_order: number;
  addons: Array<{
    id?: string;
    name: string;
    description: string;
    /** Pounds string (e.g. "5.00"); converted to pence on save. */
    price: string;
    additional_duration_minutes: number;
    is_active: boolean;
    sort_order: number;
  }>;
}

export function emptyAddonGroupValue(): AddonGroupEditorValue {
  return {
    name: '',
    prompt_to_client: '',
    description: '',
    selection_type: 'single',
    min_select: 1,
    max_select: 1,
    hidden_from_online: false,
    is_active: true,
    sort_order: 0,
    addons: [
      {
        name: '',
        description: '',
        price: '',
        additional_duration_minutes: 0,
        is_active: true,
        sort_order: 0,
      },
    ],
  };
}

export function addonGroupValueFromCatalog(catalog: AppointmentCatalogAddonGroup): AddonGroupEditorValue {
  return addonGroupValueFromRecords(catalog.group, catalog.addons);
}

export function addonGroupValueFromRecords(group: AddonGroup, addons: Addon[]): AddonGroupEditorValue {
  return {
    id: group.id,
    name: group.name,
    prompt_to_client: group.prompt_to_client ?? '',
    description: group.description ?? '',
    selection_type: group.selection_type,
    min_select: group.min_select,
    max_select: group.max_select,
    hidden_from_online: group.hidden_from_online,
    is_active: group.is_active,
    sort_order: group.sort_order,
    addons: addons.map((a, idx) => ({
      id: a.id,
      name: a.name,
      description: a.description ?? '',
      price: penceToPoundsInput(a.additional_price_pence),
      additional_duration_minutes: a.additional_duration_minutes,
      is_active: a.is_active,
      sort_order: a.sort_order ?? idx,
    })),
  };
}

export interface AddonGroupEditorProps {
  open: boolean;
  title?: string;
  initialValue?: AddonGroupEditorValue;
  onClose: () => void;
  onSubmit: (value: AddonGroupEditorValue) => Promise<void> | void;
  saveLabel?: string;
  /** Currency symbol for the price inputs (defaults to £). */
  currencySymbol?: string;
}

/**
 * Inline modal for creating or editing an addon group with its options. Used from
 * the Add/Edit service form and the standalone Add-Ons library page.
 */
export function AddonGroupEditor({
  open,
  title = 'Add-on group',
  initialValue,
  onClose,
  onSubmit,
  saveLabel = 'Save',
  currencySymbol = '£',
}: AddonGroupEditorProps) {
  const [value, setValue] = useState<AddonGroupEditorValue>(() => initialValue ?? emptyAddonGroupValue());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wasOpen = useRef(false);

  // Seed the form only on the closed→open transition. `initialValue` is a fresh
  // object on every parent render, so resetting on its identity would wipe
  // in-progress edits whenever the parent re-renders (e.g. a background fetch).
  useEffect(() => {
    if (open && !wasOpen.current) {
      setValue(initialValue ?? emptyAddonGroupValue());
      setError(null);
      setBusy(false);
    }
    wasOpen.current = open;
  }, [open, initialValue]);

  function update<K extends keyof AddonGroupEditorValue>(key: K, next: AddonGroupEditorValue[K]) {
    setValue((v) => ({ ...v, [key]: next }));
  }

  function updateAddon(idx: number, patch: Partial<AddonGroupEditorValue['addons'][number]>) {
    setValue((v) => ({
      ...v,
      addons: v.addons.map((row, i) => (i === idx ? { ...row, ...patch } : row)),
    }));
  }

  function addOption() {
    setValue((v) => ({
      ...v,
      addons: [
        ...v.addons,
        {
          name: '',
          description: '',
          price: '',
          additional_duration_minutes: 0,
          is_active: true,
          sort_order: v.addons.length,
        },
      ],
    }));
  }

  function removeOption(idx: number) {
    setValue((v) => ({
      ...v,
      addons: v.addons.filter((_, i) => i !== idx),
    }));
  }

  async function handleSubmit() {
    setError(null);
    const trimmedName = value.name.trim();
    if (!trimmedName) {
      setError('Add a group name.');
      return;
    }
    const cleanedAddons = value.addons
      .map((a) => ({ ...a, name: a.name.trim() }))
      .filter((a) => a.name.length > 0);
    if (cleanedAddons.length === 0) {
      setError('Add at least one option.');
      return;
    }
    const minSelect =
      value.selection_type === 'single'
        ? value.min_select === 0
          ? 0
          : 1
        : Math.max(0, value.min_select);
    const maxSelect =
      value.selection_type === 'single'
        ? 1
        : value.max_select == null
          ? null
          : Math.max(minSelect, value.max_select);
    setBusy(true);
    try {
      await onSubmit({
        ...value,
        name: trimmedName,
        addons: cleanedAddons,
        min_select: minSelect,
        max_select: maxSelect,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={title}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={busy}>
            {busy ? 'Saving…' : saveLabel}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700">Group name *</label>
          <input
            type="text"
            value={value.name}
            onChange={(e) => update('name', e.target.value)}
            placeholder="e.g. Conditioner choice"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-slate-500">
            Internal label. Only used in the dashboard unless &quot;Prompt to client&quot; is empty.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700">Prompt to client</label>
          <input
            type="text"
            value={value.prompt_to_client}
            onChange={(e) => update('prompt_to_client', e.target.value)}
            placeholder="e.g. Choose your conditioner"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-slate-500">
            Question shown above the options at booking. Falls back to the group name when blank.
          </p>
        </div>

        <fieldset>
          <legend className="text-sm font-medium text-slate-700">Selection</legend>
          <div className="mt-2 flex flex-wrap gap-3 text-sm">
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                checked={value.selection_type === 'single'}
                onChange={() =>
                  setValue((v) => ({
                    ...v,
                    selection_type: 'single',
                    min_select: v.min_select === 0 ? 0 : 1,
                    max_select: 1,
                  }))
                }
              />
              Pick one
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                checked={value.selection_type === 'multi'}
                onChange={() => setValue((v) => ({ ...v, selection_type: 'multi' }))}
              />
              Pick multiple
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
            {value.selection_type === 'single' ? (
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={value.min_select === 1}
                  onChange={(e) => update('min_select', e.target.checked ? 1 : 0)}
                />
                Required (client must choose one)
              </label>
            ) : (
              <>
                <label className="flex items-center gap-2">
                  Minimum
                  <NumericInput
                    value={value.min_select}
                    onChange={(n) => update('min_select', Math.max(0, n))}
                    min={0}
                    max={value.max_select ?? 40}
                    className="w-20 rounded border border-slate-300 px-2 py-1"
                  />
                </label>
                <label className="flex items-center gap-2">
                  Maximum
                  <input
                    type="number"
                    min={0}
                    value={value.max_select ?? ''}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === '') {
                        update('max_select', null);
                        return;
                      }
                      const n = Number(raw);
                      if (!Number.isFinite(n)) return;
                      update('max_select', Math.max(0, Math.floor(n)));
                    }}
                    placeholder="No limit"
                    aria-label="Maximum to pick"
                    className="w-24 rounded border border-slate-300 px-2 py-1"
                  />
                </label>
              </>
            )}
          </div>
        </fieldset>

        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.hidden_from_online}
            onChange={(e) => update('hidden_from_online', e.target.checked)}
          />
          Hide from online booking page (staff-only)
        </label>

        <div className="border-t border-slate-100 pt-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-slate-700">Options</p>
            <button
              type="button"
              onClick={addOption}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              + Add option
            </button>
          </div>
          <ul className="space-y-2">
            {value.addons.map((a, idx) => (
              <li key={a.id ?? idx} className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-start gap-3">
                  <div className="flex-1 space-y-2">
                    <input
                      type="text"
                      placeholder="Option name (e.g. Argan oil conditioner)"
                      value={a.name}
                      onChange={(e) => updateAddon(idx, { name: e.target.value })}
                      aria-label="Option name"
                      className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                    />
                    <textarea
                      placeholder="Optional description"
                      value={a.description}
                      onChange={(e) => updateAddon(idx, { description: e.target.value })}
                      rows={1}
                      aria-label="Option description"
                      className="w-full resize-none rounded border border-slate-300 px-2 py-1 text-sm"
                    />
                    <div className="flex flex-wrap gap-3 text-sm">
                      <label className="flex items-center gap-2">
                        Extra price ({currencySymbol})
                        <input
                          type="text"
                          inputMode="decimal"
                          value={a.price}
                          onChange={(e) => updateAddon(idx, { price: e.target.value })}
                          placeholder="0.00"
                          aria-label="Extra price"
                          className="w-24 rounded border border-slate-300 px-2 py-1"
                        />
                      </label>
                      <label className="flex items-center gap-2">
                        Extra minutes
                        <NumericInput
                          value={a.additional_duration_minutes}
                          onChange={(n) => updateAddon(idx, { additional_duration_minutes: Math.max(0, Math.min(240, n)) })}
                          min={0}
                          max={240}
                          className="w-20 rounded border border-slate-300 px-2 py-1"
                        />
                      </label>
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={a.is_active}
                          onChange={(e) => updateAddon(idx, { is_active: e.target.checked })}
                        />
                        Active
                      </label>
                    </div>
                  </div>
                  {value.addons.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => removeOption(idx)}
                      className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      aria-label="Remove option"
                      title="Remove"
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>
    </Dialog>
  );
}
