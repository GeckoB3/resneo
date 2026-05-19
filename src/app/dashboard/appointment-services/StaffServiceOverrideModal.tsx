'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { mergeAppointmentServiceWithPractitionerLink } from '@/lib/appointments/merge-service-with-overrides';
import type { AppointmentService, PractitionerService } from '@/types/booking-models';
import { NumericInput } from '@/components/ui/NumericInput';
import { currencySymbolFromCode } from '@/lib/money/currency-symbol';
import { Dialog } from '@/components/ui/primitives/Dialog';
import { Button } from '@/components/ui/primitives/Button';

const COLOUR_OPTIONS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
  '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1',
];

function penceToPounds(pence: number | null): string {
  if (pence == null) return '';
  return (pence / 100).toFixed(2);
}

function poundsToPence(pounds: string): number | null {
  const trimmed = pounds.trim();
  if (!trimmed) return null;
  const num = parseFloat(trimmed);
  if (Number.isNaN(num) || num < 0) return null;
  return Math.round(num * 100);
}

interface ServiceLike {
  id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  buffer_minutes: number;
  price_pence: number | null;
  deposit_pence: number | null;
  colour: string;
  staff_may_customize_name?: boolean;
  staff_may_customize_description?: boolean;
  staff_may_customize_duration?: boolean;
  staff_may_customize_buffer?: boolean;
  staff_may_customize_price?: boolean;
  staff_may_customize_deposit?: boolean;
  staff_may_customize_colour?: boolean;
}

interface CalendarChoice {
  id: string;
  name: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  service: ServiceLike;
  link: PractitionerService | null;
  currency?: string;
  calendarChoices?: CalendarChoice[];
  selectedCalendarId?: string;
  onSelectedCalendarChange?: (calendarId: string) => void;
}

