'use client';

import { ServiceCategoryList } from '@/components/booking/ServiceCategoryList';
import { resolveServicesLayout } from '@/lib/booking/booking-page-theme';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { compareByCategoryThenServiceOrder, type ServiceCategoryRef } from '@/lib/booking/service-categories';
import { buildGuestModifyRequest } from '@/lib/booking/guest-modify-request';
import type { GuestBookingDetailActor } from '@/lib/booking/guest-booking-actor';
import type { VenuePublic, GuestDetails } from './types';
import { usePublicBookingAccountGateContext } from '@/components/booking/PublicBookingAccountGate';
import { mergeGuestDetailsPrefill } from '@/lib/booking/public-booking-account-gate';
import { DetailsStep } from './DetailsStep';
import BookingComplianceBlock, { type BookingComplianceState } from './BookingComplianceBlock';
import { BrandSpinner } from '@/components/ui/primitives';
import { clearBookingComplianceDrafts } from './BookingComplianceForms';
import { COMPLIANCE_REQUIREMENT_UNMET } from '@/lib/compliance/constants';
import { BookingSubmittingPanel } from './BookingSubmittingPanel';
import { PaymentStep } from './PaymentStep';
import {
  APPOINTMENT_BOOKING_RESET_EVENT,
  restartPublicAppointmentBooking,
} from './appointment-booking-events';
import {
  cancellationDeadlineHoursBefore,
  classifyGroupDepositRefunds,
  isDepositRefundAvailableAt,
} from '@/lib/booking/cancellation-deadline';
import { defaultPhoneCountryForVenueCurrency } from '@/lib/phone/default-country';
import { currencySymbolFromCode } from '@/lib/money/currency-symbol';
import { getVenueLocalDateTimeForBooking } from '@/lib/venue/venue-local-clock';
import { minutesToTime, timeToMinutes } from '@/lib/availability';
import { MultiServiceSummaryCard } from './MultiServiceSummaryCard';
import { MultiServicePickerBar, type PickerServiceLine } from './MultiServicePickerBar';
import {
  MAX_SERVICES_PER_VISIT,
  chainSpanMinutes,
  serialiseServiceChainParam,
  type ServiceChainSegmentParam,
} from '@/lib/booking/service-chain';
import { StaffCardHoldToggle } from '@/components/booking/StaffCardHoldToggle';
import { StaffRequireChargeCheckbox } from '@/components/booking/StaffRequireChargeCheckbox';
import {
  resolveStaffEntityCardHold,
  STAFF_CARD_HOLD_LINK_SENT_LINE,
} from '@/components/booking/staff-card-hold';
import {
  cardHoldCatalogNoticeLine,
  cardHoldConfirmationLine,
  isCardHoldPaymentMode,
  type CardHoldPaymentMode,
} from './card-hold-copy';
import { resolveAppointmentServiceOnlineCharge } from '@/lib/appointments/appointment-service-payment';
import { formatBookablePricePence, formatFromBookablePricePence } from '@/lib/booking/format-price-display';
import type { ClassPaymentRequirement } from '@/types/booking-models';
import {
  type BookingFlowAudience,
  appointmentCatalogUrl,
  appointmentCalendarUrl,
  appointmentCalendarCacheKey,
  bookingAvailabilityUrl,
  validateAppointmentSlotUrl,
  bookingCreateUrl,
  bookingCreateMultiServiceUrl,
  bookingCreateGroupUrl,
  venueBookingsCreateUrl,
} from '@/lib/booking/booking-flow-api';
import {
  confirmBookingPaymentWithServer,
  BOOKING_CANCELLED_MESSAGE,
  PAYMENT_PROCESSING_BODY,
  PAYMENT_PROCESSING_HEADING,
  type ConfirmOutcome,
} from '@/lib/booking/client-confirm-payment';
import { ResourceCalendarMonth, todayYmdLocal } from './ResourceCalendarMonth';
import {
  AppointmentPublicShell,
  AppointmentProgressBar,
  AppointmentStepHeader,
  AppointmentChoiceCard,
  AppointmentBackLink,
  appointmentProgressPhase,
  appointmentTimeSlotClass,
  APPOINTMENT_TIME_SLOTS_GRID_CLASS,
  APPOINTMENT_TIME_SLOT_LABEL_CLASS,
  APPOINTMENT_DETAILS_SUBMIT_CLASS,
  APPOINTMENT_DETAILS_INPUT_CLASS,
  APPOINTMENT_PUBLIC_CHEVRON_SM,
  APPOINTMENT_PUBLIC_PRICE,
  AppointmentSummaryStrip,
  ExpandableDescription,
} from './appointment-public-ui';
import { StaffChoiceCard, StaffChoiceCardSkeleton } from '@/components/booking/StaffChoiceCard';
import {
  afterAddons,
  afterService,
  afterVariant,
  anyAvailableCardVisible,
  backFromAddons,
  backFromService,
  backFromSlot,
  backFromStaffPick,
  backFromVariant,
  type AppointmentFlowOrdering,
  type AppointmentFlowShape,
} from '@/lib/booking/appointment-flow-order';
import type { StaffRebookBootstrapPayloadV1 } from '@/lib/booking/staff-rebook-bootstrap';
import {
  ANY_AVAILABLE_PRACTITIONER_ID,
  isAnyAvailablePractitionerId,
} from '@/lib/availability/appointment-any-practitioner';
import {
  parseAnyAvailablePractitionerConfig,
  pickPractitionerSlotForPooledTime,
} from '@/lib/feature-flags/any-available-practitioner-config';
import type { PractitionerSlot } from '@/lib/availability/appointment-engine';
import { practitionerIdForBookingCreate } from '@/lib/booking/practitioner-id-for-booking-create';
import { AppointmentWaitlistJoin } from './AppointmentWaitlistJoin';
import { CollectiveCrossSuggestion } from './CollectiveCrossSuggestion';
import { staffBookingFlowDurationMs } from '@/lib/metrics/staff-booking-flow-duration';
import { StaffBookingConfirmationFooter } from '@/components/booking/StaffBookingConfirmationFooter';

function staffRebookAppointmentInitialDetails(
  bootstrap: StaffRebookBootstrapPayloadV1 | null | undefined,
): Partial<GuestDetails> | undefined {
  if (!bootstrap?.guest) return undefined;
  const g = bootstrap.guest;
  // Only the persistent client identity is pre-filled. Per-booking fields
  // (dietary notes, occasion, comments/requests) are intentionally left blank so
  // they're entered fresh for each booking rather than carried over — they would
  // otherwise leak into the "Comments or requests" box on the details step.
  return {
    first_name: g.firstName?.trim() ?? '',
    last_name: g.lastName?.trim() ?? '',
    email: typeof g.email === 'string' ? g.email : '',
    phone: typeof g.phone === 'string' ? g.phone : '',
  };
}

/** One bookable variant of a service. Mirrors the public catalog's `AppointmentCatalogVariant`. */
interface CatalogVariant {
  id: string;
  name: string;
  description?: string | null;
  duration_minutes: number;
  buffer_minutes: number;
  price_pence: number | null;
  deposit_pence: number | null;
  sort_order: number;
}

/** The earliest slot in a group, so lock periods are judged against the first appointment. */
function earliestGroupSlot(people: Array<{ date: string; time: string }>): { date: string | null; time: string | null } {
  let best: { date: string; time: string } | null = null;
  for (const p of people) {
    if (!best || `${p.date} ${p.time}` < `${best.date} ${best.time}`) best = { date: p.date, time: p.time };
  }
  return { date: best?.date ?? null, time: best?.time ?? null };
}

/** An unmet compliance requirement returned to a staff booking (the server never blocks staff). */
type StaffComplianceWarning = {
  compliance_type_id?: string;
  compliance_type_name: string;
  /** `required` is a block_all rule the venue set for everyone; `advisory` is everything else. */
  severity?: 'required' | 'advisory';
};

/**
 * Staff confirmation: compliance requirements the guest has not met. Staff are never
 * blocked by compliance (plan §5), so a `required` item (the venue's block_all rule) is
 * shown first and in red, with a link to capture the record straight away.
 */
function StaffComplianceWarningsCard({
  warnings,
  bookingId,
}: {
  warnings?: StaffComplianceWarning[];
  bookingId?: string | null;
}) {
  if (!warnings || warnings.length === 0) return null;
  const required = warnings.filter((w) => w.severity === 'required');
  const advisory = warnings.filter((w) => w.severity !== 'required');
  const names = (list: StaffComplianceWarning[]) => list.map((w) => w.compliance_type_name).join(', ');
  const strong = required.length > 0;
  const tone = strong ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50';
  const heading = strong ? 'text-red-900' : 'text-amber-900';
  const body = strong ? 'text-red-800' : 'text-amber-800';
  return (
    <div className={`mt-4 max-w-sm mx-auto rounded-lg border p-3 text-left ${tone}`}>
      <p className={`text-xs font-semibold ${heading}`}>Outstanding compliance forms</p>
      {required.length > 0 ? (
        <p className={`mt-0.5 text-xs ${body}`}>
          The booking is made, but this venue requires {names(required)} for this booking and{' '}
          {required.length === 1 ? 'it is' : 'they are'} not on file. Capture the record in venue or send the form
          before the appointment.
        </p>
      ) : null}
      {advisory.length > 0 ? (
        <p className={`mt-0.5 text-xs ${body}`}>
          {names(advisory)} {advisory.length === 1 ? 'is' : 'are'} not on file yet. Collect the record or send the
          form before the appointment.
        </p>
      ) : null}
      {bookingId ? (
        <a
          href={`/dashboard/bookings?openBooking=${encodeURIComponent(bookingId)}`}
          className={`mt-2 inline-block text-xs font-semibold underline underline-offset-2 ${heading}`}
        >
          Capture in venue
        </a>
      ) : null}
    </div>
  );
}

/** Staff-only booking duration overrides: parent service id if no variant; composite key when a variant is chosen. */
function staffDurationOverrideKey(serviceId: string, variantId: string | null): string {
  return variantId ? `${serviceId}:${variantId}` : serviceId;
}

/**
 * Card description. Rendered as a sibling of the card's click target (see the shell/target split in
 * `choiceCardShellClass`), because it owns an expand toggle and buttons must not nest.
 */
function ServiceCatalogDescription({
  description,
  idSuffix,
  className,
}: {
  description?: string | null;
  idSuffix: string;
  className?: string;
}) {
  return <ExpandableDescription description={description} idSuffix={idSuffix} className={className} />;
}

function catalogVariantsForServiceId(catalogStaff: CatalogPractitioner[], serviceId: string): CatalogVariant[] {
  for (const p of catalogStaff) {
    const offer = p.services.find((s) => s.id === serviceId);
    if (offer?.variants && offer.variants.length > 0) return offer.variants;
  }
  return [];
}

/**
 * Variants for a service, scoped to a specific calendar when given. Combined pages
 * need this because each calendar's source service has its OWN variants; omitting the
 * id (single venue) falls back to first-match, where all calendars share the same set.
 */
function catalogVariantsForServiceFromStaff(
  catalogStaff: CatalogPractitioner[],
  serviceId: string,
  practitionerId?: string | null,
): CatalogVariant[] {
  if (practitionerId) {
    const scoped = catalogStaff
      .find((p) => p.id === practitionerId)
      ?.services.find((s) => s.id === serviceId)?.variants;
    if (scoped) return scoped;
  }
  return catalogVariantsForServiceId(catalogStaff, serviceId);
}

/** Returns the (active, visible-online) add-on groups for a given service id, or an empty list. */
function catalogAddonGroupsForServiceId(
  catalogStaff: CatalogPractitioner[],
  serviceId: string,
): import('@/types/booking-models').AppointmentCatalogAddonGroup[] {
  for (const p of catalogStaff) {
    const offer = p.services.find((s) => s.id === serviceId);
    if (offer?.addon_groups && offer.addon_groups.length > 0) return offer.addon_groups;
  }
  return [];
}

/**
 * Add-on groups for a service, scoped to a specific calendar when given. Combined
 * pages need this because each calendar's source service carries its OWN groups,
 * so resolving by service id alone can show one venue's extras while charging
 * another's. Omitting the id (single venue) falls back to first-match, where every
 * calendar shares the same set.
 */
function addonGroupsForServiceFromStaff(
  catalogStaff: CatalogPractitioner[],
  serviceId: string,
  practitionerId?: string | null,
): import('@/types/booking-models').AppointmentCatalogAddonGroup[] {
  if (practitionerId) {
    const scoped = catalogStaff
      .find((p) => p.id === practitionerId)
      ?.services.find((s) => s.id === serviceId)?.addon_groups;
    if (scoped) return scoped;
  }
  return catalogAddonGroupsForServiceId(catalogStaff, serviceId);
}

/**
 * Combined pages: whether an offering is the same thing whoever provides it.
 * Only those can be pooled; the rest need a calendar chosen first, because the
 * options and the price come off that calendar's own source service.
 */
function offeringIsUniform(catalogStaff: CatalogPractitioner[], serviceId: string): boolean {
  for (const p of catalogStaff) {
    const offer = p.services.find((s) => s.id === serviceId);
    if (offer && offer.any_available === false) return false;
  }
  return true;
}

type CatalogServiceOffer = CatalogPractitioner['services'][number];

/** Apply chosen variant duration / buffer / price / deposit on a catalog service offer. */
function catalogOfferWithVariant(
  offer: CatalogServiceOffer | undefined | null,
  variantId: string | null,
): CatalogServiceOffer | null {
  if (!offer) return null;
  if (!variantId) return offer;
  const variant = offer.variants?.find((v) => v.id === variantId);
  if (!variant) return offer;
  return {
    ...offer,
    duration_minutes: variant.duration_minutes,
    buffer_minutes: variant.buffer_minutes,
    price_pence: variant.price_pence,
    deposit_pence: variant.deposit_pence ?? offer.deposit_pence ?? null,
  };
}

/**
 * Resolve the chosen add-ons for a service into filtered ids, price/duration totals,
 * and display lines. Shared by the single, multi-service, and group flows so the chain
 * math, review cards, and create payloads all agree.
 */
function addonSelectionDetails(
  catalogStaff: CatalogPractitioner[],
  serviceId: string,
  addonIds: string[],
  /**
   * Combined page: add-ons live on the CHOSEN calendar's own source service, so
   * resolve groups from that calendar. Omitted (single venue) → first-match, where
   * every calendar offering the service shares the same groups anyway.
   */
  practitionerId?: string | null,
): {
  filteredIds: string[];
  totalPence: number;
  totalMinutes: number;
  lines: Array<{ id: string; name: string; pricePence: number; durationMinutes: number }>;
} {
  const scoped = practitionerId
    ? catalogStaff.find((p) => p.id === practitionerId)?.services.find((s) => s.id === serviceId)?.addon_groups
    : undefined;
  const groups = scoped ?? catalogAddonGroupsForServiceId(catalogStaff, serviceId);
  const idSet = new Set(addonIds);
  const lines: Array<{ id: string; name: string; pricePence: number; durationMinutes: number }> = [];
  let totalPence = 0;
  let totalMinutes = 0;
  for (const g of groups) {
    for (const a of g.addons) {
      if (idSet.has(a.id)) {
        totalPence += a.additional_price_pence;
        totalMinutes += a.additional_duration_minutes;
        lines.push({
          id: a.id,
          name: a.name,
          pricePence: a.additional_price_pence,
          durationMinutes: a.additional_duration_minutes,
        });
      }
    }
  }
  const filteredIds = addonIds.filter((id) => groups.some((g) => g.addons.some((a) => a.id === id)));
  return { filteredIds, totalPence, totalMinutes, lines };
}

const STAFF_CUSTOM_DURATION_PRESETS = [15, 30, 45, 60, 75, 90, 105, 120] as const;

