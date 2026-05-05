'use client';

import { DEFAULT_ENTITY_BOOKING_WINDOW, entityBookingWindowFromRow } from '@/lib/booking/entity-booking-window';
import { defaultNewUnifiedCalendarWorkingHours } from '@/lib/availability/practitioner-defaults';
import { toServiceCustomScheduleV2 } from '@/lib/service-custom-availability';
import type { ClassPaymentRequirement, ServiceCustomScheduleStored, ServiceCustomScheduleV2, WorkingHours } from '@/types/booking-models';
import type { OpeningHours } from '@/types/availability';
import type { VenueOpeningException } from '@/types/venue-opening-exceptions';
import { ServiceCustomAvailabilityEditor } from '@/components/scheduling/ServiceCustomAvailabilityEditor';
import { ServiceAvailabilityCalendar } from '@/components/scheduling/ServiceAvailabilityCalendar';
import { NumericInput } from '@/components/ui/NumericInput';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { HelpTooltip } from '@/components/dashboard/HelpTooltip';
import { StripePaymentWarning } from '@/components/dashboard/StripePaymentWarning';

export type StaffMayFlags = {
  name: boolean;
  description: boolean;
  duration: boolean;
  buffer: boolean;
  price: boolean;
  deposit: boolean;
  colour: boolean;
};

export const DEFAULT_STAFF_MAY: StaffMayFlags = {
  name: false,
  description: false,
  duration: false,
  buffer: false,
  price: false,
  deposit: false,
  colour: false,
};

export interface AppointmentServiceFormDraft {
  /** Stable key for React lists and field identity */
  clientKey: string;
  /** Set after POST or when hydrating from GET: drives PATCH vs POST on save */
  serverId?: string;
  name: string;
  description: string;
  duration_minutes: number;
  buffer_minutes: number;
  price: string;
  deposit: string;
  payment_requirement: ClassPaymentRequirement;
  colour: string;
  is_active: boolean;
  practitioner_ids: string[];
  staffMay: StaffMayFlags;
  max_advance_booking_days: number;
  min_booking_notice_hours: number;
  cancellation_notice_hours: number;
  allow_same_day_booking: boolean;
  custom_availability_enabled: boolean;
  custom_working_hours: ServiceCustomScheduleStored;
}

const COLOUR_OPTIONS = [
  '#3B82F6',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#8B5CF6',
  '#EC4899',
  '#06B6D4',
  '#84CC16',
  '#F97316',
  '#6366F1',
];

function poundsToPence(pounds: string): number | null {
  const trimmed = pounds.trim();
  if (!trimmed) return null;
  const num = parseFloat(trimmed);
  if (Number.isNaN(num) || num < 0) return null;
  return Math.round(num * 100);
}

function penceToPoundsDisplay(pence: unknown): string {
  if (typeof pence !== 'number' || !Number.isFinite(pence)) return '';
  return (pence / 100).toFixed(2);
}

export function createEmptyAppointmentServiceDraft(): AppointmentServiceFormDraft {
  return {
    clientKey: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `svc-${Date.now()}-${Math.random()}`,
    name: '',
    description: '',
    duration_minutes: 30,
    buffer_minutes: 0,
    price: '',
    deposit: '',
    payment_requirement: 'none',
    colour: '#3B82F6',
    is_active: true,
    practitioner_ids: [],
    staffMay: { ...DEFAULT_STAFF_MAY },
    max_advance_booking_days: DEFAULT_ENTITY_BOOKING_WINDOW.max_advance_booking_days,
    min_booking_notice_hours: DEFAULT_ENTITY_BOOKING_WINDOW.min_booking_notice_hours,
    cancellation_notice_hours: DEFAULT_ENTITY_BOOKING_WINDOW.cancellation_notice_hours,
    allow_same_day_booking: DEFAULT_ENTITY_BOOKING_WINDOW.allow_same_day_booking,
    custom_availability_enabled: false,
    custom_working_hours: {},
  };
}