export function StaffServiceOverrideModal({
  open,
  onClose,
  onSaved,
  service,
  link,
  currency = 'GBP',
  calendarChoices = [],
  selectedCalendarId,
  onSelectedCalendarChange,
}: Props) {
  const sym = currencySymbolFromCode(currency);

  const base = service as AppointmentService;
  const merged = useMemo(
    () => mergeAppointmentServiceWithPractitionerLink(base, link ?? undefined),
    [base, link],
  );

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [bufferMinutes, setBufferMinutes] = useState(0);
  const [price, setPrice] = useState('');
  const [deposit, setDeposit] = useState('');
  const [requireDeposit, setRequireDeposit] = useState(false);
  const [colour, setColour] = useState('#3B82F6');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(merged.name);
    setDescription(merged.description ?? '');
    setDurationMinutes(merged.duration_minutes);
    setBufferMinutes(merged.buffer_minutes);
    setPrice(penceToPounds(merged.price_pence));
    const dep = merged.deposit_pence;
    setDeposit(penceToPounds(dep));
    setRequireDeposit(dep != null && dep > 0);
    setColour(merged.colour || '#3B82F6');
  }, [open, merged]);

  const buildPatch = useCallback(() => {
    const patch: Record<string, string | number | null> = { service_id: service.id };
    if (service.staff_may_customize_name) {
      patch.custom_name = name.trim() === base.name.trim() ? null : name.trim();
    }
    if (service.staff_may_customize_description) {
      const b = base.description ?? '';
      const d = description.trim();
      patch.custom_description = d === b ? null : d || null;
    }
    if (service.staff_may_customize_duration) {
      patch.custom_duration_minutes =
        durationMinutes === base.duration_minutes ? null : durationMinutes;
    }
    if (service.staff_may_customize_buffer) {
      patch.custom_buffer_minutes = bufferMinutes === base.buffer_minutes ? null : bufferMinutes;
    }
    if (service.staff_may_customize_price) {
      const p = poundsToPence(price);
      patch.custom_price_pence = p === base.price_pence ? null : p;
    }
    if (service.staff_may_customize_deposit) {
      const baseDep = base.deposit_pence ?? 0;
      if (!requireDeposit) {
        patch.custom_deposit_pence = baseDep > 0 ? 0 : null;
      } else {
        const depP = poundsToPence(deposit) ?? 0;
        patch.custom_deposit_pence = depP === baseDep ? null : depP;
      }
    }
    if (service.staff_may_customize_colour) {
      patch.custom_colour = colour === base.colour ? null : colour;
    }
    return patch;
  }, [
    service,
    base,
    name,
    description,
    durationMinutes,
    bufferMinutes,
    price,
    deposit,
    requireDeposit,
    colour,
  ]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const raw = buildPatch();
      const { service_id, ...rest } = raw;
      const body: Record<string, unknown> = { service_id };
      if (calendarChoices.length > 1 && selectedCalendarId) {
        body.calendar_id = selectedCalendarId;
      }
      for (const [k, v] of Object.entries(rest)) {
        if (v !== undefined) body[k] = v;
      }
      const res = await fetch('/api/venue/practitioner-service-overrides', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? 'Failed to save');
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  const anyField =
    service.staff_may_customize_name ||
    service.staff_may_customize_description ||
    service.staff_may_customize_duration ||
    service.staff_may_customize_buffer ||
    service.staff_may_customize_price ||
    service.staff_may_customize_deposit ||
    service.staff_may_customize_colour;

  if (!anyField) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={`Your settings: ${base.name}`}
      size="md"
      footer={
        <OverrideModalFooter onClose={onClose} onSave={() => void handleSave()} saving={saving} />
      }
    >
      {calendarChoices.length > 1 && selectedCalendarId && onSelectedCalendarChange ? (
        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium text-slate-700">Calendar</label>
          <select
            value={selectedCalendarId}
            onChange={(e) => onSelectedCalendarChange(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          >
            {calendarChoices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <p className="mb-4 text-sm text-slate-600">
        {calendarChoices.length > 1
          ? 'Changes apply only to the calendar you select above. Match the venue default to clear your override for a field.'
          : 'Changes apply only to your calendar. Match the venue default to clear your override for a field.'}
      </p>
      {error ? <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      <div className="space-y-4">
        {service.staff_may_customize_name ? (
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Display name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-slate-500">Venue default: {base.name}</p>
          </div>
        ) : null}
        {service.staff_may_customize_description ? (
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        ) : null}
        {service.staff_may_customize_duration ? (
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Duration (minutes)</label>
            <NumericInput
              min={5}
              max={480}
              value={durationMinutes}
              onChange={setDurationMinutes}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-slate-500">Venue default: {base.duration_minutes} min</p>
          </div>
        ) : null}
        {service.staff_may_customize_buffer ? (
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Buffer (minutes)</label>
            <NumericInput
              min={0}
              max={120}
              value={bufferMinutes}
              onChange={setBufferMinutes}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        ) : null}
        {service.staff_may_customize_price ? (
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Price ({sym})</label>
            <CurrencyInput sym={sym} value={price} onChange={setPrice} />
          </div>
        ) : null}
        {service.staff_may_customize_deposit ? (
          <div className="space-y-3 rounded-lg border border-slate-200 p-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setRequireDeposit(!requireDeposit)}
                className={`relative h-6 w-11 rounded-full transition-colors ${
                  requireDeposit ? 'bg-brand-600' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    requireDeposit ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
              <span className="text-sm font-medium text-slate-700">Require deposit</span>
            </div>
            {requireDeposit ? (
              <div>
                <label className="mb-1 block text-sm text-slate-600">Deposit ({sym})</label>
                <CurrencyInput sym={sym} value={deposit} onChange={setDeposit} />
              </div>
            ) : null}
          </div>
        ) : null}
        {service.staff_may_customize_colour ? (
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Colour</label>
            <div className="flex flex-wrap gap-2">
              {COLOUR_OPTIONS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColour(c)}
                  className={`h-8 w-8 rounded-full border-2 transition-all ${
                    colour === c ? 'scale-110 border-slate-900' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

function OverrideModalFooter({
  onClose,
  onSave,
  saving,
}: {
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <div className="flex justify-end gap-3">
      <Button type="button" variant="secondary" onClick={onClose}>
        Cancel
      </Button>
      <Button type="button" onClick={onSave} loading={saving} disabled={saving}>
        {saving ? 'Saving…' : 'Save changes'}
      </Button>
    </div>
  );
}

function CurrencyInput({
  sym,
  value,
  onChange,
}: {
  sym: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative max-w-[200px]">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">{sym}</span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-300 py-2 pl-7 pr-3 text-sm"
      />
    </div>
  );
}