function StaffCustomDurationPopover({
  value,
  onPresetPick,
  onOtherMinutesChange,
  onDone,
  onReset,
}: {
  value: number;
  onPresetPick: (minutes: number) => void;
  onOtherMinutesChange: (minutes: number) => void;
  onDone: () => void;
  onReset: () => void;
}) {
  return (
    <div
      className="absolute left-4 top-[calc(100%-0.25rem)] z-20 w-64 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-xl"
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      role="dialog"
      aria-label="Custom duration"
    >
      <p className="text-xs font-semibold text-slate-700">Custom duration</p>
      <p className="mt-0.5 text-[11px] text-slate-500">Applies only to this booking.</p>
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        {STAFF_CUSTOM_DURATION_PRESETS.map((minutes) => (
          <button
            key={minutes}
            type="button"
            onClick={() => onPresetPick(minutes)}
            className={`rounded-lg px-2 py-1.5 text-xs font-semibold ${
              value === minutes
                ? 'bg-brand-600 text-white'
                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            {minutes}m
          </button>
        ))}
      </div>
      <label className="mt-2 block text-[11px] font-semibold text-slate-600">
        Other minutes
        <input
          type="number"
          min={15}
          max={840}
          step={5}
          value={value}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (!Number.isInteger(next)) return;
            onOtherMinutesChange(Math.min(840, Math.max(15, next)));
          }}
          className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
        />
      </label>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
        >
          Done
        </button>
        <button
          type="button"
          onClick={onReset}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          Reset
        </button>
      </div>
    </div>
  );
}

/** Services + staff from catalog (no date / slots). */
interface CatalogPractitioner {
  id: string;
  name: string;
  services: Array<{
    id: string;
    name: string;
    description?: string | null;
    duration_minutes: number;
    buffer_minutes?: number;
    price_pence: number | null;
    deposit_pence?: number | null;
    payment_requirement?: ClassPaymentRequirement;
    /** Venue-chosen display order (lower first); the service picker sorts by this, then name. */
    sort_order?: number;
    /** Category heading the venue lists this service under; null or absent when uncategorised. */
    category?: ServiceCategoryRef | null;
    /** From service_items / appointment_services; used for deposit refund copy before booking completes. */
    cancellation_notice_hours?: number;
    /** Optional sub-options. When present, the customer must pick one before slot selection. */
    variants?: CatalogVariant[];
    /** Add-on groups linked to this service (visible online). Public catalog filters hidden ones. */
    addon_groups?: import('@/types/booking-models').AppointmentCatalogAddonGroup[];
    /** Combined page only: whether "any available" may be offered (false → pick a calendar). */
    any_available?: boolean;
    /** Where the service is delivered; 'client_address' makes the details step collect an address. */
    location_type?: import('@/types/booking-models').ServiceLocationType;
  }>;
}

/** Address fields for booking create payloads; empty object when no address was collected. */
function clientAddressPayloadFields(details: GuestDetails): Record<string, string> {
  if (!details.address_line1?.trim()) return {};
  return {
    client_address_line1: details.address_line1.trim(),
    ...(details.address_line2?.trim() ? { client_address_line2: details.address_line2.trim() } : {}),
    ...(details.address_city?.trim() ? { client_address_city: details.address_city.trim() } : {}),
    ...(details.address_postcode?.trim() ? { client_address_postcode: details.address_postcode.trim() } : {}),
  };
}

/** True when any of the given service ids is delivered at the client's address. */
function anyServiceNeedsClientAddress(catalog: CatalogPractitioner[], serviceIds: Array<string | null | undefined>): boolean {
  const wanted = new Set(serviceIds.filter((id): id is string => Boolean(id)));
  if (wanted.size === 0) return false;
  for (const prac of catalog) {
    for (const svc of prac.services) {
      if (wanted.has(svc.id) && svc.location_type === 'client_address') return true;
    }
  }
  return false;
}

/** Per-date availability from /api/booking/availability. */
interface SlotPractitioner extends CatalogPractitioner {
  slots: Array<{
    start_time: string;
    service_id: string;
    duration_minutes: number;
    price_pence: number | null;
    practitioner_id?: string;
    practitioner_name?: string;
  }>;
}

interface PersonSelection {
  /** Rows added together for one attendee share a key, so they are shown and removed as one. */
  personKey?: string;
  label: string;
  serviceId: string;
  serviceName: string;
  /** Chosen variant for this attendee's service, if the service has variants. */
  serviceVariantId?: string | null;
  practitionerId: string;
  practitionerName: string;
  date: string;
  time: string;
  /** Includes add-on minutes. */
  durationMinutes: number;
  bufferMinutes: number;
  /** Service (+variant) price only; add-on price tracked separately. */
  pricePence: number | null;
  /** Includes add-on price when the online charge is a full payment. */
  depositPence: number;
  /** `card_hold`: no money due at booking; `depositPence` is the no-show fee to authorise. */
  onlineChargeLabel?: 'deposit' | 'full_payment' | 'card_hold';
  /** Add-ons chosen for this attendee. */
  addonIds?: string[];
  addonTotalPence?: number;
  addonTotalMinutes?: number;
}

/** Consecutive services for one practitioner (multi-service booking). */
export interface MultiServiceSegment {
  serviceId: string;
  /** When the parent service has variants, the picked sub-option id. */
  serviceVariantId?: string | null;
  serviceName: string;
  practitionerId: string;
  practitionerName: string;
  startTime: string;
  /** Includes add-on minutes so chain start times line up with the server's consecutive check. */
  durationMinutes: number;
  bufferMinutes: number;
  /** Service+variant price only (add-on price is tracked separately in `addonTotalPence`). */
  pricePence: number | null;
  depositPence: number;
  /** `card_hold`: no money due at booking; `depositPence` is the no-show fee to authorise. */
  onlineChargeLabel?: 'deposit' | 'full_payment' | 'card_hold';
  /** Chosen add-on ids for this segment (sent to create-multi-service / validate-slot). */
  addonIds?: string[];
  /** Sum of add-on price for display on the review card. */
  addonTotalPence?: number;
  /** Sum of add-on minutes folded into `durationMinutes`. */
  addonTotalMinutes?: number;
  /** Staff custom core duration (without add-ons), sent to `create-multi-service` for staff sources. */
  customDurationMinutes?: number | null;
}

/**
 * A service ticked after the first one on the picker (Docs/multi-service-picker-plan.md).
 * Its options (variant, add-ons) are collected before the times; `optionsDone`
 * records that they were asked for.
 */
interface ChainExtra {
  serviceId: string;
  variantId: string | null;
  addonIds: string[];
  optionsDone: boolean;
}

/** Where the flow goes once every extra service has its options. */
type ChainTarget = 'practitioner' | 'slot' | 'prefill';

/**
 * Effective duration and buffer of one service as it will be booked: the
 * person's own offer when known, the chosen variant, a staff custom duration,
 * and the add-ons on top.
 */
function effectiveSegmentTiming(
  catalogStaff: CatalogPractitioner[],
  sel: { serviceId: string; variantId: string | null; addonIds: string[] },
  practitionerId: string | null,
  staffDurationOverrides: Record<string, number>,
): { durationMinutes: number; bufferMinutes: number } {
  const scopedPrac = practitionerId && !isAnyAvailablePractitionerId(practitionerId) ? practitionerId : null;
  const base =
    (scopedPrac
      ? catalogStaff.find((p) => p.id === scopedPrac)?.services.find((s) => s.id === sel.serviceId)
      : undefined) ?? catalogStaff.flatMap((p) => p.services).find((s) => s.id === sel.serviceId);
  if (!base) return { durationMinutes: 30, bufferMinutes: 0 };
  const offer = catalogOfferWithVariant(base, sel.variantId) ?? base;
  const custom = staffDurationOverrides[staffDurationOverrideKey(sel.serviceId, sel.variantId)];
  const addons = addonSelectionDetails(catalogStaff, sel.serviceId, sel.addonIds, scopedPrac);
  return {
    durationMinutes: (custom ?? offer.duration_minutes) + addons.totalMinutes,
    bufferMinutes: offer.buffer_minutes ?? 0,
  };
}

/**
 * The visit's span, first start to last end, when more than one service is
 * chosen. The month view only knows one length, so it is asked about this
 * block; the day view checks the exact chain.
 */
function chainSpanForSelection(
  catalogStaff: CatalogPractitioner[],
  primary: { serviceId: string; variantId: string | null; addonIds: string[] },
  extras: ChainExtra[],
  practitionerId: string | null,
  staffDurationOverrides: Record<string, number>,
): number {
  return chainSpanMinutes([
    effectiveSegmentTiming(catalogStaff, primary, practitionerId, staffDurationOverrides),
    ...extras.map((ex) => effectiveSegmentTiming(catalogStaff, ex, practitionerId, staffDurationOverrides)),
  ]);
}

function recomputeMultiServiceChain(segments: MultiServiceSegment[], firstStart: string): MultiServiceSegment[] {
  let m = timeToMinutes(firstStart);
  return segments.map((seg) => {
    const row = { ...seg, startTime: minutesToTime(m) };
    m += seg.durationMinutes + seg.bufferMinutes;
    return row;
  });
}

type Step =
  | 'mode_choice'
  | 'staff_pick'
  | 'service' | 'variant' | 'addons' | 'append_variant' | 'practitioner' | 'slot' | 'multi_service' | 'details' | 'payment' | 'confirmation'
  | 'group_person_label' | 'group_staff_pick' | 'group_service' | 'group_variant' | 'group_addons' | 'group_practitioner' | 'group_slot'
  | 'group_review' | 'group_details' | 'group_payment' | 'group_confirmation';

const SINGLE_STEPS: Step[] = ['service', 'variant', 'addons', 'practitioner', 'slot', 'multi_service', 'details'];
const SINGLE_STEPS_LOCKED: Step[] = ['service', 'variant', 'addons', 'slot', 'multi_service', 'details'];

/** Steps that show the "Booking with {person}" banner once staff-first has one. */
const STAFF_FIRST_BANNER_STEPS: Step[] = ['service', 'variant', 'addons', 'append_variant'];

/**
 * The group flow runs the same shape as a single booking, one guest at a time,
 * so it asks the ordering helper about the single steps and renames the answer.
 * Its entry and exit (the person label, and the review it returns to) have no
 * single-flow equivalent and stay at their call sites.
 */
const GROUP_STEP_BY_SINGLE = {
  staff_pick: 'group_staff_pick',
  service: 'group_service',
  variant: 'group_variant',
  addons: 'group_addons',
  practitioner: 'group_practitioner',
  slot: 'group_slot',
} as const satisfies Record<string, Step>;

function groupStep(single: keyof typeof GROUP_STEP_BY_SINGLE): Step {
  return GROUP_STEP_BY_SINGLE[single];
}

interface AppointmentBookingFlowProps {
  venue: VenuePublic;
  cancellationPolicy?: string;
  embed?: boolean;
  onHeightChange?: () => void;
  accentColour?: string;
  /** From /book/{venue}/{practitioner-slug}: skip staff step; catalog filtered */
  lockedPractitioner?: { id: string; name: string; bookingSlug: string };
  /** §7.7: set when this flow is mounted inside a venue collective page. */
  collectiveId?: string;
  /** Combined page: the offering id, so the create call resolves the price/duration override. */
  collectiveServiceItemId?: string;
  bookingAudience?: BookingFlowAudience;
  onBookingCreated?: () => void;
  /**
   * Fired once an EXISTING booking has been saved, as distinct from
   * {@link onBookingCreated}, which asks the host to dismiss the confirmation and is
   * wired to the staff-only "Done" footer. A host showing its own summary of the booking
   * needs to know it changed while the guest is still reading the confirmation, so this
   * fires on both audiences and does not imply dismissal.
   */
  onBookingModified?: () => void;
  /**
   * Fires the moment a booking is created/updated (POST success) rather than when staff
   * dismiss the confirmation screen ({@link onBookingCreated}) — lets host calendars
   * refresh their grid while the modal is still open.
   */
  onBookingSubmitted?: () => void;
  initialDate?: string;
  initialTime?: string;
  preselectedPractitionerId?: string;
  preselectedServiceId?: string;
  waitlistOfferEntryId?: string;
  /** Public flow: open on "Select a service", skipping the single/group mode chooser (`?start=service`). */
  /**
   * Which step the LINK asked to open on.
   *
   * `'service'` skips the single-or-group chooser. `'time'` additionally says
   * the link already names the service, so the service step should be passed
   * through once the catalogue confirms it: that is what makes "Book again"
   * one tap rather than three (P3-1). Neither value can skip a REQUIRED
   * choice; see `advanceForRebook`.
   */
  initialStep?: 'service' | 'time';
  /** Staff walk-ins: optional guest contact (defaults name to Walk In). */
  staffBookingSource?: 'phone' | 'walk-in';
  editBooking?: {
    id: string;
    booking_date: string;
    booking_time: string;
    party_size: number;
    practitioner_id: string;
    service_id: string;
    guest_first_name?: string;
    guest_last_name?: string;
    guest_email?: string;
    guest_phone?: string;
    /**
     * WHO is saving, and therefore WHERE the save goes (P2-3). Absent means
     * staff, which is why this cannot be inferred from whether a credential
     * is present: a signed-in customer holds no credential either, and under
     * the old `publicAuth` shape would silently have PATCHed the venue route.
     */
    guestActor?: GuestBookingDetailActor;
  };
  /** Built from sessionStorage when staff uses “Rebook” from guest history (same venue). */
  staffRebookBootstrap?: StaffRebookBootstrapPayloadV1 | null;
  /** When set, staff create/calendar calls target a linked owner venue. */
  linkedOwnerVenueId?: string;
}

function formatDateHuman(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return dateStr;
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function todayStr(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

function slotStartKey(startTime: string): string {
  return startTime.trim().slice(0, 5);
}

/** One button per clock time (pooled “any available” can list multiple practitioners at the same time). */
function dedupeSlotsByStartTime<T extends { start_time: string }>(slots: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const slot of slots) {
    const key = slotStartKey(slot.start_time);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(slot);
  }
  return out;
}

function groupSlotsByPeriod(slots: Array<{ start_time: string }>) {
  const morning: typeof slots = [];
  const afternoon: typeof slots = [];
  const evening: typeof slots = [];
  for (const slot of slots) {
    const [h] = slot.start_time.split(':').map(Number);
    if ((h ?? 0) < 12) morning.push(slot);
    else if ((h ?? 0) < 17) afternoon.push(slot);
    else evening.push(slot);
  }
  return { morning, afternoon, evening };
}

export function AppointmentBookingFlow({
  venue,
  cancellationPolicy,
  embed,
  onHeightChange,
  accentColour,
  lockedPractitioner,
  collectiveId,
  collectiveServiceItemId,
  bookingAudience = 'public',
  onBookingCreated,
  onBookingModified,
  onBookingSubmitted,
  initialDate,
  initialTime,
  preselectedPractitionerId,
  preselectedServiceId,
  waitlistOfferEntryId,
  initialStep,
  staffBookingSource = 'phone',
  editBooking,
  staffRebookBootstrap = null,
  linkedOwnerVenueId,
}: AppointmentBookingFlowProps) {
  const isStaff = bookingAudience === 'staff';
  const acknowledgeStaffBooking = useCallback(() => {
    onBookingCreated?.();
  }, [onBookingCreated]);
  const staffFlowStartedAtRef = useRef<number | null>(null);
  useEffect(() => {
    if (isStaff && !editBooking) {
      staffFlowStartedAtRef.current = Date.now();
    }
  }, [isStaff, editBooking]);
  const isPublicGuest = bookingAudience === 'public';
  const accountGate = usePublicBookingAccountGateContext();
  const isEdit = Boolean(editBooking);
  const isStaffWalkInAppointment = isStaff && staffBookingSource === 'walk-in';
  const detailsAudience =
    isStaff && staffBookingSource === 'walk-in' ? ('staff_walk_in' as const) : isStaff ? ('staff' as const) : ('public' as const);
  const publicCreateErrorMessage = useCallback(
    (res: Response, data: { error?: string; message?: string }) => {
      if (isPublicGuest && accountGate.handleCreateResponseError(res.status, data.error)) {
        return 'Sign in is required to book this venue.';
      }
      // Prefer a server-supplied human-readable message (e.g. compliance 409s carry a
      // friendly `message` alongside the machine `error` code) so guests never see a raw code.
      return data.message ?? data.error ?? 'Booking failed';
    },
    [accountGate, isPublicGuest],
  );
  const terms = venue.terminology ?? { client: 'Client', booking: 'Appointment', staff: 'Staff' };
  const anyAvailablePractitionerEnabled = Boolean(
    venue.feature_flags?.resolved?.any_available_practitioner,
  );
  const anyAvailableAssignmentConfig = useMemo(
    () =>
      parseAnyAvailablePractitionerConfig({
        any_available_practitioner_config: venue.feature_flags?.any_available_practitioner_config,
      }),
    [venue.feature_flags?.any_available_practitioner_config],
  );
  const appointmentWaitlistEnabled = Boolean(venue.feature_flags?.resolved?.waitlist_v2);
  /**
   * Owner venue's card-hold flag (design doc 7.6 / D6). Present on staff venue
   * payloads (GET /api/venue, linked venue-profile, dashboard page bootstrap);
   * absent (falsy) on the public /api/booking/venue payload, which is fine
   * because the toggle is staff-audience only.
   */
  const cardHoldDepositsEnabled = Boolean(venue.feature_flags?.resolved?.card_hold_deposits);
  const [staffRequireDeposit, setStaffRequireDeposit] = useState(false);
  /** Card-hold services only (design doc 7.6): default ON, staff may waive per booking. */
  const [staffRequireCardHold, setStaffRequireCardHold] = useState(true);
  // Public compliance pre-check (Phase 2 / G4): the guest's email, seeded from a
  // signed-in account and updated as they type, drives the pre-check resolve.
  const [precheckEmail, setPrecheckEmail] = useState<string>(
    () => (isPublicGuest ? accountGate.guestDetailsPrefill?.email?.trim() ?? '' : ''),
  );
  // Inline compliance forms the guest completes during booking (Phase 2c): collected
  // submissions + whether every mandatory form is done (gates Confirm) + the type ids
  // (so the pre-check notice suppresses the forms it is already rendering).
  const [bookingCompliance, setBookingCompliance] = useState<BookingComplianceState | null>(null);
  // The inline compliance forms sit below the contact fields, so a "complete the form" error
  // raised from the submit button needs to bring them into view.
  const bookingComplianceRef = useRef<HTMLDivElement | null>(null);
  // Bumped when the server rejects a booking on compliance, so the block re-resolves and
  // shows the form the client had not seen.
  const [complianceRefreshKey, setComplianceRefreshKey] = useState(0);
  // A submit that arrived while the compliance check for the typed email was still running.
  // Held here and resumed by the effect below the handlers, so the guest never has to click twice.
  const [pendingComplianceSubmit, setPendingComplianceSubmit] = useState<
    { kind: 'single' | 'group'; details: GuestDetails } | null
  >(null);

  const isLockedPractitionerFlow = Boolean(
    lockedPractitioner?.id && lockedPractitioner?.bookingSlug,
  );
  /** Staff opened the modal from the dashboard calendar empty-slot menu with date, time, and column (practitioner) set. */
  const staffCalendarSlotPrefillActive = useMemo(() => {
    if (!isStaff || isStaffWalkInAppointment || isEdit || Boolean(staffRebookBootstrap?.appointment)) return false;
    if (isLockedPractitionerFlow) return false;
    const d = initialDate?.trim();
    const t = initialTime?.trim();
    const p = preselectedPractitionerId?.trim();
    return Boolean(d && t && p);
  }, [
    isStaff,
    isStaffWalkInAppointment,
    isEdit,
    staffRebookBootstrap?.appointment,
    isLockedPractitionerFlow,
    initialDate,
    initialTime,
    preselectedPractitionerId,
  ]);
  const singleFlowSteps: Step[] = isLockedPractitionerFlow ? SINGLE_STEPS_LOCKED : SINGLE_STEPS;

  /**
   * Whether this session asks for a person before a service. Decided once, at
   * mount: nobody part-way through must have the steps rearranged under them
   * because the venue flipped the setting, and the surfaces excluded here
   * (edits, per-practitioner pages) cannot change mid-session either.
   *
   * The rule on both sides of the desk is the same: reorder only when the
   * session does not already know the answer to one of the two questions.
   *   * Knows the *what* already (a waitlist offer, a `service_id` link, a
   *     rebook seeded from a past appointment): stay service-first, because
   *     asking who first would be a step backwards.
   *   * Knows the *who* already (staff clicked an empty slot on someone's
   *     calendar column, so date, time and person are all set): stay
   *     service-first, because the person is no longer a question.
   *
   * Walk-ins are deliberately not excluded. Someone is standing at the desk
   * asking for a person as often as for a service, so the toggle applies:
   * `staffCalendarSlotPrefillActive` already treats walk-ins as unprefilled
   * even when launched from a column.
   */
  const [orderingForSession] = useState<AppointmentFlowOrdering>(() =>
    venue.feature_flags?.resolved?.staff_first_booking_flow === true &&
    (bookingAudience === 'public' ||
      (isStaff && !staffCalendarSlotPrefillActive && !staffRebookBootstrap?.appointment)) &&
    !editBooking &&
    !(lockedPractitioner?.id && lockedPractitioner?.bookingSlug) &&
    !preselectedServiceId
      ? 'staff_first'
      : 'service_first',
  );
  /**
   * Combined pages only. Set when a guest who chose "Any available" picks an
   * offering that differs by calendar: they have to name a calendar after all,
   * and from that point the flow behaves exactly like the combined
   * service-first flow, which is what {@link flowShape} then reports.
   */
  const [anyRouteActive, setAnyRouteActive] = useState(false);
  const isStaffFirst = orderingForSession === 'staff_first';
  const flowShape: AppointmentFlowShape = useMemo(
    () => ({
      // Inside the pooled-offering detour the guest is picking a calendar and
      // then its own options, which is the combined service-first flow exactly.
      // Reporting it as such is what keeps that detour on tested ground.
      ordering: anyRouteActive ? 'service_first' : orderingForSession,
      surface: isLockedPractitionerFlow ? 'locked' : venue.is_collective ? 'combined' : 'venue',
    }),
    [orderingForSession, anyRouteActive, isLockedPractitionerFlow, venue.is_collective],
  );

  // Shared state
  // A combined page (venue collective) skips the single/group mode choice: the
  // group pipeline has no collective routing, so only single bookings are offered.
  const [step, setStep] = useState<Step>(() => {
    if (isStaffFirst) {
      // A combined page has no single-or-group chooser, staff never see one
      // either (group bookings are reached only from `mode_choice`), and
      // `?start=service` means "skip the chooser". All three land on the picker.
      return venue.is_collective || isStaff || initialStep
        ? 'staff_pick'
        : 'mode_choice';
    }
    return editBooking || isLockedPractitionerFlow || isStaff || venue.is_collective || initialStep
      ? 'service'
      : 'mode_choice';
  });
  const [date, setDate] = useState(() => editBooking?.booking_date ?? initialDate ?? todayStr());
  const [catalogStaff, setCatalogStaff] = useState<CatalogPractitioner[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [slotPractitioners, setSlotPractitioners] = useState<SlotPractitioner[]>([]);
  /**
   * The server could not read this venue's schedule and refused to guess (Stage 7).
   * Distinct from "no slots": one means try again, the other means try another day.
   */
  const [slotsUnavailable, setSlotsUnavailable] = useState(false);
  /**
   * The month lookup could not be answered (Stage 7). Separate from `slotsUnavailable`:
   * one greys out a whole picker, the other empties a single day's time list.
   */
  const [calendarUnavailable, setCalendarUnavailable] = useState(false);
  /**
   * Arguments of the last month lookup, so "Try again" can replay exactly that request.
   * Clearing the cache alone does not refetch: the effect that loads a month is keyed on
   * the month and selection, none of which changed, so nothing would happen.
   */
  const lastCalendarFetchRef = useRef<Parameters<typeof fetchAppointmentCalendarMonth>[0] | null>(null);
  /**
   * The arguments of the last slot lookup, so "Try again" can replay exactly that request.
   * A ref, not state: it must not cause a render, and the retry only ever reads the latest.
   */
  const lastSlotFetchRef = useRef<Parameters<typeof fetchAvailability>[0] | null>(null);

  /**
   * Stage 7 (decision J). Deliberately NOT the "no times available" card: that one tells a
   * guest to try a different date, which is the wrong advice when the date is fine and the
   * lookup is not. Amber rather than red, because nothing is broken for them and retrying
   * usually works.
   */
  const renderSlotsUnavailable = (onRetry: () => void) => (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-8 text-center">
      <p className="text-sm font-medium text-amber-900">We could not load times for {formatDateHuman(date)}</p>
      <p className="mx-auto mt-1 max-w-sm text-xs text-amber-800">
        This is a temporary problem on our side, not a sign the day is full. Please try again in a moment.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
      >
        Try again
      </button>
    </div>
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /** "Continue" on the extras step, which awaits a round trip when adding another service. */
  const [addonsAdvancing, setAddonsAdvancing] = useState(false);

  // Clear persisted inline-compliance drafts once a booking has actually succeeded (the flow
  // reaches confirmation/payment). Doing it here, not on submit start, means a failed submit
  // still resumes on reload, while a completed booking doesn't leave stale answers behind.
  useEffect(() => {
    if (
      isPublicGuest &&
      (step === 'confirmation' || step === 'payment' || step === 'group_confirmation' || step === 'group_payment')
    ) {
      clearBookingComplianceDrafts(venue.id);
    }
  }, [step, isPublicGuest, venue.id]);

  // Single booking state
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(() => editBooking?.service_id ?? preselectedServiceId ?? null);
  /** When the chosen service has variants, this is the picked variant id; null otherwise. */
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  /**
   * Add-ons chosen by the booker for the current service. Reset whenever the service or
   * variant changes (linked groups depend on the service). The booking-create payload
   * includes these as `{ addons: [{ addon_id }] }`.
   */
  const [selectedAddonIds, setSelectedAddonIds] = useState<string[]>([]);
  /** Staff-created appointments can override duration for this booking only. Keyed by parent service id. */
  const [staffDurationOverrides, setStaffDurationOverrides] = useState<Record<string, number>>({});
  /** Staff service-step (no variants): which service id has the duration popover open. */
  const [durationPopoverServiceId, setDurationPopoverServiceId] = useState<string | null>(null);
  /** Staff variant-step duration editor: which composite override key has its popover open. */
  const [durationPopoverOpenForKey, setDurationPopoverOpenForKey] = useState<string | null>(null);
  const [selectedPractitionerId, setSelectedPractitionerId] = useState<string | null>(() =>
    editBooking?.practitioner_id ?? (lockedPractitioner?.id && lockedPractitioner?.bookingSlug ? lockedPractitioner.id : null),
  );
  const [selectedTime, setSelectedTime] = useState<string | null>(() => editBooking?.booking_time.slice(0, 5) ?? initialTime ?? null);
  /**
   * Staff-first only: the service a guest was trying to book when the person
   * they picked turned out to be full. Purely presentational, so the next
   * person's list can pin it and say "you were booking this"; it never changes
   * where any step goes.
   */
  const [carriedServiceId, setCarriedServiceId] = useState<string | null>(null);
  const [guestDetails, setGuestDetails] = useState<GuestDetails | null>(null);
  const [createResult, setCreateResult] = useState<{
    booking_id: string;
    booking_ids?: string[];
    client_secret?: string;
    stripe_account_id?: string;
    requires_deposit: boolean;
    deposit_amount_pence: number;
    cancellation_notice_hours: number;
    payment_url?: string;
    /** Card capture mode from the create response ('setup' = card hold, no payment today). */
    payment_mode?: CardHoldPaymentMode;
    card_hold_fee_pence?: number | null;
    card_hold_consent_text?: string | null;
    /** Staff create requested a card hold, so `payment_url` is a card request link (design doc 7.6). */
    card_hold_requested?: boolean;
    /** Unmet requirements flagged at staff booking time (audit M2; staff are never blocked, plan §5). */
    compliance_warnings?: StaffComplianceWarning[];
  } | null>(null);
  /** Server-verified payment outcome (plan Phase 5): drives honest confirmation copy. */
  const [paymentOutcome, setPaymentOutcome] = useState<ConfirmOutcome | null>(null);

  // Keyed by booking id so host re-renders (new callback identity) don't re-fire the notify.
  const submittedNotifiedIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!createResult?.booking_id) return;
    if (submittedNotifiedIdRef.current === createResult.booking_id) return;
    submittedNotifiedIdRef.current = createResult.booking_id;
    onBookingSubmitted?.();
  }, [createResult, onBookingSubmitted]);

  const [multiServiceSegments, setMultiServiceSegments] = useState<MultiServiceSegment[] | null>(null);
  /**
   * Multi-service picker (Docs/multi-service-picker-plan.md). `pendingServiceIds`
   * are the services ticked on the list, in the order they were ticked. On
   * Continue the first becomes `selectedServiceId`, so every single-service path
   * below keeps working, and the rest become `chainExtras`, whose options are
   * collected one by one before the times. The group flow has its own pair.
   */
  const [pendingServiceIds, setPendingServiceIds] = useState<string[]>(() =>
    preselectedServiceId && !editBooking ? [preselectedServiceId] : [],
  );
  const [chainExtras, setChainExtras] = useState<ChainExtra[]>([]);
  const [groupPendingServiceIds, setGroupPendingServiceIds] = useState<string[]>([]);
  const [groupChainExtras, setGroupChainExtras] = useState<ChainExtra[]>([]);
  /** Add-on buffer for the extra service currently on the add-ons step (the primary keeps `selectedAddonIds`). */
  const [chainAddonIds, setChainAddonIds] = useState<string[]>([]);
  /**
   * Describes what the shared `addons` step is currently configuring:
   * - `primary`: the first/single service (existing flow → practitioner/slot).
   * - `chain`: an extra service chosen on the picker, before the times; `target`
   *   is where the flow resumes once every extra has its options.
   * - `edit`: extras for an existing segment at `segmentIndex`.
   */
  const [addonFlowContext, setAddonFlowContext] = useState<
    | { kind: 'primary' }
    | { kind: 'chain'; index: number; serviceId: string; variantId?: string | null; group: boolean; target: ChainTarget }
    | { kind: 'edit'; segmentIndex: number; serviceId: string }
  >({ kind: 'primary' });

  // Group booking state
  const [groupPeople, setGroupPeople] = useState<PersonSelection[]>([]);
  const [currentPersonLabel, setCurrentPersonLabel] = useState('');
  const [groupServiceId, setGroupServiceId] = useState<string | null>(null);
  /** In-progress attendee's chosen variant (null until picked / not applicable). */
  const [groupVariantId, setGroupVariantId] = useState<string | null>(null);
  /** In-progress attendee's chosen add-on ids. Reset when the service/variant changes. */
  const [groupSelectedAddonIds, setGroupSelectedAddonIds] = useState<string[]>([]);
  const [groupPractitionerId, setGroupPractitionerId] = useState<string | null>(null);
  const [groupCreateResult, setGroupCreateResult] = useState<{
    group_booking_id: string;
    booking_ids: string[];
    client_secret?: string;
    stripe_account_id?: string;
    requires_deposit: boolean;
    total_deposit_pence: number;
    cancellation_notice_hours: number;
    /** Card capture mode from the create response ('setup' = card hold, no payment today). */
    payment_mode?: CardHoldPaymentMode;
    card_hold_fee_pence?: number | null;
    card_hold_consent_text?: string | null;
    /** Unmet requirements flagged at staff booking time (staff are never blocked, plan §5). */
    compliance_warnings?: StaffComplianceWarning[];
  } | null>(null);

  /**
   * Visual calendar state: currently-displayed month + dates-with-availability for the
   * `(practitioner, service)` pair. Cached by key so month-paging / back-and-forward is cheap.
   */
  const [calendarMonth, setCalendarMonth] = useState<{ year: number; month: number }>(() => {
    const base = initialDate ?? todayStr();
    const [y, m] = base.split('-').map(Number);
    return { year: y ?? new Date().getFullYear(), month: m ?? new Date().getMonth() + 1 };
  });
  const [availableDates, setAvailableDates] = useState<Set<string>>(new Set());
  const [loadingCalendar, setLoadingCalendar] = useState(false);
  /** Service id currently being appended (spinner on its "add another service" button). */
  /** Variant id currently being appended (spinner on its option button in the append-variant step). */
  /** Segment index currently being removed (spinner on its Remove button). */
  const [removingSegmentIndex, setRemovingSegmentIndex] = useState<number | null>(null);
  const [calendarCache, setCalendarCache] = useState<Map<string, Set<string>>>(() => new Map());
  /** One-shot bootstrap from guest-history Rebook — applied after catalog load. */
  const staffRebookApplyRef = useRef(false);
  const [staffRebookPriming, setStaffRebookPriming] = useState(false);
  const calendarCacheRef = useRef(calendarCache);
  calendarCacheRef.current = calendarCache;
  const calendarInFlightRef = useRef<Map<string, Promise<Set<string>>>>(new Map());
  const calendarMonthRef = useRef(calendarMonth);
  calendarMonthRef.current = calendarMonth;

  const advanceToGuestDetails = useCallback(async () => {
    if (isPublicGuest && !(await accountGate.ensureSignedIn())) return;
    setStep('details');
  }, [accountGate, isPublicGuest]);
  const advanceToGroupDetails = useCallback(async () => {
    if (isPublicGuest && !(await accountGate.ensureSignedIn())) return;
    setStep('group_details');
  }, [accountGate, isPublicGuest]);

  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!onHeightChange || !containerRef.current) return;
    const ro = new ResizeObserver(() => {
      onHeightChange();
    });
    ro.observe(containerRef.current);
    onHeightChange();
    return () => ro.disconnect();
  }, [onHeightChange]);

  useEffect(() => {
    if (!onHeightChange) return;
    onHeightChange();
  }, [step, onHeightChange]);

  useEffect(() => {
    if (!isPublicGuest) return;
    if (step !== 'details' && step !== 'group_details') return;
    void accountGate.ensureSignedIn();
  }, [accountGate, isPublicGuest, step]);

  useEffect(() => {
    function onReset() {
      setDate(todayStr());
      setSlotPractitioners([]);
      setLoading(false);
      setError(null);
      setSelectedServiceId(null);
      setSelectedVariantId(null);
      setStaffDurationOverrides({});
      setDurationPopoverServiceId(null);
      setDurationPopoverOpenForKey(null);
      setSelectedTime(null);
      setGuestDetails(null);
      setCreateResult(null);
      setMultiServiceSegments(null);
      setPendingServiceIds([]);
      setChainExtras([]);
      setGroupPendingServiceIds([]);
      setGroupChainExtras([]);
      setChainAddonIds([]);
      setGroupPeople([]);
      setCurrentPersonLabel('');
      setGroupServiceId(null);
      setGroupVariantId(null);
      setGroupSelectedAddonIds([]);
      setGroupPractitionerId(null);
      setGroupCreateResult(null);
      setSelectedAddonIds([]);
      setAddonFlowContext({ kind: 'primary' });
      setSubmitting(false);
      // Clear any compliance collected for the previous booking so it can't leak into the next.
      setBookingCompliance(null);
      setPrecheckEmail(isPublicGuest ? accountGate.guestDetailsPrefill?.email?.trim() ?? '' : '');
      if (lockedPractitioner?.id && lockedPractitioner?.bookingSlug) {
        setStep('service');
        setSelectedPractitionerId(lockedPractitioner.id);
      } else if (isStaffFirst) {
        setAnyRouteActive(false);
        setCarriedServiceId(null);
        setStep(venue.is_collective || isStaff ? 'staff_pick' : 'mode_choice');
        setSelectedPractitionerId(null);
      } else {
        setStep(isStaff || venue.is_collective ? 'service' : 'mode_choice');
        setSelectedPractitionerId(null);
      }
    }
    window.addEventListener(APPOINTMENT_BOOKING_RESET_EVENT, onReset);
    return () => window.removeEventListener(APPOINTMENT_BOOKING_RESET_EVENT, onReset);
  }, [lockedPractitioner?.id, lockedPractitioner?.bookingSlug, isStaff, isStaffFirst, venue.is_collective, isPublicGuest, accountGate.guestDetailsPrefill?.email]);

  // Build phantom bookings from already-selected group people
  const phantomBookings = useMemo(() => {
    return groupPeople
      .filter((p) => p.date === date)
      .map((p) => ({
        practitioner_id: p.practitionerId,
        start_time: p.time,
        duration_minutes: p.durationMinutes,
        buffer_minutes: p.bufferMinutes,
      }));
  }, [groupPeople, date]);

  const fetchCatalog = useCallback(async () => {
    setCatalogLoading(true);
    try {
      const res = await fetch(appointmentCatalogUrl(venue.id, lockedPractitioner?.bookingSlug, isStaff));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load catalog');
      setCatalogStaff(data.practitioners ?? []);
    } catch {
      setError('Failed to load services');
      setCatalogStaff([]);
    } finally {
      setCatalogLoading(false);
    }
  }, [venue.id, lockedPractitioner?.bookingSlug, isStaff]);

  useEffect(() => {
    fetchCatalog();
  }, [fetchCatalog]);

  useEffect(() => {
    if (initialDate) setDate(initialDate);
  }, [initialDate]);

  useEffect(() => {
    if (editBooking) return;
    if (!initialTime) return;
    setSelectedTime(initialTime.trim().slice(0, 5));
  }, [initialTime, editBooking]);

  useEffect(() => {
    if (editBooking || !preselectedServiceId || catalogStaff.length === 0) return;
    const hasService = catalogStaff.some((p) => p.services.some((s) => s.id === preselectedServiceId));
    if (hasService) {
      setSelectedServiceId(preselectedServiceId);
    }
  }, [editBooking, preselectedServiceId, catalogStaff]);

  useEffect(() => {
    if (editBooking || !preselectedPractitionerId || catalogStaff.length === 0 || lockedPractitioner) return;
    if (catalogStaff.some((p) => p.id === preselectedPractitionerId)) {
      setSelectedPractitionerId(preselectedPractitionerId);
    }
  }, [editBooking, preselectedPractitionerId, catalogStaff, lockedPractitioner]);

  const fetchAvailability = useCallback(
    async (opts: {
      serviceId: string;
      practitionerId: string;
      variantId?: string | null;
      durationMinutes?: number | null;
      addonIds?: string[];
      /** Every service in the visit, first included, when more than one was ticked. */
      chain?: ServiceChainSegmentParam[];
    }) => {
      lastSlotFetchRef.current = opts;
      setLoading(true);
      try {
        const params = new URLSearchParams({ venue_id: venue.id, date });
        params.set('service_id', opts.serviceId);
        if (isAnyAvailablePractitionerId(opts.practitionerId)) {
          params.set('any_available', '1');
        } else {
          params.set('practitioner_id', opts.practitionerId);
        }
        if (opts.variantId) params.set('variant_id', opts.variantId);
        if (opts.durationMinutes != null) params.set('duration_minutes', String(opts.durationMinutes));
        if (opts.addonIds && opts.addonIds.length > 0) {
          for (const id of opts.addonIds) params.append('addon_ids', id);
        }
        if (opts.chain && opts.chain.length > 1) {
          params.set('services', serialiseServiceChainParam(opts.chain));
        }
        if (phantomBookings.length > 0) {
          params.set('phantoms', JSON.stringify(phantomBookings));
        }
        if (waitlistOfferEntryId) {
          params.set('waitlist_offer', waitlistOfferEntryId);
        }
        const res = await fetch(bookingAvailabilityUrl(params));
        const data = await res.json();
        /**
         * Stage 7 (decision J). A 503 means the server could not read this venue's schedule
         * and refused to guess. Before this, `data.practitioners ?? []` turned that into an
         * empty slot list, which reads as "fully booked" -- the same screen a genuinely full
         * day produces, so a guest would give up on a venue that was open.
         */
        if (res.status === 503 && (data as { unavailable?: boolean })?.unavailable) {
          setSlotsUnavailable(true);
          setSlotPractitioners([]);
          return;
        }
        setSlotsUnavailable(false);
        setSlotPractitioners(data.practitioners ?? []);
      } catch {
        setError('Failed to load availability');
      } finally {
        setLoading(false);
      }
    },
    [venue.id, date, phantomBookings, waitlistOfferEntryId],
  );

  /** Month grid for the date picker (public or staff calendar API). */
  const fetchAppointmentCalendarMonth = useCallback(
    async (opts: {
      practitionerId: string;
      serviceId: string;
      variantId?: string | null;
      durationMinutes?: number | null;
      addonIds?: string[] | null;
      year: number;
      month: number;
      signal?: AbortSignal;
    }): Promise<Set<string>> => {
      lastCalendarFetchRef.current = opts;
      const url = appointmentCalendarUrl(
        bookingAudience,
        venue.id,
        opts.practitionerId,
        opts.serviceId,
        opts.year,
        opts.month,
        opts.variantId ?? null,
        opts.durationMinutes ?? null,
        isAnyAvailablePractitionerId(opts.practitionerId),
        linkedOwnerVenueId ?? null,
        null,
        opts.addonIds ?? null,
      );
      const res = await fetch(url, { signal: opts.signal });
      const data = (await res.json()) as { available_dates?: string[]; error?: string; unavailable?: boolean };
      /**
       * Stage 7 (decision J). A 503 means the server could not read this venue's schedule
       * and refused to guess. The throw below is kept, so nothing caches a wrong month, but
       * the flag is what stops the picker rendering an empty month as though every date
       * were genuinely full. That is the more misleading failure of the two: a guest sees
       * dates greyed out and concludes the venue is busy for weeks.
       *
       * Clearing the flag on ANY successful month load is deliberate: one month answering
       * means the venue is reachable again, whether or not anyone pressed Try again.
       */
      if (res.status === 503 && data.unavailable) {
        setCalendarUnavailable(true);
        throw new Error(data.error ?? 'Availability temporarily unavailable');
      }
      if (!res.ok) throw new Error(data.error ?? 'Failed to load calendar');
      setCalendarUnavailable(false);
      return new Set(data.available_dates ?? []);
    },
    [bookingAudience, venue.id, linkedOwnerVenueId],
  );

  const loadAppointmentCalendarMonth = useCallback(
    (opts: {
      practitionerId: string;
      serviceId: string;
      variantId?: string | null;
      durationMinutes?: number | null;
      addonIds?: string[] | null;
      year: number;
      month: number;
    }): Promise<Set<string>> => {
      const key = appointmentCalendarCacheKey(
        opts.practitionerId,
        opts.serviceId,
        opts.year,
        opts.month,
        opts.variantId ?? null,
        opts.durationMinutes ?? null,
        opts.addonIds ?? null,
      );
      const cached = calendarCacheRef.current.get(key);
      if (cached) return Promise.resolve(cached);

      const inFlight = calendarInFlightRef.current.get(key);
      if (inFlight) return inFlight;

      const promise = fetchAppointmentCalendarMonth(opts)
        .then((nextSet) => {
          setCalendarCache((prev) => {
            if (prev.has(key)) return prev;
            const next = new Map(prev);
            next.set(key, nextSet);
            return next;
          });
          return nextSet;
        })
        .finally(() => {
          calendarInFlightRef.current.delete(key);
        });

      calendarInFlightRef.current.set(key, promise);
      return promise;
    },
    [fetchAppointmentCalendarMonth],
  );

  /** Best-effort month prefetch with a small concurrency cap to avoid hammering the API/DB. */
  const prefetchCalendarTasks = useCallback(
    async (
      tasks: Array<{ practitionerId: string; serviceId: string; durationMinutes?: number | null }>,
      year: number,
      month: number,
      options?: { signal?: AbortSignal; concurrency?: number },
    ) => {
      const concurrency = options?.concurrency ?? 4;
      const signal = options?.signal;
      const pending = tasks.filter((t) => {
        const key = appointmentCalendarCacheKey(t.practitionerId, t.serviceId, year, month, null, t.durationMinutes ?? null);
        return !calendarCacheRef.current.has(key);
      });
      if (pending.length === 0) return;

      const queue = pending.slice();
      async function worker() {
        while (queue.length > 0) {
          if (signal?.aborted) return;
          const t = queue.shift();
          if (!t) return;
          const key = appointmentCalendarCacheKey(t.practitionerId, t.serviceId, year, month, null, t.durationMinutes ?? null);
          if (calendarCacheRef.current.has(key)) continue;
          try {
            const nextSet = await loadAppointmentCalendarMonth({
              practitionerId: t.practitionerId,
              serviceId: t.serviceId,
              durationMinutes: t.durationMinutes ?? null,
              year,
              month,
            });
            if (signal?.aborted) return;
            setCalendarCache((prev) => {
              if (prev.has(key)) return prev;
              const next = new Map(prev);
              next.set(key, nextSet);
              return next;
            });
          } catch (e) {
            if (signal?.aborted || (e instanceof Error && e.name === 'AbortError')) return;
            /* best-effort */
          }
        }
      }
      const nWorkers = Math.min(concurrency, pending.length);
      await Promise.all(Array.from({ length: nWorkers }, () => worker()));
    },
    [loadAppointmentCalendarMonth],
  );

  const primeSelectedAppointmentCalendar = useCallback(
    (
      practitionerId: string,
      serviceId: string,
      durationMinutes?: number | null,
      variantId?: string | null,
    ) => {
      const { year, month } = calendarMonthRef.current;
      void loadAppointmentCalendarMonth({
        practitionerId,
        serviceId,
        durationMinutes,
        variantId: variantId ?? null,
        year,
        month,
      }).catch(() => {
        /* best-effort: the mounted calendar effect will surface an empty state if needed */
      });
    },
    [loadAppointmentCalendarMonth],
  );

  /** Start loading month grids as soon as a service is chosen (before the slot step mounts). */
  const queuePrefetchForServicePractitioners = useCallback(
    (serviceId: string, durationMinutes?: number | null) => {
      const { year, month } = calendarMonthRef.current;
      const tasks: Array<{ practitionerId: string; serviceId: string; durationMinutes?: number | null }> = [];
      for (const p of catalogStaff) {
        if (p.services.some((s) => s.id === serviceId)) {
          tasks.push({ practitionerId: p.id, serviceId, durationMinutes: durationMinutes ?? null });
        }
      }
      if (tasks.length === 0) return;
      void prefetchCalendarTasks(tasks, year, month, { concurrency: 4 });
    },
    [catalogStaff, prefetchCalendarTasks],
  );

  const primeSelectedAppointmentCalendarRef = useRef(primeSelectedAppointmentCalendar);
  primeSelectedAppointmentCalendarRef.current = primeSelectedAppointmentCalendar;
  const queuePrefetchForServicePractitionersRef = useRef(queuePrefetchForServicePractitioners);
  queuePrefetchForServicePractitionersRef.current = queuePrefetchForServicePractitioners;

  useLayoutEffect(() => {
    if (!staffRebookBootstrap?.appointment || editBooking || !isStaff || !staffRebookBootstrap) return;
    if (catalogLoading || catalogStaff.length === 0) return;
    if (staffRebookApplyRef.current) return;

    const appt = staffRebookBootstrap.appointment;
    const practitioner = catalogStaff.find((p) => p.id === appt.practitionerId);
    const offer = practitioner?.services.find((s) => s.id === appt.serviceId);
    if (!practitioner || !offer) {
      staffRebookApplyRef.current = true;
      setError('Could not reopen this appointment in the picker. Choose a service, staff member, and time.');
      return;
    }

    const catalogVariants = offer.variants ?? [];
    let variantId: string | null = appt.variantId ?? null;
    if (catalogVariants.length > 0) {
      if (!variantId || !catalogVariants.some((v) => v.id === variantId)) {
        staffRebookApplyRef.current = true;
        setSelectedServiceId(appt.serviceId);
        setSelectedVariantId(null);
        setSelectedPractitionerId(appt.practitionerId);
        setStep('variant');
        return;
      }
    } else {
      variantId = null;
    }

    const naturalDuration =
      variantId != null
        ? (catalogVariants.find((v) => v.id === variantId)?.duration_minutes ?? offer.duration_minutes)
        : offer.duration_minutes;

    let durationMinutesParam: number | null = null;
    if (appt.durationMinutes != null && appt.durationMinutes !== naturalDuration) {
      durationMinutesParam = appt.durationMinutes;
      setStaffDurationOverrides((prev) => ({
        ...prev,
        [staffDurationOverrideKey(appt.serviceId, variantId)]: appt.durationMinutes!,
      }));
    }

    staffRebookApplyRef.current = true;
    setStaffRebookPriming(true);
    queuePrefetchForServicePractitionersRef.current(appt.serviceId, durationMinutesParam ?? naturalDuration);
    setSelectedServiceId(appt.serviceId);
    setSelectedVariantId(variantId);
    setSelectedPractitionerId(appt.practitionerId);
    primeSelectedAppointmentCalendarRef.current(appt.practitionerId, appt.serviceId, durationMinutesParam, variantId);
    setStep('slot');
    setError(null);
    queueMicrotask(() => setStaffRebookPriming(false));
  }, [staffRebookBootstrap, editBooking, isStaff, catalogLoading, catalogStaff]);

  useEffect(() => {
    if (step !== 'slot' && step !== 'group_slot') return;
    const isGroup = step === 'group_slot';
    const svc = isGroup ? groupServiceId : selectedServiceId;
    const prac = isGroup ? groupPractitionerId : selectedPractitionerId;
    const variantId = isGroup ? groupVariantId : selectedVariantId;
    const durationMinutes =
      !isGroup && svc
        ? staffDurationOverrides[staffDurationOverrideKey(svc, variantId)] ?? null
        : null;
    if (!svc || !prac) return;
    const addonIds = isGroup ? groupSelectedAddonIds : selectedAddonIds;
    const extras = isGroup ? groupChainExtras : chainExtras;
    const chain: ServiceChainSegmentParam[] | undefined =
      extras.length > 0
        ? [
            { service_id: svc, variant_id: variantId, addon_ids: addonIds, duration_minutes: durationMinutes },
            ...extras.map((ex) => ({
              service_id: ex.serviceId,
              variant_id: ex.variantId,
              addon_ids: ex.addonIds,
              duration_minutes: isGroup
                ? null
                : staffDurationOverrides[staffDurationOverrideKey(ex.serviceId, ex.variantId)] ?? null,
            })),
          ]
        : undefined;
    fetchAvailability({
      serviceId: svc,
      practitionerId: prac,
      variantId,
      durationMinutes,
      addonIds,
      chain,
    });
  }, [
    step,
    date,
    selectedServiceId,
    selectedVariantId,
    selectedAddonIds,
    selectedPractitionerId,
    staffDurationOverrides,
    groupServiceId,
    groupVariantId,
    groupSelectedAddonIds,
    groupPractitionerId,
    chainExtras,
    groupChainExtras,
    phantomBookings,
    fetchAvailability,
  ]);

  /**
   * Preload month availability while the user is still picking a practitioner (or a service in the
   * locked-practitioner flow) so the date picker often hits the cache on the next step.
   */
  useEffect(() => {
    const { year, month } = calendarMonth;
    const tasks: Array<{ practitionerId: string; serviceId: string; durationMinutes?: number | null }> = [];

    if (step === 'practitioner' && selectedServiceId) {
      const durationMinutes =
        staffDurationOverrides[staffDurationOverrideKey(selectedServiceId, selectedVariantId)] ?? null;
      for (const p of catalogStaff) {
        if (p.services.some((s) => s.id === selectedServiceId)) {
          tasks.push({ practitionerId: p.id, serviceId: selectedServiceId, durationMinutes });
        }
      }
      if (
        anyAvailablePractitionerEnabled &&
        !isEdit &&
        tasks.length > 1
      ) {
        // Combined pages: the any-available pool is only shown when calendars share the
        // same options; an unused prefetch here is harmless, so we don't gate it.
        tasks.push({
          practitionerId: ANY_AVAILABLE_PRACTITIONER_ID,
          serviceId: selectedServiceId,
          durationMinutes,
        });
      }
    } else if (
      step === 'service' &&
      (isLockedPractitionerFlow
        ? Boolean(lockedPractitioner?.id)
        : // Staff-first knows the person on the service step too, so warm their
          // months while the guest reads. Skipped for the pooled option, whose
          // month grids are the most expensive thing the server computes.
          isStaffFirst &&
          Boolean(selectedPractitionerId) &&
          !isAnyAvailablePractitionerId(selectedPractitionerId))
    ) {
      const chosenId = isLockedPractitionerFlow ? lockedPractitioner?.id : selectedPractitionerId;
      const p = catalogStaff.find((c) => c.id === chosenId);
      if (p) {
        for (const s of p.services) {
          tasks.push({
            practitionerId: p.id,
            serviceId: s.id,
            durationMinutes: staffDurationOverrides[s.id] ?? null,
          });
        }
      }
    } else if (step === 'group_service' && isStaffFirst && groupPractitionerId) {
      // Staff-first group: this guest's person is settled, so warm their months
      // while the booker reads the service list.
      const p = catalogStaff.find((c) => c.id === groupPractitionerId);
      for (const s of p?.services ?? []) {
        tasks.push({ practitionerId: p!.id, serviceId: s.id });
      }
    } else if (step === 'group_practitioner' && groupServiceId) {
      for (const p of catalogStaff) {
        if (p.services.some((s) => s.id === groupServiceId)) {
          tasks.push({ practitionerId: p.id, serviceId: groupServiceId });
        }
      }
    }

    if (tasks.length === 0) return;

    const ac = new AbortController();
    void prefetchCalendarTasks(tasks, year, month, { signal: ac.signal, concurrency: 4 });
    return () => ac.abort();
  }, [
    step,
    selectedServiceId,
    selectedVariantId,
    staffDurationOverrides,
    groupServiceId,
    isLockedPractitionerFlow,
    lockedPractitioner?.id,
    isStaffFirst,
    selectedPractitionerId,
    groupPractitionerId,
    catalogStaff,
    calendarMonth,
    prefetchCalendarTasks,
    anyAvailablePractitionerEnabled,
    isEdit,
  ]);

  /**
   * Drive the visual date picker: whenever the user lands on a slot step with a
   * resolved (practitioner, service), fetch dates-with-availability for the
   * displayed month. Results are memoised in `calendarCache`.
   */
  useEffect(() => {
    if (step !== 'slot' && step !== 'group_slot') return;
    const isGroup = step === 'group_slot';
    const svc = isGroup ? groupServiceId : selectedServiceId;
    const prac = isGroup ? groupPractitionerId : selectedPractitionerId;
    const variantId = isGroup ? groupVariantId : selectedVariantId;
    const durationMinutes =
      !isGroup && svc
        ? staffDurationOverrides[staffDurationOverrideKey(svc, variantId)] ?? null
        : null;
    if (!svc || !prac) return;

    const addonIdsForCal = isGroup ? groupSelectedAddonIds : selectedAddonIds;
    // Several services: the month is asked about the visit's whole span.
    const extrasForCal = isGroup ? groupChainExtras : chainExtras;
    const calDuration =
      extrasForCal.length > 0
        ? chainSpanForSelection(
            catalogStaff,
            { serviceId: svc, variantId, addonIds: addonIdsForCal },
            extrasForCal,
            prac,
            isGroup ? {} : staffDurationOverrides,
          )
        : durationMinutes;
    const key = appointmentCalendarCacheKey(
      prac,
      svc,
      calendarMonth.year,
      calendarMonth.month,
      variantId,
      calDuration,
      addonIdsForCal,
    );
    const cached = calendarCache.get(key);
    if (cached) {
      setAvailableDates(cached);
      setLoadingCalendar(false);
      return;
    }

    let cancelled = false;
    (async () => {
      setLoadingCalendar(true);
      try {
        const nextSet = await loadAppointmentCalendarMonth({
          practitionerId: prac,
          serviceId: svc,
          variantId,
          durationMinutes: calDuration,
          addonIds: addonIdsForCal,
          year: calendarMonth.year,
          month: calendarMonth.month,
        });
        if (cancelled) return;
        setAvailableDates(nextSet);
      } catch {
        if (cancelled) return;
        setAvailableDates(new Set());
      } finally {
        if (!cancelled) setLoadingCalendar(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    step,
    selectedServiceId,
    selectedVariantId,
    selectedAddonIds,
    selectedPractitionerId,
    staffDurationOverrides,
    groupServiceId,
    groupVariantId,
    groupSelectedAddonIds,
    groupPractitionerId,
    chainExtras,
    groupChainExtras,
    catalogStaff,
    calendarMonth.year,
    calendarMonth.month,
    calendarCache,
    loadAppointmentCalendarMonth,
  ]);

  /** Keep the calendar grid on the month of the selected date (e.g. +N week shortcuts). */
  useEffect(() => {
    if (!date) return;
    const [y, m] = date.split('-').map(Number);
    if (!y || !m) return;
    setCalendarMonth((prev) => (prev.year === y && prev.month === m ? prev : { year: y, month: m }));
  }, [date]);

  /** Reset the displayed month whenever the user changes service or practitioner. */
  useEffect(() => {
    const base = date || todayStr();
    const [y, m] = base.split('-').map(Number);
    if (!y || !m) return;
    setCalendarMonth((prev) => (prev.year === y && prev.month === m ? prev : { year: y, month: m }));
  }, [selectedServiceId, selectedVariantId, selectedPractitionerId, groupServiceId, groupPractitionerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const goPrevMonth = useCallback(() => {
    setCalendarMonth((prev) => {
      const m = prev.month - 1;
      if (m < 1) return { year: prev.year - 1, month: 12 };
      return { year: prev.year, month: m };
    });
  }, []);
  const goNextMonth = useCallback(() => {
    setCalendarMonth((prev) => {
      const m = prev.month + 1;
      if (m > 12) return { year: prev.year + 1, month: 1 };
      return { year: prev.year, month: m };
    });
  }, []);

  const allServices = catalogStaff.flatMap((p) => p.services);
  const uniqueServices = Array.from(new Map(allServices.map((s) => [s.id, s])).values());

  const servicesWithFromPrice = useMemo(() => {
    const map = new Map<
      string,
      {
        id: string;
        name: string;
        description: string | null;
        duration_minutes: number;
        minPricePence: number | null;
        sortOrder: number;
        /** Same value as `sortOrder`, under the name the category grouping reads. */
        sort_order: number;
        category: ServiceCategoryRef | null;
        location_type?: import('@/types/booking-models').ServiceLocationType;
      }
    >();
    for (const p of catalogStaff) {
      for (const s of p.services) {
        const price = s.price_pence;
        const existing = map.get(s.id);
        if (!existing) {
          map.set(s.id, {
            id: s.id,
            name: s.name,
            description: s.description?.trim() ? s.description.trim() : null,
            duration_minutes: s.duration_minutes,
            minPricePence: price,
            sortOrder: s.sort_order ?? 0,
            sort_order: s.sort_order ?? 0,
            category: s.category ?? null,
            location_type: s.location_type,
          });
        } else {
          if (!existing.description && s.description?.trim()) {
            existing.description = s.description.trim();
          }
          if (price != null && (existing.minPricePence == null || price < existing.minPricePence)) {
            existing.minPricePence = price;
          }
        }
      }
    }
    // Venue-chosen order first (Dashboard → Services drag order); name breaks ties so
    // venues that never reordered keep the old alphabetical listing.
    return Array.from(map.values()).sort((a, b) =>
      compareByCategoryThenServiceOrder(
        { sort_order: a.sortOrder, name: a.name, category: a.category },
        { sort_order: b.sortOrder, name: b.name, category: b.category },
      ),
    );
  }, [catalogStaff]);

  const onlyListedServiceId = useMemo(() => {
    if (servicesWithFromPrice.length !== 1) return null;
    return servicesWithFromPrice[0]?.id ?? null;
  }, [servicesWithFromPrice]);

  /**
   * Single-service venues: warm the calendar cache while the user reads the service step (one batch
   * of throttled requests, same as practitioner-step prefetch).
   */
  useEffect(() => {
    // Staff-first has already narrowed to one person by this step, so warming
    // every provider here would either duplicate that or, after "Any available",
    // fire the pooled requests the branch above deliberately skips.
    if (step !== 'service' || catalogLoading || isLockedPractitionerFlow || isStaffFirst) return;
    if (!onlyListedServiceId) return;
    const { year, month } = calendarMonth;
    const durationMinutes = staffDurationOverrides[onlyListedServiceId] ?? null;
    const tasks: Array<{ practitionerId: string; serviceId: string; durationMinutes?: number | null }> = [];
    for (const p of catalogStaff) {
      if (p.services.some((s) => s.id === onlyListedServiceId)) {
        tasks.push({ practitionerId: p.id, serviceId: onlyListedServiceId, durationMinutes });
      }
    }
    if (tasks.length === 0) return;
    const ac = new AbortController();
    void prefetchCalendarTasks(tasks, year, month, { signal: ac.signal, concurrency: 4 });
    return () => ac.abort();
  }, [
    step,
    catalogLoading,
    isLockedPractitionerFlow,
    isStaffFirst,
    onlyListedServiceId,
    staffDurationOverrides,
    catalogStaff,
    calendarMonth,
    prefetchCalendarTasks,
  ]);

  /** Only people who offer EVERY service in the visit can take it. */
  const practitionersForSelectedService = useMemo(() => {
    if (!selectedServiceId) return [];
    const wanted = [selectedServiceId, ...chainExtras.map((e) => e.serviceId)];
    return catalogStaff.filter((p) => wanted.every((id) => p.services.some((s) => s.id === id)));
  }, [catalogStaff, selectedServiceId, chainExtras]);

  /** Everyone the staff-first picker offers; empty calendars are already excluded upstream. */
  const bookableStaff = useMemo(
    () => catalogStaff.filter((p) => p.services.length > 0),
    [catalogStaff],
  );
  const teamProfiles = venue.booking_page_config?.team_profiles ?? {};

  /**
   * The service list once a person is chosen: their own services at their own
   * prices, rather than the venue-wide list with a "from" price folded across
   * everyone. Picking "Any available" keeps the venue-wide list, which is what
   * the pooled option means and what service-first already shows for it.
   */
  const staffFirstServices = useMemo(() => {
    if (!isStaffFirst || !selectedPractitionerId) return null;
    if (isAnyAvailablePractitionerId(selectedPractitionerId)) return null;
    const prac = catalogStaff.find((p) => p.id === selectedPractitionerId);
    if (!prac) return null;
    return prac.services
      .map((s) => {
        const variantPrices = (s.variants ?? [])
          .map((v) => v.price_pence)
          .filter((p): p is number => p != null);
        return {
          id: s.id,
          name: s.name,
          description: s.description?.trim() ? s.description.trim() : null,
          duration_minutes: s.duration_minutes,
          // A service with options is priced "from" its cheapest option, as the
          // venue-wide list does; otherwise it is simply this person's price.
          minPricePence: variantPrices.length > 0 ? Math.min(...variantPrices) : s.price_pence,
          sortOrder: s.sort_order ?? 0,
          sort_order: s.sort_order ?? 0,
          category: s.category ?? null,
          location_type: s.location_type,
        };
      })
      .sort((a, b) =>
        compareByCategoryThenServiceOrder(
          { sort_order: a.sortOrder, name: a.name, category: a.category },
          { sort_order: b.sortOrder, name: b.name, category: b.category },
        ),
      );
  }, [isStaffFirst, selectedPractitionerId, catalogStaff]);

  /** The group service step's list once staff-first has a person for this guest. */
  const groupStaffFirstServices = useMemo(() => {
    if (!isStaffFirst || !groupPractitionerId) return null;
    const prac = catalogStaff.find((p) => p.id === groupPractitionerId);
    if (!prac) return null;
    return prac.services
      .map((s) => {
        const variantPrices = (s.variants ?? [])
          .map((v) => v.price_pence)
          .filter((p): p is number => p != null);
        return {
          id: s.id,
          name: s.name,
          description: s.description?.trim() ? s.description.trim() : null,
          duration_minutes: s.duration_minutes,
          minPricePence: variantPrices.length > 0 ? Math.min(...variantPrices) : s.price_pence,
          sortOrder: s.sort_order ?? 0,
          sort_order: s.sort_order ?? 0,
          category: s.category ?? null,
          location_type: s.location_type,
        };
      })
      .sort((a, b) =>
        compareByCategoryThenServiceOrder(
          { sort_order: a.sortOrder, name: a.name, category: a.category },
          { sort_order: b.sortOrder, name: b.name, category: b.category },
        ),
      );
  }, [isStaffFirst, groupPractitionerId, catalogStaff]);

  /** What the service step lists, with a carried service (4.12) pinned to the top. */
  const serviceListForStep = useMemo(() => {
    const base = staffFirstServices ?? servicesWithFromPrice;
    if (!carriedServiceId) return base;
    const carried = base.find((s) => s.id === carriedServiceId);
    return carried ? [carried, ...base.filter((s) => s.id !== carriedServiceId)] : base;
  }, [staffFirstServices, servicesWithFromPrice, carriedServiceId]);

  /** What the picker bar summarises: the ticked services that are still listed, in tick order. */
  const pendingPickerLines = useMemo<PickerServiceLine[]>(
    () =>
      pendingServiceIds
        .map((id) => serviceListForStep.find((svc) => svc.id === id))
        .filter((svc): svc is NonNullable<typeof svc> => Boolean(svc))
        .map((svc) => ({
          id: svc.id,
          name: svc.name,
          durationMinutes: staffDurationOverrides[svc.id] ?? svc.duration_minutes,
          minPricePence: svc.minPricePence,
        })),
    [pendingServiceIds, serviceListForStep, staffDurationOverrides],
  );
  const groupPickerList = groupStaffFirstServices ?? servicesWithFromPrice;
  const groupPendingPickerLines = useMemo<PickerServiceLine[]>(
    () =>
      groupPendingServiceIds
        .map((id) => groupPickerList.find((svc) => svc.id === id))
        .filter((svc): svc is NonNullable<typeof svc> => Boolean(svc))
        .map((svc) => ({ id: svc.id, name: svc.name, durationMinutes: svc.duration_minutes, minPricePence: svc.minPricePence })),
    [groupPendingServiceIds, groupPickerList],
  );

  /** The person the guest just switched to does not do the service they were booking. */
  const carriedServiceUnavailable =
    carriedServiceId != null && !serviceListForStep.some((s) => s.id === carriedServiceId);

  const practitionersForGroupService = useMemo(() => {
    if (!groupServiceId) return [];
    const wanted = [groupServiceId, ...groupChainExtras.map((e) => e.serviceId)];
    return catalogStaff.filter((p) => wanted.every((id) => p.services.some((s) => s.id === id)));
  }, [catalogStaff, groupServiceId, groupChainExtras]);

  const sym = currencySymbolFromCode(venue.currency);
  /** Sections with a category menu, or collapsible categories (Settings, Booking Page). */
  const servicesLayout = resolveServicesLayout(venue.booking_page_config);

  function onlineChargeFromCatalogOffer(offer: {
    price_pence: number | null;
    deposit_pence?: number | null;
    payment_requirement?: ClassPaymentRequirement;
  }) {
    return resolveAppointmentServiceOnlineCharge({
      price_pence: offer.price_pence,
      deposit_pence: offer.deposit_pence ?? null,
      payment_requirement: offer.payment_requirement,
    });
  }

  function formatPrice(pence: number | null): string {
    return formatBookablePricePence(pence, sym);
  }

  function formatFromPrice(pence: number | null): string {
    return formatFromBookablePricePence(pence, sym);
  }

  const phoneDefaultCountry = defaultPhoneCountryForVenueCurrency(venue.currency);

  // Single flow helpers (names/prices from catalog; slots from availability API)
  const selectedPrac = isAnyAvailablePractitionerId(selectedPractitionerId)
    ? {
        id: ANY_AVAILABLE_PRACTITIONER_ID,
        name: `Any available ${terms.staff.toLowerCase()}`,
        services: selectedServiceId
          ? catalogStaff
              .flatMap((p) => p.services.filter((s) => s.id === selectedServiceId))
              .slice(0, 1)
          : [],
      }
    : catalogStaff.find((p) => p.id === selectedPractitionerId);
  const slotPrac = slotPractitioners.find(
    (p) => p.id === selectedPractitionerId || (isAnyAvailablePractitionerId(selectedPractitionerId) && p.id === ANY_AVAILABLE_PRACTITIONER_ID),
  );
  const pooledSlotsRaw =
    slotPrac?.slots.filter((s) => !selectedServiceId || s.service_id === selectedServiceId) ?? [];
  const availableSlots = dedupeSlotsByStartTime(pooledSlotsRaw);
  const selectedService = uniqueServices.find((s) => s.id === selectedServiceId);
  const selectedServiceForPractitioner =
    selectedPrac?.services.find((s) => s.id === selectedServiceId) ?? selectedService;
  /**
   * Combined booking page (venue collective): variants/add-ons live on the CHOSEN
   * calendar's own source service, so the flow resolves the calendar before them and
   * these lookups are practitioner-scoped (empty until a calendar is picked).
   */
  const isCombined = Boolean(venue.is_collective);

  /**
   * Whose catalogue the extra services' options come from: the chosen person
   * when there is one (combined, staff-first and per-practitioner pages), else
   * the venue-wide first match, exactly as the primary service's steps do.
   */
  const scopedPractitionerForOptions = useCallback(
    (group: boolean): string | null => {
      const pid = group ? groupPractitionerId : selectedPractitionerId;
      return pid && !isAnyAvailablePractitionerId(pid) ? pid : null;
    },
    [groupPractitionerId, selectedPractitionerId],
  );

  const chainExtraHasOptions = useCallback(
    (serviceId: string, group: boolean): { hasVariants: boolean; hasAddons: boolean } => {
      const scoped = scopedPractitionerForOptions(group);
      return {
        hasVariants: catalogVariantsForServiceFromStaff(catalogStaff, serviceId, scoped).length > 0,
        hasAddons: addonGroupsForServiceFromStaff(catalogStaff, serviceId, scoped).length > 0,
      };
    },
    [catalogStaff, scopedPractitionerForOptions],
  );

  /** Open the option step(s) for one extra service; variants first, then add-ons. */
  const openChainExtraOptions = useCallback(
    (index: number, target: ChainTarget, group: boolean, extrasOverride?: ChainExtra[]) => {
      const extras = extrasOverride ?? (group ? groupChainExtras : chainExtras);
      const ex = extras[index];
      if (!ex) return false;
      const { hasVariants, hasAddons } = chainExtraHasOptions(ex.serviceId, group);
      if (!hasVariants && !hasAddons) return false;
      setAddonFlowContext({ kind: 'chain', index, serviceId: ex.serviceId, variantId: ex.variantId, group, target });
      setChainAddonIds(ex.addonIds);
      setError(null);
      setStep(hasVariants ? 'append_variant' : 'addons');
      return true;
    },
    [chainExtraHasOptions, chainExtras, groupChainExtras],
  );

  /**
   * Before the flow reaches `target`, ask for any extra service's options that
   * have not been collected yet. Returns true when it navigated to one (the
   * caller stops), false when there is nothing left to ask (the caller carries
   * on to `target` itself).
   */
  const drainChainOptions = useCallback(
    (target: ChainTarget, opts: { extras?: ChainExtra[]; fromIndex?: number; group?: boolean } = {}): boolean => {
      const group = opts.group ?? false;
      const extras = opts.extras ?? (group ? groupChainExtras : chainExtras);
      for (let i = opts.fromIndex ?? 0; i < extras.length; i += 1) {
        if (extras[i]!.optionsDone) continue;
        if (openChainExtraOptions(i, target, group, extras)) return true;
      }
      return false;
    },
    [chainExtras, groupChainExtras, openChainExtraOptions],
  );

  /** The last extra service that has options, for Back links that land on it; -1 when none. */
  const lastChainExtraWithOptions = useCallback(
    (group: boolean): number => {
      const extras = group ? groupChainExtras : chainExtras;
      for (let i = extras.length - 1; i >= 0; i -= 1) {
        const { hasVariants, hasAddons } = chainExtraHasOptions(extras[i]!.serviceId, group);
        if (hasVariants || hasAddons) return i;
      }
      return -1;
    },
    [chainExtraHasOptions, chainExtras, groupChainExtras],
  );

  /** Month-priming length: the visit's span once extras are chosen, else the single-service value. */
  const primeDurationWithChain = useCallback(
    (
      serviceId: string,
      variantId: string | null,
      addonIds: string[],
      practitionerId: string | null,
      fallback: number | null,
      extrasOverride?: ChainExtra[],
    ): number | null => {
      const extras = extrasOverride ?? chainExtras;
      if (extras.length === 0) return fallback;
      return chainSpanForSelection(catalogStaff, { serviceId, variantId, addonIds }, extras, practitionerId, staffDurationOverrides);
    },
    [catalogStaff, chainExtras, staffDurationOverrides],
  );

  /**
   * Choose a service and move to whatever comes next.
   *
   * Lifted out of the service row so the row and the rebook auto-advance
   * (P3-1) run the SAME path. What must not be duplicated is precisely the
   * part that is easy to get wrong: `afterService` routes a service with
   * variants to the variant step and one with addon groups to the addons
   * step. A shortcut that jumped a rebook link straight to the times would
   * produce bookings with no variant chosen, at the wrong duration and the
   * wrong price.
   */
  const chooseServiceAndAdvance = useCallback(
    (serviceId: string, extras: ChainExtra[] = []) => {
      const serviceHasVariants =
        (isStaffFirst
          ? catalogVariantsForServiceFromStaff(catalogStaff, serviceId, selectedPractitionerId)
          : catalogVariantsForServiceId(catalogStaff, serviceId)
        ).length > 0;
      const staffDurationOverrideForService = staffDurationOverrides[serviceId] ?? null;

      setDurationPopoverOpenForKey(null);
      setDurationPopoverServiceId(null);
      queuePrefetchForServicePractitioners(serviceId, staffDurationOverrideForService);
      setSelectedServiceId(serviceId);
      setSelectedVariantId(null);
      setSelectedAddonIds([]);
      setCarriedServiceId(null);
      // Pooled on a combined page: an offering that differs by
      // calendar cannot be booked without naming one, so this is
      // where the guest is handed back to the calendar list.
      if (
        isCombined &&
        isAnyAvailablePractitionerId(selectedPractitionerId) &&
        !offeringIsUniform(catalogStaff, serviceId)
      ) {
        setAnyRouteActive(true);
        setSelectedPractitionerId(null);
        setStep('practitioner');
        return;
      }
      const hasAddonGroups = isStaffFirst
        ? addonGroupsForServiceFromStaff(catalogStaff, serviceId, selectedPractitionerId).length > 0
        : catalogAddonGroupsForServiceId(catalogStaff, serviceId).length > 0;
      // Editing keeps the booking's own person, so it can skip ahead to the
      // times once there is nothing left to choose. This sits after the
      // options checks, exactly as it always has.
      if (isEdit && !serviceHasVariants && !hasAddonGroups) {
        const existingOrFirst =
          catalogStaff.find((p) => p.id === selectedPractitionerId && p.services.some((s) => s.id === serviceId)) ??
          catalogStaff.find((p) => p.services.some((s) => s.id === serviceId));
        setSelectedPractitionerId(existingOrFirst?.id ?? null);
        if (existingOrFirst?.id) {
          primeSelectedAppointmentCalendar(existingOrFirst.id, serviceId, staffDurationOverrideForService);
          setStep('slot');
        } else {
          setStep('practitioner');
        }
        return;
      }
      const next = afterService(flowShape, {
        hasVariants: serviceHasVariants,
        hasAddons: hasAddonGroups,
      });
      // The extra services' options are asked for before the person or the times.
      if ((next === 'slot' || next === 'practitioner') && drainChainOptions(next, { extras })) return;
      if (next === 'slot' && selectedPractitionerId) {
        primeSelectedAppointmentCalendar(
          selectedPractitionerId,
          serviceId,
          primeDurationWithChain(serviceId, null, [], selectedPractitionerId, staffDurationOverrideForService, extras),
        );
      }
      setStep(next);
    },
    [
      catalogStaff,
      drainChainOptions,
      flowShape,
      isCombined,
      isEdit,
      isStaffFirst,
      primeDurationWithChain,
      primeSelectedAppointmentCalendar,
      queuePrefetchForServicePractitioners,
      selectedPractitionerId,
      staffDurationOverrides,
    ],
  );

  /** Tick or untick a service on the picker; the cap is the visit cap. */
  const togglePendingService = useCallback((serviceId: string) => {
    setPendingServiceIds((prev) =>
      prev.includes(serviceId)
        ? prev.filter((id) => id !== serviceId)
        : prev.length >= MAX_SERVICES_PER_VISIT
          ? prev
          : [...prev, serviceId],
    );
  }, []);

  /** Continue from the picker: the first tick leads, the rest follow as extras. */
  const continueFromServicePicker = useCallback(() => {
    const listed = new Set(serviceListForStep.map((svc) => svc.id));
    const ids = pendingServiceIds.filter((id) => listed.has(id));
    const first = ids[0];
    if (!first) return;
    const extras: ChainExtra[] = ids.slice(1).map((id) => ({ serviceId: id, variantId: null, addonIds: [], optionsDone: false }));
    setChainExtras(extras);
    setChainAddonIds([]);
    chooseServiceAndAdvance(first, extras);
  }, [chooseServiceAndAdvance, pendingServiceIds, serviceListForStep]);

  const toggleGroupPendingService = useCallback((serviceId: string) => {
    setGroupPendingServiceIds((prev) =>
      prev.includes(serviceId)
        ? prev.filter((id) => id !== serviceId)
        : prev.length >= MAX_SERVICES_PER_VISIT
          ? prev
          : [...prev, serviceId],
    );
  }, []);

  /** The group picker's Continue: this guest's first tick leads, the rest follow. */
  const continueFromGroupPicker = useCallback(() => {
    const listed = new Set((groupStaffFirstServices ?? servicesWithFromPrice).map((svc) => svc.id));
    const ids = groupPendingServiceIds.filter((id) => listed.has(id));
    const first = ids[0];
    if (!first) return;
    const extras: ChainExtra[] = ids.slice(1).map((id) => ({ serviceId: id, variantId: null, addonIds: [], optionsDone: false }));
    setGroupChainExtras(extras);
    setChainAddonIds([]);
    const hasVariants = (isStaffFirst
      ? catalogVariantsForServiceFromStaff(catalogStaff, first, groupPractitionerId)
      : catalogVariantsForServiceId(catalogStaff, first)
    ).length > 0;
    const hasAddons = (isStaffFirst
      ? addonGroupsForServiceFromStaff(catalogStaff, first, groupPractitionerId)
      : catalogAddonGroupsForServiceId(catalogStaff, first)
    ).length > 0;
    setGroupServiceId(first);
    setGroupVariantId(null);
    setGroupSelectedAddonIds([]);
    const next = afterService(flowShape, { hasVariants, hasAddons });
    if ((next === 'slot' || next === 'practitioner') && drainChainOptions(next, { extras, group: true })) return;
    if (next === 'slot' && groupPractitionerId) {
      primeSelectedAppointmentCalendar(
        groupPractitionerId,
        first,
        extras.length > 0
          ? chainSpanForSelection(catalogStaff, { serviceId: first, variantId: null, addonIds: [] }, extras, groupPractitionerId, {})
          : null,
      );
    } else if (next === 'practitioner') {
      queuePrefetchForServicePractitioners(first);
    }
    setStep(groupStep(next));
  }, [
    catalogStaff,
    drainChainOptions,
    flowShape,
    groupPendingServiceIds,
    groupPractitionerId,
    groupStaffFirstServices,
    isStaffFirst,
    primeSelectedAppointmentCalendar,
    queuePrefetchForServicePractitioners,
    servicesWithFromPrice,
  ]);

  /**
   * `?start=time`: pass THROUGH the service step for a rebook link (P3-1).
   *
   * Runs once, and only once the catalogue has arrived, because until then
   * there is no way to tell a service that still exists from one the venue
   * retired. A link naming a service that no longer resolves simply stays on
   * the service step, which is the same way a stale `service_id` already
   * degrades: the link's shape settles the order, not whether it resolves.
   *
   * **It advances by running the ordinary selection**, not by jumping to the
   * times. `chooseServiceAndAdvance` consults `afterService`, so a service
   * with variants stops at the variant step and one with addon groups stops
   * at addons. Those are REQUIRED choices; skipping them would produce a
   * booking at the wrong duration and the wrong price.
   */
  const rebookAdvanceDone = useRef(false);
  useEffect(() => {
    if (rebookAdvanceDone.current) return;
    if (initialStep !== 'time' || editBooking || !preselectedServiceId) return;
    // The `step` half is DEFENSIVE and no test pins it: a named service already
    // suppresses the staff-first picker, so the two conditions coincide today.
    // Kept because it states the intent precisely, and it can only narrow.
    if (catalogStaff.length === 0 || step !== 'service') return;
    const resolves = catalogStaff.some((p) => p.services.some((s) => s.id === preselectedServiceId));
    if (!resolves) {
      // Nothing more to try: the catalogue is loaded and the service is gone.
      rebookAdvanceDone.current = true;
      return;
    }
    rebookAdvanceDone.current = true;
    chooseServiceAndAdvance(preselectedServiceId);
  }, [
    catalogStaff,
    chooseServiceAndAdvance,
    editBooking,
    initialStep,
    preselectedServiceId,
    step,
  ]);

  /** Variants the customer can pick from for the currently selected service (active only). */
  const variantsForSelectedService = useMemo<CatalogVariant[]>(() => {
    if (!selectedServiceId) return [];
    if (isCombined) {
      if (!selectedPractitionerId) return [];
      const prac = catalogStaff.find((p) => p.id === selectedPractitionerId);
      return prac?.services.find((s) => s.id === selectedServiceId)?.variants ?? [];
    }
    return catalogVariantsForServiceId(catalogStaff, selectedServiceId);
  }, [catalogStaff, selectedServiceId, isCombined, selectedPractitionerId]);
  const serviceHasVariants = variantsForSelectedService.length > 0;
  /** Add-on groups for the selected service — practitioner-scoped on a combined page. */
  const addonGroupsForSelectedService = useMemo<import('@/types/booking-models').AppointmentCatalogAddonGroup[]>(() => {
    if (!selectedServiceId) return [];
    if (isCombined) {
      if (!selectedPractitionerId) return [];
      const prac = catalogStaff.find((p) => p.id === selectedPractitionerId);
      return prac?.services.find((s) => s.id === selectedServiceId)?.addon_groups ?? [];
    }
    return catalogAddonGroupsForServiceId(catalogStaff, selectedServiceId);
  }, [catalogStaff, selectedServiceId, isCombined, selectedPractitionerId]);
  const serviceHasAddons = addonGroupsForSelectedService.length > 0;
  /**
   * The add-ons chosen for the primary service, priced from the same groups the
   * add-on step offered (practitioner-scoped on a combined page, like the groups
   * above). Every price shown after the add-on step has to include this: the
   * practitioner cards, the banner over them and the single-booking summary were
   * all quoting the service alone, so a guest who had just added a paid
   * treatment was told the visit cost less than it did.
   */
  const selectedAddonSummary = useMemo<ReturnType<typeof addonSelectionDetails>>(
    () =>
      selectedServiceId
        ? addonSelectionDetails(
            catalogStaff,
            selectedServiceId,
            selectedAddonIds,
            isCombined ? selectedPractitionerId : undefined,
          )
        : { filteredIds: [], totalPence: 0, totalMinutes: 0, lines: [] },
    [catalogStaff, selectedServiceId, selectedAddonIds, isCombined, selectedPractitionerId],
  );
  const groupSelectedAddonSummary = useMemo<ReturnType<typeof addonSelectionDetails>>(
    () =>
      groupServiceId
        ? addonSelectionDetails(catalogStaff, groupServiceId, groupSelectedAddonIds)
        : { filteredIds: [], totalPence: 0, totalMinutes: 0, lines: [] },
    [catalogStaff, groupServiceId, groupSelectedAddonIds],
  );
  /**
   * A service price with the chosen add-ons on top. An unset service price still
   * reads as unset (which formats as Free) unless paid add-ons were chosen, in
   * which case the add-ons are the price.
   */
  const priceWithAddons = (pence: number | null | undefined, addonPence: number): number | null =>
    addonPence > 0 ? (pence ?? 0) + addonPence : pence ?? null;
  const priceWithSelectedAddons = (pence: number | null | undefined) =>
    priceWithAddons(pence, selectedAddonSummary.totalPence);
  const addonCountSuffix = (count: number) =>
    count > 0 ? ` incl. ${count} add-on${count === 1 ? '' : 's'}` : '';
  /**
   * Combined page: "any available" is only safe when an offering's calendars share the
   * same options (the merged catalog marks this per offering). Otherwise the customer
   * must pick a specific calendar to reach its variants/add-ons.
   */
  const selectedOfferingAnyAvailable = useMemo(() => {
    if (!isCombined || !selectedServiceId) return true;
    const ids = [selectedServiceId, ...chainExtras.map((e) => e.serviceId)];
    return ids.every((id) => {
      for (const p of catalogStaff) {
        const s = p.services.find((x) => x.id === id);
        if (s) return s.any_available !== false;
      }
      return true;
    });
  }, [isCombined, selectedServiceId, chainExtras, catalogStaff]);
  const selectedVariant = useMemo<CatalogVariant | null>(() => {
    if (!selectedVariantId) return null;
    return variantsForSelectedService.find((v) => v.id === selectedVariantId) ?? null;
  }, [variantsForSelectedService, selectedVariantId]);
  const staffCustomDurationMinutes =
    isStaff && selectedServiceId
      ? staffDurationOverrides[staffDurationOverrideKey(selectedServiceId, selectedVariantId)] ?? null
      : null;
  const serviceSelectionDurationMinutes = selectedServiceId
    ? staffDurationOverrides[staffDurationOverrideKey(selectedServiceId, selectedVariantId)] ??
      selectedVariant?.duration_minutes ??
      selectedService?.duration_minutes ??
      null
    : null;
  /**
   * Practitioner offer with variant overrides applied. Used everywhere price / duration / deposit
   * needs to reflect the chosen sub-option (summary copy, online charge, end-time previews).
   */
  const effectiveOfferForBooking = useMemo(() => {
    const merged = catalogOfferWithVariant(selectedServiceForPractitioner, selectedVariantId);
    if (!merged) return null;
    const offer =
      selectedVariant != null
        ? { ...merged, name: `${selectedServiceForPractitioner!.name} - ${selectedVariant.name}` }
        : merged;
    if (staffCustomDurationMinutes == null) return offer;
    return { ...offer, duration_minutes: staffCustomDurationMinutes };
  }, [selectedServiceForPractitioner, selectedVariantId, selectedVariant, staffCustomDurationMinutes]);
  const groupedSlots = groupSlotsByPeriod(availableSlots);
  /** The times step's banner: one service, or the whole visit when several were ticked. */
  const slotHeaderServiceLabel = useMemo(() => {
    const primaryLabel = `${selectedService?.name ?? ''}${selectedVariant ? ` - ${selectedVariant.name}` : ''}`;
    if (chainExtras.length === 0) return primaryLabel;
    const extraNames = chainExtras.map((ex) => uniqueServices.find((svc) => svc.id === ex.serviceId)?.name ?? '');
    return [primaryLabel, ...extraNames].filter(Boolean).join(' + ');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- uniqueServices is derived per render from catalogStaff
  }, [selectedService?.name, selectedVariant, chainExtras, catalogStaff]);
  const slotHeaderDurationMinutes =
    chainExtras.length > 0 && selectedServiceId
      ? chainSpanForSelection(
          catalogStaff,
          { serviceId: selectedServiceId, variantId: selectedVariantId, addonIds: selectedAddonIds },
          chainExtras,
          selectedPractitionerId,
          staffDurationOverrides,
        )
      : effectiveOfferForBooking?.duration_minutes ?? 0;

  const primaryBookingSegment = multiServiceSegments?.[0] ?? null;

  const assignedPractitionerId = useMemo(() => {
    const fromSegment = primaryBookingSegment?.practitionerId;
    if (fromSegment && !isAnyAvailablePractitionerId(fromSegment)) return fromSegment;
    if (!isAnyAvailablePractitionerId(selectedPractitionerId)) return selectedPractitionerId;
    return fromSegment ?? null;
  }, [primaryBookingSegment, selectedPractitionerId]);

  const assignedPractitioner = useMemo(
    () => (assignedPractitionerId ? catalogStaff.find((p) => p.id === assignedPractitionerId) ?? null : null),
    [assignedPractitionerId, catalogStaff],
  );

  /** Staff member for this visit after a time is chosen (especially “any available”). */
  const assignedStaffDisplayName = useMemo(() => {
    if (primaryBookingSegment?.practitionerName?.trim()) {
      return primaryBookingSegment.practitionerName.trim();
    }
    if (assignedPractitioner?.name) return assignedPractitioner.name;
    if (isAnyAvailablePractitionerId(selectedPractitionerId)) {
      return '';
    }
    return selectedPrac?.name ?? '';
  }, [primaryBookingSegment, assignedPractitioner, selectedPractitionerId, selectedPrac?.name]);

  /** Same practitioner for add-on services (not the “any available” placeholder). */
  const visitPractitioner = useMemo(() => {
    if (assignedPractitioner) return assignedPractitioner;
    if (isAnyAvailablePractitionerId(selectedPractitionerId)) {
      const seg = primaryBookingSegment;
      if (!seg?.practitionerId) return null;
      const fromCatalog = catalogStaff.find((p) => p.id === seg.practitionerId);
      if (fromCatalog) return fromCatalog;
      return {
        id: seg.practitionerId,
        name: seg.practitionerName,
        services: catalogStaff.flatMap((p) => p.services.filter((s) => s.id === seg.serviceId)).slice(0, 1),
      };
    }
    return selectedPrac ?? null;
  }, [assignedPractitioner, isAnyAvailablePractitionerId, selectedPractitionerId, primaryBookingSegment, catalogStaff, selectedPrac]);

  const buildSegmentFromSlotPick = useCallback(
    (time: string): MultiServiceSegment | null => {
      if (!selectedServiceId) return null;
      const offer = effectiveOfferForBooking ?? selectedPrac?.services.find((s) => s.id === selectedServiceId);
      if (!offer) return null;
      const firstOnline = onlineChargeFromCatalogOffer(offer);
      const candidatesAtTime = pooledSlotsRaw.filter(
        (s) => slotStartKey(s.start_time) === slotStartKey(time),
      );
      const picked =
        isAnyAvailablePractitionerId(selectedPractitionerId) && candidatesAtTime.length > 0
          ? pickPractitionerSlotForPooledTime(
              candidatesAtTime as PractitionerSlot[],
              anyAvailableAssignmentConfig,
              [],
            ) ??
            candidatesAtTime[0]
          : availableSlots.find((s) => slotStartKey(s.start_time) === slotStartKey(time));
      let practitionerId = selectedPractitionerId!;
      let practitionerName = selectedPrac?.name ?? '';
      if (isAnyAvailablePractitionerId(selectedPractitionerId) && picked?.practitioner_id) {
        practitionerId = picked.practitioner_id;
        practitionerName =
          picked.practitioner_name?.trim() ||
          catalogStaff.find((p) => p.id === picked.practitioner_id)?.name ||
          'Staff member';
      }
      // Fold the current add-on selection into this segment so the chain math,
      // review card, and server consecutive-slot check all agree. Practitioner-scoped
      // (= first-match for single venues; the chosen calendar's groups on a combined page).
      const segmentAddonGroups = addonGroupsForSelectedService;
      const segmentAddonIdSet = new Set(selectedAddonIds);
      let addonTotalPence = 0;
      let addonTotalMinutes = 0;
      for (const grp of segmentAddonGroups) {
        for (const a of grp.addons) {
          if (segmentAddonIdSet.has(a.id)) {
            addonTotalPence += a.additional_price_pence;
            addonTotalMinutes += a.additional_duration_minutes;
          }
        }
      }
      const segmentAddonIds = selectedAddonIds.filter((id) =>
        segmentAddonGroups.some((g) => g.addons.some((a) => a.id === id)),
      );
      // Full payment rolls add-on price into the online charge; deposits do not.
      const depositWithAddons =
        (firstOnline?.amountPence ?? 0) +
        (firstOnline?.chargeLabel === 'full_payment' ? addonTotalPence : 0);
      return {
        serviceId: selectedServiceId,
        serviceVariantId: selectedVariantId,
        serviceName: offer.name,
        practitionerId,
        practitionerName,
        startTime: time,
        durationMinutes: (offer.duration_minutes ?? 30) + addonTotalMinutes,
        bufferMinutes: offer.buffer_minutes ?? 0,
        pricePence: offer.price_pence ?? null,
        depositPence: depositWithAddons,
        onlineChargeLabel: firstOnline?.chargeLabel,
        addonIds: segmentAddonIds,
        addonTotalPence,
        addonTotalMinutes,
        customDurationMinutes: staffCustomDurationMinutes,
      };
    },
    [
      selectedServiceId,
      selectedVariantId,
      selectedPractitionerId,
      selectedAddonIds,
      effectiveOfferForBooking,
      staffCustomDurationMinutes,
      selectedPrac,
      availableSlots,
      pooledSlotsRaw,
      anyAvailableAssignmentConfig,
      catalogStaff,
      addonGroupsForSelectedService,
    ],
  );

  // Group flow helpers
  const groupSelectedPrac = catalogStaff.find((p) => p.id === groupPractitionerId);
  /**
   * This guest's options and extras, scoped to their person once staff-first has
   * chosen one. Drives how far back the times step unwinds.
   */
  const groupSelectedVariants = groupServiceId
    ? isStaffFirst
      ? catalogVariantsForServiceFromStaff(catalogStaff, groupServiceId, groupPractitionerId)
      : catalogVariantsForServiceId(catalogStaff, groupServiceId)
    : [];
  const groupSelectedAddonGroups = groupServiceId
    ? isStaffFirst
      ? addonGroupsForServiceFromStaff(catalogStaff, groupServiceId, groupPractitionerId)
      : catalogAddonGroupsForServiceId(catalogStaff, groupServiceId)
    : [];
  const groupSlotPrac = slotPractitioners.find((p) => p.id === groupPractitionerId);
  const groupAvailableSlots = dedupeSlotsByStartTime(
    groupSlotPrac?.slots.filter((s) => !groupServiceId || s.service_id === groupServiceId) ?? [],
  );
  const groupSelectedService = uniqueServices.find((s) => s.id === groupServiceId);
  const groupSlotServicesLabel = [
    groupSelectedService?.name ?? '',
    ...groupChainExtras.map((ex) => uniqueServices.find((svc) => svc.id === ex.serviceId)?.name ?? ''),
  ]
    .filter(Boolean)
    .join(' + ');
  const groupGroupedSlots = groupSlotsByPeriod(groupAvailableSlots);

  const refundNoticeHours = useMemo(() => {
    const fallback = venue.booking_rules?.cancellation_notice_hours ?? 48;
    if (multiServiceSegments && multiServiceSegments.length > 0) {
      const hoursList = multiServiceSegments
        .map((seg) => {
          const p = catalogStaff.find((c) => c.id === seg.practitionerId);
          const offer = p?.services.find((s) => s.id === seg.serviceId);
          return offer?.cancellation_notice_hours;
        })
        .filter((h): h is number => typeof h === 'number' && Number.isFinite(h));
      if (hoursList.length > 0) return Math.min(...hoursList);
      return fallback;
    }
    const offer = selectedPrac?.services.find((s) => s.id === selectedServiceId);
    if (offer && typeof offer.cancellation_notice_hours === 'number') {
      return offer.cancellation_notice_hours;
    }
    return fallback;
  }, [
    venue.booking_rules,
    multiServiceSegments,
    catalogStaff,
    selectedPrac,
    selectedServiceId,
  ]);

  useEffect(() => {
    if (!isEdit) return;
    setError(null);
  }, [isEdit, date, selectedTime]);

  /** Client-address services: the details step must collect where staff travel to. */
  const collectClientAddressSingle = useMemo(
    () =>
      anyServiceNeedsClientAddress(
        catalogStaff,
        multiServiceSegments && multiServiceSegments.length > 0
          ? multiServiceSegments.map((s) => s.serviceId)
          : [selectedServiceId],
      ),
    [catalogStaff, multiServiceSegments, selectedServiceId],
  );
  const collectClientAddressGroup = useMemo(
    () => anyServiceNeedsClientAddress(catalogStaff, groupPeople.map((p) => p.serviceId)),
    [catalogStaff, groupPeople],
  );

  // ── Single booking handlers ──

  /**
   * Segments for the extra services with the person the first segment settled
   * on, at their own prices. Start times are placeholders; the caller lines the
   * chain up with `recomputeMultiServiceChain`.
   */
  const segmentsForChainExtras = useCallback(
    (practitionerId: string, practitionerName: string, extras: ChainExtra[]): MultiServiceSegment[] => {
      const prac = catalogStaff.find((p) => p.id === practitionerId);
      const out: MultiServiceSegment[] = [];
      for (const ex of extras) {
        const baseOffer =
          prac?.services.find((svc) => svc.id === ex.serviceId) ??
          catalogStaff.flatMap((p) => p.services).find((svc) => svc.id === ex.serviceId);
        if (!baseOffer) continue;
        const offer = catalogOfferWithVariant(baseOffer, ex.variantId) ?? baseOffer;
        const variantName = ex.variantId ? baseOffer.variants?.find((v) => v.id === ex.variantId)?.name : null;
        const custom = staffDurationOverrides[staffDurationOverrideKey(ex.serviceId, ex.variantId)] ?? null;
        const addonInfo = addonSelectionDetails(catalogStaff, ex.serviceId, ex.addonIds, practitionerId);
        const online = onlineChargeFromCatalogOffer(offer);
        // Full payment rolls add-on price into the online charge; deposits do not.
        const depositWithAddons =
          (online?.amountPence ?? 0) + (online?.chargeLabel === 'full_payment' ? addonInfo.totalPence : 0);
        out.push({
          serviceId: ex.serviceId,
          serviceVariantId: ex.variantId,
          serviceName: variantName ? `${baseOffer.name} - ${variantName}` : baseOffer.name,
          practitionerId,
          practitionerName,
          startTime: '00:00',
          durationMinutes: (custom ?? offer.duration_minutes) + addonInfo.totalMinutes,
          bufferMinutes: offer.buffer_minutes ?? 0,
          pricePence: offer.price_pence,
          depositPence: depositWithAddons,
          onlineChargeLabel: online?.chargeLabel,
          addonIds: addonInfo.filteredIds,
          addonTotalPence: addonInfo.totalPence,
          addonTotalMinutes: addonInfo.totalMinutes,
          customDurationMinutes: custom,
        });
      }
      return out;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onlineChargeFromCatalogOffer is a stable inner function
    [catalogStaff, staffDurationOverrides],
  );

  /** Every segment of the visit from a chosen start: the first as picked, the extras after it. */
  const buildChainFromStart = useCallback(
    (time: string): MultiServiceSegment[] | null => {
      const first = buildSegmentFromSlotPick(time);
      if (!first) return null;
      const rest = segmentsForChainExtras(first.practitionerId, first.practitionerName, chainExtras);
      return recomputeMultiServiceChain([first, ...rest], time);
    },
    [buildSegmentFromSlotPick, chainExtras, segmentsForChainExtras],
  );

  const validateMultiServiceChain = useCallback(
    async (chain: MultiServiceSegment[], bookingDateOverride?: string): Promise<string | null> => {
      const booking_date = bookingDateOverride ?? date;
      const phantoms: Array<{
        practitioner_id: string;
        start_time: string;
        duration_minutes: number;
        buffer_minutes: number;
      }> = [];
      for (const seg of chain) {
        const res = await fetch(validateAppointmentSlotUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            venue_id: venue.id,
            booking_date,
            practitioner_id: seg.practitionerId,
            service_id: seg.serviceId,
            ...(seg.serviceVariantId ? { variant_id: seg.serviceVariantId } : {}),
            ...(seg.addonIds && seg.addonIds.length > 0
              ? { addons: seg.addonIds.map((id) => ({ addon_id: id })) }
              : {}),
            start_time: seg.startTime,
            phantoms,
          }),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (!data.ok) {
          return data.error ?? 'One or more times are no longer available';
        }
        phantoms.push({
          practitioner_id: seg.practitionerId,
          start_time: seg.startTime,
          duration_minutes: seg.durationMinutes,
          buffer_minutes: seg.bufferMinutes,
        });
      }
      return null;
    },
    [venue.id, date],
  );

  const continueStaffCalendarSlotPrefill = useCallback(
    async (opts: { serviceId: string; variantId: string | null; extras?: ChainExtra[] }) => {
      const bookingDate = initialDate!.trim();
      const timeHm = initialTime!.trim().slice(0, 5);
      const practitionerId = preselectedPractitionerId!.trim();

      const practitioner = catalogStaff.find((c) => c.id === practitionerId);
      const baseOffer = practitioner?.services.find((s) => s.id === opts.serviceId);

      const primeCal = (durationForPrime: number | null) => {
        primeSelectedAppointmentCalendar(practitionerId, opts.serviceId, durationForPrime, opts.variantId);
      };

      const goToSlotWithMessage = (message: string, durationForPrime: number | null) => {
        setSelectedServiceId(opts.serviceId);
        setSelectedVariantId(opts.variantId);
        setSelectedPractitionerId(practitionerId);
        setDate(bookingDate);
        setSelectedTime(timeHm);
        primeCal(durationForPrime);
        setMultiServiceSegments(null);
        setError(message);
        setStep('slot');
      };

      if (!practitioner || !baseOffer) {
        goToSlotWithMessage(
          'This service is not available with the calendar column you selected. Choose a date and time below.',
          staffDurationOverrides[staffDurationOverrideKey(opts.serviceId, opts.variantId)] ?? null,
        );
        return;
      }

      let effectiveName = baseOffer.name;
      let durationMinutes = baseOffer.duration_minutes;
      let bufferMinutes = baseOffer.buffer_minutes ?? 0;
      let pricePence = baseOffer.price_pence;
      let depositPence = baseOffer.deposit_pence ?? null;
      const paymentRequirement = baseOffer.payment_requirement;

      if (opts.variantId) {
        const v = baseOffer.variants?.find((x) => x.id === opts.variantId);
        if (!v) {
          goToSlotWithMessage(
            'That option is not valid for this service. Choose a date and time below.',
            staffDurationOverrides[staffDurationOverrideKey(opts.serviceId, opts.variantId)] ?? null,
          );
          return;
        }
        effectiveName = `${baseOffer.name} - ${v.name}`;
        durationMinutes = v.duration_minutes;
        bufferMinutes = v.buffer_minutes ?? bufferMinutes;
        pricePence = v.price_pence;
        depositPence = v.deposit_pence ?? depositPence ?? null;
      }

      const staffOv = staffDurationOverrides[staffDurationOverrideKey(opts.serviceId, opts.variantId)];
      if (staffOv != null) {
        durationMinutes = staffOv;
      }

      const firstOnline = onlineChargeFromCatalogOffer({
        price_pence: pricePence,
        deposit_pence: depositPence,
        payment_requirement: paymentRequirement,
      });

      const segment: MultiServiceSegment = {
        serviceId: opts.serviceId,
        serviceVariantId: opts.variantId,
        serviceName: effectiveName,
        practitionerId,
        practitionerName: practitioner.name,
        startTime: timeHm,
        durationMinutes,
        bufferMinutes,
        pricePence,
        depositPence: firstOnline?.amountPence ?? 0,
        onlineChargeLabel: firstOnline?.chargeLabel,
      };

      // The extra services follow the prefilled slot back to back, and the
      // whole visit is checked before it is shown.
      const extras = opts.extras ?? chainExtras;
      const chain = recomputeMultiServiceChain(
        [{ ...segment, customDurationMinutes: staffOv ?? null }, ...segmentsForChainExtras(practitionerId, practitioner.name, extras)],
        timeHm,
      );
      const err = await validateMultiServiceChain(chain, bookingDate);
      if (err) {
        goToSlotWithMessage(`${err} Pick another date or time using the calendar below.`, staffOv ?? durationMinutes);
        return;
      }

      setSelectedServiceId(opts.serviceId);
      setSelectedVariantId(opts.variantId);
      setSelectedPractitionerId(practitionerId);
      setDate(bookingDate);
      setSelectedTime(timeHm);
      primeCal(staffOv ?? durationMinutes);
      setMultiServiceSegments(chain);
      setError(null);
      setStep('multi_service');
    },
    [
      initialDate,
      initialTime,
      preselectedPractitionerId,
      catalogStaff,
      chainExtras,
      primeSelectedAppointmentCalendar,
      segmentsForChainExtras,
      validateMultiServiceChain,
      staffDurationOverrides,
    ],
  );

  /** Re-apply an add-on selection to an existing segment, then revalidate the chain. */
  const applyAddonsToSegment = useCallback(
    async (index: number, addonIds: string[]): Promise<string | null> => {
      if (!multiServiceSegments || index < 0 || index >= multiServiceSegments.length) {
        return 'Unable to update extras.';
      }
      const seg = multiServiceSegments[index]!;
      const addonInfo = addonSelectionDetails(catalogStaff, seg.serviceId, addonIds, seg.practitionerId);
      const baseDuration = seg.durationMinutes - (seg.addonTotalMinutes ?? 0);
      const baseDeposit =
        seg.depositPence - (seg.onlineChargeLabel === 'full_payment' ? seg.addonTotalPence ?? 0 : 0);
      const updated: MultiServiceSegment = {
        ...seg,
        durationMinutes: baseDuration + addonInfo.totalMinutes,
        depositPence:
          baseDeposit + (seg.onlineChargeLabel === 'full_payment' ? addonInfo.totalPence : 0),
        addonIds: addonInfo.filteredIds,
        addonTotalPence: addonInfo.totalPence,
        addonTotalMinutes: addonInfo.totalMinutes,
      };
      const firstStart = multiServiceSegments[0]!.startTime;
      const nextSegments = multiServiceSegments.map((s, i) => (i === index ? updated : s));
      const chain = recomputeMultiServiceChain(nextSegments, firstStart);
      const err = await validateMultiServiceChain(chain);
      if (err) {
        setError(err);
        return err;
      }
      setMultiServiceSegments(chain);
      setError(null);
      return null;
    },
    [multiServiceSegments, validateMultiServiceChain, catalogStaff],
  );

  const handleRemoveMultiSegment = useCallback(
    async (index: number) => {
      if (!multiServiceSegments || multiServiceSegments.length <= 1) return;
      const firstStart = multiServiceSegments[0]!.startTime;
      const next = multiServiceSegments.filter((_, i) => i !== index);
      const chain = recomputeMultiServiceChain(next, firstStart);
      setRemovingSegmentIndex(index);
      try {
        const err = await validateMultiServiceChain(chain);
        if (err) {
          setError(err);
          return;
        }
        setMultiServiceSegments(chain);
        setError(null);
      } finally {
        setRemovingSegmentIndex(null);
      }
    },
    [multiServiceSegments, validateMultiServiceChain],
  );

  /** Every extra has its options: go where the flow was heading. */
  const arriveAtChainTarget = useCallback(
    (target: ChainTarget, group: boolean, extras: ChainExtra[]) => {
      if (group) {
        if (target === 'practitioner') {
          setStep('group_practitioner');
          return;
        }
        if (groupPractitionerId && groupServiceId) {
          primeSelectedAppointmentCalendar(
            groupPractitionerId,
            groupServiceId,
            chainSpanForSelection(
              catalogStaff,
              { serviceId: groupServiceId, variantId: groupVariantId, addonIds: groupSelectedAddonIds },
              extras,
              groupPractitionerId,
              {},
            ),
            groupVariantId,
          );
        }
        setStep('group_slot');
        return;
      }
      if (target === 'prefill') {
        if (selectedServiceId) {
          void continueStaffCalendarSlotPrefill({ serviceId: selectedServiceId, variantId: selectedVariantId, extras });
        }
        return;
      }
      if (target === 'practitioner') {
        setStep('practitioner');
        return;
      }
      if (selectedPractitionerId && selectedServiceId) {
        primeSelectedAppointmentCalendar(
          selectedPractitionerId,
          selectedServiceId,
          primeDurationWithChain(
            selectedServiceId,
            selectedVariantId,
            selectedAddonIds,
            selectedPractitionerId,
            staffDurationOverrides[staffDurationOverrideKey(selectedServiceId, selectedVariantId)] ?? null,
            extras,
          ),
          selectedVariantId,
        );
      }
      setStep('slot');
    },
    [
      catalogStaff,
      continueStaffCalendarSlotPrefill,
      groupPractitionerId,
      groupSelectedAddonIds,
      groupServiceId,
      groupVariantId,
      primeDurationWithChain,
      primeSelectedAppointmentCalendar,
      selectedAddonIds,
      selectedPractitionerId,
      selectedServiceId,
      selectedVariantId,
      staffDurationOverrides,
    ],
  );

  /** Record one extra service's choices, then ask about the next one or move on. */
  const finishChainExtraOptions = useCallback(
    (index: number, choice: { variantId: string | null; addonIds: string[] }, group: boolean, target: ChainTarget) => {
      const extras = group ? groupChainExtras : chainExtras;
      const next = extras.map((ex, i) =>
        i === index ? { ...ex, variantId: choice.variantId, addonIds: choice.addonIds, optionsDone: true } : ex,
      );
      (group ? setGroupChainExtras : setChainExtras)(next);
      setAddonFlowContext({ kind: 'primary' });
      setChainAddonIds([]);
      setError(null);
      if (drainChainOptions(target, { extras: next, fromIndex: index + 1, group })) return;
      arriveAtChainTarget(target, group, next);
    },
    [arriveAtChainTarget, chainExtras, drainChainOptions, groupChainExtras],
  );

  /** Back from an extra service's options: the previous extra with options, else the first service's last step. */
  const backFromChainOptions = useCallback(
    (index: number, group: boolean, target: ChainTarget) => {
      for (let i = index - 1; i >= 0; i -= 1) {
        if (openChainExtraOptions(i, target, group)) return;
      }
      setAddonFlowContext({ kind: 'primary' });
      setChainAddonIds([]);
      if (group) {
        const primary = groupServiceId ? chainExtraHasOptions(groupServiceId, true) : { hasVariants: false, hasAddons: false };
        setStep(primary.hasAddons ? 'group_addons' : primary.hasVariants ? 'group_variant' : 'group_service');
        return;
      }
      if (serviceHasAddons) {
        setStep('addons');
        return;
      }
      if (serviceHasVariants) {
        setStep('variant');
        return;
      }
      // Combined pages chose the calendar before any options.
      setStep(isCombined && !isStaffFirst ? 'practitioner' : 'service');
    },
    [chainExtraHasOptions, groupServiceId, isCombined, isStaffFirst, openChainExtraOptions, serviceHasAddons, serviceHasVariants],
  );

  /** "Change services" on the review: back to the picker with the visit's services ticked. */
  const returnToServicePicker = useCallback(() => {
    const ids =
      multiServiceSegments?.map((seg) => seg.serviceId) ??
      [selectedServiceId, ...chainExtras.map((e) => e.serviceId)].filter((id): id is string => Boolean(id));
    setPendingServiceIds(ids);
    setMultiServiceSegments(null);
    setSelectedTime(null);
    setChainExtras([]);
    setChainAddonIds([]);
    setSelectedVariantId(null);
    setSelectedAddonIds([]);
    setAddonFlowContext({ kind: 'primary' });
    setDurationPopoverServiceId(null);
    setDurationPopoverOpenForKey(null);
    setError(null);
    // Venue and combined pages choose the person after the services; the
    // staff-first and per-practitioner pages keep them.
    if (!isStaffFirst && !isLockedPractitionerFlow) setSelectedPractitionerId(null);
    setSelectedServiceId(null);
    setStep('service');
  }, [chainExtras, isLockedPractitionerFlow, isStaffFirst, multiServiceSegments, selectedServiceId]);

  const handleDetailsSubmit = useCallback(
    async (details: GuestDetails) => {
      setGuestDetails(details);
      setError(null);
      if (isPublicGuest) {
        const emailError = accountGate.validateGuestEmail(details.email);
        if (emailError) {
          setError(emailError);
          return;
        }
      }
      // Block until every mandatory inline compliance form is completed (Phase 2c). The
      // server also re-checks, so this is a friendly guard, not the security boundary.
      if (isPublicGuest && bookingCompliance?.resolving) {
        setPendingComplianceSubmit({ kind: 'single', details });
        return;
      }
      if (isPublicGuest && bookingCompliance && !bookingCompliance.mandatoryComplete) {
        setError('Please complete the required form(s) before booking.');
        bookingComplianceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      const complianceCreateFields =
        isPublicGuest && bookingCompliance && bookingCompliance.submissions.length > 0
          ? {
              compliance_submissions: bookingCompliance.submissions,
              compliance_draft_id: bookingCompliance.draftId,
            }
          : {};
      const chain = multiServiceSegments;
      // Single-service create reads add-ons from segment 0 (the authoritative store once a
      // slot is picked), falling back to the working buffer for edit/prefill entry paths.
      const singleCreateAddonIds = chain?.[0]?.addonIds ?? selectedAddonIds;
      if (chain && chain.length > 1) {
        /**
         * Marked as submitting BEFORE the chain is re-validated, not after.
         *
         * `validateMultiServiceChain` makes one sequential request per segment,
         * so confirming a two or three service visit sat on the network for a
         * noticeable moment with no feedback at all: `DetailsStep`'s own spinner
         * is driven by react-hook-form's `isSubmitting`, and `onSubmit` is a void
         * callback, so it clears a tick after the click. The single-service path
         * below never showed this because it flips the flag immediately.
         */
        setSubmitting(true);
        try {
          const v = await validateMultiServiceChain(chain);
          if (v) {
            setError(v);
            return;
          }
          const res = await fetch(bookingCreateMultiServiceUrl(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              venue_id: venue.id,
              booking_date: date,
              first_name: details.first_name,
              last_name: details.last_name,
              email: details.email || undefined,
              phone: details.phone?.trim() || undefined,
              source: isStaff ? staffBookingSource : 'booking_page',
              // Staff discretion over money, mirroring the single-booking route.
              // Ignored server-side for public sources, so it is sent only here.
              ...(isStaff
                ? {
                    require_deposit: !isStaffWalkInAppointment && staffRequireDeposit,
                    require_card_hold: staffRequireCardHold,
                  }
                : {}),
              dietary_notes: details.dietary_notes,
              occasion: details.occasion,
              ...clientAddressPayloadFields(details),
              services: chain.map((s) => ({
                service_id: s.serviceId,
                practitioner_id: s.practitionerId,
                start_time: s.startTime,
                ...(s.serviceVariantId ? { service_variant_id: s.serviceVariantId } : {}),
                // Staff custom durations, honoured server-side for staff sources only.
                ...(isStaff && s.customDurationMinutes != null ? { duration_minutes: s.customDurationMinutes } : {}),
                ...(s.addonIds && s.addonIds.length > 0
                  ? { addons: s.addonIds.map((id) => ({ addon_id: id })) }
                  : {}),
              })),
              marketing_consent: details.marketing_consent,
              collective_id: collectiveId,
              collective_service_item_id: collectiveServiceItemId,
              ...complianceCreateFields,
            }),
          });
          const data = await res.json();
          if (!res.ok) {
            setError(publicCreateErrorMessage(res, data));
            if ((data as { error?: unknown } | null)?.error === COMPLIANCE_REQUIREMENT_UNMET) {
              setComplianceRefreshKey((k) => k + 1);
              bookingComplianceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            return;
          }
          const ids = data.booking_ids as string[] | undefined;
          const primary = (data.primary_booking_id as string | undefined) ?? ids?.[0];
          if (!primary) throw new Error('Booking failed');
          setCreateResult({
            booking_id: primary,
            booking_ids: ids,
            client_secret: data.client_secret,
            stripe_account_id: data.stripe_account_id,
            requires_deposit: data.requires_deposit ?? false,
            deposit_amount_pence: typeof data.total_deposit_pence === 'number' ? data.total_deposit_pence : 0,
            cancellation_notice_hours:
              typeof data.cancellation_notice_hours === 'number' ? data.cancellation_notice_hours : refundNoticeHours,
            payment_mode: data.payment_mode,
            card_hold_fee_pence: data.card_hold_fee_pence ?? null,
            card_hold_consent_text: data.card_hold_consent_text ?? null,
            compliance_warnings: Array.isArray(data.compliance_warnings) ? data.compliance_warnings : undefined,
          });
          const needsStripe = Boolean(data.requires_deposit && data.client_secret);
          setStep(needsStripe ? 'payment' : 'confirmation');
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Booking failed');
        } finally {
          setSubmitting(false);
        }
        return;
      }

      setSubmitting(true);
      try {
        const practitionerIdForCreate = practitionerIdForBookingCreate(
          selectedPractitionerId,
          multiServiceSegments,
        );
        if (!practitionerIdForCreate) {
          setError('Choose a practitioner and time before continuing.');
          setSubmitting(false);
          return;
        }
        if (isStaff) {
          const offerForCharge = effectiveOfferForBooking ?? selectedServiceForPractitioner;
          const online = offerForCharge ? onlineChargeFromCatalogOffer(offerForCharge) : null;
          // The checkbox is the only gate, for `full_payment` as much as for
          // `deposit`. A pay-in-full service used to be forced on with no
          // control, so it could not be booked over the phone at all.
          const require_deposit =
            !isStaffWalkInAppointment &&
            staffRequireDeposit &&
            online != null &&
            online.amountPence > 0 &&
            (online.chargeLabel === 'full_payment' || online.chargeLabel === 'deposit');
          // Card-hold services (design doc 7.6): send the toggle state explicitly
          // (server defaults to true when omitted; ignored for non-card-hold services).
          const staffCardHold = resolveStaffEntityCardHold({
            paymentRequirement: online?.chargeLabel,
            feePerUnitPence: online?.amountPence,
            cardHoldFlagEnabled: cardHoldDepositsEnabled,
          });
          const res = await fetch(venueBookingsCreateUrl(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              booking_date: date,
              booking_time: selectedTime,
              party_size: 1,
              first_name: details.first_name,
              last_name: details.last_name,
              phone: details.phone?.trim() || undefined,
              email: details.email || undefined,
              dietary_notes: details.dietary_notes,
              occasion: details.occasion,
              ...clientAddressPayloadFields(details),
              require_deposit,
              ...(staffCardHold ? { require_card_hold: staffRequireCardHold } : {}),
              practitioner_id: practitionerIdForCreate,
              appointment_service_id: selectedServiceId,
              service_variant_id: selectedVariantId ?? undefined,
              duration_minutes: staffCustomDurationMinutes ?? undefined,
              source: staffBookingSource,
              ...(staffBookingFlowDurationMs(staffFlowStartedAtRef.current) != null
                ? { staff_booking_duration_ms: staffBookingFlowDurationMs(staffFlowStartedAtRef.current) }
                : {}),
              ...(staffRebookBootstrap?.guest || details.returning_guest
                ? { returning_guest: true }
                : {}),
              ...(singleCreateAddonIds.length > 0
                ? { addons: singleCreateAddonIds.map((id) => ({ addon_id: id })) }
                : {}),
              ...(linkedOwnerVenueId ? { owner_venue_id: linkedOwnerVenueId } : {}),
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.message ?? data.error ?? 'Booking failed');
          setCreateResult({
            booking_id: data.booking_id,
            requires_deposit: Boolean(data.payment_url),
            deposit_amount_pence: 0,
            cancellation_notice_hours: refundNoticeHours,
            payment_url: data.payment_url,
            card_hold_requested: Boolean(staffCardHold && staffRequireCardHold && data.payment_url),
            compliance_warnings: Array.isArray(data.compliance_warnings) ? data.compliance_warnings : undefined,
          });
          setStep('confirmation');
          staffFlowStartedAtRef.current = Date.now();
          return;
        }

        const res = await fetch(bookingCreateUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            venue_id: venue.id,
            booking_date: date,
            booking_time: selectedTime,
            party_size: 1,
            first_name: details.first_name,
              last_name: details.last_name,
            email: details.email || undefined,
            phone: details.phone,
            source: 'booking_page',
            practitioner_id: practitionerIdForCreate,
            appointment_service_id: selectedServiceId,
            service_variant_id: selectedVariantId ?? undefined,
            dietary_notes: details.dietary_notes,
            occasion: details.occasion,
            ...clientAddressPayloadFields(details),
            marketing_consent: details.marketing_consent,
            collective_id: collectiveId,
            collective_service_item_id: collectiveServiceItemId,
            ...(singleCreateAddonIds.length > 0
              ? { addons: singleCreateAddonIds.map((id) => ({ addon_id: id })) }
              : {}),
            ...(waitlistOfferEntryId ? { waitlist_offer_id: waitlistOfferEntryId } : {}),
            ...complianceCreateFields,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(publicCreateErrorMessage(res, data));
          if ((data as { error?: unknown } | null)?.error === COMPLIANCE_REQUIREMENT_UNMET) {
            setComplianceRefreshKey((k) => k + 1);
            bookingComplianceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
          return;
        }
        setCreateResult({
          booking_id: data.booking_id,
          client_secret: data.client_secret,
          stripe_account_id: data.stripe_account_id,
          requires_deposit: data.requires_deposit ?? false,
          deposit_amount_pence: typeof data.deposit_amount_pence === 'number' ? data.deposit_amount_pence : 0,
          cancellation_notice_hours:
            typeof data.cancellation_notice_hours === 'number' ? data.cancellation_notice_hours : refundNoticeHours,
          payment_mode: data.payment_mode,
          card_hold_fee_pence: data.card_hold_fee_pence ?? null,
          card_hold_consent_text: data.card_hold_consent_text ?? null,
        });
        setStep(data.requires_deposit && data.client_secret ? 'payment' : 'confirmation');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Booking failed');
      } finally {
        setSubmitting(false);
      }
    },
    [
      bookingCompliance,
      venue.id,
      date,
      selectedTime,
      selectedPractitionerId,
      selectedServiceId,
      selectedVariantId,
      selectedAddonIds,
      staffCustomDurationMinutes,
      effectiveOfferForBooking,
      refundNoticeHours,
      multiServiceSegments,
      validateMultiServiceChain,
      isStaff,
      staffRequireDeposit,
      staffRequireCardHold,
      cardHoldDepositsEnabled,
      staffBookingSource,
      isStaffWalkInAppointment,
      selectedServiceForPractitioner,
      onBookingCreated,
      collectiveId,
      collectiveServiceItemId,
      isPublicGuest,
      accountGate,
      publicCreateErrorMessage,
      waitlistOfferEntryId,
      linkedOwnerVenueId,
      staffRebookBootstrap?.guest,
    ],
  );

  const handleEditSave = useCallback(async () => {
    if (!editBooking || !selectedPractitionerId || !selectedServiceId || !selectedTime) {
      setError('Choose a service, practitioner and time before saving.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const body = {
        booking_date: date,
        booking_time: selectedTime.length === 5 ? `${selectedTime}:00` : selectedTime,
        party_size: editBooking.party_size,
        practitioner_id: selectedPractitionerId,
        appointment_service_id: selectedServiceId,
      };
      // Staff keep the venue PATCH, with its manual-overlap allowance: a
      // receptionist double-booking a chair on purpose is a supported thing
      // to do and a guest rescheduling themselves is not.
      const guestRequest = editBooking.guestActor
        ? buildGuestModifyRequest(editBooking.guestActor, editBooking.id, body)
        : null;
      const res = guestRequest
        ? await fetch(guestRequest.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(guestRequest.body),
          })
        : await fetch(`/api/venue/bookings/${editBooking.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...body,
              allow_manual_overlap: true,
            }),
          });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const d = data as { error?: string; message?: string };
        throw new Error(d.message ?? d.error ?? 'Could not update appointment');
      }
      setCreateResult({
        booking_id: editBooking.id,
        requires_deposit: false,
        deposit_amount_pence: 0,
        cancellation_notice_hours: refundNoticeHours,
      });
      setStep('confirmation');
      // Tell the host the booking moved. Without this a manage page keeps rendering the
      // old date and time beside a confirmation saying the change was saved, which reads
      // as the reschedule not having worked.
      onBookingModified?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update appointment');
    } finally {
      setSubmitting(false);
    }
  }, [
    date,
    editBooking,
    onBookingModified,
    refundNoticeHours,
    selectedPractitionerId,
    selectedServiceId,
    selectedTime,
  ]);

  const handlePaymentComplete = useCallback(async () => {
    if (createResult?.booking_id) {
      const outcome = await confirmBookingPaymentWithServer({ booking_id: createResult.booking_id });
      setPaymentOutcome(outcome);
    } else {
      setPaymentOutcome(null);
    }
    setStep('confirmation');
  }, [createResult?.booking_id]);

  // ── Group booking handlers ──

  function addPersonToGroup(time: string) {
    const svc = uniqueServices.find((s) => s.id === groupServiceId);
    const prac = catalogStaff.find((p) => p.id === groupPractitionerId);
    if (!svc || !prac) return;

    const baseOffer = prac.services.find((s) => s.id === groupServiceId);
    // Apply the chosen variant (duration / buffer / price / deposit) when one is picked.
    const svcOffer = catalogOfferWithVariant(baseOffer, groupVariantId) ?? baseOffer;
    const offerForCharge = svcOffer ?? {
      price_pence: svc.price_pence,
      deposit_pence: svc.deposit_pence,
      payment_requirement: svc.payment_requirement,
    };
    const gOnline = onlineChargeFromCatalogOffer(offerForCharge);
    const addonInfo = addonSelectionDetails(catalogStaff, svc.id, groupSelectedAddonIds);
    // Full payment rolls add-on price into the online charge; deposits do not.
    const depositWithAddons =
      (gOnline?.amountPence ?? 0) +
      (gOnline?.chargeLabel === 'full_payment' ? addonInfo.totalPence : 0);
    const variantSuffix =
      groupVariantId && baseOffer?.variants
        ? baseOffer.variants.find((v) => v.id === groupVariantId)?.name
        : null;
    const personKey = `${currentPersonLabel}#${Date.now()}`;
    const firstRow: PersonSelection = {
      personKey,
      label: currentPersonLabel,
      serviceId: svc.id,
      serviceName:
        (svcOffer?.name ?? svc.name) + (variantSuffix ? ` (${variantSuffix})` : ''),
      serviceVariantId: groupVariantId,
      practitionerId: prac.id,
      practitionerName: prac.name,
      date,
      time,
      durationMinutes: (svcOffer?.duration_minutes ?? svc.duration_minutes) + addonInfo.totalMinutes,
      bufferMinutes: svcOffer?.buffer_minutes ?? 0,
      pricePence: svcOffer?.price_pence ?? svc.price_pence,
      depositPence: depositWithAddons,
      onlineChargeLabel: gOnline?.chargeLabel,
      addonIds: addonInfo.filteredIds,
      addonTotalPence: addonInfo.totalPence,
      addonTotalMinutes: addonInfo.totalMinutes,
    };
    // One row per service, back to back with the same person, like a single
    // guest's visit; `create-group` checks each row against the ones before it.
    const rows: PersonSelection[] = [firstRow];
    let nextStart = timeToMinutes(time.slice(0, 5)) + firstRow.durationMinutes + firstRow.bufferMinutes;
    for (const seg of segmentsForChainExtras(prac.id, prac.name, groupChainExtras)) {
      rows.push({
        personKey,
        label: currentPersonLabel,
        serviceId: seg.serviceId,
        serviceName: seg.serviceName,
        serviceVariantId: seg.serviceVariantId,
        practitionerId: seg.practitionerId,
        practitionerName: seg.practitionerName,
        date,
        time: minutesToTime(nextStart),
        durationMinutes: seg.durationMinutes,
        bufferMinutes: seg.bufferMinutes,
        pricePence: seg.pricePence,
        depositPence: seg.depositPence,
        onlineChargeLabel: seg.onlineChargeLabel,
        addonIds: seg.addonIds,
        addonTotalPence: seg.addonTotalPence,
        addonTotalMinutes: seg.addonTotalMinutes,
      });
      nextStart += seg.durationMinutes + seg.bufferMinutes;
    }
    setGroupPeople((prev) => [...prev, ...rows]);
    setGroupServiceId(null);
    setGroupVariantId(null);
    setGroupSelectedAddonIds([]);
    setGroupPractitionerId(null);
    setGroupPendingServiceIds([]);
    setGroupChainExtras([]);
    setCurrentPersonLabel('');
    setStep('group_review');
  }

  function removePersonFromGroup(index: number) {
    setGroupPeople((prev) => {
      const key = prev[index]?.personKey;
      return prev.filter((p, i) => i !== index && (key == null || p.personKey !== key));
    });
  }

  /** The group's rows folded back into people, in the order they were added. */
  const groupedPeople = useMemo(() => {
    const out: Array<{ key: string; label: string; firstIndex: number; rows: PersonSelection[] }> = [];
    groupPeople.forEach((row, i) => {
      const key = row.personKey ?? `row-${i}`;
      const existing = out.find((g) => g.key === key);
      if (existing) existing.rows.push(row);
      else out.push({ key, label: row.label, firstIndex: i, rows: [row] });
    });
    return out;
  }, [groupPeople]);
  const groupPersonCount = groupedPeople.length;

  const handleGroupDetailsSubmit = useCallback(async (details: GuestDetails) => {
    setGuestDetails(details);
    setError(null);
    if (isPublicGuest) {
      const emailError = accountGate.validateGuestEmail(details.email);
      if (emailError) {
        setError(emailError);
        return;
      }
    }
    // Gate on mandatory inline compliance forms (the server re-checks; this is a friendly guard).
    if (isPublicGuest && bookingCompliance?.resolving) {
      setPendingComplianceSubmit({ kind: 'group', details });
      return;
    }
    if (isPublicGuest && bookingCompliance && !bookingCompliance.mandatoryComplete) {
      setError('Please complete the required form(s) before booking.');
      bookingComplianceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const complianceCreateFields =
      isPublicGuest && bookingCompliance && bookingCompliance.submissions.length > 0
        ? {
            compliance_submissions: bookingCompliance.submissions,
            compliance_draft_id: bookingCompliance.draftId,
          }
        : {};
    setSubmitting(true);
    try {
      const res = await fetch(bookingCreateGroupUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venue_id: venue.id,
          first_name: details.first_name,
              last_name: details.last_name,
          email: details.email || undefined,
          phone: details.phone?.trim() || undefined,
          source: isStaff ? staffBookingSource : 'booking_page',
          // Staff discretion over money, mirroring the single-booking route.
          // Ignored server-side for public sources, so it is sent only here.
          ...(isStaff
            ? {
                require_deposit: !isStaffWalkInAppointment && staffRequireDeposit,
                require_card_hold: staffRequireCardHold,
              }
            : {}),
          dietary_notes: details.dietary_notes,
          ...clientAddressPayloadFields(details),
          people: groupPeople.map((p) => ({
            person_label: p.label,
            practitioner_id: p.practitionerId,
            appointment_service_id: p.serviceId,
            ...(p.serviceVariantId ? { service_variant_id: p.serviceVariantId } : {}),
            ...(p.addonIds && p.addonIds.length > 0
              ? { addons: p.addonIds.map((id) => ({ addon_id: id })) }
              : {}),
            booking_date: p.date,
            booking_time: p.time,
          })),
          marketing_consent: details.marketing_consent,
          ...complianceCreateFields,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          isPublicGuest
            ? publicCreateErrorMessage(res, data)
            : (data.message ?? data.error ?? 'Group booking failed'),
        );
        if (isPublicGuest && (data as { error?: unknown } | null)?.error === COMPLIANCE_REQUIREMENT_UNMET) {
          setComplianceRefreshKey((k) => k + 1);
          bookingComplianceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return;
      }
      setGroupCreateResult({
        group_booking_id: data.group_booking_id,
        booking_ids: data.booking_ids,
        client_secret: data.client_secret,
        stripe_account_id: data.stripe_account_id,
        requires_deposit: data.requires_deposit ?? false,
        total_deposit_pence: data.total_deposit_pence ?? 0,
        cancellation_notice_hours: typeof data.cancellation_notice_hours === 'number' ? data.cancellation_notice_hours : refundNoticeHours,
        payment_mode: data.payment_mode,
        card_hold_fee_pence: data.card_hold_fee_pence ?? null,
        card_hold_consent_text: data.card_hold_consent_text ?? null,
        compliance_warnings: Array.isArray(data.compliance_warnings) ? data.compliance_warnings : undefined,
      });
      const needsStripe = Boolean(data.requires_deposit && data.client_secret);
      setStep(needsStripe ? 'group_payment' : 'group_confirmation');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Group booking failed');
    } finally {
      setSubmitting(false);
    }
  }, [venue.id, groupPeople, refundNoticeHours, isStaff, staffBookingSource, isStaffWalkInAppointment, staffRequireDeposit, staffRequireCardHold, isPublicGuest, accountGate, publicCreateErrorMessage, bookingCompliance]);

  // Resume a submit that was held while the compliance check ran (see the guards above).
  const complianceResolving = bookingCompliance?.resolving ?? false;
  useEffect(() => {
    if (!pendingComplianceSubmit || complianceResolving) return;
    const { kind, details } = pendingComplianceSubmit;
    queueMicrotask(() => {
      setPendingComplianceSubmit(null);
      if (kind === 'single') void handleDetailsSubmit(details);
      else void handleGroupDetailsSubmit(details);
    });
  }, [pendingComplianceSubmit, complianceResolving, handleDetailsSubmit, handleGroupDetailsSubmit]);

  const handleGroupPaymentComplete = useCallback(async () => {
    if (groupCreateResult?.booking_ids?.[0]) {
      const outcome = await confirmBookingPaymentWithServer({
        booking_id: groupCreateResult.booking_ids[0],
      });
      setPaymentOutcome(outcome);
    } else {
      setPaymentOutcome(null);
    }
    setStep('group_confirmation');
  }, [groupCreateResult]);

  // ── Shared time slot renderer ──

  function renderTimeSlots(
    grouped: { morning: Array<{ start_time: string }>; afternoon: Array<{ start_time: string }>; evening: Array<{ start_time: string }> },
    onSelect: (time: string) => void,
  ) {
    const sections = [
      { label: 'Morning', slots: grouped.morning },
      { label: 'Afternoon', slots: grouped.afternoon },
      { label: 'Evening', slots: grouped.evening },
    ];
    return (
      <div className="space-y-4">
        {sections.map((section) =>
          section.slots.length > 0 ? (
            <div key={section.label}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">{section.label}</p>
              <div className={APPOINTMENT_TIME_SLOTS_GRID_CLASS}>
                {section.slots.map((slot, slotIndex) => (
                  <button
                    key={`${section.label}-${slotStartKey(slot.start_time)}-${slotIndex}`}
                    type="button"
                    onClick={() => onSelect(slot.start_time)}
                    className={appointmentTimeSlotClass(false, isPublicGuest)}
                  >
                    <span className={APPOINTMENT_TIME_SLOT_LABEL_CLASS}>
                      {slot.start_time.slice(0, 5)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null,
        )}
      </div>
    );
  }

  const totalGroupPrice = groupPeople.reduce(
    (sum, p) => sum + (p.pricePence ?? 0) + (p.addonTotalPence ?? 0),
    0,
  );
  const totalGroupDepositPence = groupPeople.reduce((sum, p) => sum + (p.depositPence ?? 0), 0);

  // Card holds (design doc 7.3): hold fees are not money due at booking, so they are split
  // out of the deposit sums and the legacy deposit / refund-policy copy is suppressed for
  // the hold portion.
  const groupCardHoldFeePence = groupPeople.reduce(
    (sum, p) => sum + (p.onlineChargeLabel === 'card_hold' ? p.depositPence ?? 0 : 0),
    0,
  );
  const groupPaidDepositPence = totalGroupDepositPence - groupCardHoldFeePence;
  const groupChargeLabel: 'deposit' | 'full_payment' | 'card_hold' =
    groupPeople.length > 0 && groupPeople.every((p) => p.onlineChargeLabel === 'card_hold')
      ? 'card_hold'
      : groupPeople.length > 0 &&
          groupPeople
            .filter((p) => p.onlineChargeLabel !== 'card_hold')
            .every((p) => p.onlineChargeLabel === 'full_payment')
        ? 'full_payment'
        : 'deposit';

  const isMultiServiceBooking = Boolean(multiServiceSegments && multiServiceSegments.length > 1);
  const singleOnlineCharge = effectiveOfferForBooking
    ? onlineChargeFromCatalogOffer(effectiveOfferForBooking)
    : null;
  const multiCardHoldFeePence = (multiServiceSegments ?? []).reduce(
    (sum, s) => sum + (s.onlineChargeLabel === 'card_hold' ? s.depositPence ?? 0 : 0),
    0,
  );
  const multiPaidDepositPence = (multiServiceSegments ?? []).reduce(
    (sum, s) => sum + (s.onlineChargeLabel !== 'card_hold' ? s.depositPence ?? 0 : 0),
    0,
  );
  const singleDetailsChargeLabel: 'deposit' | 'full_payment' | 'card_hold' = isMultiServiceBooking
    ? (multiServiceSegments ?? []).every((s) => s.onlineChargeLabel === 'card_hold')
      ? 'card_hold'
      : (multiServiceSegments ?? [])
            .filter((s) => s.onlineChargeLabel !== 'card_hold')
            .every((s) => s.onlineChargeLabel === 'full_payment')
        ? 'full_payment'
        : 'deposit'
    : singleOnlineCharge?.chargeLabel === 'card_hold'
      ? 'card_hold'
      : singleOnlineCharge?.chargeLabel === 'full_payment'
        ? 'full_payment'
        : 'deposit';
  const singleDetailsDepositPence = isMultiServiceBooking
    ? multiPaidDepositPence
    : singleDetailsChargeLabel === 'card_hold'
      ? 0
      : singleOnlineCharge?.amountPence ?? 0;
  const singleDetailsCardHoldFeePence = isMultiServiceBooking
    ? multiCardHoldFeePence
    : singleDetailsChargeLabel === 'card_hold'
      ? singleOnlineCharge?.amountPence ?? 0
      : 0;

  /**
   * Whether this staff booking actually collects money.
   *
   * Every staff shape (single, multi-service visit, group) answers to the one
   * checkbox, and the guest-facing charge copy inside `DetailsStep` follows it
   * rather than the catalog: with the box unchecked there is no deposit to
   * describe, so promising a refund window for one would be a lie. Walk-ins
   * never collect a deposit in any model (spec 2.8).
   */
  const staffCollectsCharge = isStaff && !isStaffWalkInAppointment && staffRequireDeposit;
  const chargeCopyVisible = isStaff ? staffCollectsCharge : true;
  const staffKeepsCardHold = !isStaff || staffRequireCardHold;

  const paymentCancellationBlurb = `Full deposit refund if you cancel ≥${refundNoticeHours}h before each appointment.`;

  const singleAppointmentPaymentPolicy = useMemo(() => {
    if (!selectedTime) return paymentCancellationBlurb;
    const iso = cancellationDeadlineHoursBefore(date, selectedTime, refundNoticeHours);
    if (isDepositRefundAvailableAt(iso)) {
      return cancellationPolicy ?? `Full deposit refund if you cancel ≥${refundNoticeHours}h before start.`;
    }
    return `Refund cut-off has passed - this deposit is not refundable if you cancel.`;
  }, [date, selectedTime, refundNoticeHours, cancellationPolicy, paymentCancellationBlurb]);

  const groupAppointmentPaymentPolicy = useMemo(() => {
    if (groupPeople.length === 0) return paymentCancellationBlurb;
    const slots = groupPeople.map((p) => ({ date: p.date, time: p.time }));
    const cls = classifyGroupDepositRefunds(slots, refundNoticeHours);
    if (cls === 'all_refundable') {
      return cancellationPolicy ?? paymentCancellationBlurb;
    }
    if (cls === 'none_refundable') {
      return `Refund cut-off has passed for at least one appointment - not all of this deposit is refundable if you cancel.`;
    }
    return `Refund is per appointment (≥${refundNoticeHours}h before each start). Some cut-offs have passed - those shares are not refundable.`;
  }, [groupPeople, refundNoticeHours, cancellationPolicy, paymentCancellationBlurb]);

  const singleConfirmationDepositCopy = useMemo(() => {
    if (!selectedTime) return null;
    const iso = cancellationDeadlineHoursBefore(date, selectedTime, refundNoticeHours);
    const hrs = createResult?.cancellation_notice_hours ?? refundNoticeHours;
    const amt = ((createResult?.deposit_amount_pence ?? 0) / 100).toFixed(2);
    if (isDepositRefundAvailableAt(iso)) {
      return `Full refund of ${sym}${amt} if you cancel ≥${hrs}h before start.`;
    }
    return `${sym}${amt} deposit not refundable - the refund cut-off for this appointment has passed.`;
  }, [date, selectedTime, refundNoticeHours, createResult, sym]);

  const groupConfirmationDepositCopy = useMemo(() => {
    const slots = groupPeople.map((p) => ({ date: p.date, time: p.time }));
    const cls = classifyGroupDepositRefunds(slots, refundNoticeHours);
    const hrs = groupCreateResult?.cancellation_notice_hours ?? refundNoticeHours;
    const amt = ((groupCreateResult?.total_deposit_pence ?? 0) / 100).toFixed(2);
    if (cls === 'all_refundable') {
      return `Full refund of each share (${sym}${amt} total) if you cancel ≥${hrs}h before each start.`;
    }
    if (cls === 'none_refundable') {
      return `${sym}${amt} total not fully refundable - refund cut-off has passed for every appointment.`;
    }
    return `${sym}${amt} total: refund per appointment (≥${hrs}h before start); cut-off passed for some - those shares are not refundable.`;
  }, [groupPeople, refundNoticeHours, groupCreateResult, sym]);

  const appointmentRebookWait =
    Boolean(staffRebookBootstrap?.appointment) && isStaff && !editBooking && (catalogLoading || staffRebookPriming);

  const progressMeta = isPublicGuest ? appointmentProgressPhase(step) : null;
  const choiceCardClass = isPublicGuest
    ? 'ap-choice-card w-full text-left'
    : 'w-full rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-left shadow-sm transition-all hover:border-brand-300 hover:shadow-md active:scale-[0.99]';
  // Cards that carry a description split the visual shell (border, padding, hover) from the click
  // target, so an expand toggle can sit inside the card without nesting a button inside a button.
  // Padding stays on the shell so the toggle lines up with the text above it. The target then
  // stretches over the whole shell (`ap-card-stretch`), so the description is not a dead zone.
  const choiceCardShellClass = isPublicGuest
    ? 'ap-choice-card ap-card-shell'
    : 'ap-card-shell rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm transition-all hover:border-brand-300 hover:shadow-md active:scale-[0.99]';
  const choiceCardTargetClass = 'ap-card-stretch w-full text-left';
  const publicDetailsFieldProps = isPublicGuest
    ? { submitClassName: APPOINTMENT_DETAILS_SUBMIT_CLASS, fieldClassName: APPOINTMENT_DETAILS_INPUT_CLASS }
    : {};

  /**
   * The only way to the picker. Every arrival clears the pooled-offering detour,
   * so no exit from it can be forgotten and leave the flow routing as though a
   * calendar still had to be chosen.
   */
  function goToStaffPick(opts?: { carryServiceId?: string | null }) {
    setAnyRouteActive(false);
    setCarriedServiceId(opts?.carryServiceId ?? null);
    // The carried service is pinned, not ticked: the next person may not offer it.
    setPendingServiceIds([]);
    setChainExtras([]);
    setSelectedPractitionerId(null);
    setSelectedServiceId(null);
    setSelectedVariantId(null);
    setSelectedAddonIds([]);
    setSelectedTime(null);
    setMultiServiceSegments(null);
    setError(null);
    setStep('staff_pick');
  }

  /** Shared by the guest and staff copies of the times step so they cannot drift. */
  function goBackFromSlot() {
    setSelectedTime(null);
    setMultiServiceSegments(null);
    const target = backFromSlot(flowShape, {
      hasVariants: serviceHasVariants,
      hasAddons: serviceHasAddons,
    });
    // Off the venue page the extra services' options sit directly behind the times.
    if (target !== 'practitioner') {
      const lastExtra = lastChainExtraWithOptions(false);
      if (lastExtra >= 0 && openChainExtraOptions(lastExtra, 'slot', false)) return;
    }
    if (target === 'practitioner') {
      setSelectedPractitionerId(null);
    }
    if (target === 'service') {
      setSelectedServiceId(null);
      setSelectedVariantId(null);
      setDurationPopoverServiceId(null);
      setDurationPopoverOpenForKey(null);
    }
    setStep(target);
  }

  /**
   * Staff-first dead end: the person the guest picked has nothing free. Carry the
   * service back to the picker so the next person's list can point at it.
   */
  function seeSomeoneElse() {
    goToStaffPick({ carryServiceId: selectedServiceId });
  }

  /** Offered only when switching is actually possible, and not from the pooled option. */
  const canSeeSomeoneElse =
    isStaffFirst &&
    bookableStaff.length > 1 &&
    Boolean(selectedPractitionerId) &&
    !isAnyAvailablePractitionerId(selectedPractitionerId);

  /**
   * Offered once a booking is done, so a guest booking two things in a row is
   * not left hunting for a way back to the start. Staff have their own Done
   * control, and an edit is a change to one booking rather than a new one.
   */
  const bookAnotherButton =
    isPublicGuest && !isEdit ? (
      <button
        type="button"
        onClick={restartPublicAppointmentBooking}
        className="mt-6 w-full rounded-xl border border-brand-200 bg-white px-4 py-3 text-sm font-semibold text-brand-800 transition-colors hover:border-brand-300 hover:bg-brand-50/70"
      >
        {/* "Book another booking" is not a sentence, so venues whose word for a
            booking is just that get the phrasing the other way round. */}
        {terms.booking.trim().toLowerCase() === 'booking'
          ? 'Make another booking'
          : `Book another ${terms.booking.toLowerCase()}`}
      </button>
    ) : null;

  const flowContent = (
    <div
      ref={isPublicGuest ? undefined : containerRef}
      className={
        isPublicGuest
          ? 'relative'
          : `relative mx-auto max-w-lg${appointmentRebookWait ? ' min-h-[14rem]' : ''}`
      }
      style={
        !isPublicGuest && accentColour ? ({ '--accent': accentColour } as React.CSSProperties) : undefined
      }
    >
      {appointmentRebookWait ? (
        <div
          className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center rounded-2xl bg-white/80 backdrop-blur-[1px]"
          aria-busy="true"
          aria-live="polite"
        >
          <BrandSpinner className="h-10 w-10" />
          <p className="mt-3 text-sm font-medium text-slate-700">
            {catalogLoading ? 'Loading services…' : 'Opening date & time…'}
          </p>
        </div>
      ) : null}
      {isLockedPractitionerFlow && lockedPractitioner && singleFlowSteps.includes(step) && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-brand-100 bg-brand-50/80 px-4 py-3 text-sm text-brand-900">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-800">
            {lockedPractitioner.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="font-medium">Booking with {lockedPractitioner.name}</div>
            <div className="text-xs text-brand-700/80">You will only see services and times for this {terms.staff.toLowerCase()}.</div>
          </div>
        </div>
      )}

      {isStaffFirst && selectedPractitionerId && STAFF_FIRST_BANNER_STEPS.includes(step) && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-brand-100 bg-brand-50/80 px-4 py-3 text-sm text-brand-900">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-800">
            {isAnyAvailablePractitionerId(selectedPractitionerId)
              ? '*'
              : (selectedPrac?.name ?? '').charAt(0).toUpperCase()}
          </div>
          <div className="font-medium">
            {isAnyAvailablePractitionerId(selectedPractitionerId)
              ? 'Booking with whoever is available first'
              : `Booking with ${selectedPrac?.name ?? ''}`}
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* ════════════════════════════════════════════════
          MODE CHOICE: Book for myself vs Group
          ════════════════════════════════════════════════ */}
      {step === 'mode_choice' && !isLockedPractitionerFlow && !isEdit && !isStaff && !isCombined && (
        <div>
          <AppointmentStepHeader
            title="How would you like to book?"
            description="Choose a single appointment or a group booking for several people."
          />
          <div className="space-y-3">
            <AppointmentChoiceCard
              onClick={() => (isStaffFirst ? goToStaffPick() : setStep('service'))}
              title="Book an appointment"
              description="Schedule an appointment for yourself"
              icon={
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                </svg>
              }
            />
            <AppointmentChoiceCard
              onClick={() => setStep('group_review')}
              title="Group appointment"
              description="Different services for multiple people"
              icon={
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
                </svg>
              }
            />
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════
          STAFF-FIRST: choose a person, then their services
          ════════════════════════════════════════════════ */}

      {step === 'staff_pick' && (
        <div data-testid="staff-pick-step">
          {/* Staff never pass through the single-or-group chooser, so the picker
              is their first step and there is nothing behind it. */}
          {backFromStaffPick(flowShape) && !initialStep && !isStaff && (
            <AppointmentBackLink onClick={() => setStep('mode_choice')} />
          )}
          <AppointmentStepHeader
            // Staff are booking on someone else's behalf, so the guest-facing
            // phrasing would be addressed to the wrong person.
            title={isStaff ? 'Who is this appointment with?' : 'Who would you like to see?'}
            description="Pick a person to see their services and prices."
          />
          {catalogLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <StaffChoiceCardSkeleton key={i} />
              ))}
            </div>
          ) : bookableStaff.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-center">
              <p className="text-sm font-medium text-slate-600">
                No {terms.staff.toLowerCase()} are available to book right now.
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {isStaff
                  ? `Check that your ${terms.staff.toLowerCase()} have bookable calendars and services.`
                  : 'Try again later or contact the venue.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {anyAvailableCardVisible(flowShape, {
                flagOn: anyAvailablePractitionerEnabled,
                listedCount: bookableStaff.length,
                hasUniformOffering: catalogStaff.some((p) =>
                  p.services.some((s) => s.any_available !== false),
                ),
              }) ? (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPractitionerId(ANY_AVAILABLE_PRACTITIONER_ID);
                    setStep('service');
                  }}
                  className={choiceCardClass}
                  aria-label="Any available"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-base font-bold text-brand-700"
                        aria-hidden
                      >
                        *
                      </div>
                      <div>
                        <div className="font-medium text-slate-900">Any available</div>
                        <p className="text-xs text-slate-500">First available time across the team</p>
                      </div>
                    </div>
                    <svg className={APPOINTMENT_PUBLIC_CHEVRON_SM} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden><path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
                  </div>
                </button>
              ) : null}
              {bookableStaff.map((prac) => (
                <StaffChoiceCard
                  key={prac.id}
                  name={prac.name}
                  profile={teamProfiles[prac.id]}
                  className={choiceCardClass}
                  onClick={() => {
                    setSelectedPractitionerId(prac.id);
                    setStep('service');
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════
          SINGLE BOOKING FLOW (unchanged from before)
          ════════════════════════════════════════════════ */}

      {step === 'service' && (
        <div>
          {isStaffFirst ? (
            <AppointmentBackLink
              onClick={() => {
                if (backFromService(flowShape) === 'staff_pick') {
                  goToStaffPick();
                  return;
                }
                setStep('mode_choice');
              }}
            />
          ) : !isLockedPractitionerFlow && !isEdit && !isStaff && !isCombined && !initialStep ? (
            isPublicGuest ? (
              <AppointmentBackLink onClick={() => { setPendingServiceIds([]); setStep('mode_choice'); }} />
            ) : (
              <button type="button" onClick={() => { setPendingServiceIds([]); setStep('mode_choice'); }} className="mb-3 inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
                Back
              </button>
            )
          ) : null}
          {isPublicGuest ? (
            <AppointmentStepHeader
              title="Select a service"
              description={
                isEdit
                  ? 'Choose the service for your changed appointment.'
                  : 'Choose one or more services. You will pick a date and time in a later step.'
              }
            />
          ) : (
            <>
              <h2 className="mb-1 text-lg font-semibold text-slate-900">Select a service</h2>
              <p className="mb-4 text-sm text-slate-500">
                {isEdit
                  ? 'Choose the service for your changed appointment.'
                  : 'Choose one or more services. You will pick a date and time in a later step.'}
              </p>
            </>
          )}
          {catalogLoading ? (
            <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-[72px] animate-pulse rounded-xl bg-slate-100" />)}</div>
          ) : serviceListForStep.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-center">
              <p className="text-sm font-medium text-slate-600">No services are available right now</p>
              <p className="mt-1 text-xs text-slate-400">Try again later or contact the venue.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {carriedServiceUnavailable && selectedPrac?.name ? (
                <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  {selectedPrac.name} does not offer the service you were booking, but here is what
                  they do.
                </p>
              ) : null}
              <ServiceCategoryList
                services={serviceListForStep}
                layout={servicesLayout}
                embed={embed}
                idPrefix="ap-service"
                revealServiceId={carriedServiceId ?? preselectedServiceId ?? null}
                renderService={(svc) => {
                const serviceVariants = isStaffFirst
                  ? catalogVariantsForServiceFromStaff(catalogStaff, svc.id, selectedPractitionerId)
                  : catalogVariantsForServiceId(catalogStaff, svc.id);
                const serviceHasVariants = serviceVariants.length > 0;
                const isCarriedService = isStaffFirst && svc.id === carriedServiceId;
                const displayedDuration = staffDurationOverrides[svc.id] ?? svc.duration_minutes;
                const durationIsCustom = displayedDuration !== svc.duration_minutes;

                // Editing changes one booking, so it keeps the tap-through list;
                // everything else ticks services and continues from the bar.
                const pickerSelected = !isEdit && pendingServiceIds.includes(svc.id);
                const pickerFull = !isEdit && !pickerSelected && pendingServiceIds.length >= MAX_SERVICES_PER_VISIT;
                function navigateFromServiceRow() {
                  if (isEdit) {
                    chooseServiceAndAdvance(svc.id);
                    return;
                  }
                  togglePendingService(svc.id);
                }

                if (!isStaff) {
                  return (
                    <div key={svc.id} className={`${choiceCardShellClass}${pickerSelected ? ' ap-choice-card-selected' : ''}`}>
                    <button
                      type="button"
                      onClick={navigateFromServiceRow}
                      className={`${choiceCardTargetClass}${pickerFull ? ' opacity-50' : ''}`}
                      aria-pressed={isEdit ? undefined : pickerSelected}
                      aria-disabled={pickerFull || undefined}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-medium text-slate-900">{svc.name}</span>
                            {svc.location_type === 'online' && (
                              <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700 ring-1 ring-sky-200/80">
                                Online
                              </span>
                            )}
                            {svc.location_type === 'client_address' && (
                              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 ring-1 ring-emerald-200/80">
                                At your address
                              </span>
                            )}
                            {isCarriedService && (
                              <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-700 ring-1 ring-brand-200/80">
                                You were booking this
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 text-xs text-slate-500">{svc.duration_minutes} min</div>
                        </div>
                        <div className="flex flex-shrink-0 items-center gap-2">
                          <span className={APPOINTMENT_PUBLIC_PRICE}>
                            {/* One person's own price is exact; a "from" only makes sense
                                across their options, or across the whole team. */}
                            {isStaffFirst && staffFirstServices && !serviceHasVariants
                              ? formatPrice(svc.minPricePence)
                              : formatFromPrice(svc.minPricePence)}
                          </span>
                          {pickerSelected ? (
                            <span className="ap-pick-check inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white" aria-hidden>
                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                              </svg>
                            </span>
                          ) : isEdit ? (
                            <svg className={APPOINTMENT_PUBLIC_CHEVRON_SM} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                            </svg>
                          ) : (
                            <span className="ap-pick-box inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-slate-300" aria-hidden />
                          )}
                        </div>
                      </div>
                    </button>
                    <ServiceCatalogDescription description={svc.description} idSuffix={svc.id} />
                    </div>
                  );
                }

                return (
                  <div key={svc.id} className="relative">
                    <div className={`flex w-full overflow-hidden rounded-xl border bg-white shadow-sm transition-all hover:shadow-md active:scale-[0.99] ${
                      pickerSelected ? 'border-brand-500 ring-1 ring-brand-300' : 'border-slate-200 hover:border-brand-300'
                    }${pickerFull ? ' opacity-60' : ''}`}>
                      {/* Shell/target split (see `choiceCardShellClass`): the button's stretched
                          target covers this whole column, description included, while the custom
                          duration box and price button sit outside it as their own controls. */}
                      <div className="ap-card-shell min-w-0 flex-1 transition-colors hover:bg-slate-50/60">
                        <button
                          type="button"
                          onClick={navigateFromServiceRow}
                          aria-pressed={isEdit ? undefined : pickerSelected}
                          className="ap-card-stretch w-full px-4 py-3.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/40"
                        >
                          <div className="flex items-center gap-2 font-medium text-slate-900">
                            {!isEdit ? (
                              <span
                                className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                                  pickerSelected ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300'
                                }`}
                                aria-hidden
                              >
                                {pickerSelected ? (
                                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                                  </svg>
                                ) : null}
                              </span>
                            ) : null}
                            <span>{svc.name}</span>
                          </div>
                          {serviceHasVariants ? (
                            <div className="mt-0.5 text-xs text-slate-500">From {svc.duration_minutes} min</div>
                          ) : null}
                        </button>
                        <ServiceCatalogDescription
                          description={svc.description}
                          idSuffix={svc.id}
                          className="px-4 pb-3"
                        />
                      </div>
                      {!serviceHasVariants ? (
                        <div className="flex flex-shrink-0 items-stretch border-l border-slate-100 bg-white">
                          <button
                            type="button"
                            onClick={() => {
                              setDurationPopoverOpenForKey(null);
                              setDurationPopoverServiceId((current) => (current === svc.id ? null : svc.id));
                            }}
                            className={`inline-flex items-center gap-1 self-stretch px-3 py-3.5 text-[11px] font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:ring-inset ${
                              durationIsCustom ? 'bg-brand-50/80 text-brand-700' : 'bg-white text-slate-600 hover:bg-slate-50/80'
                            }`}
                            aria-expanded={durationPopoverServiceId === svc.id}
                            aria-haspopup="dialog"
                          >
                            <span
                              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 shadow-sm ${
                                durationIsCustom
                                  ? 'border-brand-200 bg-brand-50 text-brand-700'
                                  : 'border-slate-200 bg-slate-50 text-slate-600'
                              }`}
                            >
                              {displayedDuration} min
                              <span className="sr-only">Custom duration</span>
                              <svg
                                className="h-3 w-3"
                                fill="none"
                                viewBox="0 0 24 24"
                                strokeWidth={2}
                                stroke="currentColor"
                                aria-hidden="true"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z"
                                />
                              </svg>
                            </span>
                          </button>
                        </div>
                      ) : null}
                      <button
                        type="button"
                        onClick={navigateFromServiceRow}
                        className="flex flex-shrink-0 items-center gap-2 border-l border-slate-100 bg-white py-3.5 pl-3 pr-3 text-left transition-colors hover:bg-slate-50/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/40"
                      >
                        <span className="text-sm font-semibold text-brand-600">{formatFromPrice(svc.minPricePence)}</span>
                        <svg className="h-4 w-4 flex-shrink-0 text-slate-300" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                        </svg>
                      </button>
                    </div>
                    {!serviceHasVariants && durationPopoverServiceId === svc.id ? (
                      <StaffCustomDurationPopover
                        value={displayedDuration}
                        onPresetPick={(minutes) => {
                          setStaffDurationOverrides((prev) => ({ ...prev, [svc.id]: minutes }));
                          setDurationPopoverServiceId(null);
                        }}
                        onOtherMinutesChange={(minutes) => {
                          setStaffDurationOverrides((prev) => ({ ...prev, [svc.id]: minutes }));
                        }}
                        onDone={() => setDurationPopoverServiceId(null)}
                        onReset={() => {
                          setStaffDurationOverrides((prev) => {
                            const next = { ...prev };
                            delete next[svc.id];
                            return next;
                          });
                          setDurationPopoverServiceId(null);
                        }}
                      />
                    ) : null}
                  </div>
                );
                }}
              />
            </div>
          )}
          {!isEdit && !catalogLoading && serviceListForStep.length > 0 ? (
            <MultiServicePickerBar
              services={pendingPickerLines}
              max={MAX_SERVICES_PER_VISIT}
              isPublic={isPublicGuest}
              formatPrice={formatPrice}
              staffWord={terms.staff.toLowerCase()}
              onContinue={continueFromServicePicker}
              onClear={() => setPendingServiceIds([])}
            />
          ) : null}
        </div>
      )}

      {step === 'variant' && (
        <div>
          <button
            type="button"
            onClick={() => {
              setSelectedVariantId(null);
              setDurationPopoverOpenForKey(null);
              setDurationPopoverServiceId(null);
              const target = backFromVariant(flowShape);
              if (target === 'service' && (isLockedPractitionerFlow || isStaffFirst)) {
                // These flows keep the person, so the service list is what is
                // genuinely behind the options and the choice has to be released.
                setSelectedServiceId(null);
              }
              setStep(target);
            }}
            className="mb-3 inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
            Back
          </button>
          <h2 className="mb-1 text-lg font-semibold text-slate-900">Choose your option</h2>
          <p className="mb-4 text-sm text-slate-500">
            This service has a few variations to choose from. Pick one to continue.
          </p>
          <div className="space-y-2">
            {variantsForSelectedService.map((variant) => {
              if (!selectedServiceId) return null;
              const variantOverrideKey = staffDurationOverrideKey(selectedServiceId, variant.id);
              const variantDisplayedDuration =
                staffDurationOverrides[variantOverrideKey] ?? variant.duration_minutes;
              const variantDurationIsCustom = variantDisplayedDuration !== variant.duration_minutes;

              const primeDuration = staffDurationOverrides[variantOverrideKey] ?? null;

              if (!isStaff) {
                return (
                  <div key={variant.id} className={choiceCardShellClass}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedVariantId(variant.id);
                      setSelectedAddonIds([]);
                      // Combined page: the calendar is already chosen — add-ons next (its
                      // own), else straight to slots.
                      if (
                        !isCombined &&
                        staffCalendarSlotPrefillActive &&
                        preselectedPractitionerId &&
                        !isLockedPractitionerFlow &&
                        selectedServiceId
                      ) {
                        if (drainChainOptions('prefill')) return;
                        void continueStaffCalendarSlotPrefill({ serviceId: selectedServiceId, variantId: variant.id });
                        return;
                      }
                      const next = afterVariant(flowShape, {
                        hasVariants: true,
                        hasAddons: isCombined
                          ? serviceHasAddons
                          : selectedServiceId != null &&
                            (isStaffFirst
                              ? addonGroupsForServiceFromStaff(catalogStaff, selectedServiceId, selectedPractitionerId)
                              : catalogAddonGroupsForServiceId(catalogStaff, selectedServiceId)
                            ).length > 0,
                      });
                      if ((next === 'slot' || next === 'practitioner') && drainChainOptions(next)) return;
                      if (next === 'slot' && selectedPractitionerId && selectedServiceId) {
                        primeSelectedAppointmentCalendar(
                          selectedPractitionerId,
                          selectedServiceId,
                          primeDurationWithChain(selectedServiceId, variant.id, [], selectedPractitionerId, primeDuration),
                          variant.id,
                        );
                      }
                      setStep(next);
                    }}
                    className={choiceCardTargetClass}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900">{variant.name}</div>
                        <div className="mt-0.5 text-xs text-slate-500">{variant.duration_minutes} min</div>
                      </div>
                      <svg
                        className={`${APPOINTMENT_PUBLIC_CHEVRON_SM} flex-shrink-0`}
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                      </svg>
                    </div>
                  </button>
                  <ServiceCatalogDescription description={variant.description} idSuffix={variant.id} />
                  </div>
                );
              }

              function navigateFromVariantRow() {
                setDurationPopoverOpenForKey(null);
                setDurationPopoverServiceId(null);
                setSelectedVariantId(variant.id);
                setSelectedAddonIds([]);
                const hasAddonGroups =
                  selectedServiceId != null &&
                  catalogAddonGroupsForServiceId(catalogStaff, selectedServiceId).length > 0;
                if (hasAddonGroups) {
                  setStep('addons');
                  return;
                }
                if (
                  staffCalendarSlotPrefillActive &&
                  preselectedPractitionerId &&
                  !isLockedPractitionerFlow &&
                  selectedServiceId
                ) {
                  if (drainChainOptions('prefill')) return;
                  void continueStaffCalendarSlotPrefill({ serviceId: selectedServiceId, variantId: variant.id });
                  return;
                }
                const next = afterVariant(flowShape, { hasVariants: true, hasAddons: false });
                if ((next === 'slot' || next === 'practitioner') && drainChainOptions(next)) return;
                if (next === 'slot' && selectedPractitionerId && selectedServiceId) {
                  primeSelectedAppointmentCalendar(
                    selectedPractitionerId,
                    selectedServiceId,
                    primeDurationWithChain(selectedServiceId, variant.id, [], selectedPractitionerId, primeDuration),
                    variant.id,
                  );
                }
                setStep(next);
              }

              return (
                <div key={variant.id} className="relative">
                  <div className="flex w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-all hover:border-brand-300 hover:shadow-md active:scale-[0.99]">
                    <button type="button" onClick={navigateFromVariantRow} className="min-w-0 flex-1 px-4 py-3.5 text-left transition-colors hover:bg-slate-50/60">
                      <div className="font-medium text-slate-900">{variant.name}</div>
                      {variant.description ? <div className="mt-0.5 text-xs text-slate-500">{variant.description}</div> : null}
                    </button>
                    <div className="flex flex-shrink-0 items-center gap-2 border-l border-slate-100 bg-white py-3.5 pl-3 pr-1">
                      <button
                        type="button"
                        onClick={() => {
                          setDurationPopoverServiceId(null);
                          setDurationPopoverOpenForKey((current) =>
                            current === variantOverrideKey ? null : variantOverrideKey,
                          );
                        }}
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/40 ${
                          variantDurationIsCustom
                            ? 'border-brand-200 bg-brand-50 text-brand-700'
                            : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                        }`}
                        aria-expanded={durationPopoverOpenForKey === variantOverrideKey}
                        aria-haspopup="dialog"
                      >
                        {variantDisplayedDuration} min
                        <span className="sr-only">Custom duration</span>
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z"
                          />
                        </svg>
                      </button>
                      <span className="text-sm font-semibold text-brand-600">{formatPrice(variant.price_pence)}</span>
                    </div>
                    <div className="pointer-events-none flex items-center pr-3 text-slate-300">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                      </svg>
                    </div>
                  </div>
                  {durationPopoverOpenForKey === variantOverrideKey ? (
                    <StaffCustomDurationPopover
                      value={variantDisplayedDuration}
                      onPresetPick={(minutes) => {
                        setStaffDurationOverrides((prev) => ({ ...prev, [variantOverrideKey]: minutes }));
                        setDurationPopoverOpenForKey(null);
                      }}
                      onOtherMinutesChange={(minutes) => {
                        setStaffDurationOverrides((prev) => ({ ...prev, [variantOverrideKey]: minutes }));
                      }}
                      onDone={() => setDurationPopoverOpenForKey(null)}
                      onReset={() => {
                        setStaffDurationOverrides((prev) => {
                          const next = { ...prev };
                          delete next[variantOverrideKey];
                          return next;
                        });
                        setDurationPopoverOpenForKey(null);
                      }}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {step === 'addons' && (() => {
        const addonStepServiceId =
          addonFlowContext.kind === 'primary' ? selectedServiceId : addonFlowContext.serviceId;
        const addonStepServiceName =
          addonFlowContext.kind === 'edit'
            ? multiServiceSegments?.[addonFlowContext.segmentIndex]?.serviceName ?? null
            : addonStepServiceId
              ? visitPractitioner?.services.find((s) => s.id === addonStepServiceId)?.name ??
                uniqueServices.find((s) => s.id === addonStepServiceId)?.name ??
                null
              : null;
        const addonStepIsSegment = addonFlowContext.kind !== 'primary';
        // Scope the groups to whoever this booking (or this segment) is with. On a
        // combined page two calendars can offer the same service with different
        // extras, and the charge already follows the chosen calendar, so resolving
        // by service id alone showed one venue's extras while charging another's.
        const addonStepPractitionerId =
          addonFlowContext.kind === 'edit'
            ? multiServiceSegments?.[addonFlowContext.segmentIndex]?.practitionerId ?? null
            : addonFlowContext.kind === 'chain'
              ? scopedPractitionerForOptions(addonFlowContext.group)
              : selectedPractitionerId;
        const addonGroups = addonStepServiceId
          ? addonGroupsForServiceFromStaff(catalogStaff, addonStepServiceId, addonStepPractitionerId)
          : [];
        // An extra service keeps its own buffer so the first service's choices survive.
        const stepAddonIds = addonFlowContext.kind === 'chain' ? chainAddonIds : selectedAddonIds;
        const setStepAddonIds = addonFlowContext.kind === 'chain' ? setChainAddonIds : setSelectedAddonIds;
        const selectedIds = new Set(stepAddonIds);
        const totalsPence = addonGroups.reduce((sum, g) => {
          for (const a of g.addons) {
            if (selectedIds.has(a.id)) sum += a.additional_price_pence;
          }
          return sum;
        }, 0);
        const totalsMin = addonGroups.reduce((sum, g) => {
          for (const a of g.addons) {
            if (selectedIds.has(a.id)) sum += a.additional_duration_minutes;
          }
          return sum;
        }, 0);
        const validationProblems: string[] = [];
        for (const grp of addonGroups) {
          const chosenInGroup = grp.addons.filter((a) => selectedIds.has(a.id)).length;
          if (chosenInGroup < grp.group.min_select) {
            validationProblems.push(
              grp.group.min_select === 1
                ? `Choose an option for "${grp.group.name}".`
                : `Choose at least ${grp.group.min_select} options for "${grp.group.name}".`,
            );
          }
          if (grp.group.max_select != null && chosenInGroup > grp.group.max_select) {
            validationProblems.push(`"${grp.group.name}" allows at most ${grp.group.max_select} options.`);
          }
          if (grp.group.selection_type === 'single' && chosenInGroup > 1) {
            validationProblems.push(`"${grp.group.name}" allows only one selection.`);
          }
        }
        const continueDisabled = validationProblems.length > 0;
        function toggleAddon(addonId: string, group: typeof addonGroups[number]) {
          setStepAddonIds((prev) => {
            const has = prev.includes(addonId);
            if (group.group.selection_type === 'single') {
              // Clear any other choice in this group, then add (or remove) this one.
              const withoutGroup = prev.filter((id) => !group.addons.some((a) => a.id === id));
              return has ? withoutGroup : [...withoutGroup, addonId];
            }
            return has ? prev.filter((id) => id !== addonId) : [...prev, addonId];
          });
        }
        async function goNext() {
          if (continueDisabled || addonsAdvancing) return;
          setAddonsAdvancing(true);
          try {
            await advanceFromAddons();
          } finally {
            setAddonsAdvancing(false);
          }
        }

        // The body of "Continue", wrapped by goNext so every exit path clears the pending state.
        // Adding a second or third service waits on a round trip here, and without feedback the
        // button looked inert long enough for staff to press it again.
        async function advanceFromAddons() {
          if (addonFlowContext.kind === 'chain') {
            finishChainExtraOptions(
              addonFlowContext.index,
              { variantId: addonFlowContext.variantId ?? null, addonIds: chainAddonIds },
              addonFlowContext.group,
              addonFlowContext.target,
            );
            return;
          }
          if (addonFlowContext.kind === 'edit') {
            const editedIndex = addonFlowContext.segmentIndex;
            const editedIds = selectedAddonIds;
            await applyAddonsToSegment(editedIndex, editedIds);
            setAddonFlowContext({ kind: 'primary' });
            // Keep the buffer mirroring segment 0 for any later back-to-slot re-pick.
            setSelectedAddonIds(
              editedIndex === 0 ? editedIds : multiServiceSegments?.[0]?.addonIds ?? [],
            );
            setStep('multi_service');
            return;
          }
          if (
            staffCalendarSlotPrefillActive &&
            preselectedPractitionerId &&
            !isLockedPractitionerFlow &&
            selectedServiceId
          ) {
            if (drainChainOptions('prefill')) return;
            void continueStaffCalendarSlotPrefill({
              serviceId: selectedServiceId,
              variantId: selectedVariantId ?? null,
            });
            return;
          }
          const next = afterAddons(flowShape);
          if ((next === 'slot' || next === 'practitioner') && drainChainOptions(next)) return;
          if (next === 'slot' && selectedPractitionerId && selectedServiceId) {
            // The person or calendar is already settled, so prime their month
            // (with the variant and add-on duration) and head straight to times.
            primeSelectedAppointmentCalendar(
              selectedPractitionerId,
              selectedServiceId,
              primeDurationWithChain(
                selectedServiceId,
                selectedVariantId,
                selectedAddonIds,
                selectedPractitionerId,
                staffDurationOverrides[staffDurationOverrideKey(selectedServiceId, selectedVariantId)] ?? null,
              ),
              selectedVariantId ?? null,
            );
          }
          setStep(next);
        }
        return (
          <div>
            <button
              type="button"
              onClick={() => {
                if (addonFlowContext.kind === 'chain') {
                  backFromChainOptions(addonFlowContext.index, addonFlowContext.group, addonFlowContext.target);
                  return;
                }
                if (addonStepIsSegment) {
                  setAddonFlowContext({ kind: 'primary' });
                  setSelectedAddonIds(multiServiceSegments?.[0]?.addonIds ?? []);
                  setStep('multi_service');
                  return;
                }
                setSelectedAddonIds([]);
                const target = backFromAddons(flowShape, {
                  hasVariants: serviceHasVariants,
                  hasAddons: true,
                });
                if (target === 'service' && isStaffFirst) {
                  // Staff-first keeps the person; the service choice is what the
                  // guest is going back to change.
                  setSelectedServiceId(null);
                  setSelectedVariantId(null);
                }
                setStep(target);
              }}
              className="mb-3 inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
              </svg>
              Back
            </button>
            <h2 className="mb-1 text-lg font-semibold text-slate-900">
              {addonStepIsSegment && addonStepServiceName
                ? `Add extras to ${addonStepServiceName}`
                : 'Add extras to your booking'}
            </h2>
            <p className="mb-4 text-sm text-slate-500">
              Choose any optional extras you&apos;d like to stack on top of this service.
            </p>
            <div className="space-y-4">
              {addonGroups.map((grp) => {
                const label = grp.group.prompt_to_client?.trim() || grp.group.name;
                const single = grp.group.selection_type === 'single';
                const isRequired = single && grp.group.min_select === 1;
                const optHint = single
                  ? isRequired
                    ? 'Pick one (required)'
                    : 'Pick one (optional)'
                  : grp.group.max_select != null
                    ? grp.group.min_select > 0
                      ? `Pick between ${grp.group.min_select} and ${grp.group.max_select}`
                      : `Pick up to ${grp.group.max_select}`
                    : grp.group.min_select > 0
                      ? `Pick at least ${grp.group.min_select}`
                      : 'Pick any';
                return (
                  <fieldset key={grp.group.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    {/* float+clear keeps the legend inside the card instead of straddling the top border */}
                    <legend className="float-left w-full text-sm font-semibold text-slate-800">{label}</legend>
                    <p className="mt-0.5 clear-both text-xs text-slate-500">{optHint}</p>
                    <ul className="mt-3 space-y-2">
                      {grp.addons.map((a) => {
                        const checked = selectedIds.has(a.id);
                        return (
                          <li key={a.id}>
                            <label
                              className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 ${
                                checked
                                  ? 'border-brand-400 bg-brand-50/40'
                                  : 'border-slate-200 hover:border-slate-300'
                              }`}
                            >
                              <input
                                type={single ? 'radio' : 'checkbox'}
                                name={`addon-${grp.group.id}`}
                                checked={checked}
                                onChange={() => toggleAddon(a.id, grp)}
                                className="mt-1 shrink-0"
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm font-medium text-slate-900">{a.name}</span>
                                {a.description ? (
                                  <span className="mt-0.5 block text-xs text-slate-500">{a.description}</span>
                                ) : null}
                              </span>
                              <span className="shrink-0 text-right text-xs font-semibold text-slate-700 tabular-nums">
                                {a.additional_price_pence > 0
                                  ? `+${currencySymbolFromCode(venue.currency ?? 'GBP')}${(a.additional_price_pence / 100).toFixed(2)}`
                                  : 'Free'}
                                {a.additional_duration_minutes > 0 ? (
                                  <span className="block text-[11px] font-normal text-slate-500">
                                    +{a.additional_duration_minutes} min
                                  </span>
                                ) : null}
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </fieldset>
                );
              })}
            </div>
            {validationProblems.length > 0 ? (
              <ul className="mt-4 list-disc rounded-lg border border-amber-200 bg-amber-50 px-5 py-2 text-xs text-amber-900">
                {validationProblems.map((msg, i) => (
                  <li key={i}>{msg}</li>
                ))}
              </ul>
            ) : null}
            <div className="mt-5 flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <span className="text-sm font-semibold text-slate-700">
                Extras total: +{currencySymbolFromCode(venue.currency ?? 'GBP')}
                {(totalsPence / 100).toFixed(2)}
                {totalsMin > 0 ? ` · +${totalsMin} min` : ''}
              </span>
              <button
                type="button"
                onClick={goNext}
                disabled={continueDisabled || addonsAdvancing}
                aria-busy={addonsAdvancing}
                className="inline-flex items-center gap-1 rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {addonsAdvancing ? (
                  <span
                    className="mr-1 h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                    aria-hidden
                  />
                ) : null}
                Continue
                {addonsAdvancing ? null : (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        );
      })()}

      {step === 'practitioner' && (
        <div>
          <button
            onClick={() => {
              if (anyRouteActive) {
                // Leaving the pooled-offering detour: put "Any available" back so
                // the service list the guest returns to is the one they were on.
                setAnyRouteActive(false);
                setSelectedVariantId(null);
                setSelectedAddonIds([]);
                setSelectedServiceId(null);
                setSelectedPractitionerId(ANY_AVAILABLE_PRACTITIONER_ID);
                setStep('service');
                return;
              }
              if (isCombined) {
                // Calendar-first: practitioner is reached straight from service, so
                // Back returns there (variants/add-ons come AFTER the calendar).
                setSelectedVariantId(null);
                setSelectedAddonIds([]);
                setDurationPopoverServiceId(null);
                setDurationPopoverOpenForKey(null);
                setSelectedPractitionerId(null);
                if (!isEdit) setSelectedServiceId(null);
                setStep('service');
                return;
              }
              // The extra services' options were asked for after the first service's.
              const lastExtra = lastChainExtraWithOptions(false);
              if (lastExtra >= 0 && openChainExtraOptions(lastExtra, 'practitioner', false)) return;
              const hasAddonGroups =
                selectedServiceId != null &&
                catalogAddonGroupsForServiceId(catalogStaff, selectedServiceId).length > 0;
              if (hasAddonGroups) {
                setStep('addons');
                return;
              }
              if (serviceHasVariants) {
                setStep('variant');
                return;
              }
              if (isEdit) {
                setStep('service');
                return;
              }
              setSelectedServiceId(null);
              setSelectedVariantId(null);
              setSelectedAddonIds([]);
              setDurationPopoverServiceId(null);
              setDurationPopoverOpenForKey(null);
              setSelectedPractitionerId(null);
              setStep('service');
            }}
            className="mb-3 inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
            Back
          </button>
          {selectedService && (
            <div className="mb-4 flex items-center gap-3 rounded-xl border border-brand-100 bg-brand-50/50 px-4 py-2.5">
              <svg className="h-5 w-5 flex-shrink-0 text-brand-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
              <div className="text-sm"><span className="font-medium text-brand-700">{selectedService.name}</span><span className="text-brand-500"> &middot; {(serviceSelectionDurationMinutes ?? selectedService.duration_minutes) + selectedAddonSummary.totalMinutes} min &middot; {selectedVariant ? formatPrice(priceWithSelectedAddons(selectedVariant.price_pence)) : formatFromPrice(priceWithSelectedAddons(servicesWithFromPrice.find((s) => s.id === selectedService.id)?.minPricePence ?? selectedService.price_pence))}{addonCountSuffix(selectedAddonSummary.lines.length)}</span></div>
            </div>
          )}
          {anyRouteActive ? (
            <p className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              This service is a little different for each {terms.staff.toLowerCase()}.
            </p>
          ) : null}
          <h2 className="mb-1 text-lg font-semibold text-slate-900">Who would you like to see?</h2>
          <p className="mb-4 text-sm text-slate-500">
            {isEdit
              ? `Choose the ${terms.staff.toLowerCase()} for your changed appointment.`
              : `Choose your preferred ${terms.staff.toLowerCase()}. Prices shown are what they charge for this service${selectedAddonSummary.lines.length > 0 ? ', including your add-ons' : ''}.`}
          </p>
          {catalogLoading ? (
            <div className="space-y-3">{[1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-100" />)}</div>
          ) : practitionersForSelectedService.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-center">
              <p className="text-sm font-medium text-slate-600">No {terms.staff.toLowerCase()} offer this service</p>
              <p className="mt-1 text-xs text-slate-400">Contact the venue if you need help.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {anyAvailablePractitionerEnabled && practitionersForSelectedService.length > 1 && !isEdit && (!isCombined || selectedOfferingAnyAvailable) ? (
                <button
                  type="button"
                  onClick={() => {
                    if (selectedServiceId) {
                      const durKey = staffDurationOverrideKey(selectedServiceId, selectedVariantId);
                      primeSelectedAppointmentCalendar(
                        ANY_AVAILABLE_PRACTITIONER_ID,
                        selectedServiceId,
                        primeDurationWithChain(
                          selectedServiceId,
                          selectedVariantId,
                          selectedAddonIds,
                          null,
                          staffDurationOverrides[durKey] ?? null,
                        ),
                        selectedVariantId,
                      );
                    }
                    setSelectedPractitionerId(ANY_AVAILABLE_PRACTITIONER_ID);
                    setStep('slot');
                  }}
                  className={choiceCardClass}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
                        *
                      </div>
                      <div>
                        <div className="font-medium text-slate-900">Any available</div>
                        <p className="text-xs text-slate-500">First available time across the team</p>
                      </div>
                    </div>
                    <svg className={APPOINTMENT_PUBLIC_CHEVRON_SM} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
                  </div>
                </button>
              ) : null}
              {practitionersForSelectedService.map((prac) => {
                const offer = catalogOfferWithVariant(
                  prac.services.find((s) => s.id === selectedServiceId),
                  selectedVariantId,
                );
                return (
                  <button
                    key={prac.id}
                    onClick={() => {
                      if (selectedServiceId) {
                        const durKey = staffDurationOverrideKey(selectedServiceId, selectedVariantId);
                        primeSelectedAppointmentCalendar(
                          prac.id,
                          selectedServiceId,
                          primeDurationWithChain(
                            selectedServiceId,
                            selectedVariantId,
                            selectedAddonIds,
                            prac.id,
                            staffDurationOverrides[durKey] ?? null,
                          ),
                          selectedVariantId,
                        );
                      }
                      setSelectedPractitionerId(prac.id);
                      // Combined page: now that the calendar (venue) is chosen, collect ITS
                      // own variants/add-ons before slots.
                      if (isCombined) {
                        const pracOffer = prac.services.find((s) => s.id === selectedServiceId);
                        if ((pracOffer?.variants?.length ?? 0) > 0) {
                          setStep('variant');
                          return;
                        }
                        if ((pracOffer?.addon_groups?.length ?? 0) > 0) {
                          setStep('addons');
                          return;
                        }
                        // No options on the first offering: the extras' come off this calendar too.
                        if (drainChainOptions('slot')) return;
                      }
                      setStep('slot');
                    }}
                    className={choiceCardClass}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">{prac.name.charAt(0).toUpperCase()}</div>
                        <div className="font-medium text-slate-900">{prac.name}</div>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-2">
                        <span className={APPOINTMENT_PUBLIC_PRICE}>{formatPrice(priceWithSelectedAddons(offer?.price_pence))}</span>
                        <svg className={APPOINTMENT_PUBLIC_CHEVRON_SM} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {step === 'slot' && (
        <div>
          {isPublicGuest ? (
            <AppointmentBackLink onClick={goBackFromSlot} />
          ) : (
            <button
              type="button"
              onClick={goBackFromSlot}
              className="mb-3 inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
              Back
            </button>
          )}
          {isPublicGuest ? (
            <AppointmentSummaryStrip>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium">
                  {slotHeaderServiceLabel}
                </span>
                <span className="ap-context-muted" aria-hidden>
                  &middot;
                </span>
                <span>{assignedStaffDisplayName || selectedPrac?.name}</span>
                {effectiveOfferForBooking?.duration_minutes ? (
                  <>
                    <span className="ap-context-muted" aria-hidden>
                      &middot;
                    </span>
                    <span>{slotHeaderDurationMinutes} min</span>
                  </>
                ) : null}
              </div>
            </AppointmentSummaryStrip>
          ) : (
            <div className="mb-4 rounded-xl border border-brand-100 bg-brand-50/50 px-4 py-2.5 text-sm">
              <div className="flex items-center gap-2 text-brand-700">
                <span className="font-medium">
                  {slotHeaderServiceLabel}
                </span>
                <span className="text-brand-400">&middot;</span>
                <span>{assignedStaffDisplayName || selectedPrac?.name}</span>
                {effectiveOfferForBooking?.duration_minutes ? (
                  <>
                    <span className="text-brand-400">&middot;</span>
                    <span>{slotHeaderDurationMinutes} min</span>
                  </>
                ) : null}
              </div>
            </div>
          )}
          <h2 className="mb-1 text-lg font-semibold text-slate-900">Date and time</h2>
          <p className="mb-4 text-sm text-slate-500">Green days have at least one bookable time. Select a day to see times.</p>
          {/**
            * Stage 7. Without this, a month the server refused to answer renders as a grid
            * with nothing green: visually identical to a venue booked solid for weeks, and
            * the guest has no way to tell the difference or reason to try again.
            */}
          {calendarUnavailable && (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-medium">We could not check which days are free</p>
              <p className="mt-1 text-xs text-amber-800">
                This is a temporary problem on our side, not a sign the month is full. Please try again in a
                moment.
              </p>
              <button
                type="button"
                onClick={() => {
                  setCalendarUnavailable(false);
                  setCalendarCache(new Map());
                  const last = lastCalendarFetchRef.current;
                  if (last) void fetchAppointmentCalendarMonth(last).then((set) => setAvailableDates(set)).catch(() => {});
                }}
                className="mt-3 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
              >
                Try again
              </button>
            </div>
          )}
          <div className="mb-4">
            <ResourceCalendarMonth
              year={calendarMonth.year}
              month={calendarMonth.month}
              availableDates={availableDates}
              selectedDate={date || null}
              onSelectDate={(ymd) => { setDate(ymd); setSelectedTime(null); }}
              onPrevMonth={goPrevMonth}
              onNextMonth={goNextMonth}
              minSelectableDate={todayYmdLocal()}
              loading={loadingCalendar}
              weekOffsetShortcuts={isStaff}
              weekShortcutBaseDate={staffRebookBootstrap?.initialDate}
            />
          </div>
          {isStaffWalkInAppointment && (
            <div className="mb-4">
              <button
                type="button"
                onClick={() => {
                  const { dateYmd, timeHHmmss } = getVenueLocalDateTimeForBooking(venue.timezone);
                  setDate(dateYmd);
                  const offer = effectiveOfferForBooking ?? selectedPrac?.services.find((s) => s.id === selectedServiceId);
                  const firstOnline = offer ? onlineChargeFromCatalogOffer(offer) : null;
                  setSelectedTime(timeHHmmss);
                  const walkInChain = buildChainFromStart(timeHHmmss.slice(0, 5));
                  setMultiServiceSegments(
                    walkInChain ?? [{
                      serviceId: selectedServiceId!,
                      serviceVariantId: selectedVariantId,
                      serviceName: offer?.name ?? '',
                      practitionerId: selectedPractitionerId!,
                      practitionerName: selectedPrac?.name ?? '',
                      startTime: timeHHmmss,
                      durationMinutes: offer?.duration_minutes ?? 30,
                      bufferMinutes: offer?.buffer_minutes ?? 0,
                      pricePence: offer?.price_pence ?? null,
                      depositPence: firstOnline?.amountPence ?? 0,
                      onlineChargeLabel: firstOnline?.chargeLabel,
                    }],
                  );
                  setError(null);
                  setStep('multi_service');
                }}
                className="w-full rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-left text-sm font-semibold text-emerald-900 shadow-sm transition-colors hover:bg-emerald-100"
              >
                Start appointment now
              </button>
            </div>
          )}
          {loading ? (
            <div className="h-32 animate-pulse rounded-xl bg-slate-100" />
          ) : slotsUnavailable ? (
            renderSlotsUnavailable(() => {
              const last = lastSlotFetchRef.current;
              if (last) void fetchAvailability(last);
            })
          ) : availableSlots.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-center">
              <p className="text-sm font-medium text-slate-600">No times available on {formatDateHuman(date)}</p>
              <p className="mt-1 text-xs text-slate-400">Try a different date above.</p>
              {canSeeSomeoneElse ? (
                <button
                  type="button"
                  onClick={seeSomeoneElse}
                  className="mt-4 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700"
                >
                  See someone else
                </button>
              ) : null}
              {appointmentWaitlistEnabled && isPublicGuest ? (
                <AppointmentWaitlistJoin
                  venueId={venue.id}
                  initialServiceId={selectedServiceId ?? undefined}
                  initialDate={date}
                  initialPractitionerId={
                    selectedPractitionerId && !isAnyAvailablePractitionerId(selectedPractitionerId)
                      ? selectedPractitionerId
                      : null
                  }
                  catalogStaff={catalogStaff}
                  catalogLoading={catalogLoading}
                  currency={venue.currency}
                />
              ) : null}
              {/* §8.6 — if this venue is in a live collective, point fully-booked
                  guests at the combined page. Not shown inside a collective page. */}
              {isPublicGuest && !collectiveId ? (
                <CollectiveCrossSuggestion venueId={venue.id} accentColour={accentColour} />
              ) : null}
            </div>
          ) : (
            renderTimeSlots(groupedSlots, (time) => {
              const chain = buildChainFromStart(time);
              if (!chain) return;
              setSelectedTime(time);
              setMultiServiceSegments(chain);
              setStep('multi_service');
            })
          )}
        </div>
      )}

      {step === 'multi_service' && multiServiceSegments && multiServiceSegments.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => {
              setSelectedTime(null);
              setMultiServiceSegments(null);
              setStep('slot');
            }}
            className="mb-3 inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
            Back
          </button>
          <h2 className="mb-1 text-lg font-semibold text-slate-900">Review your services</h2>
          <p className="mb-4 text-sm text-slate-500">
            {isAnyAvailablePractitionerId(selectedPractitionerId) && assignedStaffDisplayName ? (
              <>
                Your {terms.booking.toLowerCase()} is with{' '}
                <span className="font-medium text-slate-800">{assignedStaffDisplayName}</span>. Check the services
                below, then continue to your details.
              </>
            ) : (
              <>
                Check your services with{' '}
                {visitPractitioner?.name ?? assignedStaffDisplayName ?? terms.staff.toLowerCase()}, then continue to
                your details.
              </>
            )}
          </p>
          <MultiServiceSummaryCard
            lines={multiServiceSegments.map((s) => ({
              serviceName: s.serviceName,
              variantName: s.serviceVariantId
                ? catalogVariantsForServiceFromStaff(catalogStaff, s.serviceId, s.practitionerId).find((v) => v.id === s.serviceVariantId)?.name ?? null
                : null,
              practitionerName: s.practitionerName,
              startTime: s.startTime,
              durationMinutes: s.durationMinutes,
              pricePence: s.pricePence,
              depositPence: s.depositPence,
              chargeKind: s.onlineChargeLabel,
              extras: addonSelectionDetails(catalogStaff, s.serviceId, s.addonIds ?? [], s.practitionerId).lines.map((l) => ({
                name: l.name,
                pricePence: l.pricePence,
                durationMinutes: l.durationMinutes,
              })),
              editableAddons: catalogAddonGroupsForServiceId(catalogStaff, s.serviceId).length > 0,
            }))}
            formatDateHuman={formatDateHuman}
            bookingDate={date}
            currencySymbol={sym}
            formatPrice={formatPrice}
            onRemove={multiServiceSegments.length > 1 ? (idx) => void handleRemoveMultiSegment(idx) : undefined}
            removingSegmentIndex={removingSegmentIndex}
            onEditAddons={(idx) => {
              const seg = multiServiceSegments[idx];
              if (!seg) return;
              setAddonFlowContext({ kind: 'edit', segmentIndex: idx, serviceId: seg.serviceId });
              setSelectedAddonIds(seg.addonIds ?? []);
              setError(null);
              setStep('addons');
            }}
          />
          <div className="mt-4 space-y-3">
            {!isEdit ? (
              <button
                type="button"
                onClick={returnToServicePicker}
                className="w-full rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition-all hover:border-brand-300 hover:text-brand-700"
              >
                Change services
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void advanceToGuestDetails()}
              className="w-full rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700"
            >
              Continue to details
            </button>
          </div>
        </div>
      )}

      {step === 'append_variant' && addonFlowContext.kind === 'chain' && (() => {
        const ctx = addonFlowContext;
        const scoped = scopedPractitionerForOptions(ctx.group);
        const baseOffer =
          (scoped ? catalogStaff.find((p) => p.id === scoped)?.services.find((svc) => svc.id === ctx.serviceId) : undefined) ??
          uniqueServices.find((svc) => svc.id === ctx.serviceId) ??
          null;
        const variants = catalogVariantsForServiceFromStaff(catalogStaff, ctx.serviceId, scoped);
        const hasAddons = addonGroupsForServiceFromStaff(catalogStaff, ctx.serviceId, scoped).length > 0;
        const pickVariant = (variantId: string) => {
          if (hasAddons) {
            setAddonFlowContext({ ...ctx, variantId });
            setChainAddonIds([]);
            setError(null);
            setStep('addons');
            return;
          }
          finishChainExtraOptions(ctx.index, { variantId, addonIds: [] }, ctx.group, ctx.target);
        };
        return (
          <div>
            <button
              type="button"
              onClick={() => backFromChainOptions(ctx.index, ctx.group, ctx.target)}
              className="mb-3 inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
              Back
            </button>
            <h2 className="mb-1 text-lg font-semibold text-slate-900">Choose your option</h2>
            <p className="mb-4 text-sm text-slate-500">
              {baseOffer?.name ? `${baseOffer.name} has a few options.` : 'This service has a few options.'} Pick one to continue.
            </p>
            <div className="space-y-2">
              {variants.map((variant) => (
                <div key={variant.id} className={choiceCardShellClass}>
                  <button type="button" onClick={() => pickVariant(variant.id)} className={choiceCardTargetClass}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900">{variant.name}</div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          {variant.duration_minutes} min
                          {variant.price_pence != null ? ` · ${formatPrice(variant.price_pence)}` : ''}
                        </div>
                      </div>
                      <svg className={`${APPOINTMENT_PUBLIC_CHEVRON_SM} flex-shrink-0`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                      </svg>
                    </div>
                  </button>
                  <ServiceCatalogDescription description={variant.description} idSuffix={variant.id} />
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {step === 'details' && selectedTime && (
        <div>
          {isPublicGuest ? (
            <AppointmentBackLink onClick={() => setStep('multi_service')} />
          ) : (
            <button
              onClick={() => {
                setStep('multi_service');
              }}
              className="mb-3 inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
              Back
            </button>
          )}
          {multiServiceSegments && multiServiceSegments.length > 0 ? (
            <div className="mb-5">
              <MultiServiceSummaryCard
                lines={multiServiceSegments.map((s) => ({
                  serviceName: s.serviceName,
                  variantName: s.serviceVariantId
                    ? catalogVariantsForServiceFromStaff(catalogStaff, s.serviceId, s.practitionerId).find((v) => v.id === s.serviceVariantId)?.name ?? null
                    : null,
                  practitionerName: s.practitionerName,
                  startTime: s.startTime,
                  durationMinutes: s.durationMinutes,
                  pricePence: s.pricePence,
                  depositPence: s.depositPence,
                  chargeKind: s.onlineChargeLabel,
                  extras: addonSelectionDetails(catalogStaff, s.serviceId, s.addonIds ?? [], s.practitionerId).lines.map((l) => ({
                    name: l.name,
                    pricePence: l.pricePence,
                    durationMinutes: l.durationMinutes,
                  })),
                }))}
                formatDateHuman={formatDateHuman}
                bookingDate={date}
                currencySymbol={sym}
                formatPrice={formatPrice}
              />
            </div>
          ) : (
            <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Your {terms.booking.toLowerCase()}</h3>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Service</span><span className="font-medium text-slate-900">{selectedService?.name}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">{terms.staff}</span><span className="font-medium text-slate-900">{assignedStaffDisplayName || selectedPrac?.name}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Date</span><span className="font-medium text-slate-900">{formatDateHuman(date)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Time</span><span className="font-medium text-slate-900">{selectedTime}</span></div>
                {effectiveOfferForBooking?.duration_minutes != null && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Duration</span>
                    <span className="font-medium text-slate-900">{effectiveOfferForBooking.duration_minutes + selectedAddonSummary.totalMinutes} min</span>
                  </div>
                )}
                {effectiveOfferForBooking?.price_pence != null && (
                  <div className="mt-1.5 flex justify-between border-t border-slate-100 pt-1.5">
                    <span className="font-medium text-slate-700">{selectedAddonSummary.lines.length > 0 ? 'Service' : 'Price'}</span>
                    <span className="font-semibold text-brand-600">{formatPrice(effectiveOfferForBooking.price_pence)}</span>
                  </div>
                )}
                {/* The chosen add-ons, each priced, then the total they make with the service. */}
                {selectedAddonSummary.lines.map((line) => (
                  <div key={line.id} className="flex justify-between pl-3 text-xs">
                    <span className="min-w-0 truncate text-slate-500">
                      + {line.name}
                      {line.durationMinutes > 0 ? ` (+${line.durationMinutes} min)` : ''}
                    </span>
                    <span className="shrink-0 tabular-nums text-slate-700">
                      {line.pricePence > 0 ? `+${sym}${(line.pricePence / 100).toFixed(2)}` : 'Free'}
                    </span>
                  </div>
                ))}
                {selectedAddonSummary.lines.length > 0 && (
                  <div className="mt-1.5 flex justify-between border-t border-slate-100 pt-1.5">
                    <span className="font-medium text-slate-700">Total</span>
                    <span className="font-semibold text-brand-600">
                      {formatPrice(priceWithSelectedAddons(effectiveOfferForBooking?.price_pence))}
                    </span>
                  </div>
                )}
                {(() => {
                  const o = effectiveOfferForBooking
                    ? onlineChargeFromCatalogOffer(effectiveOfferForBooking)
                    : null;
                  if (!o || o.amountPence <= 0) return null;
                  if (o.chargeLabel === 'card_hold') {
                    // Card hold (design doc 7.3): no money due at booking; show the hold notice
                    // where the deposit hint renders today.
                    return (
                      <p className="mt-1.5 border-t border-slate-100 pt-1.5 text-xs text-slate-600">
                        {cardHoldCatalogNoticeLine(o.amountPence)}
                      </p>
                    );
                  }
                  // Full payment charges the add-ons too; a deposit does not. The same
                  // rule the segment builder applies when the booking is created.
                  const amountPence =
                    o.amountPence + (o.chargeLabel === 'full_payment' ? selectedAddonSummary.totalPence : 0);
                  return (
                    <div className="mt-1.5 flex justify-between border-t border-slate-100 pt-1.5">
                      <span className="font-medium text-slate-700">
                        {o.chargeLabel === 'full_payment' ? 'Pay now' : 'Deposit'}
                      </span>
                      <span className="font-semibold text-amber-700">{formatPrice(amountPence)}</span>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}
          {isStaff && !isEdit && (() => {
            /**
             * Staff charge controls for BOTH single and multi-service bookings.
             *
             * This block used to be gated on `!(segments.length > 1)`, the exact
             * inverse of the branch in `handleDetailsSubmit` that posts to
             * `create-multi-service`. So the checkbox appeared precisely when it
             * was not needed and vanished precisely when it was: a two-service
             * visit of a deposit-taking service had no way to skip the deposit
             * and stuck at `Pending`.
             *
             * The amounts come from the same whole-visit sums the summary card
             * and `DetailsStep` use, so a chain is charged and described as one
             * booking. A mixed chain can carry both a chargeable amount and a
             * card-hold fee; each gets its own control, since for a chain "the
             * two are never shown together" (7.6) would leave one of them with
             * no control at all. For a single service only one is ever non-zero,
             * so nothing changes there.
             */
            // Walk-ins never collect a deposit in any model (spec 2.8), so there
            // is no decision to offer. Card holds ARE offered on walk-ins (D6).
            const chargePence = isStaffWalkInAppointment ? 0 : singleDetailsDepositPence;
            const holdPence = singleDetailsCardHoldFeePence;
            const hold =
              holdPence > 0
                ? resolveStaffEntityCardHold({
                    paymentRequirement: 'card_hold',
                    feePerUnitPence: holdPence,
                    cardHoldFlagEnabled: cardHoldDepositsEnabled,
                  })
                : null;
            if (chargePence <= 0 && !hold) return null;
            return (
              <div className="mb-4 space-y-3">
                {chargePence > 0 && (
                  <StaffRequireChargeCheckbox
                    checked={staffRequireDeposit}
                    onChange={setStaffRequireDeposit}
                    chargeLabel={
                      singleDetailsChargeLabel === 'full_payment' ? 'full_payment' : 'deposit'
                    }
                    amountPence={chargePence}
                    currencySymbol={sym}
                  />
                )}
                {hold && (
                  <StaffCardHoldToggle
                    checked={staffRequireCardHold}
                    onChange={setStaffRequireCardHold}
                    feePence={hold.feePence}
                  />
                )}
              </div>
            );
          })()}
          {isEdit ? (
            <div className="space-y-3">
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleEditSave()}
                className="w-full rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-50"
              >
                {submitting ? 'Saving...' : 'Save appointment changes'}
              </button>
              <button
                type="button"
                onClick={() => setStep('slot')}
                disabled={submitting}
                className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                Back to time selection
              </button>
            </div>
          ) : submitting ? (
            <BookingSubmittingPanel variant="appointment" />
          ) : (
            <>
            <DetailsStep
              slot={{ key: selectedTime, label: selectedTime, start_time: selectedTime, end_time: '', available_covers: 1 }}
              date={date}
              partySize={1}
              onSubmit={handleDetailsSubmit}
              onEmailChange={isPublicGuest ? setPrecheckEmail : undefined}
              onBack={() => {
                setStep('multi_service');
              }}
              variant="appointment"
              appointmentDepositPence={chargeCopyVisible ? singleDetailsDepositPence : null}
              appointmentChargeLabel={chargeCopyVisible ? singleDetailsChargeLabel : 'deposit'}
              appointmentCardHoldFeePence={
                isStaffWalkInAppointment || !staffKeepsCardHold ? null : singleDetailsCardHoldFeePence
              }
              currencySymbol={sym}
              refundNoticeHours={refundNoticeHours}
              phoneDefaultCountry={phoneDefaultCountry}
              audience={detailsAudience}
              collectClientAddress={collectClientAddressSingle}
              initialDetails={mergeGuestDetailsPrefill(
                editBooking
                  ? {
                      first_name: editBooking.guest_first_name,
                      last_name: editBooking.guest_last_name,
                      email: editBooking.guest_email,
                      phone: editBooking.guest_phone,
                    }
                  : staffRebookAppointmentInitialDetails(staffRebookBootstrap),
                isPublicGuest ? accountGate.guestDetailsPrefill : undefined,
              )}
              emailReadOnly={isPublicGuest && accountGate.emailReadOnly}
              initialAppointmentComments={editBooking ? undefined : staffRebookBootstrap?.appointmentComments}
              hideAppointmentRequestField={isEdit}
              submitLabel={isEdit ? 'Save changes' : undefined}
              beforeFooter={
                isPublicGuest ? (
                  <div ref={bookingComplianceRef}>
                    <BookingComplianceBlock
                      venueId={venue.id}
                      serviceIds={
                        multiServiceSegments && multiServiceSegments.length > 0
                          ? multiServiceSegments.map((s) => s.serviceId)
                          : selectedServiceId
                            ? [selectedServiceId]
                            : []
                      }
                      email={precheckEmail}
                      bookingDate={date}
                      bookingTime={
                        multiServiceSegments && multiServiceSegments.length > 0
                          ? (multiServiceSegments[0]?.startTime ?? selectedTime)
                          : selectedTime
                      }
                      refreshKey={complianceRefreshKey}
                      submittingBooking={submitting}
                      onChange={setBookingCompliance}
                    />
                  </div>
                ) : undefined
              }
              {...publicDetailsFieldProps}
            />
            </>
          )}
        </div>
      )}

      {isEdit && step === 'confirmation' && (
        <div className="rounded-2xl border border-brand-200 bg-brand-50 p-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-brand-100">
            <svg className="h-8 w-8 text-brand-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-brand-900">{terms.booking} Updated</h2>
          <p className="mt-2 text-sm text-brand-700">
            {selectedService?.name} with {assignedStaffDisplayName || selectedPrac?.name}
          </p>
          <p className="mt-1 text-sm text-brand-600">{formatDateHuman(date)} at {selectedTime}</p>
          <p className="mt-3 text-xs text-brand-700">Your changes have been saved.</p>
          {isStaff ? <StaffBookingConfirmationFooter onDone={acknowledgeStaffBooking} /> : null}
        </div>
      )}

      {step === 'payment' && createResult?.client_secret && (
        <PaymentStep
          clientSecret={createResult.client_secret}
          stripeAccountId={createResult.stripe_account_id}
          amountPence={createResult.deposit_amount_pence}
          bookingId={createResult.booking_id}
          partySize={1}
          onComplete={handlePaymentComplete}
          onBack={() => setStep('details')}
          // Hold modes: the consent line covers the cancellation rule (design doc 7.3).
          cancellationPolicy={
            isCardHoldPaymentMode(createResult.payment_mode) ? undefined : singleAppointmentPaymentPolicy
          }
          summaryMode="total"
          chargeKind={singleDetailsChargeLabel === 'full_payment' ? 'full_payment' : 'deposit'}
          mode={createResult.payment_mode ?? 'payment'}
          cardHoldFeePence={createResult.card_hold_fee_pence}
          cardHoldConsentText={createResult.card_hold_consent_text}
          venueName={venue.name}
        />
      )}

      {!isEdit && step === 'confirmation' && paymentOutcome === 'cancelled' && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center">
          <h2 className="text-xl font-bold text-red-900">{terms.booking} not completed</h2>
          <p className="mt-2 text-sm text-red-800">{BOOKING_CANCELLED_MESSAGE}</p>
          {bookAnotherButton}
        </div>
      )}
      {!isEdit && step === 'confirmation' && paymentOutcome !== 'cancelled' && (
        <div className="rounded-2xl border border-brand-200 bg-brand-50 p-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-brand-100"><svg className="h-8 w-8 text-brand-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg></div>
          <h2 className="text-xl font-bold text-brand-900">
            {paymentOutcome === 'processing' || paymentOutcome === 'unconfirmed'
              ? PAYMENT_PROCESSING_HEADING
              : isEdit
                ? `${terms.booking} Updated`
                : `${terms.booking} Confirmed`}
          </h2>
          {paymentOutcome === 'processing' || paymentOutcome === 'unconfirmed' ? (
            <p className="mt-2 text-sm text-brand-700">{PAYMENT_PROCESSING_BODY}</p>
          ) : null}
          {multiServiceSegments && multiServiceSegments.length > 1 ? (
            <div className="mt-3 space-y-2 text-left text-sm text-brand-800">
              <p className="text-center text-brand-700">
                {formatDateHuman(date)}
                {assignedStaffDisplayName ? ` with ${assignedStaffDisplayName}` : selectedPrac?.name ? ` with ${selectedPrac.name}` : ''}
              </p>
              <ul className="mx-auto max-w-sm list-none space-y-1.5 rounded-lg border border-brand-200/80 bg-white/60 px-3 py-2">
                {multiServiceSegments.map((s) => (
                  <li key={`${s.serviceId}-${s.startTime}`} className="flex justify-between gap-2 text-xs">
                    <span className="font-medium text-brand-900">{s.serviceName}</span>
                    <span className="text-right text-brand-700">
                      {s.startTime}
                      {s.practitionerName ? ` · ${s.practitionerName}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <>
              <p className="mt-2 text-sm text-brand-700">
                {selectedService?.name} with {assignedStaffDisplayName || selectedPrac?.name}
              </p>
              <p className="mt-1 text-sm text-brand-600">{formatDateHuman(date)} at {selectedTime}</p>
            </>
          )}
          {!isEdit && (guestDetails?.email || guestDetails?.phone) ? (
            <p className="mt-3 text-xs text-brand-600">A confirmation will be sent to {guestDetails.email || guestDetails.phone}.</p>
          ) : null}
          {isEdit ? (
            <p className="mt-3 text-xs text-brand-700">Your changes have been saved.</p>
          ) : null}
          {!isEdit && isStaff && createResult?.payment_url ? (
            <p className="mt-3 text-xs text-brand-800">
              {createResult.card_hold_requested
                ? STAFF_CARD_HOLD_LINK_SENT_LINE
                : 'A deposit payment link was sent to the guest.'}
            </p>
          ) : null}
          {!isEdit && cardHoldConfirmationLine(createResult?.payment_mode) ? (
            <p className="mt-3 text-sm font-medium text-brand-800">
              {cardHoldConfirmationLine(createResult?.payment_mode)}
            </p>
          ) : null}
          {!isEdit &&
          (createResult?.deposit_amount_pence ?? 0) > 0 &&
          createResult?.payment_mode !== 'setup' ? (
            <p className="mt-4 max-w-sm mx-auto text-left text-xs text-brand-800/90">
              <span className="font-medium">Refund policy:</span>{' '}
              {singleConfirmationDepositCopy ??
                `Full refund if you cancel ≥${createResult?.cancellation_notice_hours ?? refundNoticeHours}h before start (see venue terms).`}
            </p>
          ) : !isEdit && isPublicGuest && !isCardHoldPaymentMode(createResult?.payment_mode) ? (
            <p className="mt-4 max-w-sm mx-auto text-left text-xs text-brand-800/90">
              No deposit was taken. You can cancel or change this booking at any time before your appointment (subject to the venue&apos;s terms).
            </p>
          ) : null}
          {isStaff ? (
            <StaffComplianceWarningsCard
              warnings={createResult?.compliance_warnings}
              bookingId={createResult?.booking_id}
            />
          ) : null}
          {isStaff ? <StaffBookingConfirmationFooter onDone={acknowledgeStaffBooking} /> : null}
          {bookAnotherButton}
        </div>
      )}

      {/* ════════════════════════════════════════════════
          GROUP BOOKING FLOW
          ════════════════════════════════════════════════ */}

      {step === 'group_review' && (
        <div>
          <button onClick={() => { if (groupPeople.length === 0) { setStep(isStaff ? 'service' : 'mode_choice'); } else { /* stay on review */ } }} className={`mb-3 inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700 ${groupPeople.length > 0 ? 'invisible' : ''}`}>
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
            Back
          </button>

          <h2 className="mb-1 text-lg font-semibold text-slate-900">Group Booking</h2>
          <p className="mb-4 text-sm text-slate-500">
            {groupPeople.length === 0
              ? 'Add each person and their services to build your group booking.'
              : `${groupPersonCount} ${groupPersonCount === 1 ? 'person' : 'people'} added. Add more or continue to checkout.`}
          </p>

          {/* Date selector for group */}
          <div className="mb-4 min-w-0">
            <label className="mb-1 block text-xs font-medium text-slate-500 uppercase tracking-wider">Booking date</label>
            <input type="date" value={date} min={todayStr()} onChange={(e) => setDate(e.target.value)} className="w-full min-w-0 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm shadow-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100 focus:outline-none" />
          </div>

          {/* People list */}
          {groupPeople.length > 0 && (
            <div className="mb-4 space-y-2">
              {groupedPeople.map((person) => (
                <div key={person.key} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-slate-900">{person.label}</div>
                      {person.rows.map((row, rowIdx) => (
                        <div key={`${person.key}-${rowIdx}`} className={rowIdx > 0 ? 'mt-2 border-t border-slate-100 pt-2' : ''}>
                          <div className="mt-0.5 text-sm text-slate-600">{row.serviceName} with {row.practitionerName}</div>
                          <div className="mt-0.5 text-xs text-slate-500">{formatDateHuman(row.date)} at {row.time} &middot; {row.durationMinutes} min</div>
                          {row.pricePence != null && <div className="mt-0.5 text-xs font-medium text-brand-600">{formatPrice(row.pricePence)}</div>}
                          {row.addonIds && row.addonIds.length > 0 ? (
                            <ul className="mt-1 space-y-0.5 border-l-2 border-slate-200 pl-2 text-[11px] text-slate-500">
                              {addonSelectionDetails(catalogStaff, row.serviceId, row.addonIds).lines.map((e, i) => (
                                <li key={`${e.id}-${i}`} className="flex items-baseline justify-between gap-2">
                                  <span className="min-w-0 truncate">
                                    + {e.name}
                                    {e.durationMinutes > 0 ? ` (+${e.durationMinutes} min)` : ''}
                                  </span>
                                  <span className="shrink-0 tabular-nums">
                                    {e.pricePence > 0 ? `+${sym}${(e.pricePence / 100).toFixed(2)}` : 'Free'}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      ))}
                    </div>
                    <button onClick={() => removePersonFromGroup(person.firstIndex)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Remove">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                </div>
              ))}
              {totalGroupPrice > 0 && (
                <div className="rounded-xl border border-brand-100 bg-brand-50/50 px-4 py-2.5 text-sm">
                  <div className="flex justify-between">
                    <span className="font-medium text-brand-700">Total (price)</span>
                    <span className="font-semibold text-brand-700">{formatPrice(totalGroupPrice)}</span>
                  </div>
                </div>
              )}
              {groupPaidDepositPence > 0 && (
                <div className="rounded-xl border border-amber-100 bg-amber-50/60 px-4 py-2.5 text-sm">
                  <div className="flex justify-between">
                    <span className="font-medium text-amber-900">Total deposit due</span>
                    <span className="font-semibold text-amber-900">{formatPrice(groupPaidDepositPence)}</span>
                  </div>
                </div>
              )}
              {groupCardHoldFeePence > 0 && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-600">
                  {cardHoldCatalogNoticeLine(groupCardHoldFeePence)}
                </div>
              )}
            </div>
          )}

          {/* Add person button */}
          {groupPersonCount < 10 && (
            <button
              onClick={() => {
                setCurrentPersonLabel('');
                setGroupServiceId(null);
                setGroupVariantId(null);
                setGroupSelectedAddonIds([]);
                setGroupPractitionerId(null);
                setGroupPendingServiceIds([]);
                setGroupChainExtras([]);
                setStep('group_person_label');
              }}
              className="w-full rounded-xl border-2 border-dashed border-slate-300 bg-white px-4 py-4 text-sm font-medium text-slate-600 transition-all hover:border-brand-300 hover:text-brand-600"
            >
              <div className="flex items-center justify-center gap-2">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                Add a person
              </div>
            </button>
          )}

          {/* Continue to details */}
          {groupPeople.length >= 1 && (
            <div className="mt-4 flex gap-3">
              <button
                onClick={() => { setGroupPeople([]); setStep(isStaff ? 'service' : 'mode_choice'); }}
                className="flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void advanceToGroupDetails()}
                className="flex-1 rounded-xl bg-brand-600 px-4 py-3 text-sm font-medium text-white hover:bg-brand-700 shadow-sm"
              >
                Continue to details
              </button>
            </div>
          )}
          {groupPeople.length === 0 && (
            <button onClick={() => setStep(isStaff ? 'service' : 'mode_choice')} className="mt-4 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Back
            </button>
          )}
        </div>
      )}

      {/* Group: person label */}
      {step === 'group_person_label' && (
        <div>
          <button onClick={() => setStep('group_review')} className="mb-3 inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
            Back
          </button>
          <h2 className="mb-1 text-lg font-semibold text-slate-900">Who is this appointment for?</h2>
          <p className="mb-4 text-sm text-slate-500">Enter a name or label (e.g. &quot;Myself&quot;, &quot;My son&quot;, &quot;Alex&quot;).</p>
          <input
            type="text"
            value={currentPersonLabel}
            onChange={(e) => setCurrentPersonLabel(e.target.value)}
            placeholder="e.g. Guest name or label"
            className="mb-4 w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm shadow-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100 focus:outline-none"
            autoFocus
          />
          <button
            disabled={!currentPersonLabel.trim()}
            onClick={() => setStep(isStaffFirst ? 'group_staff_pick' : 'group_service')}
            className="w-full rounded-xl bg-brand-600 px-4 py-3 text-sm font-medium text-white hover:bg-brand-700 shadow-sm disabled:opacity-50"
          >
            Continue
          </button>
        </div>
      )}

      {/* Group, staff-first: who is this guest seeing? */}
      {step === 'group_staff_pick' && (
        <div data-testid="group-staff-pick-step">
          <button
            onClick={() => {
              setGroupPractitionerId(null);
              setStep('group_person_label');
            }}
            className="mb-3 inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
            Back
          </button>
          <div className="mb-3 rounded-xl border border-purple-100 bg-purple-50/50 px-4 py-2.5 text-sm text-purple-700 font-medium">
            Booking for: {currentPersonLabel}
          </div>
          <h2 className="mb-1 text-lg font-semibold text-slate-900">
            Choose {terms.staff.toLowerCase()}
          </h2>
          <p className="mb-4 text-sm text-slate-500">Who should see {currentPersonLabel}?</p>
          {catalogLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <StaffChoiceCardSkeleton key={i} />
              ))}
            </div>
          ) : bookableStaff.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-center">
              <p className="text-sm font-medium text-slate-600">
                No {terms.staff.toLowerCase()} are available to book right now.
              </p>
              <p className="mt-1 text-xs text-slate-400">Try again later or contact the venue.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {bookableStaff.map((prac) => (
                <StaffChoiceCard
                  key={prac.id}
                  name={prac.name}
                  profile={teamProfiles[prac.id]}
                  className={choiceCardClass}
                  onClick={() => {
                    setGroupPractitionerId(prac.id);
                    setGroupServiceId(null);
                    setGroupVariantId(null);
                    setGroupSelectedAddonIds([]);
                    setStep('group_service');
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Group: select service */}
      {step === 'group_service' && (
        <div>
          <button
            onClick={() => {
              if (isStaffFirst) {
                setGroupPractitionerId(null);
                setGroupServiceId(null);
                setStep('group_staff_pick');
                return;
              }
              setStep('group_person_label');
            }}
            className="mb-3 inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
            Back
          </button>
          <div className="mb-3 rounded-xl border border-purple-100 bg-purple-50/50 px-4 py-2.5 text-sm text-purple-700 font-medium">
            Booking for: {currentPersonLabel}
            {isStaffFirst && groupSelectedPrac ? (
              <span className="text-purple-500"> &middot; {groupSelectedPrac.name}</span>
            ) : null}
          </div>
          <h2 className="mb-1 text-lg font-semibold text-slate-900">Select a service</h2>
          <p className="mb-4 text-sm text-slate-500">What would {currentPersonLabel} like?</p>
          {catalogLoading ? (
            <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-[72px] animate-pulse rounded-xl bg-slate-100" />)}</div>
          ) : (groupStaffFirstServices ?? servicesWithFromPrice).length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-center">
              <p className="text-sm font-medium text-slate-600">No services are available right now</p>
            </div>
          ) : (
            <div className="space-y-2">
              <ServiceCategoryList
                services={groupStaffFirstServices ?? servicesWithFromPrice}
                layout={servicesLayout}
                embed={embed}
                idPrefix="ap-group-service"
                renderService={(svc) => (
                <div key={svc.id} className={`${choiceCardShellClass}${groupPendingServiceIds.includes(svc.id) ? ' ap-choice-card-selected' : ''}`}>
                <button
                  type="button"
                  onClick={() => toggleGroupPendingService(svc.id)}
                  aria-pressed={groupPendingServiceIds.includes(svc.id)}
                  className={choiceCardTargetClass}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900">{svc.name}</div>
                      <div className="mt-0.5 text-xs text-slate-500">{svc.duration_minutes} min</div>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-2">
                      <span className={APPOINTMENT_PUBLIC_PRICE}>
                        {isStaffFirst && groupStaffFirstServices &&
                        catalogVariantsForServiceFromStaff(catalogStaff, svc.id, groupPractitionerId).length === 0
                          ? formatPrice(svc.minPricePence)
                          : formatFromPrice(svc.minPricePence)}
                      </span>
                      {groupPendingServiceIds.includes(svc.id) ? (
                        <span className="ap-pick-check inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white" aria-hidden>
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                          </svg>
                        </span>
                      ) : (
                        <span className="ap-pick-box inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-slate-300" aria-hidden />
                      )}
                    </div>
                  </div>
                </button>
                <ServiceCatalogDescription description={svc.description} idSuffix={svc.id} />
                </div>
                )}
              />
            </div>
          )}
          {!catalogLoading && groupPickerList.length > 0 ? (
            <MultiServicePickerBar
              services={groupPendingPickerLines}
              max={MAX_SERVICES_PER_VISIT}
              isPublic={isPublicGuest}
              formatPrice={formatPrice}
              staffWord={terms.staff.toLowerCase()}
              onContinue={continueFromGroupPicker}
              onClear={() => setGroupPendingServiceIds([])}
            />
          ) : null}
        </div>
      )}

      {/* Group: select variant */}
      {step === 'group_variant' && groupServiceId && (() => {
        const variants = isStaffFirst
          ? catalogVariantsForServiceFromStaff(catalogStaff, groupServiceId, groupPractitionerId)
          : catalogVariantsForServiceId(catalogStaff, groupServiceId);
        const groupHasAddons = (isStaffFirst
          ? addonGroupsForServiceFromStaff(catalogStaff, groupServiceId, groupPractitionerId)
          : catalogAddonGroupsForServiceId(catalogStaff, groupServiceId)
        ).length > 0;
        return (
          <div>
            <button
              onClick={() => setStep('group_service')}
              className="mb-3 inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
              Back
            </button>
            <div className="mb-3 rounded-xl border border-purple-100 bg-purple-50/50 px-4 py-2.5 text-sm">
              <span className="font-medium text-purple-700">{currentPersonLabel}</span>
              {isStaffFirst && groupSelectedPrac ? (
                <span className="text-purple-500"> &middot; {groupSelectedPrac.name}</span>
              ) : null}
              <span className="text-purple-500"> &middot; {groupSelectedService?.name}</span>
            </div>
            <h2 className="mb-1 text-lg font-semibold text-slate-900">Choose an option</h2>
            <p className="mb-4 text-sm text-slate-500">Pick the option that suits {currentPersonLabel}.</p>
            <div className="space-y-2">
              {variants.map((v) => (
                <button
                  key={v.id}
                  onClick={() => {
                    setGroupVariantId(v.id);
                    setGroupSelectedAddonIds([]);
                    const next = afterVariant(flowShape, {
                      hasVariants: true,
                      hasAddons: groupHasAddons,
                    });
                    if ((next === 'slot' || next === 'practitioner') && drainChainOptions(next, { group: true })) return;
                    if (next === 'slot' && groupPractitionerId) {
                      primeSelectedAppointmentCalendar(
                        groupPractitionerId,
                        groupServiceId,
                        groupChainExtras.length > 0
                          ? chainSpanForSelection(catalogStaff, { serviceId: groupServiceId, variantId: v.id, addonIds: [] }, groupChainExtras, groupPractitionerId, {})
                          : null,
                        v.id,
                      );
                    }
                    setStep(groupStep(next));
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-left shadow-sm transition-all hover:border-brand-300 hover:shadow-md active:scale-[0.99]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900">{v.name}</div>
                      {v.description ? (
                        <div className="mt-0.5 text-xs text-slate-500">{v.description}</div>
                      ) : null}
                      <div className="mt-0.5 text-xs text-slate-500">{v.duration_minutes} min</div>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-2">
                      <span className="text-sm font-semibold text-brand-600">{formatPrice(v.price_pence)}</span>
                      <svg className="h-4 w-4 text-slate-300" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Group: select add-ons */}
      {step === 'group_addons' && groupServiceId && (() => {
        const addonGroups = isStaffFirst
          ? addonGroupsForServiceFromStaff(catalogStaff, groupServiceId, groupPractitionerId)
          : catalogAddonGroupsForServiceId(catalogStaff, groupServiceId);
        const groupHasVariants = (isStaffFirst
          ? catalogVariantsForServiceFromStaff(catalogStaff, groupServiceId, groupPractitionerId)
          : catalogVariantsForServiceId(catalogStaff, groupServiceId)
        ).length > 0;
        const selectedIds = new Set(groupSelectedAddonIds);
        const totalsPence = addonGroups.reduce((sum, g) => {
          for (const a of g.addons) if (selectedIds.has(a.id)) sum += a.additional_price_pence;
          return sum;
        }, 0);
        const totalsMin = addonGroups.reduce((sum, g) => {
          for (const a of g.addons) if (selectedIds.has(a.id)) sum += a.additional_duration_minutes;
          return sum;
        }, 0);
        const validationProblems: string[] = [];
        for (const grp of addonGroups) {
          const chosenInGroup = grp.addons.filter((a) => selectedIds.has(a.id)).length;
          if (chosenInGroup < grp.group.min_select) {
            validationProblems.push(
              grp.group.min_select === 1
                ? `Choose an option for "${grp.group.name}".`
                : `Choose at least ${grp.group.min_select} options for "${grp.group.name}".`,
            );
          }
          if (grp.group.max_select != null && chosenInGroup > grp.group.max_select) {
            validationProblems.push(`"${grp.group.name}" allows at most ${grp.group.max_select} options.`);
          }
          if (grp.group.selection_type === 'single' && chosenInGroup > 1) {
            validationProblems.push(`"${grp.group.name}" allows only one selection.`);
          }
        }
        const continueDisabled = validationProblems.length > 0;
        function toggleGroupAddon(addonId: string, group: typeof addonGroups[number]) {
          setGroupSelectedAddonIds((prev) => {
            const has = prev.includes(addonId);
            if (group.group.selection_type === 'single') {
              const withoutGroup = prev.filter((id) => !group.addons.some((a) => a.id === id));
              return has ? withoutGroup : [...withoutGroup, addonId];
            }
            return has ? prev.filter((id) => id !== addonId) : [...prev, addonId];
          });
        }
        return (
          <div>
            <button
              type="button"
              onClick={() => {
                setGroupSelectedAddonIds([]);
                setStep(
                  groupStep(
                    backFromAddons(flowShape, { hasVariants: groupHasVariants, hasAddons: true }) as
                      | 'variant'
                      | 'service'
                      | 'practitioner',
                  ),
                );
              }}
              className="mb-3 inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
              Back
            </button>
            <div className="mb-3 rounded-xl border border-purple-100 bg-purple-50/50 px-4 py-2.5 text-sm">
              <span className="font-medium text-purple-700">{currentPersonLabel}</span>
              {isStaffFirst && groupSelectedPrac ? (
                <span className="text-purple-500"> &middot; {groupSelectedPrac.name}</span>
              ) : null}
              <span className="text-purple-500"> &middot; {groupSelectedService?.name}</span>
            </div>
            <h2 className="mb-1 text-lg font-semibold text-slate-900">Add extras for {currentPersonLabel}</h2>
            <p className="mb-4 text-sm text-slate-500">Choose any optional extras for this person.</p>
            <div className="space-y-4">
              {addonGroups.map((grp) => {
                const label = grp.group.prompt_to_client?.trim() || grp.group.name;
                const single = grp.group.selection_type === 'single';
                const isRequired = single && grp.group.min_select === 1;
                const optHint = single
                  ? isRequired ? 'Pick one (required)' : 'Pick one (optional)'
                  : grp.group.max_select != null
                    ? grp.group.min_select > 0
                      ? `Pick between ${grp.group.min_select} and ${grp.group.max_select}`
                      : `Pick up to ${grp.group.max_select}`
                    : grp.group.min_select > 0
                      ? `Pick at least ${grp.group.min_select}`
                      : 'Pick any';
                return (
                  <fieldset key={grp.group.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    {/* float+clear keeps the legend inside the card instead of straddling the top border */}
                    <legend className="float-left w-full text-sm font-semibold text-slate-800">{label}</legend>
                    <p className="mt-0.5 clear-both text-xs text-slate-500">{optHint}</p>
                    <ul className="mt-3 space-y-2">
                      {grp.addons.map((a) => {
                        const checked = selectedIds.has(a.id);
                        return (
                          <li key={a.id}>
                            <label
                              className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 ${
                                checked ? 'border-brand-400 bg-brand-50/40' : 'border-slate-200 hover:border-slate-300'
                              }`}
                            >
                              <input
                                type={single ? 'radio' : 'checkbox'}
                                name={`group-addon-${grp.group.id}`}
                                checked={checked}
                                onChange={() => toggleGroupAddon(a.id, grp)}
                                className="mt-1 shrink-0"
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm font-medium text-slate-900">{a.name}</span>
                                {a.description ? (
                                  <span className="mt-0.5 block text-xs text-slate-500">{a.description}</span>
                                ) : null}
                              </span>
                              <span className="shrink-0 text-right text-xs font-semibold text-slate-700 tabular-nums">
                                {a.additional_price_pence > 0
                                  ? `+${currencySymbolFromCode(venue.currency ?? 'GBP')}${(a.additional_price_pence / 100).toFixed(2)}`
                                  : 'Free'}
                                {a.additional_duration_minutes > 0 ? (
                                  <span className="block text-[11px] font-normal text-slate-500">
                                    +{a.additional_duration_minutes} min
                                  </span>
                                ) : null}
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </fieldset>
                );
              })}
            </div>
            {validationProblems.length > 0 ? (
              <ul className="mt-4 list-disc rounded-lg border border-amber-200 bg-amber-50 px-5 py-2 text-xs text-amber-900">
                {validationProblems.map((msg, i) => (
                  <li key={i}>{msg}</li>
                ))}
              </ul>
            ) : null}
            <div className="mt-5 flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <span className="text-sm font-semibold text-slate-700">
                Extras total: +{currencySymbolFromCode(venue.currency ?? 'GBP')}
                {(totalsPence / 100).toFixed(2)}
                {totalsMin > 0 ? ` · +${totalsMin} min` : ''}
              </span>
              <button
                type="button"
                onClick={() => {
                  if (continueDisabled) return;
                  const next = afterAddons(flowShape);
                  if ((next === 'slot' || next === 'practitioner') && drainChainOptions(next, { group: true })) return;
                  if (next === 'slot' && groupPractitionerId && groupServiceId) {
                    primeSelectedAppointmentCalendar(
                      groupPractitionerId,
                      groupServiceId,
                      groupChainExtras.length > 0
                        ? chainSpanForSelection(
                            catalogStaff,
                            { serviceId: groupServiceId, variantId: groupVariantId, addonIds: groupSelectedAddonIds },
                            groupChainExtras,
                            groupPractitionerId,
                            {},
                          )
                        : null,
                      groupVariantId,
                    );
                  }
                  setStep(groupStep(next));
                }}
                disabled={continueDisabled}
                className="inline-flex items-center gap-1 rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                Continue
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
              </button>
            </div>
          </div>
        );
      })()}

      {/* Group: select practitioner */}
      {step === 'group_practitioner' && (
        <div>
          <button
            onClick={() => {
              const hasAddons =
                groupServiceId != null &&
                catalogAddonGroupsForServiceId(catalogStaff, groupServiceId).length > 0;
              const hasVariants =
                groupServiceId != null &&
                catalogVariantsForServiceId(catalogStaff, groupServiceId).length > 0;
              const lastExtra = lastChainExtraWithOptions(true);
              if (lastExtra >= 0 && openChainExtraOptions(lastExtra, 'practitioner', true)) return;
              setStep(hasAddons ? 'group_addons' : hasVariants ? 'group_variant' : 'group_service');
            }}
            className="mb-3 inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
            Back
          </button>
          <div className="mb-3 rounded-xl border border-purple-100 bg-purple-50/50 px-4 py-2.5 text-sm">
            <span className="font-medium text-purple-700">{currentPersonLabel}</span>
            <span className="text-purple-500"> &middot; {groupSelectedService?.name}</span>
          </div>
          <h2 className="mb-1 text-lg font-semibold text-slate-900">Choose {terms.staff.toLowerCase()}</h2>
          <p className="mb-4 text-sm text-slate-500">Who should see {currentPersonLabel}?</p>
          {catalogLoading ? (
            <div className="space-y-3">{[1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-100" />)}</div>
          ) : practitionersForGroupService.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-center">
              <p className="text-sm font-medium text-slate-600">No {terms.staff.toLowerCase()} offer this service</p>
              <p className="mt-1 text-xs text-slate-400">Contact the venue if you need help.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {practitionersForGroupService.map((prac) => {
                const baseOffer = prac.services.find((s) => s.id === groupServiceId);
                const offer = catalogOfferWithVariant(baseOffer, groupVariantId) ?? baseOffer;
                return (
                  <button
                    key={prac.id}
                    onClick={() => {
                      if (groupServiceId) {
                        primeSelectedAppointmentCalendar(prac.id, groupServiceId, null, groupVariantId);
                      }
                      setGroupPractitionerId(prac.id);
                      setStep('group_slot');
                    }}
                    className={choiceCardClass}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">{prac.name.charAt(0).toUpperCase()}</div>
                        <div className="font-medium text-slate-900">{prac.name}</div>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-2">
                        <span className="text-sm font-semibold text-brand-600">{formatPrice(priceWithAddons(offer?.price_pence, groupSelectedAddonSummary.totalPence))}</span>
                        <svg className="h-4 w-4 text-slate-300" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Group: select time */}
      {step === 'group_slot' && (
        <div>
          <button
            onClick={() => {
              const target = backFromSlot(flowShape, {
                hasVariants: groupSelectedVariants.length > 0,
                hasAddons: groupSelectedAddonGroups.length > 0,
              });
              if (target !== 'practitioner') {
                const lastExtra = lastChainExtraWithOptions(true);
                if (lastExtra >= 0 && openChainExtraOptions(lastExtra, 'slot', true)) return;
              }
              // Service-first hands the guest back to the calendar list, so the
              // choice is released; staff-first keeps the person throughout.
              if (target === 'practitioner') setGroupPractitionerId(null);
              if (target === 'service') setGroupServiceId(null);
              setStep(groupStep(target));
            }}
            className="mb-3 inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
            Back
          </button>
          <div className="mb-3 rounded-xl border border-purple-100 bg-purple-50/50 px-4 py-2.5 text-sm">
            <span className="font-medium text-purple-700">{currentPersonLabel}</span>
            {/* Staff-first named the person first, so the summary reads in that order. */}
            <span className="text-purple-500">
              {isStaffFirst
                ? ` · ${groupSelectedPrac?.name ?? ''} · ${groupSlotServicesLabel}`
                : ` · ${groupSlotServicesLabel} · ${groupSelectedPrac?.name ?? ''}`}
            </span>
          </div>
          <h2 className="mb-1 text-lg font-semibold text-slate-900">Pick a time for {currentPersonLabel}</h2>
          <p className="mb-4 text-sm text-slate-500">Green days have at least one bookable time. Select a day, then choose an available time.</p>
          <div className="mb-4">
            <ResourceCalendarMonth
              year={calendarMonth.year}
              month={calendarMonth.month}
              availableDates={availableDates}
              selectedDate={date || null}
              onSelectDate={(ymd) => setDate(ymd)}
              onPrevMonth={goPrevMonth}
              onNextMonth={goNextMonth}
              minSelectableDate={todayYmdLocal()}
              loading={loadingCalendar}
              weekOffsetShortcuts={isStaff}
              weekShortcutBaseDate={staffRebookBootstrap?.initialDate}
            />
          </div>
          {loading ? (
            <div className="h-32 animate-pulse rounded-xl bg-slate-100" />
          ) : slotsUnavailable ? (
            renderSlotsUnavailable(() => {
              const last = lastSlotFetchRef.current;
              if (last) void fetchAvailability(last);
            })
          ) : groupAvailableSlots.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-center">
              <p className="text-sm font-medium text-slate-600">No times available on {formatDateHuman(date)}</p>
              <p className="mt-1 text-xs text-slate-400">Try a different date above.</p>
            </div>
          ) : (
            renderTimeSlots(groupGroupedSlots, (time) => addPersonToGroup(time))
          )}
        </div>
      )}

      {/* Group: details */}
      {step === 'group_details' && (
        <div>
          <button onClick={() => setStep('group_review')} className="mb-3 inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
            Back
          </button>
          <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Group booking summary</h3>
            <div className="space-y-3">
              {groupPeople.map((person, idx) => (
                <div key={idx} className="text-sm">
                  <div className="font-medium text-slate-900">{person.label}</div>
                  <div className="text-slate-600">{person.serviceName} with {person.practitionerName}</div>
                  <div className="text-xs text-slate-500">{formatDateHuman(person.date)} at {person.time}</div>
                </div>
              ))}
              {totalGroupPrice > 0 && (
                <div className="flex justify-between border-t border-slate-100 pt-2">
                  <span className="font-medium text-slate-700">Total (price)</span>
                  <span className="font-semibold text-brand-600">{formatPrice(totalGroupPrice)}</span>
                </div>
              )}
              {groupPaidDepositPence > 0 && (
                <div className="flex justify-between border-t border-amber-100 pt-2">
                  <span className="font-medium text-amber-900">Total deposit</span>
                  <span className="font-semibold text-amber-800">{formatPrice(groupPaidDepositPence)}</span>
                </div>
              )}
              {groupCardHoldFeePence > 0 && (
                <p className="border-t border-slate-100 pt-2 text-xs text-slate-600">
                  {cardHoldCatalogNoticeLine(groupCardHoldFeePence)}
                </p>
              )}
            </div>
          </div>
          {submitting ? (
            <BookingSubmittingPanel variant="appointment" />
          ) : (
            <>
              {isStaff && (() => {
                /**
                 * The group flow had no charge control of any kind. One decision
                 * covers everybody in the group, matching the single shared
                 * payment `create-group` takes.
                 *
                 * Unreachable on the web today: the group flow's only entry is
                 * the `mode_choice` chooser, which staff never see. It is here
                 * because `create-group` IS staff-reachable from the mobile app
                 * (`source` of `phone` / `walk-in`), so the route needed the
                 * decision, and a staff entry point added later must not
                 * silently re-introduce a group that cannot be booked without
                 * taking money.
                 */
                const chargePence = isStaffWalkInAppointment ? 0 : groupPaidDepositPence;
                const hold =
                  groupCardHoldFeePence > 0
                    ? resolveStaffEntityCardHold({
                        paymentRequirement: 'card_hold',
                        feePerUnitPence: groupCardHoldFeePence,
                        cardHoldFlagEnabled: cardHoldDepositsEnabled,
                      })
                    : null;
                if (chargePence <= 0 && !hold) return null;
                return (
                  <div className="mb-4 space-y-3">
                    {chargePence > 0 && (
                      <StaffRequireChargeCheckbox
                        checked={staffRequireDeposit}
                        onChange={setStaffRequireDeposit}
                        chargeLabel={groupChargeLabel === 'full_payment' ? 'full_payment' : 'deposit'}
                        amountPence={chargePence}
                        currencySymbol={sym}
                      />
                    )}
                    {hold && (
                      <StaffCardHoldToggle
                        checked={staffRequireCardHold}
                        onChange={setStaffRequireCardHold}
                        feePence={hold.feePence}
                      />
                    )}
                  </div>
                );
              })()}
              <DetailsStep
                slot={{ key: 'group', label: 'Group', start_time: groupPeople[0]?.time ?? '', end_time: '', available_covers: 1 }}
                date={groupPeople[0]?.date ?? date}
                partySize={groupPeople.length}
                onSubmit={handleGroupDetailsSubmit}
                onBack={() => setStep('group_review')}
                variant="appointment"
                appointmentDepositPence={
                  chargeCopyVisible && groupChargeLabel !== 'card_hold' ? groupPaidDepositPence : null
                }
                appointmentChargeLabel={chargeCopyVisible ? groupChargeLabel : 'deposit'}
                appointmentCardHoldFeePence={
                  staffKeepsCardHold && groupCardHoldFeePence > 0 ? groupCardHoldFeePence : null
                }
                currencySymbol={sym}
                refundNoticeHours={refundNoticeHours}
                multiAppointmentSlots={groupPeople.map((p) => ({ date: p.date, time: p.time }))}
                phoneDefaultCountry={phoneDefaultCountry}
                audience={detailsAudience}
                collectClientAddress={collectClientAddressGroup}
                initialDetails={isPublicGuest ? accountGate.guestDetailsPrefill : undefined}
                emailReadOnly={isPublicGuest && accountGate.emailReadOnly}
                onEmailChange={isPublicGuest ? setPrecheckEmail : undefined}
                beforeFooter={
                  isPublicGuest ? (
                    <div ref={bookingComplianceRef}>
                      <BookingComplianceBlock
                        venueId={venue.id}
                        serviceIds={groupPeople.map((p) => p.serviceId)}
                        email={precheckEmail}
                        bookingDate={earliestGroupSlot(groupPeople).date}
                        bookingTime={earliestGroupSlot(groupPeople).time}
                        refreshKey={complianceRefreshKey}
                        submittingBooking={submitting}
                        onChange={setBookingCompliance}
                      />
                    </div>
                  ) : undefined
                }
                {...publicDetailsFieldProps}
              />
            </>
          )}
        </div>
      )}

      {/* Group: payment */}
      {step === 'group_payment' && groupCreateResult?.client_secret && (
        <PaymentStep
          clientSecret={groupCreateResult.client_secret}
          stripeAccountId={groupCreateResult.stripe_account_id}
          amountPence={groupCreateResult.total_deposit_pence}
          bookingId={groupCreateResult.booking_ids?.[0]}
          partySize={groupPeople.length}
          onComplete={handleGroupPaymentComplete}
          onBack={() => setStep('group_details')}
          // Hold modes: the consent line covers the cancellation rule (design doc 7.3).
          cancellationPolicy={
            isCardHoldPaymentMode(groupCreateResult.payment_mode) ? undefined : groupAppointmentPaymentPolicy
          }
          summaryMode="total"
          chargeKind={groupChargeLabel === 'full_payment' ? 'full_payment' : 'deposit'}
          mode={groupCreateResult.payment_mode ?? 'payment'}
          cardHoldFeePence={groupCreateResult.card_hold_fee_pence}
          cardHoldConsentText={groupCreateResult.card_hold_consent_text}
          venueName={venue.name}
        />
      )}

      {/* Group: confirmation */}
      {step === 'group_confirmation' && paymentOutcome === 'cancelled' && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center">
          <h2 className="text-xl font-bold text-red-900">Group booking not completed</h2>
          <p className="mt-2 text-sm text-red-800">{BOOKING_CANCELLED_MESSAGE}</p>
        </div>
      )}
      {step === 'group_confirmation' && paymentOutcome !== 'cancelled' && (
        <div className="rounded-2xl border border-brand-200 bg-brand-50 p-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-brand-100">
            <svg className="h-8 w-8 text-brand-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
          </div>
          <h2 className="text-xl font-bold text-brand-900">
            {paymentOutcome === 'processing' || paymentOutcome === 'unconfirmed'
              ? PAYMENT_PROCESSING_HEADING
              : 'Group Booking Confirmed'}
          </h2>
          {paymentOutcome === 'processing' || paymentOutcome === 'unconfirmed' ? (
            <p className="mt-2 text-sm text-brand-700">{PAYMENT_PROCESSING_BODY}</p>
          ) : null}
          <div className="mt-3 space-y-2">
            {groupPeople.map((person, idx) => (
              <div key={idx} className="text-sm text-brand-700">
                <span className="font-medium">{person.label}</span>: {person.serviceName} with {person.practitionerName} at {person.time}
              </div>
            ))}
          </div>
          <p className="mt-3 text-sm text-brand-600">{formatDateHuman(groupPeople[0]?.date ?? date)}</p>
          {(guestDetails?.email || guestDetails?.phone) ? (
            <p className="mt-3 text-xs text-brand-600">
              A confirmation will be sent to {guestDetails.email || guestDetails.phone}.
            </p>
          ) : null}
          {cardHoldConfirmationLine(groupCreateResult?.payment_mode) ? (
            <p className="mt-3 text-sm font-medium text-brand-800">
              {cardHoldConfirmationLine(groupCreateResult?.payment_mode)}
            </p>
          ) : null}
          {(groupCreateResult?.total_deposit_pence ?? 0) > 0 &&
          groupCreateResult?.payment_mode !== 'setup' ? (
            <p className="mt-4 max-w-md mx-auto text-left text-xs text-brand-800/90">
              <span className="font-medium">Refund policy:</span>{' '}
              {groupConfirmationDepositCopy ??
                `Full refund per appointment if you cancel ≥${groupCreateResult?.cancellation_notice_hours ?? refundNoticeHours}h before each start (see venue terms).`}
            </p>
          ) : isPublicGuest && !isCardHoldPaymentMode(groupCreateResult?.payment_mode) ? (
            <p className="mt-4 max-w-md mx-auto text-left text-xs text-brand-800/90">
              No deposit was taken. You can cancel or change these appointments at any time before they start (subject to the venue&apos;s terms).
            </p>
          ) : null}
          {isStaff ? (
            <StaffComplianceWarningsCard
              warnings={groupCreateResult?.compliance_warnings}
              bookingId={groupCreateResult?.booking_ids?.[0]}
            />
          ) : null}
          {isStaff ? <StaffBookingConfirmationFooter onDone={acknowledgeStaffBooking} /> : null}
          {bookAnotherButton}
        </div>
      )}
    </div>
  );

  if (isPublicGuest) {
    return (
      <AppointmentPublicShell
        ref={containerRef}
        accentColour={accentColour}
        embed={embed}
        className={appointmentRebookWait ? 'min-h-[14rem]' : ''}
      >
        {progressMeta ? <AppointmentProgressBar phase={progressMeta.phase} /> : null}
        {flowContent}
      </AppointmentPublicShell>
    );
  }

  return flowContent;
}
