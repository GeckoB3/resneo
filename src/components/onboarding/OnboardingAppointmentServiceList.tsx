'use client';

import Link from 'next/link';
import { defaultNewUnifiedCalendarWorkingHours } from '@/lib/availability/practitioner-defaults';
import { entityBookingWindowFromRow } from '@/lib/booking/entity-booking-window';
import { parseProcessingTimeBlocksFromDb } from '@/lib/appointments/processing-time';
import { isServiceCustomScheduleEmpty, toServiceCustomScheduleV2 } from '@/lib/service-custom-availability';
import {
  DEFAULT_APPOINTMENT_SERVICE_FORM_VALUES,
  DEFAULT_STAFF_MAY_CUSTOMIZE,
  type AppointmentServiceFormValues,
  type StaffMayCustomizeFlags,
} from '@/components/dashboard/appointment-services/appointment-service-form-values';
import { AppointmentServiceFormFields } from '@/components/dashboard/appointment-services/AppointmentServiceFormFields';
import { OnboardingInlineAddCalendarControls } from '@/components/onboarding/OnboardingInlineAddCalendarControls';
import type { CalendarEntitlement } from '@/hooks/use-calendar-entitlement';
import type { ClassPaymentRequirement, WorkingHours } from '@/types/booking-models';
import type { OpeningHours } from '@/types/availability';
import type { VenueOpeningException } from '@/types/venue-opening-exceptions';

/** @deprecated Use StaffMayCustomizeFlags — kept for any external imports */
export type StaffMayFlags = StaffMayCustomizeFlags;
/** @deprecated Use DEFAULT_STAFF_MAY_CUSTOMIZE */
export const DEFAULT_STAFF_MAY = DEFAULT_STAFF_MAY_CUSTOMIZE;

export interface AppointmentServiceFormDraft extends AppointmentServiceFormValues {
  /** Stable key for React lists and field identity */
  clientKey: string;
  /** Set after POST or when hydrating from GET: drives PATCH vs POST on save */
  serverId?: string;
}

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
    ...DEFAULT_APPOINTMENT_SERVICE_FORM_VALUES,
    clientKey:
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `svc-${Date.now()}-${Math.random()}`,
  };
}

export function appointmentServiceDraftFromBusinessDefault(ds: {
  name: string;
  duration: number;
  price: number;
}): AppointmentServiceFormDraft {
  return {
    ...createEmptyAppointmentServiceDraft(),
    name: ds.name,
    duration_minutes: ds.duration,
    price: (ds.price / 100).toFixed(2),
  };
}

