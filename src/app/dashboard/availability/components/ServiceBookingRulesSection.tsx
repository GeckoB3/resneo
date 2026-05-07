'use client';

import { useEffect, useState } from 'react';
import { HelpTooltip } from '@/components/dashboard/HelpTooltip';
import { helpContent } from '@/lib/help-content';
import { NumericInput } from '@/components/ui/NumericInput';
import type { ServiceBookingRestriction } from '@/app/dashboard/availability/service-settings-types';
import { defaultBookingRestriction } from '@/app/dashboard/availability/service-settings-types';

const FIELD_CLASS =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100';

interface Props {
  serviceId: string;
  restriction: ServiceBookingRestriction | undefined;
  showToast: (msg: string) => void;
  onRestrictionSaved: (r: ServiceBookingRestriction) => void;
}

export function ServiceBookingRulesSection({ serviceId, restriction, showToast, onRestrictionSaved }: Props) {
  const [draft, setDraft] = useState<ServiceBookingRestriction>(() =>
    restriction
      ? { ...restriction, deposit_amount_per_person_gbp: restriction.deposit_amount_per_person_gbp ?? null }
      : ({ id: '', ...defaultBookingRestriction(serviceId) } as ServiceBookingRestriction),
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(
      restriction
        ? { ...restriction, deposit_amount_per_person_gbp: restriction.deposit_amount_per_person_gbp ?? null }
        : ({ id: '', ...defaultBookingRestriction(serviceId) } as ServiceBookingRestriction),
    );
  }, [serviceId, restriction]);

  async function handleSave() {
    if (draft.deposit_required_from_party_size != null) {
      const amt = draft.deposit_amount_per_person_gbp;
      if (typeof amt !== 'number' || !Number.isFinite(amt) || amt <= 0) {
        showToast('Enter a deposit amount per person greater than £0 when deposits are required.');
        return;
      }
    }
    setSaving(true);
    const existing = restriction;
    const { id: _draftId, ...rest } = draft;
    const payload = {
      ...rest,
      online_requires_deposit: true as const,
    };
    try {
      if (existing) {
        const res = await fetch('/api/venue/booking-restrictions', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: existing.id, ...payload }),
        });
        if (!res.ok) throw new Error();
        const json = await res.json();
        onRestrictionSaved(json.restriction as ServiceBookingRestriction);
        showToast('Booking rules saved');
      } else {
        const res = await fetch('/api/venue/booking-restrictions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error();
        const json = await res.json();
        onRestrictionSaved(json.restriction as ServiceBookingRestriction);
        showToast('Booking rules saved');
      }
    } catch {
      showToast('Failed to save booking rules');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div id="rules" className="scroll-mt-24 space-y-4">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        <strong>Deposits:</strong> Configure advance booking windows, party sizes, large-party redirect, and deposits for{' '}
        <span className="font-medium">guest</span> online bookings. Staff use &ldquo;Require deposit&rdquo; on the New Booking form for one-off payment links.
        Deposit refunds use the cancellation notice hours below.
      </div>

      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-base font-bold text-slate-900">Booking rules</h3>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600">
              Min advance (minutes) <HelpTooltip content={helpContent.bookingRules.minAdvance} />
            </label>
            <NumericInput min={0} value={draft.min_advance_minutes} onChange={(v) => setDraft({ ...draft, min_advance_minutes: v })} className={FIELD_CLASS} />
          </div>
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600">
              Max advance (days) <HelpTooltip content={helpContent.bookingRules.maxAdvance} />
            </label>
            <NumericInput min={1} max={365} value={draft.max_advance_days} onChange={(v) => setDraft({ ...draft, max_advance_days: v })} className={FIELD_CLASS} />
          </div>
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600">
              Min party size online <HelpTooltip content={helpContent.bookingRules.partySize} />
            </label>
            <NumericInput min={1} value={draft.min_party_size_online} onChange={(v) => setDraft({ ...draft, min_party_size_online: v })} className={FIELD_CLASS} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Max party size online</label>
            <NumericInput min={1} value={draft.max_party_size_online} onChange={(v) => setDraft({ ...draft, max_party_size_online: v })} className={FIELD_CLASS} />
          </div>
          <div className="col-span-2">
            <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600">
              Cancellation notice (hours) — deposit refund{' '}
              <HelpTooltip content="Guests who cancel at least this many hours before the reservation start can receive an automatic deposit refund (when deposits apply)." />
            </label>
            <NumericInput
              min={0}
              max={168}
              value={draft.cancellation_notice_hours ?? 48}
              onChange={(v) => setDraft({ ...draft, cancellation_notice_hours: v })}
              className={`max-w-xs ${FIELD_CLASS}`}
            />
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 p-3 space-y-3">
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={draft.large_party_threshold != null}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  large_party_threshold: e.target.checked ? 10 : null,
                  large_party_message: e.target.checked
                    ? draft.large_party_message || 'For parties of 10 or more, please call us directly.'
                    : null,
                })
              }
              className="h-4 w-4 rounded border-slate-300 text-brand-600"
            />
            <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
              Enable large party redirect <HelpTooltip content={helpContent.bookingRules.largePartyThreshold} />
            </span>
          </label>
          {draft.large_party_threshold != null && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Redirect from party size</label>
                <NumericInput min={2} value={draft.large_party_threshold} onChange={(v) => setDraft({ ...draft, large_party_threshold: v })} className={FIELD_CLASS} />
              </div>
              <div className="col-span-2">
                <label className="mb-1 block text-xs font-medium text-slate-600">Message shown to guests</label>
                <input
                  type="text"
                  value={draft.large_party_message ?? ''}
                  onChange={(e) => setDraft({ ...draft, large_party_message: e.target.value || null })}
                  placeholder="e.g. For parties of 10 or more, please call us directly."
                  className={FIELD_CLASS}
                />
              </div>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-slate-200 p-3 space-y-3">
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={draft.deposit_required_from_party_size != null}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  deposit_required_from_party_size: e.target.checked ? 6 : null,
                  deposit_amount_per_person_gbp: e.target.checked
                    ? draft.deposit_amount_per_person_gbp == null
                      ? 5
                      : draft.deposit_amount_per_person_gbp
                    : null,
                })
              }
              className="h-4 w-4 rounded border-slate-300 text-brand-600"
            />
            <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
              Require deposits for this service <HelpTooltip content={helpContent.bookingRules.depositThreshold} />
            </span>
          </label>
          {draft.deposit_required_from_party_size != null && (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Deposit from party size</label>
                <NumericInput min={1} value={draft.deposit_required_from_party_size} onChange={(v) => setDraft({ ...draft, deposit_required_from_party_size: v })} className={FIELD_CLASS} />
              </div>
              <div className="max-w-xs">
                <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600">
                  Amount per person (£) <HelpTooltip content="Charged per guest when the party size threshold is met. Example: £5 × 4 guests = £20 total." />
                </label>
                <NumericInput
                  allowFloat
                  min={0.01}
                  max={100}
                  value={draft.deposit_amount_per_person_gbp ?? 5}
                  onChange={(v) => setDraft({ ...draft, deposit_amount_per_person_gbp: v > 0 ? v : null })}
                  className={FIELD_CLASS}
                />
              </div>
            </div>
          )}
        </div>

        <button type="button" onClick={() => void handleSave()} disabled={saving} className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50">
          {saving ? 'Saving...' : 'Save booking rules'}
        </button>
      </div>
    </div>
  );
}