export function appointmentServiceDraftFromBusinessDefault(ds: {
  name: string;
  duration: number;
  price: number;
}): AppointmentServiceFormDraft {
  return {
    clientKey: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `svc-${Date.now()}-${Math.random()}`,
    name: ds.name,
    description: '',
    duration_minutes: ds.duration,
    buffer_minutes: 0,
    price: (ds.price / 100).toFixed(2),
    deposit: '',
    payment_requirement: 'none',
    colour: '#3B82F6',
    is_active: true,
    practitioner_ids: [],
    staffMay: { ...DEFAULT_STAFF_MAY },
    max_advance_booking_days: DEFAULT_ENTITY_BOOKING_WINDOW.max_advance_booking_days,
    min_booking_notice_hours: DEFAULT_ENTITY_BOOKING_WINDOW.min_booking_notice_hours,
    cancellation_notice_hours: DEFAULT_ENTITY_BOOKING_WINDOW.cancellation_notice_hours,
    allow_same_day_booking: DEFAULT_ENTITY_BOOKING_WINDOW.allow_same_day_booking,
    custom_availability_enabled: false,
    custom_working_hours: {},
  };
}

function appointmentServiceDraftFromApiRow(
  row: Record<string, unknown>,
  practitionerIds: string[],
): AppointmentServiceFormDraft {
  const id = row.id as string;
  const payment = row.payment_requirement as ClassPaymentRequirement | undefined;
  const depositPence = row.deposit_pence as number | null | undefined;
  const pricePence = row.price_pence as number | null | undefined;
  const win = entityBookingWindowFromRow(row);
  return {
    clientKey: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `svc-${Date.now()}-${Math.random()}`,
    serverId: id,
    name: String(row.name ?? ''),
    description: String(row.description ?? ''),
    duration_minutes: typeof row.duration_minutes === 'number' ? row.duration_minutes : 30,
    buffer_minutes: typeof row.buffer_minutes === 'number' ? row.buffer_minutes : 0,
    price: penceToPoundsDisplay(pricePence),
    deposit: penceToPoundsDisplay(depositPence),
    payment_requirement:
      payment ??
      (typeof depositPence === 'number' && depositPence > 0 ? 'deposit' : 'none'),
    colour: typeof row.colour === 'string' && row.colour ? row.colour : '#3B82F6',
    is_active: Boolean(row.is_active),
    practitioner_ids: practitionerIds,
    staffMay: {
      name: Boolean(row.staff_may_customize_name),
      description: Boolean(row.staff_may_customize_description),
      duration: Boolean(row.staff_may_customize_duration),
      buffer: Boolean(row.staff_may_customize_buffer),
      price: Boolean(row.staff_may_customize_price),
      deposit: Boolean(row.staff_may_customize_deposit),
      colour: Boolean(row.staff_may_customize_colour),
    },
    max_advance_booking_days: win.max_advance_booking_days,
    min_booking_notice_hours: win.min_booking_notice_hours,
    cancellation_notice_hours: win.cancellation_notice_hours,
    allow_same_day_booking: win.allow_same_day_booking,
    custom_availability_enabled: Boolean(row.custom_availability_enabled),
    custom_working_hours:
      row.custom_availability_enabled && row.custom_working_hours && typeof row.custom_working_hours === 'object'
        ? (JSON.parse(JSON.stringify(row.custom_working_hours)) as WorkingHours)
        : {},
  };
}

/** Hydrate onboarding drafts from GET /api/venue/appointment-services */
export function appointmentServiceDraftsFromApiResponse(body: {
  services?: unknown[];
  practitioner_services?: Array<{ practitioner_id: string; service_id: string }>;
}): AppointmentServiceFormDraft[] {
  const links = body.practitioner_services ?? [];
  const byService = new Map<string, string[]>();
  for (const l of links) {
    const sid = l.service_id;
    const pid = l.practitioner_id;
    if (!byService.has(sid)) byService.set(sid, []);
    byService.get(sid)!.push(pid);
  }
  const rows = body.services ?? [];
  return rows.map((row) =>
    appointmentServiceDraftFromApiRow(row as Record<string, unknown>, byService.get((row as { id: string }).id) ?? []),
  );
}