function appointmentServiceDraftFromApiRow(row: Record<string, unknown>, practitionerIds: string[]): AppointmentServiceFormDraft {
  const id = row.id as string;
  const payment = row.payment_requirement as ClassPaymentRequirement | undefined;
  const depositPence = row.deposit_pence as number | null | undefined;
  const pricePence = row.price_pence as number | null | undefined;
  const win = entityBookingWindowFromRow(row);

  const rawVariants = row.variants as unknown[] | undefined;
  const variants = Array.isArray(rawVariants)
    ? rawVariants.map((v) => {
        const vr = v as Record<string, unknown>;
        return {
          id: typeof vr.id === 'string' ? vr.id : undefined,
          name: String(vr.name ?? ''),
          description: String(vr.description ?? ''),
          duration_minutes: typeof vr.duration_minutes === 'number' ? vr.duration_minutes : 30,
          buffer_minutes: typeof vr.buffer_minutes === 'number' ? vr.buffer_minutes : 0,
          price: penceToPoundsDisplay(vr.price_pence as number | null | undefined),
          deposit: penceToPoundsDisplay(vr.deposit_pence as number | null | undefined),
          is_active: Boolean(vr.is_active),
          processing_time_blocks: parseProcessingTimeBlocksFromDb(
            (vr as { processing_time_blocks?: unknown }).processing_time_blocks,
          ),
        };
      })
    : [];

  return {
    clientKey:
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `svc-${Date.now()}-${Math.random()}`,
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
      Boolean(row.custom_availability_enabled) && row.custom_working_hours && typeof row.custom_working_hours === 'object'
        ? toServiceCustomScheduleV2(row.custom_working_hours as WorkingHours | Record<string, never>)
        : { version: 2, rules: [] },
    variants,
    addon_group_links: [],
    processing_time_blocks: parseProcessingTimeBlocksFromDb(
      (row as { processing_time_blocks?: unknown }).processing_time_blocks,
    ),
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

export function serviceDraftToApiPayload(
  draft: AppointmentServiceFormDraft,
  opts: { isAdmin: boolean },
): Record<string, unknown> {
  const { isAdmin } = opts;
  const depositPence = draft.payment_requirement === 'deposit' ? (poundsToPence(draft.deposit) ?? 0) : 0;
  const usesVariantsPayload = isAdmin && draft.variants.length > 0;
  const primaryForParent =
    usesVariantsPayload && draft.variants.length > 0
      ? draft.variants.find((v) => v.is_active) ?? draft.variants[0]
      : null;
  const durationMinutesPayload =
    usesVariantsPayload && primaryForParent ? primaryForParent.duration_minutes : draft.duration_minutes;
  const bufferMinutesPayload =
    usesVariantsPayload && primaryForParent ? primaryForParent.buffer_minutes : draft.buffer_minutes;
  const priceStrPayload = usesVariantsPayload && primaryForParent ? primaryForParent.price : draft.price;

  const payload: Record<string, unknown> = {
    name: draft.name.trim(),
    description: draft.description.trim() || undefined,
    duration_minutes: durationMinutesPayload,
    buffer_minutes: bufferMinutesPayload,
    price_pence: poundsToPence(priceStrPayload) ?? undefined,
    payment_requirement: draft.payment_requirement,
    deposit_pence: depositPence,
    colour: draft.colour,
    is_active: draft.is_active,
    practitioner_ids: draft.practitioner_ids,
    max_advance_booking_days: draft.max_advance_booking_days,
    min_booking_notice_hours: draft.min_booking_notice_hours,
    cancellation_notice_hours: draft.cancellation_notice_hours,
    allow_same_day_booking: draft.allow_same_day_booking,
  };

  if (isAdmin) {
    payload.staff_may_customize_name = draft.staffMay.name;
    payload.staff_may_customize_description = draft.staffMay.description;
    payload.staff_may_customize_duration = draft.staffMay.duration;
    payload.staff_may_customize_buffer = draft.staffMay.buffer;
    payload.staff_may_customize_price = draft.staffMay.price;
    payload.staff_may_customize_deposit = draft.staffMay.deposit;
    payload.staff_may_customize_colour = draft.staffMay.colour;
    payload.custom_availability_enabled = draft.custom_availability_enabled;
    payload.custom_working_hours = draft.custom_availability_enabled ? draft.custom_working_hours : null;
    payload.processing_time_blocks = usesVariantsPayload ? [] : draft.processing_time_blocks;
    payload.variants = draft.variants.map((v, idx) => ({
      ...(v.id ? { id: v.id } : {}),
      name: v.name.trim(),
      description: v.description.trim() || null,
      duration_minutes: v.duration_minutes,
      buffer_minutes: v.buffer_minutes,
      price_pence: poundsToPence(v.price),
      deposit_pence: poundsToPence(v.deposit),
      sort_order: idx,
      is_active: v.is_active,
      processing_time_blocks: v.processing_time_blocks,
    }));
  }

  return payload;
}

export function validateAppointmentServiceDraftForSave(
  s: AppointmentServiceFormDraft,
  ctx: { isAdmin: boolean; needsRoster: boolean; staffTerm: string },
): string | null {
  const usesVariants = ctx.isAdmin && s.variants.length > 0;
  const activeVariants = usesVariants ? s.variants.filter((v) => v.is_active) : [];

  if (ctx.needsRoster && s.practitioner_ids.length === 0) {
    return `Select at least one ${ctx.staffTerm.toLowerCase()} for each service, or re-save your team step.`;
  }

  if (!usesVariants && s.duration_minutes < 5) {
    return 'Each service must have a duration of at least 5 minutes.';
  }

  if (s.payment_requirement === 'deposit') {
    const d = poundsToPence(s.deposit);
    if (d == null || d <= 0) {
      return 'Enter a valid deposit amount for each service that requires a deposit.';
    }
  }

  if (s.payment_requirement === 'full_payment') {
    if (usesVariants) {
      if (activeVariants.length === 0) {
        return 'Turn on at least one bookable option for each service with full online payment, or switch back to a single offering.';
      }
      for (const v of activeVariants) {
        const p = poundsToPence(v.price);
        if (p == null || p <= 0) {
          return `Option "${v.name.trim() || 'Unnamed'}": set a price — full online payment applies to each option.`;
        }
      }
    } else {
      const p = poundsToPence(s.price);
      if (p == null || p <= 0) {
        return 'Set a price for each service that charges the full amount online.';
      }
    }
  }

  if (ctx.isAdmin && s.custom_availability_enabled && isServiceCustomScheduleEmpty(s.custom_working_hours)) {
    return `Add at least one custom schedule rule for “${s.name.trim() || 'this service'}”, or turn off custom availability.`;
  }

  if (ctx.isAdmin && usesVariants) {
    if (activeVariants.length === 0) {
      return 'Turn on at least one bookable option for each service with options, or switch back to a single offering.';
    }
    for (let i = 0; i < s.variants.length; i++) {
      const v = s.variants[i]!;
      if (!v.name.trim()) {
        return `Option ${i + 1}: name is required`;
      }
      if (v.duration_minutes < 5 || v.duration_minutes > 480) {
        return `Option "${v.name.trim()}": duration must be between 5 and 480 minutes`;
      }
      if (v.price.trim() && poundsToPence(v.price) == null) {
        return `Option "${v.name.trim()}": invalid price`;
      }
      if (v.deposit.trim() && poundsToPence(v.deposit) == null) {
        return `Option "${v.name.trim()}": invalid deposit`;
      }
    }
  }

  return null;
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
  /** Admins only: entitlement-aware inline calendar creation + limit copy (matches event/class/resource onboarding). */
  inlineAddCalendar?: {
    entitlementLoaded: boolean;
    canAddCalendar: boolean;
    entitlement: CalendarEntitlement | null;
    onAddCalendar: () => void;
  } | null;
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
  inlineAddCalendar = null,
}: OnboardingAppointmentServiceListProps) {
  return (
    <div className="min-w-0 max-w-full space-y-4">
      {services.map((s) => {
        const linkedCalendarsForPreview = s.practitioner_ids.map((id) => ({
          id,
          working_hours: calendarWorkingHoursById[id] ?? defaultNewUnifiedCalendarWorkingHours(),
        }));

        const setDraftForm: React.Dispatch<React.SetStateAction<AppointmentServiceFormValues>> = (action) => {
          setServices((prev) =>
            prev.map((row) => {
              if (row.clientKey !== s.clientKey) return row;
              const next: AppointmentServiceFormDraft =
                typeof action === 'function'
                  ? { ...row, ...action(row) }
                  : { ...row, ...action };
              return next;
            }),
          );
        };

        const calendarsSection =
          roster.length > 0 || (venueIsAdmin && inlineAddCalendar) ? (
            <div className="min-w-0 max-w-full">
              {venueIsAdmin && inlineAddCalendar ? (
                <div className="mb-3 min-w-0 max-w-full rounded-lg border border-slate-100 bg-slate-50/90 p-3">
                  <OnboardingInlineAddCalendarControls
                    entitlementLoaded={inlineAddCalendar.entitlementLoaded}
                    canAddCalendar={inlineAddCalendar.canAddCalendar}
                    entitlement={inlineAddCalendar.entitlement}
                    onAddCalendar={inlineAddCalendar.onAddCalendar}
                    layout="panel"
                    helperWhenCanAdd={
                      <>
                        Create a new team calendar column without leaving onboarding. Tick it below to offer this
                        service on that column. You can edit weekly hours anytime in{' '}
                        <Link
                          href="/dashboard/calendar-availability"
                          className="font-medium text-brand-700 underline hover:text-brand-800"
                        >
                          Calendar availability
                        </Link>
                        .
                      </>
                    }
                  />
                </div>
              ) : null}
              {roster.length > 0 ? (
                <>
                  <label className="mb-2 block text-sm font-medium text-slate-700">
                    Calendars that offer this service
                  </label>
                  <p className="mb-2 text-xs text-slate-500">Tick the calendars that should offer this service.</p>
                  <div className="min-w-0 max-w-full space-y-2">
                    {roster.map((p) => (
                      <label
                        key={p.id}
                        className="flex min-w-0 max-w-full cursor-pointer items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50"
                      >
                        <input
                          type="checkbox"
                          checked={s.practitioner_ids.includes(p.id)}
                          onChange={() =>
                            setServices((prev) =>
                              prev.map((row) => {
                                if (row.clientKey !== s.clientKey) return row;
                                const nextIds = row.practitioner_ids.includes(p.id)
                                  ? row.practitioner_ids.filter((id) => id !== p.id)
                                  : [...row.practitioner_ids, p.id];
                                return { ...row, practitioner_ids: nextIds };
                              }),
                            )
                          }
                          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="min-w-0 break-words text-sm text-slate-700">{p.name}</span>
                      </label>
                    ))}
                  </div>
                </>
              ) : venueIsAdmin && inlineAddCalendar ? (
                <p className="text-xs text-slate-500">
                  No team calendars in the list yet. Use <strong className="font-medium text-slate-700">Add calendar</strong>{' '}
                  above — new columns appear here so you can attach this service.
                </p>
              ) : null}
            </div>
          ) : null;

        return (
          <div key={s.clientKey} className="min-w-0 max-w-full space-y-4 rounded-xl border border-slate-200 p-4">
            <div className="flex min-w-0 items-start justify-between gap-2">
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

            <AppointmentServiceFormFields
              form={s}
              setForm={setDraftForm}
              isAdmin={venueIsAdmin}
              stripeConnected={stripeConnected}
              currencySymbol={currencySymbol}
              fieldGroupSuffix={s.clientKey}
              venueOpeningHours={venueOpeningHours}
              venueOpeningExceptions={venueOpeningExceptions}
              linkedCalendarsForPreview={linkedCalendarsForPreview}
              calendarsSection={calendarsSection}
              hideStaffMaySection={hideStaffCustomization}
              staffNotice={
                !venueIsAdmin && !hideStaffCustomization && roster.length > 0 ? (
                  <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    Link this service to at least one calendar you control. Only venue admins can change which fields
                    other {terms.staff.toLowerCase()} may customise for their calendars.
                  </p>
                ) : undefined
              }
            />
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
