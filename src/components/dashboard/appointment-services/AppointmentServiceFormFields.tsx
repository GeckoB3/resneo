'use client';

import { useMemo, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import {
  APPOINTMENT_SERVICE_COLOUR_OPTIONS,
  DEFAULT_APPOINTMENT_SERVICE_VARIANT_ROW,
  type AppointmentServiceFormValues,
  type AppointmentServiceVariantFormRow,
} from '@/components/dashboard/appointment-services/appointment-service-form-values';
import { ProcessingTimeTimelineEditor } from '@/components/dashboard/appointment-services/ProcessingTimeTimelineEditor';
import { HelpTooltip } from '@/components/dashboard/HelpTooltip';
import { StripePaymentWarning } from '@/components/dashboard/StripePaymentWarning';
import { ServiceCustomAvailabilityEditor } from '@/components/scheduling/ServiceCustomAvailabilityEditor';
import { ServiceAvailabilityCalendar } from '@/components/scheduling/ServiceAvailabilityCalendar';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { NumericInput } from '@/components/ui/NumericInput';
import type { OpeningHours } from '@/types/availability';
import type { VenueOpeningException } from '@/types/venue-opening-exceptions';
import type { WorkingHours } from '@/types/booking-models';

function parsePositivePounds(value: string): boolean {
  const t = value.trim().replace(/,/g, '');
  if (!t) return false;
  const n = Number.parseFloat(t);
  return Number.isFinite(n) && n > 0;
}

/** Enough detail that we surface the next option (name, duration, full-payment price when offered). */
function isVariantCompleteForGuidedFlow(
  v: AppointmentServiceVariantFormRow,
  paymentRequirement: AppointmentServiceFormValues['payment_requirement'],
): boolean {
  if (!v.name.trim()) return false;
  if (v.duration_minutes < 5 || v.duration_minutes > 480) return false;
  if (paymentRequirement === 'full_payment' && v.is_active && !parsePositivePounds(v.price)) return false;
  return true;
}

export interface AppointmentServiceFormFieldsProps {
  form: AppointmentServiceFormValues;
  setForm: Dispatch<SetStateAction<AppointmentServiceFormValues>>;
  isAdmin: boolean;
  stripeConnected: boolean;
  currencySymbol: string;
  /** Distinct per form instance (e.g. onboarding clientKey or `modal`). */
  fieldGroupSuffix: string;
  venueOpeningHours: OpeningHours | null;
  venueOpeningExceptions?: VenueOpeningException[] | null;
  linkedCalendarsForPreview: Array<{ id: string; working_hours: WorkingHours | null | undefined }>;
  calendarsSection: ReactNode;
  /** Appointments Light: hide “optional overrides per calendar” only. */
  hideStaffMaySection?: boolean;
  staffNotice?: ReactNode;
}

export function AppointmentServiceFormFields({
  form,
  setForm,
  isAdmin,
  stripeConnected,
  currencySymbol: sym,
  fieldGroupSuffix,
  venueOpeningHours,
  venueOpeningExceptions = null,
  linkedCalendarsForPreview,
  calendarsSection,
  hideStaffMaySection = false,
  staffNotice,
}: AppointmentServiceFormFieldsProps) {
  const usesVariants = isAdmin && form.variants.length > 0;
  const paymentName = `payment-requirement-${fieldGroupSuffix}`;
  const bookingModeName = `service-booking-mode-${fieldGroupSuffix}`;

  const allVariantsReadyForAnother = useMemo(
    () => form.variants.every((v) => isVariantCompleteForGuidedFlow(v, form.payment_requirement)),
    [form.variants, form.payment_requirement],
  );

  const incompleteVariantIndexes = useMemo(() => {
    const out: number[] = [];
    form.variants.forEach((v, i) => {
      if (!isVariantCompleteForGuidedFlow(v, form.payment_requirement)) out.push(i);
    });
    return out;
  }, [form.variants, form.payment_requirement]);

  return (
    <div className="space-y-4">
      {staffNotice}

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Name *</label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          placeholder="e.g. Consultation, Standard session"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Description</label>
        <textarea
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          rows={2}
          placeholder="Brief description of the service"
        />
      </div>

      {isAdmin && (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-gradient-to-b from-slate-50/90 to-white p-4 shadow-sm ring-1 ring-slate-100/80">
          <div>
            <p className="text-sm font-semibold text-slate-900">How will clients book this service?</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              Choose one structure. Use <span className="font-medium text-slate-800">multiple options</span> when guests
              must pick a tier first (e.g. duration or style); each option has its own timing and price. Use{' '}
              <span className="font-medium text-slate-800">one fixed offering</span> when every booking is the same.
            </p>
          </div>
          <div className="space-y-2">
            <label
              className={`flex cursor-pointer gap-3 rounded-xl border bg-white p-3.5 shadow-sm transition-colors ${
                !usesVariants ? 'border-brand-400 ring-2 ring-brand-100' : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <input
                type="radio"
                name={bookingModeName}
                className="mt-1 shrink-0"
                checked={!usesVariants}
                onChange={() => {
                  if (form.variants.length === 0) return;
                  if (
                    !window.confirm(
                      'Switch to one fixed offering? All bookable options you added will be removed from this service.',
                    )
                  ) {
                    return;
                  }
                  setForm((f) => ({ ...f, variants: [] }));
                }}
              />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">One fixed offering</p>
                <p className="mt-0.5 text-xs text-slate-600">
                  One duration, buffer, and price. What you set below applies to every booking.
                </p>
              </div>
            </label>
            <label
              className={`flex cursor-pointer gap-3 rounded-xl border bg-white p-3.5 shadow-sm transition-colors ${
                usesVariants ? 'border-brand-400 ring-2 ring-brand-100' : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <input
                type="radio"
                name={bookingModeName}
                className="mt-1 shrink-0"
                checked={usesVariants}
                onChange={() => {
                  setForm((f) => {
                    if (f.variants.length > 0) return f;
                    return {
                      ...f,
                      variants: [
                        {
                          ...DEFAULT_APPOINTMENT_SERVICE_VARIANT_ROW,
                          duration_minutes: f.duration_minutes,
                          buffer_minutes: f.buffer_minutes,
                          price: f.price,
                          deposit: f.payment_requirement === 'deposit' ? f.deposit : '',
                        },
                      ],
                    };
                  });
                }}
              />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">Multiple bookable options</p>
                <p className="mt-0.5 text-xs text-slate-600">
                  Guests choose an option before picking a time. You&apos;ll set up <strong>one option at a time</strong>{' '}
                  — finish each option, then add the next. Each option has its own duration, buffer, price, optional
                  description, and optional deposit override.
                </p>
              </div>
            </label>
          </div>
        </div>
      )}

      {usesVariants && (
        <div className="space-y-4 rounded-xl border border-brand-100 bg-white p-4 shadow-sm ring-1 ring-brand-50">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-slate-900">Bookable options</p>
                <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-brand-800 ring-1 ring-brand-100">
                  {form.variants.length} {form.variants.length === 1 ? 'option' : 'options'}
                </span>
              </div>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-600">
                Work through each card in order. When an option has a name, valid duration
                {form.payment_requirement === 'full_payment' ? ', and a price (for options offered online)' : ''}, you
                can add another. Payment rules still come from{' '}
                <span className="font-medium text-slate-800">Online payment when booking</span> below — deposit defaults
                apply when an option&apos;s deposit is blank.
              </p>
            </div>
          </div>

          {form.variants.length === 1 ? (
            <div className="rounded-lg border border-brand-200/80 bg-brand-50/40 px-3 py-2.5">
              <p className="text-xs font-semibold text-brand-900">Step 1 — Your first option</p>
              <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-[11px] leading-snug text-brand-950/85">
                <li>Name it clearly (e.g. &quot;45 minutes&quot;, &quot;Colour &amp; cut&quot;).</li>
                <li>Set duration, buffer, and price.</li>
                <li>Then use <span className="font-semibold">Add another option</span> if you need more tiers.</li>
              </ol>
            </div>
          ) : (
            <p className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 text-[11px] text-slate-600">
              Complete every option below before adding another. Incomplete rows are highlighted.
            </p>
          )}

          {!allVariantsReadyForAnother ? (
            <p className="text-[11px] font-medium text-amber-800">
              Finish the highlighted option
              {incompleteVariantIndexes.length > 1 ? 's' : ''} before adding another.
              {form.payment_requirement === 'full_payment'
                ? ' Options offered online need a price greater than zero.'
                : ''}
            </p>
          ) : null}

          <div className="space-y-4">
            {form.variants.map((variant, idx) => {
              const complete = isVariantCompleteForGuidedFlow(variant, form.payment_requirement);
              const isOnlyOption = form.variants.length === 1;
              return (
              <div
                key={variant.id ?? `new-${idx}`}
                className={`space-y-2.5 rounded-xl border bg-white p-3.5 shadow-sm transition-shadow ${
                  complete
                    ? 'border-slate-200'
                    : 'border-amber-300 ring-2 ring-amber-100/90'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="shrink-0 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-bold tabular-nums text-slate-700">
                      Option {idx + 1}
                    </span>
                    {complete ? (
                      <span className="text-[11px] font-medium text-emerald-700">Ready</span>
                    ) : (
                      <span className="text-[11px] font-medium text-amber-800">In progress</span>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={isOnlyOption}
                    title={
                      isOnlyOption
                        ? 'Switch to “One fixed offering” above to remove multi-option mode, or keep at least one option.'
                        : undefined
                    }
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        variants: f.variants.filter((_, i) => i !== idx),
                      }))
                    }
                    className="shrink-0 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-slate-600"
                  >
                    Remove
                  </button>
                </div>
                <div className="flex items-start gap-2">
                  <input
                    type="text"
                    value={variant.name}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        variants: f.variants.map((row, i) => (i === idx ? { ...row, name: e.target.value } : row)),
                      }))
                    }
                    placeholder="Option name (e.g. 60 minutes, Full head)"
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-[11px] font-medium text-slate-600">
                    Optional description (shown when they pick this option)
                  </label>
                  <textarea
                    value={variant.description}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        variants: f.variants.map((row, i) => (i === idx ? { ...row, description: e.target.value } : row)),
                      }))
                    }
                    placeholder="e.g. Includes toner — allow 15 extra minutes."
                    rows={2}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div>
                    <label className="mb-0.5 block text-[11px] font-medium text-slate-600">Duration (mins) *</label>
                    <NumericInput
                      min={5}
                      max={480}
                      value={variant.duration_minutes}
                      onChange={(v) =>
                        setForm((f) => ({
                          ...f,
                          variants: f.variants.map((row, i) => (i === idx ? { ...row, duration_minutes: v } : row)),
                        }))
                      }
                      className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-0.5 block text-[11px] font-medium text-slate-600">Buffer (mins)</label>
                    <NumericInput
                      min={0}
                      max={120}
                      value={variant.buffer_minutes}
                      onChange={(v) =>
                        setForm((f) => ({
                          ...f,
                          variants: f.variants.map((row, i) => (i === idx ? { ...row, buffer_minutes: v } : row)),
                        }))
                      }
                      className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-0.5 block text-[11px] font-medium text-slate-600">Price ({sym})</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={variant.price}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          variants: f.variants.map((row, i) => (i === idx ? { ...row, price: e.target.value } : row)),
                        }))
                      }
                      placeholder="0.00"
                      className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-0.5 block text-[11px] font-medium text-slate-600">
                      Deposit ({sym}) <span className="font-normal text-slate-400">optional</span>
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={variant.deposit}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          variants: f.variants.map((row, i) => (i === idx ? { ...row, deposit: e.target.value } : row)),
                        }))
                      }
                      placeholder={form.payment_requirement === 'deposit' ? 'Uses service default' : '—'}
                      className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                    />
                  </div>
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={variant.is_active}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        variants: f.variants.map((row, i) => (i === idx ? { ...row, is_active: e.target.checked } : row)),
                      }))
                    }
                    className="h-3.5 w-3.5 rounded border-slate-300"
                  />
                  Offer this option to clients
                </label>
                {isAdmin ? (
                  <ProcessingTimeTimelineEditor
                    compact
                    durationMinutes={variant.duration_minutes}
                    bufferMinutes={variant.buffer_minutes}
                    blocks={variant.processing_time_blocks}
                    onChange={(blocks) =>
                      setForm((f) => ({
                        ...f,
                        variants: f.variants.map((row, i) => (i === idx ? { ...row, processing_time_blocks: blocks } : row)),
                      }))
                    }
                  />
                ) : null}
              </div>
            );
            })}
          </div>

          <div className="flex flex-col gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[11px] text-slate-600">
              {allVariantsReadyForAnother
                ? 'Need another length, price band, or session type? Add it here.'
                : 'Complete every option above (including prices when charging full payment online) to unlock adding another.'}
            </p>
            <button
              type="button"
              disabled={!allVariantsReadyForAnother}
              title={
                allVariantsReadyForAnother
                  ? undefined
                  : 'Complete name, duration, and required price on every option above first.'
              }
              onClick={() =>
                setForm((f) => {
                  const last = f.variants[f.variants.length - 1];
                  return {
                    ...f,
                    variants: [
                      ...f.variants,
                      {
                        ...DEFAULT_APPOINTMENT_SERVICE_VARIANT_ROW,
                        duration_minutes:
                          last?.duration_minutes ?? DEFAULT_APPOINTMENT_SERVICE_VARIANT_ROW.duration_minutes,
                        buffer_minutes: last?.buffer_minutes ?? 0,
                      },
                    ],
                  };
                })
              }
              className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-brand-600 bg-brand-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-brand-700 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.25} stroke="currentColor" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Add another option
            </button>
          </div>
        </div>
      )}

      {!usesVariants && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Duration (mins) *</label>
              <NumericInput
                value={form.duration_minutes}
                onChange={(v) => setForm({ ...form, duration_minutes: v })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                min={5}
                max={480}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Buffer (mins)</label>
              <NumericInput
                value={form.buffer_minutes}
                onChange={(v) => setForm({ ...form, buffer_minutes: v })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                min={0}
                max={120}
              />
            </div>
          </div>

          {isAdmin ? (
            <ProcessingTimeTimelineEditor
              durationMinutes={form.duration_minutes}
              bufferMinutes={form.buffer_minutes}
              blocks={form.processing_time_blocks}
              onChange={(blocks) => setForm((f) => ({ ...f, processing_time_blocks: blocks }))}
            />
          ) : null}

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Price ({sym})</label>
            <div className="relative max-w-[200px]">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">{sym}</span>
              <input
                type="text"
                inputMode="decimal"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                className="w-full rounded-lg border border-slate-300 py-2 pl-7 pr-3 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                placeholder="0.00"
              />
            </div>
          </div>
        </>
      )}

      {usesVariants ? (
        <p className="rounded-lg border border-amber-100 bg-amber-50/80 px-3 py-2 text-xs text-amber-950/90">
          <span className="font-semibold">Payment &amp; booking rules below apply to every option.</span> For full online
          payment, each turned-on option must have a price. For deposits, the service default deposit fills in when an
          option&apos;s deposit is left blank.
        </p>
      ) : null}

      <SectionCard>
        <SectionCard.Header title="Online payment when booking" />
        <SectionCard.Body className="!pt-0 space-y-3">
          <div className="space-y-2">
            <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name={paymentName}
                className="mt-0.5"
                checked={form.payment_requirement === 'none'}
                onChange={() => setForm((f) => ({ ...f, payment_requirement: 'none' }))}
              />
              <span>No online payment (pay at venue or arrange separately)</span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name={paymentName}
                className="mt-0.5"
                checked={form.payment_requirement === 'deposit'}
                onChange={() => setForm((f) => ({ ...f, payment_requirement: 'deposit' }))}
              />
              <span>Custom deposit (fixed amount online)</span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name={paymentName}
                className="mt-0.5"
                checked={form.payment_requirement === 'full_payment'}
                onChange={() => setForm((f) => ({ ...f, payment_requirement: 'full_payment' }))}
              />
              <span>Pay full price online at booking</span>
            </label>
          </div>
          {form.payment_requirement === 'deposit' && (
            <div>
              <label className="mb-1 block text-sm text-slate-600">
                {usesVariants ? (
                  <>
                    Default deposit ({sym}){' '}
                    <span className="font-normal text-slate-500">
                      — used when an option leaves its deposit field blank
                    </span>
                  </>
                ) : (
                  <>Deposit amount ({sym})</>
                )}
              </label>
              <div className="relative max-w-[200px]">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">{sym}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={form.deposit}
                  onChange={(e) => setForm({ ...form, deposit: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 py-2 pl-7 pr-3 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  placeholder="5.00"
                />
              </div>
            </div>
          )}
          {form.payment_requirement === 'full_payment' && (
            <p className="text-xs text-slate-500">
              {usesVariants
                ? 'Each option offered to clients needs its own price — that is what they pay online at booking.'
                : 'The full service price (above) is charged when the guest completes booking online.'}
            </p>
          )}
          <StripePaymentWarning
            stripeConnected={stripeConnected}
            requiresOnlinePayment={
              form.payment_requirement === 'deposit' || form.payment_requirement === 'full_payment'
            }
          />
        </SectionCard.Body>
      </SectionCard>

      <div className="space-y-3 rounded-lg border border-slate-200 p-4">
        <p className="text-sm font-medium text-slate-800">Guest booking rules</p>
        <p className="text-xs text-slate-500">
          Applies to online bookings for this service (advance window, notice, and deposit refund notice).
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm text-slate-700">Max advance (days)</label>
            <NumericInput
              min={1}
              max={365}
              value={form.max_advance_booking_days}
              onChange={(v) => setForm({ ...form, max_advance_booking_days: v })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-700">Min booking notice (hours)</label>
            <NumericInput
              min={0}
              max={168}
              value={form.min_booking_notice_hours}
              onChange={(v) => setForm({ ...form, min_booking_notice_hours: v })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor={`svc-cancel-${fieldGroupSuffix}`} className="mb-1 block text-sm text-slate-700">
              Cancellation notice (hours){' '}
              <HelpTooltip
                maxWidth={300}
                content="This sets when deposits and online payments are refundable until: guests who cancel at least this many hours before the start time get a full refund (subject to your payment settings)."
              />
            </label>
            <NumericInput
              id={`svc-cancel-${fieldGroupSuffix}`}
              min={0}
              max={168}
              value={form.cancellation_notice_hours}
              onChange={(v) => setForm({ ...form, cancellation_notice_hours: v })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="flex flex-col justify-end">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.allow_same_day_booking}
                onChange={(e) => setForm({ ...form, allow_same_day_booking: e.target.checked })}
                className="rounded border-slate-300"
              />
              Allow same-day bookings
            </label>
          </div>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Colour</label>
        <div className="flex flex-wrap gap-2">
          {APPOINTMENT_SERVICE_COLOUR_OPTIONS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setForm({ ...form, colour: c })}
              className={`h-8 w-8 rounded-full border-2 transition-all ${
                form.colour === c ? 'scale-110 border-slate-900' : 'border-transparent'
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setForm({ ...form, is_active: !form.is_active })}
          className={`relative h-6 w-11 rounded-full transition-colors ${form.is_active ? 'bg-brand-600' : 'bg-slate-300'}`}
        >
          <span
            className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
              form.is_active ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
        <span className="text-sm text-slate-700">Active (visible to clients)</span>
      </div>

      {isAdmin && !hideStaffMaySection && (
        <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/90 p-4">
          <p className="text-sm font-medium text-slate-800">Optional overrides per calendar</p>
          <p className="text-xs text-slate-500">
            {usesVariants ? (
              <>
                Allow staff on a calendar to override these fields for their column only. For services with multiple
                options, duration, buffer, price, and deposit refer to each bookable option once a client has chosen it.
              </>
            ) : (
              <>
                Allow staff users assigned to an individual calendar to adjust the following values for their calendar
                only. Leave unticked and all calendars use the value set above.
              </>
            )}
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(
              [
                ['name', 'Display name'],
                ['description', 'Description'],
                ['duration', 'Duration'],
                ['buffer', 'Buffer time'],
                ['price', 'Price'],
                ['deposit', 'Deposit'],
                ['colour', 'Colour'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.staffMay[key]}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      staffMay: { ...prev.staffMay, [key]: e.target.checked },
                    }))
                  }
                  className="h-4 w-4 rounded border-slate-300 text-blue-600"
                />
                {label}
              </label>
            ))}
          </div>
        </div>
      )}

      {calendarsSection}

      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
        <div>
          <p className="text-sm font-medium text-slate-800">When guests can book this service online</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Final availability is the overlap of venue opening hours, each linked calendar&apos;s hours, and this
            service&apos;s schedule (below). Staff blocks and one-off calendar changes also apply live.
          </p>
        </div>
        <ServiceAvailabilityCalendar
          venueOpeningHours={venueOpeningHours}
          venueOpeningExceptions={venueOpeningExceptions ?? undefined}
          linkedCalendars={linkedCalendarsForPreview}
          customAvailabilityEnabled={form.custom_availability_enabled}
          customWorkingHours={form.custom_working_hours}
          footnote="Based on venue hours (with exceptions), each linked calendar's recurring weekly hours, and this service's schedule. Staff blocks and one-off calendar changes are not previewed here."
        />

        {isAdmin ? (
          <div className="space-y-3 pt-1">
            <div>
              <p className="text-sm font-medium text-slate-800">This service&apos;s schedule</p>
              <p className="mt-0.5 text-xs text-slate-500">
                Optional — only turn on if this service should be bookable for less time than its calendars are open
                (for example a brunch menu, or evening-only therapy).
              </p>
            </div>
            <ServiceCustomAvailabilityEditor
              value={form.custom_working_hours}
              onChange={(next) => setForm((f) => ({ ...f, custom_working_hours: next }))}
              enabled={form.custom_availability_enabled}
              onEnabledChange={(next) => setForm((f) => ({ ...f, custom_availability_enabled: next }))}
            />
          </div>
        ) : (
          <p className="text-xs text-slate-500">Only venue admins can change this service&apos;s schedule.</p>
        )}
      </div>
    </div>
  );
}