/** Build JSON body for POST /api/venue/appointment-services (same shape as dashboard Add Service) */
export function serviceDraftToApiPayload(draft: AppointmentServiceFormDraft): Record<string, unknown> {
  const depositPence =
    draft.payment_requirement === 'deposit' ? (poundsToPence(draft.deposit) ?? 0) : 0;
  const ids = draft.practitioner_ids;
  return {
    name: draft.name.trim(),
    description: draft.description.trim() || undefined,
    duration_minutes: draft.duration_minutes,
    buffer_minutes: draft.buffer_minutes,
    price_pence: poundsToPence(draft.price) ?? undefined,
    payment_requirement: draft.payment_requirement,
    deposit_pence: depositPence,
    colour: draft.colour,
    is_active: draft.is_active,
    practitioner_ids: ids,
    max_advance_booking_days: draft.max_advance_booking_days,
    min_booking_notice_hours: draft.min_booking_notice_hours,
    cancellation_notice_hours: draft.cancellation_notice_hours,
    allow_same_day_booking: draft.allow_same_day_booking,
    staff_may_customize_name: draft.staffMay.name,
    staff_may_customize_description: draft.staffMay.description,
    staff_may_customize_duration: draft.staffMay.duration,
    staff_may_customize_buffer: draft.staffMay.buffer,
    staff_may_customize_price: draft.staffMay.price,
    staff_may_customize_deposit: draft.staffMay.deposit,
    staff_may_customize_colour: draft.staffMay.colour,
    custom_availability_enabled: draft.custom_availability_enabled,
    custom_working_hours: draft.custom_availability_enabled ? draft.custom_working_hours : null,
  };
}

interface OnboardingAppointmentServiceListProps {
  currencySymbol: string;
  terms: { client: string; staff: string };
  services: AppointmentServiceFormDraft[];
  setServices: React.Dispatch<React.SetStateAction<AppointmentServiceFormDraft[]>>;
  roster: Array<{ id: string; name: string }>;
  /** When roster loads, merge into drafts that still have empty practitioner_ids */
  rosterIds: string[];
  /** Matches dashboard Services: admins see optional per-calendar overrides; staff do not */
  venueIsAdmin: boolean;
  /** Venue Stripe Connect — warns when deposits/full payment chosen without Stripe */
  stripeConnected: boolean;
  /** Appointments Light: single calendar, hide per-staff field customisation UI */
  hideStaffCustomization?: boolean;
  /** Business opening hours (omit for Appointments Light–style flows where only calendar hours apply). */
  venueOpeningHours?: OpeningHours | null;
  /** Venue closed / amended hours on specific dates (same source as live booking). */
  venueOpeningExceptions?: VenueOpeningException[] | null;
  /** Draft or saved weekly hours per calendar; missing ids use the same default as new calendars. */
  calendarWorkingHoursById?: Record<string, WorkingHours>;
}

export function OnboardingAppointmentServiceList({
  currencySymbol,
  terms,
  services,
  setServices,
  roster,
  rosterIds,
  venueIsAdmin,
  stripeConnected,
  hideStaffCustomization = false,
  venueOpeningHours = null,
  venueOpeningExceptions = null,
  calendarWorkingHoursById = {},
}: OnboardingAppointmentServiceListProps) {
  const sym = currencySymbol;

  function togglePractitioner(clientKey: string, pid: string) {
    setServices((prev) =>
      prev.map((row) => {
        if (row.clientKey !== clientKey) return row;
        const nextIds = row.practitioner_ids.includes(pid)
          ? row.practitioner_ids.filter((id) => id !== pid)
          : [...row.practitioner_ids, pid];
        return { ...row, practitioner_ids: nextIds };
      }),
    );
  }

  function updateRow(clientKey: string, patch: Partial<AppointmentServiceFormDraft>) {
    setServices((prev) =>
      prev.map((row) => (row.clientKey === clientKey ? { ...row, ...patch } : row)),
    );
  }

  function getServiceV2(s: AppointmentServiceFormDraft): ServiceCustomScheduleV2 {
    const raw =
      s.custom_working_hours && typeof s.custom_working_hours === 'object'
        ? s.custom_working_hours
        : {};
    return toServiceCustomScheduleV2(raw);
  }

  return (
    <div className="space-y-4">
      {services.map((s) => {
        const linkedCalendarsForPreview = s.practitioner_ids.map((id) => ({
          id,
          working_hours: calendarWorkingHoursById[id] ?? defaultNewUnifiedCalendarWorkingHours(),
        }));
        return (
        <div key={s.clientKey} className="rounded-xl border border-slate-200 p-4 space-y-4">
          {!venueIsAdmin && !hideStaffCustomization && roster.length > 0 && (
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Link this service to at least one calendar you control. Only venue admins can change which fields other
              staff may customise for their calendars.
            </p>
          )}
          <div className="flex items-start justify-between gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Service
              {s.serverId ? '' : ' (new)'}
            </span>
            {services.length > 1 && (
              <button
                type="button"
                onClick={() => setServices((prev) => prev.filter((row) => row.clientKey !== s.clientKey))}
                className="text-xs font-medium text-slate-400 hover:text-red-600"
              >
                Remove
              </button>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Name *</label>
            <input
              type="text"
              value={s.name}
              onChange={(e) => updateRow(s.clientKey, { name: e.target.value })}
              placeholder="e.g. Consultation, Standard session"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Description</label>
            <textarea
              value={s.description}
              onChange={(e) => updateRow(s.clientKey, { description: e.target.value })}
              rows={2}
              placeholder="Brief description of the service"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Duration (mins) *</label>
              <NumericInput
                value={s.duration_minutes}
                onChange={(n) => updateRow(s.clientKey, { duration_minutes: n })}
                min={5}
                max={480}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Buffer (mins)</label>
              <NumericInput
                value={s.buffer_minutes}
                onChange={(n) => updateRow(s.clientKey, { buffer_minutes: n })}
                min={0}
                max={120}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Price ({sym})</label>
            <div className="relative max-w-[200px]">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">{sym}</span>
              <input
                type="text"
                inputMode="decimal"
                value={s.price}
                onChange={(e) => updateRow(s.clientKey, { price: e.target.value })}
                className="w-full rounded-lg border border-slate-300 py-2 pl-7 pr-3 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                placeholder="0.00"
              />
            </div>
          </div>

          <SectionCard>
            <SectionCard.Header title="Online payment when booking" />
            <SectionCard.Body className="!pt-0 space-y-3">
            <div className="space-y-2">
              <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
                <input
                  type="radio"
                  name={`payment-${s.clientKey}`}
                  className="mt-0.5"
                  checked={s.payment_requirement === 'none'}
                  onChange={() => updateRow(s.clientKey, { payment_requirement: 'none' })}
                />
                <span>No online payment (pay at venue or arrange separately)</span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
                <input
                  type="radio"
                  name={`payment-${s.clientKey}`}
                  className="mt-0.5"
                  checked={s.payment_requirement === 'deposit'}
                  onChange={() => updateRow(s.clientKey, { payment_requirement: 'deposit' })}
                />
                <span>Custom deposit (fixed amount online)</span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
                <input
                  type="radio"
                  name={`payment-${s.clientKey}`}
                  className="mt-0.5"
                  checked={s.payment_requirement === 'full_payment'}
                  onChange={() => updateRow(s.clientKey, { payment_requirement: 'full_payment' })}
                />
                <span>Pay full price online at booking</span>
              </label>
            </div>
            {s.payment_requirement === 'deposit' && (
              <div>
                <label className="mb-1 block text-sm text-slate-600">Deposit amount ({sym})</label>
                <div className="relative max-w-[200px]">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">{sym}</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={s.deposit}
                    onChange={(e) => updateRow(s.clientKey, { deposit: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 py-2 pl-7 pr-3 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    placeholder="5.00"
                  />
                </div>
              </div>
            )}
            {s.payment_requirement === 'full_payment' && (
              <p className="text-xs text-slate-500">
                The full service price (above) is charged when the guest completes booking online.
              </p>
            )}
            <StripePaymentWarning
              stripeConnected={stripeConnected}
              requiresOnlinePayment={
                s.payment_requirement === 'deposit' || s.payment_requirement === 'full_payment'
              }
            />
            </SectionCard.Body>
          </SectionCard>

          <div className="rounded-lg border border-slate-200 p-4 space-y-3">
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
                  value={s.max_advance_booking_days}
                  onChange={(n) =>
                    updateRow(s.clientKey, {
                      max_advance_booking_days: n,
                    })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-700">Min booking notice (hours)</label>
                <NumericInput
                  min={0}
                  max={168}
                  value={s.min_booking_notice_hours}
                  onChange={(n) =>
                    updateRow(s.clientKey, {
                      min_booking_notice_hours: n,
                    })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label htmlFor={`svc-cancel-${s.clientKey}`} className="mb-1 block text-sm text-slate-700">
                  Cancellation notice (hours){' '}
                  <HelpTooltip
                    maxWidth={300}
                    content="This sets when deposits and online payments are refundable until: guests who cancel at least this many hours before the start time get a full refund (subject to your payment settings)."
                  />
                </label>
                <NumericInput
                  id={`svc-cancel-${s.clientKey}`}
                  min={0}
                  max={168}
                  value={s.cancellation_notice_hours}
                  onChange={(n) =>
                    updateRow(s.clientKey, {
                      cancellation_notice_hours: n,
                    })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div className="flex flex-col justify-end">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={s.allow_same_day_booking}
                    onChange={(e) => updateRow(s.clientKey, { allow_same_day_booking: e.target.checked })}
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
              {COLOUR_OPTIONS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => updateRow(s.clientKey, { colour: c })}
                  className={`h-8 w-8 rounded-full border-2 transition-all ${
                    s.colour === c ? 'border-slate-900 scale-110' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => updateRow(s.clientKey, { is_active: !s.is_active })}
              className={`relative h-6 w-11 rounded-full transition-colors ${s.is_active ? 'bg-brand-600' : 'bg-slate-300'}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  s.is_active ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
            <span className="text-sm text-slate-700">Active (visible to clients)</span>
          </div>

          {venueIsAdmin && !hideStaffCustomization && (
            <div className="rounded-lg border border-slate-200 bg-slate-50/90 p-4 space-y-3">
              <p className="text-sm font-medium text-slate-800">Optional overrides per calendar</p>
              <p className="text-xs text-slate-500">
                Allow staff users assigned to an individual calendar to adjust the following values for their calendar
                only. Leave unticked and all calendars use the value set above.
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
                      checked={s.staffMay[key]}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setServices((prev) =>
                          prev.map((row) =>
                            row.clientKey === s.clientKey
                              ? { ...row, staffMay: { ...row.staffMay, [key]: checked } }
                              : row,
                          ),
                        );
                      }}
                      className="h-4 w-4 rounded border-slate-300 text-blue-600"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          )}

          {roster.length > 0 && (
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">Calendars that offer this service</label>
              <p className="mb-2 text-xs text-slate-500">
                Tick the calendars that should offer this service.
              </p>
              <div className="space-y-2">
                {roster.map((p) => (
                  <label
                    key={p.id}
                    className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={s.practitioner_ids.includes(p.id)}
                      onChange={() => togglePractitioner(s.clientKey, p.id)}
                      className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-slate-700">{p.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
            <div>
              <p className="text-sm font-medium text-slate-800">When guests can book this service online</p>
              <p className="mt-0.5 text-xs text-slate-500">
                Final availability is the overlap of venue opening hours, each linked calendar&apos;s
                hours, and this service&apos;s schedule (below). Staff blocks and one-off calendar
                changes also apply live.
              </p>
            </div>
            <ServiceAvailabilityCalendar
              venueOpeningHours={venueOpeningHours}
              venueOpeningExceptions={venueOpeningExceptions ?? undefined}
              linkedCalendars={linkedCalendarsForPreview}
              customAvailabilityEnabled={s.custom_availability_enabled}
              customWorkingHours={s.custom_working_hours}
              footnote="Based on venue hours (with exceptions), each linked calendar's recurring weekly hours, and this service's schedule. Staff blocks and one-off calendar changes are not previewed here."
            />

            <div className="space-y-3 pt-1">
              <div>
                <p className="text-sm font-medium text-slate-800">This service&apos;s schedule</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Optional — only turn on if this service should be bookable for less time than its calendars are open
                  (for example a brunch menu, or evening-only therapy).
                </p>
              </div>
              {venueIsAdmin ? (
                <ServiceCustomAvailabilityEditor
                  value={getServiceV2(s)}
                  onChange={(next) =>
                    updateRow(s.clientKey, {
                      custom_working_hours: next as ServiceCustomScheduleStored,
                    })
                  }
                  enabled={s.custom_availability_enabled}
                  onEnabledChange={(next) =>
                    updateRow(s.clientKey, { custom_availability_enabled: next })
                  }
                />
              ) : (
                <p className="text-xs text-slate-500">
                  Only venue admins can change this service&apos;s schedule.
                </p>
              )}
            </div>
          </div>
        </div>
        );
      })}

      <button
        type="button"
        onClick={() =>
          setServices((prev) => [
            ...prev,
            {
              ...createEmptyAppointmentServiceDraft(),
              practitioner_ids: rosterIds.length > 0 ? [...rosterIds] : [],
            },
          ])
        }
        className="w-full rounded-xl border-2 border-dashed border-slate-200 py-3 text-sm text-slate-500 hover:border-brand-300 hover:text-brand-600"
      >
        + Add service
      </button>

    </div>
  );
}

