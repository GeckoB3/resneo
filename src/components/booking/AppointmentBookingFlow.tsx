'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { VenuePublic, GuestDetails } from './types';
import { usePublicBookingAccountGateContext } from '@/components/booking/PublicBookingAccountGate';
import { mergeGuestDetailsPrefill } from '@/lib/booking/public-booking-account-gate';
import { DetailsStep } from './DetailsStep';
import BookingComplianceBlock from './BookingComplianceBlock';
import { clearBookingComplianceDrafts, type BookingComplianceState } from './BookingComplianceForms';
import { BookingSubmittingPanel } from './BookingSubmittingPanel';
import { PaymentStep } from './PaymentStep';
import { APPOINTMENT_BOOKING_RESET_EVENT } from './appointment-booking-events';
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
  bookingConfirmPaymentUrl,
  venueBookingsCreateUrl,
} from '@/lib/booking/booking-flow-api';
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
} from './appointment-public-ui';
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

/** Staff-only booking duration overrides: parent service id if no variant; composite key when a variant is chosen. */
function staffDurationOverrideKey(serviceId: string, variantId: string | null): string {
  return variantId ? `${serviceId}:${variantId}` : serviceId;
}

function ServiceCatalogDescription({ description }: { description?: string | null }) {
  const text = description?.trim();
  if (!text) return null;
  return <p className="mt-1 text-xs leading-relaxed text-slate-500 line-clamp-3">{text}</p>;
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
  onlineChargeLabel?: 'deposit' | 'full_payment';
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
  onlineChargeLabel?: 'deposit' | 'full_payment';
  /** Chosen add-on ids for this segment (sent to create-multi-service / validate-slot). */
  addonIds?: string[];
  /** Sum of add-on price for display on the review card. */
  addonTotalPence?: number;
  /** Sum of add-on minutes folded into `durationMinutes`. */
  addonTotalMinutes?: number;
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
  | 'service' | 'variant' | 'addons' | 'append_variant' | 'practitioner' | 'slot' | 'multi_service' | 'details' | 'payment' | 'confirmation'
  | 'group_person_label' | 'group_service' | 'group_variant' | 'group_addons' | 'group_practitioner' | 'group_slot'
  | 'group_review' | 'group_details' | 'group_payment' | 'group_confirmation';

const SINGLE_STEPS: Step[] = ['service', 'variant', 'addons', 'practitioner', 'slot', 'multi_service', 'details'];
const SINGLE_STEPS_LOCKED: Step[] = ['service', 'variant', 'addons', 'slot', 'multi_service', 'details'];

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
  initialStep?: 'service';
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
    publicAuth?: { token?: string; hmac?: string };
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
  const [staffRequireDeposit, setStaffRequireDeposit] = useState(false);
  // Public compliance pre-check (Phase 2 / G4): the guest's email, seeded from a
  // signed-in account and updated as they type, drives the pre-check resolve.
  const [precheckEmail, setPrecheckEmail] = useState<string>(
    () => (isPublicGuest ? accountGate.guestDetailsPrefill?.email?.trim() ?? '' : ''),
  );
  // Inline compliance forms the guest completes during booking (Phase 2c): collected
  // submissions + whether every mandatory form is done (gates Confirm) + the type ids
  // (so the pre-check notice suppresses the forms it is already rendering).
  const [bookingCompliance, setBookingCompliance] = useState<BookingComplianceState | null>(null);

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

  // Shared state
  const [step, setStep] = useState<Step>(() =>
    editBooking || isLockedPractitionerFlow || isStaff || initialStep === 'service' ? 'service' : 'mode_choice',
  );
  const [date, setDate] = useState(() => editBooking?.booking_date ?? initialDate ?? todayStr());
  const [catalogStaff, setCatalogStaff] = useState<CatalogPractitioner[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [slotPractitioners, setSlotPractitioners] = useState<SlotPractitioner[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
    /** Unmet warn_staff/warn_client requirements flagged at staff booking time (audit M2). */
    compliance_warnings?: Array<{ compliance_type_name: string }>;
  } | null>(null);

  // Keyed by booking id so host re-renders (new callback identity) don't re-fire the notify.
  const submittedNotifiedIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!createResult?.booking_id) return;
    if (submittedNotifiedIdRef.current === createResult.booking_id) return;
    submittedNotifiedIdRef.current = createResult.booking_id;
    onBookingSubmitted?.();
  }, [createResult, onBookingSubmitted]);

  const [multiServiceSegments, setMultiServiceSegments] = useState<MultiServiceSegment[] | null>(null);
  const [addingExtraService, setAddingExtraService] = useState(false);
  /**
   * Describes what the shared `addons` step is currently configuring:
   * - `primary`: the first/single service (existing flow → practitioner/slot).
   * - `append`: extras for a freshly-picked additional multi-service segment.
   * - `edit`: extras for an existing segment at `segmentIndex`.
   */
  const [addonFlowContext, setAddonFlowContext] = useState<
    | { kind: 'primary' }
    | { kind: 'append'; serviceId: string; variantId?: string | null }
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
  const [appendingServiceId, setAppendingServiceId] = useState<string | null>(null);
  /** Variant id currently being appended (spinner on its option button in the append-variant step). */
  const [appendingVariantId, setAppendingVariantId] = useState<string | null>(null);
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
      setAddingExtraService(false);
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
      } else {
        setStep(isStaff ? 'service' : 'mode_choice');
        setSelectedPractitionerId(null);
      }
    }
    window.addEventListener(APPOINTMENT_BOOKING_RESET_EVENT, onReset);
    return () => window.removeEventListener(APPOINTMENT_BOOKING_RESET_EVENT, onReset);
  }, [lockedPractitioner?.id, lockedPractitioner?.bookingSlug, isStaff, isPublicGuest, accountGate.guestDetailsPrefill?.email]);

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
    }) => {
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
        if (phantomBookings.length > 0) {
          params.set('phantoms', JSON.stringify(phantomBookings));
        }
        if (waitlistOfferEntryId) {
          params.set('waitlist_offer', waitlistOfferEntryId);
        }
        const res = await fetch(bookingAvailabilityUrl(params));
        const data = await res.json();
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
      const data = (await res.json()) as { available_dates?: string[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Failed to load calendar');
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
    fetchAvailability({
      serviceId: svc,
      practitionerId: prac,
      variantId,
      durationMinutes,
      addonIds: isGroup ? groupSelectedAddonIds : selectedAddonIds,
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
    } else if (isLockedPractitionerFlow && step === 'service' && lockedPractitioner?.id) {
      const p = catalogStaff.find((c) => c.id === lockedPractitioner.id);
      if (p) {
        for (const s of p.services) {
          tasks.push({
            practitionerId: p.id,
            serviceId: s.id,
            durationMinutes: staffDurationOverrides[s.id] ?? null,
          });
        }
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
    const key = appointmentCalendarCacheKey(
      prac,
      svc,
      calendarMonth.year,
      calendarMonth.month,
      variantId,
      durationMinutes,
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
          durationMinutes,
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
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
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
    if (step !== 'service' || catalogLoading || isLockedPractitionerFlow || !onlyListedServiceId) return;
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
    onlyListedServiceId,
    staffDurationOverrides,
    catalogStaff,
    calendarMonth,
    prefetchCalendarTasks,
  ]);

  const practitionersForSelectedService = useMemo(() => {
    if (!selectedServiceId) return [];
    return catalogStaff.filter((p) => p.services.some((s) => s.id === selectedServiceId));
  }, [catalogStaff, selectedServiceId]);

  const practitionersForGroupService = useMemo(() => {
    if (!groupServiceId) return [];
    return catalogStaff.filter((p) => p.services.some((s) => s.id === groupServiceId));
  }, [catalogStaff, groupServiceId]);

  const sym = currencySymbolFromCode(venue.currency);

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
   * Combined page: "any available" is only safe when an offering's calendars share the
   * same options (the merged catalog marks this per offering). Otherwise the customer
   * must pick a specific calendar to reach its variants/add-ons.
   */
  const selectedOfferingAnyAvailable = useMemo(() => {
    if (!isCombined || !selectedServiceId) return true;
    for (const p of catalogStaff) {
      const s = p.services.find((x) => x.id === selectedServiceId);
      if (s) return s.any_available !== false;
    }
    return true;
  }, [isCombined, selectedServiceId, catalogStaff]);
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
      };
    },
    [
      selectedServiceId,
      selectedVariantId,
      selectedPractitionerId,
      selectedAddonIds,
      effectiveOfferForBooking,
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
  const groupSlotPrac = slotPractitioners.find((p) => p.id === groupPractitionerId);
  const groupAvailableSlots = dedupeSlotsByStartTime(
    groupSlotPrac?.slots.filter((s) => !groupServiceId || s.service_id === groupServiceId) ?? [],
  );
  const groupSelectedService = uniqueServices.find((s) => s.id === groupServiceId);
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
    async (opts: { serviceId: string; variantId: string | null }) => {
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
        setAddingExtraService(false);
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

      const err = await validateMultiServiceChain([segment], bookingDate);
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
      setMultiServiceSegments([segment]);
      setAddingExtraService(false);
      setError(null);
      setStep('multi_service');
    },
    [
      initialDate,
      initialTime,
      preselectedPractitionerId,
      catalogStaff,
      primeSelectedAppointmentCalendar,
      validateMultiServiceChain,
      staffDurationOverrides,
    ],
  );

  const handlePickAdditionalService = useCallback(
    async (
      serviceId: string,
      addonIds: string[] = [],
      variantId: string | null = null,
    ): Promise<string | null> => {
      if (!visitPractitioner || !multiServiceSegments?.length) return 'Unable to add this service.';
      const baseOffer = visitPractitioner.services.find((s) => s.id === serviceId);
      if (!baseOffer) return 'Service not found.';
      if (multiServiceSegments.length >= 4) {
        setError('You can book up to four services in one visit.');
        return 'You can book up to four services in one visit.';
      }
      // Variant overrides win for duration / buffer / price / deposit, like the primary service.
      const offer = catalogOfferWithVariant(baseOffer, variantId) ?? baseOffer;
      const firstStart = multiServiceSegments[0]!.startTime;
      const nextOnline = onlineChargeFromCatalogOffer(offer);
      const addonInfo = addonSelectionDetails(catalogStaff, serviceId, addonIds, visitPractitioner.id);
      // Full payment rolls add-on price into the online charge; deposits do not.
      const depositWithAddons =
        (nextOnline?.amountPence ?? 0) +
        (nextOnline?.chargeLabel === 'full_payment' ? addonInfo.totalPence : 0);
      const nextSeg: MultiServiceSegment = {
        serviceId: baseOffer.id,
        serviceVariantId: variantId,
        serviceName: baseOffer.name,
        practitionerId: visitPractitioner.id,
        practitionerName: visitPractitioner.name,
        startTime: '00:00',
        durationMinutes: offer.duration_minutes + addonInfo.totalMinutes,
        bufferMinutes: offer.buffer_minutes ?? 0,
        pricePence: offer.price_pence,
        depositPence: depositWithAddons,
        onlineChargeLabel: nextOnline?.chargeLabel,
        addonIds: addonInfo.filteredIds,
        addonTotalPence: addonInfo.totalPence,
        addonTotalMinutes: addonInfo.totalMinutes,
      };
      const chain = recomputeMultiServiceChain([...multiServiceSegments, nextSeg], firstStart);
      setAppendingServiceId(serviceId);
      try {
        const err = await validateMultiServiceChain(chain);
        if (err) {
          setError(err);
          return err;
        }
        setMultiServiceSegments(chain);
        setError(null);
        setAddingExtraService(false);
        return null;
      } finally {
        setAppendingServiceId(null);
      }
    },
    [visitPractitioner, multiServiceSegments, validateMultiServiceChain, catalogStaff],
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
      if (isPublicGuest && bookingCompliance && !bookingCompliance.mandatoryComplete) {
        setError('Please complete the required form(s) above before booking.');
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
        const v = await validateMultiServiceChain(chain);
        if (v) {
          setError(v);
          return;
        }
        setSubmitting(true);
        try {
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
              dietary_notes: details.dietary_notes,
              occasion: details.occasion,
              ...clientAddressPayloadFields(details),
              services: chain.map((s) => ({
                service_id: s.serviceId,
                practitioner_id: s.practitionerId,
                start_time: s.startTime,
                ...(s.serviceVariantId ? { service_variant_id: s.serviceVariantId } : {}),
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
          const require_deposit =
            !isStaffWalkInAppointment &&
            online != null &&
            online.amountPence > 0 &&
            (online.chargeLabel === 'full_payment' || (online.chargeLabel === 'deposit' && staffRequireDeposit));
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
      const res = editBooking.publicAuth
        ? await fetch('/api/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              booking_id: editBooking.id,
              ...editBooking.publicAuth,
              action: 'modify',
              ...body,
            }),
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
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update appointment');
    } finally {
      setSubmitting(false);
    }
  }, [
    date,
    editBooking,
    refundNoticeHours,
    selectedPractitionerId,
    selectedServiceId,
    selectedTime,
  ]);

  const handlePaymentComplete = useCallback(async () => {
    if (createResult?.booking_id) {
      try {
        await fetch(bookingConfirmPaymentUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ booking_id: createResult.booking_id }),
        });
      } catch { /* webhook fallback */ }
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
    setGroupPeople((prev) => [
      ...prev,
      {
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
      },
    ]);
    setGroupServiceId(null);
    setGroupVariantId(null);
    setGroupSelectedAddonIds([]);
    setGroupPractitionerId(null);
    setCurrentPersonLabel('');
    setStep('group_review');
  }

  function removePersonFromGroup(index: number) {
    setGroupPeople((prev) => prev.filter((_, i) => i !== index));
  }

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
    if (isPublicGuest && bookingCompliance && !bookingCompliance.mandatoryComplete) {
      setError('Please complete the required form(s) above before booking.');
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
      });
      const needsStripe = Boolean(data.requires_deposit && data.client_secret);
      setStep(needsStripe ? 'group_payment' : 'group_confirmation');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Group booking failed');
    } finally {
      setSubmitting(false);
    }
  }, [venue.id, groupPeople, refundNoticeHours, isStaff, staffBookingSource, isPublicGuest, accountGate, publicCreateErrorMessage, bookingCompliance]);

  const handleGroupPaymentComplete = useCallback(async () => {
    if (groupCreateResult?.booking_ids?.[0]) {
      try {
        await fetch(bookingConfirmPaymentUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ booking_id: groupCreateResult.booking_ids[0] }),
        });
      } catch { /* webhook fallback */ }
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
  const publicDetailsFieldProps = isPublicGuest
    ? { submitClassName: APPOINTMENT_DETAILS_SUBMIT_CLASS, fieldClassName: APPOINTMENT_DETAILS_INPUT_CLASS }
    : {};

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
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" aria-hidden />
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

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* ════════════════════════════════════════════════
          MODE CHOICE: Book for myself vs Group
          ════════════════════════════════════════════════ */}
      {step === 'mode_choice' && !isLockedPractitionerFlow && !isEdit && !isStaff && (
        <div>
          <AppointmentStepHeader
            title="How would you like to book?"
            description="Choose a single appointment or a group booking for several people."
          />
          <div className="space-y-3">
            <AppointmentChoiceCard
              onClick={() => setStep('service')}
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
          SINGLE BOOKING FLOW (unchanged from before)
          ════════════════════════════════════════════════ */}

      {step === 'service' && (
        <div>
          {!isLockedPractitionerFlow && !isEdit && !isStaff && initialStep !== 'service' && (
            isPublicGuest ? (
              <AppointmentBackLink onClick={() => setStep('mode_choice')} />
            ) : (
              <button type="button" onClick={() => { setStep('mode_choice'); }} className="mb-3 inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
                Back
              </button>
            )
          )}
          {isPublicGuest ? (
            <AppointmentStepHeader
              title="Select a service"
              description={
                isEdit
                  ? 'Choose the service for your changed appointment.'
                  : 'Choose the service you want. You will pick a date and time in a later step.'
              }
            />
          ) : (
            <>
              <h2 className="mb-1 text-lg font-semibold text-slate-900">Select a service</h2>
              <p className="mb-4 text-sm text-slate-500">
                {isEdit
                  ? 'Choose the service for your changed appointment.'
                  : 'Choose the service you want. You will pick a date and time in a later step.'}
              </p>
            </>
          )}
          {catalogLoading ? (
            <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-[72px] animate-pulse rounded-xl bg-slate-100" />)}</div>
          ) : servicesWithFromPrice.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-center">
              <p className="text-sm font-medium text-slate-600">No services are available right now</p>
              <p className="mt-1 text-xs text-slate-400">Try again later or contact the venue.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {servicesWithFromPrice.map((svc) => {
                const serviceVariants = catalogVariantsForServiceId(catalogStaff, svc.id);
                const serviceHasVariants = serviceVariants.length > 0;
                const displayedDuration = staffDurationOverrides[svc.id] ?? svc.duration_minutes;
                const durationIsCustom = displayedDuration !== svc.duration_minutes;
                const staffDurationOverrideForService = staffDurationOverrides[svc.id] ?? null;

                function navigateFromServiceRow() {
                  setDurationPopoverOpenForKey(null);
                  setDurationPopoverServiceId(null);
                  queuePrefetchForServicePractitioners(svc.id, staffDurationOverrideForService);
                  setSelectedServiceId(svc.id);
                  setSelectedVariantId(null);
                  setSelectedAddonIds([]);
                  // Combined page: resolve the calendar (and therefore the venue) BEFORE
                  // variants/add-ons — those live on the chosen calendar's source service.
                  if (isCombined) {
                    setStep('practitioner');
                    return;
                  }
                  if (serviceHasVariants) {
                    setStep('variant');
                    return;
                  }
                  const hasAddonGroups = catalogAddonGroupsForServiceId(catalogStaff, svc.id).length > 0;
                  if (hasAddonGroups) {
                    setStep('addons');
                    return;
                  }
                  if (isEdit) {
                    const existingOrFirst =
                      catalogStaff.find((p) => p.id === selectedPractitionerId && p.services.some((s) => s.id === svc.id)) ??
                      catalogStaff.find((p) => p.services.some((s) => s.id === svc.id));
                    setSelectedPractitionerId(existingOrFirst?.id ?? null);
                    if (existingOrFirst?.id) {
                      primeSelectedAppointmentCalendar(existingOrFirst.id, svc.id, staffDurationOverrideForService);
                      setStep('slot');
                    } else {
                      setStep('practitioner');
                    }
                    return;
                  }
                  if (isLockedPractitionerFlow && selectedPractitionerId) {
                    primeSelectedAppointmentCalendar(selectedPractitionerId, svc.id, staffDurationOverrideForService);
                  }
                  setStep(isLockedPractitionerFlow ? 'slot' : 'practitioner');
                }

                if (!isStaff) {
                  return (
                    <button
                      key={svc.id}
                      type="button"
                      onClick={navigateFromServiceRow}
                      className={choiceCardClass}
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
                          </div>
                          <div className="mt-0.5 text-xs text-slate-500">{svc.duration_minutes} min</div>
                          <ServiceCatalogDescription description={svc.description} />
                        </div>
                        <div className="flex flex-shrink-0 items-center gap-2">
                          <span className={APPOINTMENT_PUBLIC_PRICE}>{formatFromPrice(svc.minPricePence)}</span>
                          <svg className={APPOINTMENT_PUBLIC_CHEVRON_SM} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                          </svg>
                        </div>
                      </div>
                    </button>
                  );
                }

                return (
                  <div key={svc.id} className="relative">
                    <div className="flex w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-all hover:border-brand-300 hover:shadow-md active:scale-[0.99]">
                      <button
                        type="button"
                        onClick={navigateFromServiceRow}
                        className="min-w-0 flex-1 px-4 py-3.5 text-left transition-colors hover:bg-slate-50/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/40"
                      >
                        <div className="font-medium text-slate-900">{svc.name}</div>
                        {serviceHasVariants ? (
                          <div className="mt-0.5 text-xs text-slate-500">From {svc.duration_minutes} min</div>
                        ) : null}
                        <ServiceCatalogDescription description={svc.description} />
                      </button>
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
              })}
            </div>
          )}
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
              if (isCombined) {
                // Calendar-first: variant → calendar (the practitioner step).
                setStep('practitioner');
                return;
              }
              if (isLockedPractitionerFlow) {
                setSelectedServiceId(null);
              }
              setStep('service');
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
                  <button
                    key={variant.id}
                    type="button"
                    onClick={() => {
                      setSelectedVariantId(variant.id);
                      setSelectedAddonIds([]);
                      // Combined page: the calendar is already chosen — add-ons next (its
                      // own), else straight to slots.
                      if (isCombined) {
                        if (serviceHasAddons) {
                          setStep('addons');
                          return;
                        }
                        if (selectedPractitionerId && selectedServiceId) {
                          primeSelectedAppointmentCalendar(selectedPractitionerId, selectedServiceId, primeDuration, variant.id);
                        }
                        setStep('slot');
                        return;
                      }
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
                        void continueStaffCalendarSlotPrefill({ serviceId: selectedServiceId, variantId: variant.id });
                        return;
                      }
                      if (isLockedPractitionerFlow && selectedPractitionerId && selectedServiceId) {
                        primeSelectedAppointmentCalendar(
                          selectedPractitionerId,
                          selectedServiceId,
                          primeDuration,
                          variant.id,
                        );
                      }
                      setStep(isLockedPractitionerFlow ? 'slot' : 'practitioner');
                    }}
                    className={choiceCardClass}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900">{variant.name}</div>
                        <div className="mt-0.5 text-xs text-slate-500">{variant.duration_minutes} min</div>
                        <ServiceCatalogDescription description={variant.description} />
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
                  void continueStaffCalendarSlotPrefill({ serviceId: selectedServiceId, variantId: variant.id });
                  return;
                }
                if (isLockedPractitionerFlow && selectedPractitionerId && selectedServiceId) {
                  primeSelectedAppointmentCalendar(
                    selectedPractitionerId,
                    selectedServiceId,
                    primeDuration,
                    variant.id,
                  );
                }
                setStep(isLockedPractitionerFlow ? 'slot' : 'practitioner');
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
        const addonGroups = addonStepServiceId
          ? catalogAddonGroupsForServiceId(catalogStaff, addonStepServiceId)
          : [];
        const selectedIds = new Set(selectedAddonIds);
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
          setSelectedAddonIds((prev) => {
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
          if (continueDisabled) return;
          if (addonFlowContext.kind === 'append') {
            await handlePickAdditionalService(
              addonFlowContext.serviceId,
              selectedAddonIds,
              addonFlowContext.variantId ?? null,
            );
            setAddonFlowContext({ kind: 'primary' });
            // Restore the buffer to mirror segment 0 (append leaves segment 0 unchanged).
            setSelectedAddonIds(multiServiceSegments?.[0]?.addonIds ?? []);
            setStep('multi_service');
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
            void continueStaffCalendarSlotPrefill({
              serviceId: selectedServiceId,
              variantId: selectedVariantId ?? null,
            });
            return;
          }
          if ((isLockedPractitionerFlow || isCombined) && selectedPractitionerId && selectedServiceId) {
            // Combined page: the calendar is already chosen, so prime it (with the
            // variant/add-on duration) and head straight to slots.
            primeSelectedAppointmentCalendar(
              selectedPractitionerId,
              selectedServiceId,
              staffDurationOverrides[staffDurationOverrideKey(selectedServiceId, selectedVariantId)] ?? null,
              selectedVariantId ?? null,
            );
          }
          setStep(isLockedPractitionerFlow || isCombined ? 'slot' : 'practitioner');
        }
        return (
          <div>
            <button
              type="button"
              onClick={() => {
                if (addonStepIsSegment) {
                  setAddonFlowContext({ kind: 'primary' });
                  setSelectedAddonIds(multiServiceSegments?.[0]?.addonIds ?? []);
                  setStep('multi_service');
                  return;
                }
                setSelectedAddonIds([]);
                if (isCombined) {
                  // Calendar-first: unwind add-ons → variant → calendar (never to service).
                  setStep(serviceHasVariants ? 'variant' : 'practitioner');
                  return;
                }
                setStep(serviceHasVariants ? 'variant' : 'service');
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
                    <legend className="px-1 text-sm font-semibold text-slate-800">{label}</legend>
                    <p className="mt-0.5 text-xs text-slate-500">{optHint}</p>
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
                disabled={continueDisabled}
                className="inline-flex items-center gap-1 rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                Continue
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                </svg>
              </button>
            </div>
          </div>
        );
      })()}

      {step === 'practitioner' && (
        <div>
          <button
            onClick={() => {
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
              <div className="text-sm"><span className="font-medium text-brand-700">{selectedService.name}</span><span className="text-brand-500"> &middot; {serviceSelectionDurationMinutes ?? selectedService.duration_minutes} min &middot; {selectedVariant ? formatPrice(selectedVariant.price_pence) : formatFromPrice(servicesWithFromPrice.find((s) => s.id === selectedService.id)?.minPricePence ?? selectedService.price_pence)}</span></div>
            </div>
          )}
          <h2 className="mb-1 text-lg font-semibold text-slate-900">Who would you like to see?</h2>
          <p className="mb-4 text-sm text-slate-500">
            {isEdit
              ? `Choose the ${terms.staff.toLowerCase()} for your changed appointment.`
              : `Choose your preferred ${terms.staff.toLowerCase()}. Prices shown are what they charge for this service.`}
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
                        staffDurationOverrides[durKey] ?? null,
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
                          staffDurationOverrides[durKey] ?? null,
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
                        <span className={APPOINTMENT_PUBLIC_PRICE}>{formatPrice(offer?.price_pence ?? null)}</span>
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
            <AppointmentBackLink
              onClick={() => {
                setSelectedTime(null);
                setMultiServiceSegments(null);
                if (isCombined) {
                  // Combined page (calendar-first): unwind slot → add-ons → variant → calendar.
                  if (serviceHasAddons) {
                    setStep('addons');
                    return;
                  }
                  if (serviceHasVariants) {
                    setStep('variant');
                    return;
                  }
                  setSelectedPractitionerId(null);
                  setStep('practitioner');
                  return;
                }
                if (isLockedPractitionerFlow) {
                  if (serviceHasVariants) {
                    setStep('variant');
                    return;
                  }
                  setSelectedServiceId(null);
                  setSelectedVariantId(null);
                  setDurationPopoverServiceId(null);
                  setDurationPopoverOpenForKey(null);
                  setStep('service');
                } else {
                  setSelectedPractitionerId(null);
                  setStep('practitioner');
                }
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setSelectedTime(null);
                setMultiServiceSegments(null);
                if (isCombined) {
                  // Combined page (calendar-first): unwind slot → add-ons → variant → calendar.
                  if (serviceHasAddons) {
                    setStep('addons');
                    return;
                  }
                  if (serviceHasVariants) {
                    setStep('variant');
                    return;
                  }
                  setSelectedPractitionerId(null);
                  setStep('practitioner');
                  return;
                }
                if (isLockedPractitionerFlow) {
                  if (serviceHasVariants) {
                    setStep('variant');
                    return;
                  }
                  setSelectedServiceId(null);
                  setSelectedVariantId(null);
                  setDurationPopoverServiceId(null);
                  setDurationPopoverOpenForKey(null);
                  setStep('service');
                } else {
                  setSelectedPractitionerId(null);
                  setStep('practitioner');
                }
              }}
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
                  {selectedService?.name}
                  {selectedVariant ? ` - ${selectedVariant.name}` : ''}
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
                    <span>{effectiveOfferForBooking.duration_minutes} min</span>
                  </>
                ) : null}
              </div>
            </AppointmentSummaryStrip>
          ) : (
            <div className="mb-4 rounded-xl border border-brand-100 bg-brand-50/50 px-4 py-2.5 text-sm">
              <div className="flex items-center gap-2 text-brand-700">
                <span className="font-medium">
                  {selectedService?.name}
                  {selectedVariant ? ` - ${selectedVariant.name}` : ''}
                </span>
                <span className="text-brand-400">&middot;</span>
                <span>{assignedStaffDisplayName || selectedPrac?.name}</span>
                {effectiveOfferForBooking?.duration_minutes ? (
                  <>
                    <span className="text-brand-400">&middot;</span>
                    <span>{effectiveOfferForBooking.duration_minutes} min</span>
                  </>
                ) : null}
              </div>
            </div>
          )}
          <h2 className="mb-1 text-lg font-semibold text-slate-900">Date and time</h2>
          <p className="mb-4 text-sm text-slate-500">Green days have at least one bookable time. Select a day to see times.</p>
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
                  const walkInSegment = buildSegmentFromSlotPick(timeHHmmss.slice(0, 5));
                  setMultiServiceSegments([
                    walkInSegment ?? {
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
                    },
                  ]);
                  setAddingExtraService(false);
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
          ) : availableSlots.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-center">
              <p className="text-sm font-medium text-slate-600">No times available on {formatDateHuman(date)}</p>
              <p className="mt-1 text-xs text-slate-400">Try a different date above.</p>
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
              const segment = buildSegmentFromSlotPick(time);
              if (!segment) return;
              setSelectedTime(time);
              setMultiServiceSegments([segment]);
              setAddingExtraService(false);
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
              setAddingExtraService(false);
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
                <span className="font-medium text-slate-800">{assignedStaffDisplayName}</span>. Add more treatments
                with them (same visit, back-to-back), or continue to your details.
              </>
            ) : (
              <>
                Add more treatments with{' '}
                {visitPractitioner?.name ?? assignedStaffDisplayName ?? terms.staff.toLowerCase()} (same visit,
                back-to-back), or continue to your details.
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
              setAddingExtraService(false);
              setError(null);
              setStep('addons');
            }}
          />
          <div className="mt-4 space-y-3">
            {multiServiceSegments.length < 4 && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setAddingExtraService((v) => !v);
                    setError(null);
                  }}
                  className="w-full rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition-all hover:border-brand-300 hover:text-brand-700"
                >
                  {addingExtraService ? 'Hide service list' : 'Add another service'}
                </button>
                {addingExtraService && visitPractitioner && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                    <p className="mb-2 text-xs font-medium text-slate-500">Choose a service - next start time is calculated automatically.</p>
                    <div className="flex flex-wrap gap-2">
                      {visitPractitioner.services.map((svc) => {
                        const appending = appendingServiceId === svc.id;
                        return (
                        <button
                          key={svc.id}
                          type="button"
                          disabled={appendingServiceId != null}
                          aria-busy={appending}
                          onClick={() => {
                            if (appendingServiceId != null) return;
                            // Offer variants first (if any), then add-ons, mirroring the primary service flow.
                            if (catalogVariantsForServiceId(catalogStaff, svc.id).length > 0) {
                              setAddonFlowContext({ kind: 'append', serviceId: svc.id });
                              setSelectedAddonIds([]);
                              setError(null);
                              setStep('append_variant');
                              return;
                            }
                            if (catalogAddonGroupsForServiceId(catalogStaff, svc.id).length > 0) {
                              setAddonFlowContext({ kind: 'append', serviceId: svc.id });
                              setSelectedAddonIds([]);
                              setAddingExtraService(false);
                              setError(null);
                              setStep('addons');
                              return;
                            }
                            void handlePickAdditionalService(svc.id);
                          }}
                          className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm hover:border-brand-300 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {appending ? (
                            <span
                              className="mr-2 h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-400 border-t-transparent"
                              aria-hidden
                            />
                          ) : null}
                          <span className="font-medium text-slate-900">{svc.name}</span>
                          <span className="ml-2 text-xs text-slate-500">{svc.duration_minutes} min</span>
                        </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
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

      {step === 'append_variant' && addonFlowContext.kind === 'append' && (() => {
        const svcId = addonFlowContext.serviceId;
        const baseOffer = visitPractitioner?.services.find((s) => s.id === svcId) ?? null;
        const variants = catalogVariantsForServiceId(catalogStaff, svcId);
        const hasAddons = catalogAddonGroupsForServiceId(catalogStaff, svcId).length > 0;
        const backToMulti = () => {
          setAddonFlowContext({ kind: 'primary' });
          setError(null);
          setStep('multi_service');
        };
        const pickVariant = async (variantId: string) => {
          if (appendingVariantId != null) return;
          if (hasAddons) {
            setAddonFlowContext({ kind: 'append', serviceId: svcId, variantId });
            setSelectedAddonIds([]);
            setError(null);
            setAddingExtraService(false);
            setStep('addons');
            return;
          }
          // No add-ons: add the service+variant directly, with a spinner while the slot validates.
          setAddingExtraService(false);
          setAppendingVariantId(variantId);
          try {
            const err = await handlePickAdditionalService(svcId, [], variantId);
            if (!err) {
              setAddonFlowContext({ kind: 'primary' });
              setStep('multi_service');
            }
          } finally {
            setAppendingVariantId(null);
          }
        };
        return (
          <div>
            <button
              type="button"
              onClick={backToMulti}
              className="mb-3 inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
              Back
            </button>
            <h2 className="mb-1 text-lg font-semibold text-slate-900">Choose your option</h2>
            <p className="mb-4 text-sm text-slate-500">
              {baseOffer?.name ? `${baseOffer.name} has a few options.` : 'This service has a few options.'} Pick one to add it to your visit.
            </p>
            <div className="space-y-2">
              {variants.map((variant) => {
                const variantBusy = appendingVariantId === variant.id;
                return (
                  <button
                    key={variant.id}
                    type="button"
                    disabled={appendingVariantId != null}
                    aria-busy={variantBusy}
                    onClick={() => void pickVariant(variant.id)}
                    className={`${choiceCardClass} disabled:cursor-not-allowed disabled:opacity-60`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900">{variant.name}</div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          {variant.duration_minutes} min
                          {variant.price_pence != null ? ` · ${formatPrice(variant.price_pence)}` : ''}
                        </div>
                        <ServiceCatalogDescription description={variant.description} />
                      </div>
                      {variantBusy ? (
                        <span
                          className="h-4 w-4 flex-shrink-0 animate-spin rounded-full border-2 border-brand-400 border-t-transparent"
                          aria-hidden
                        />
                      ) : (
                        <svg className={`${APPOINTMENT_PUBLIC_CHEVRON_SM} flex-shrink-0`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                        </svg>
                      )}
                    </div>
                  </button>
                );
              })}
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
                    <span className="font-medium text-slate-900">{effectiveOfferForBooking.duration_minutes} min</span>
                  </div>
                )}
                {effectiveOfferForBooking?.price_pence != null && (
                  <div className="mt-1.5 flex justify-between border-t border-slate-100 pt-1.5">
                    <span className="font-medium text-slate-700">Price</span>
                    <span className="font-semibold text-brand-600">{formatPrice(effectiveOfferForBooking.price_pence)}</span>
                  </div>
                )}
                {(() => {
                  const o = effectiveOfferForBooking
                    ? onlineChargeFromCatalogOffer(effectiveOfferForBooking)
                    : null;
                  if (!o || o.amountPence <= 0) return null;
                  return (
                    <div className="mt-1.5 flex justify-between border-t border-slate-100 pt-1.5">
                      <span className="font-medium text-slate-700">
                        {o.chargeLabel === 'full_payment' ? 'Pay now' : 'Deposit'}
                      </span>
                      <span className="font-semibold text-amber-700">{formatPrice(o.amountPence)}</span>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}
          {isStaff && !(multiServiceSegments && multiServiceSegments.length > 1) && (() => {
            const o = effectiveOfferForBooking
              ? onlineChargeFromCatalogOffer(effectiveOfferForBooking)
              : null;
            if (!o || o.amountPence <= 0) return null;
            if (o.chargeLabel === 'full_payment') {
              return (
                <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Full payment online ({sym}
                  {(o.amountPence / 100).toFixed(2)}) — a payment link will be sent to the client.
                </p>
              );
            }
            return (
              <label className="mb-4 flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={staffRequireDeposit}
                  onChange={(e) => setStaffRequireDeposit(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                <span className="text-sm text-slate-700">
                  Require deposit ({sym}
                  {(o.amountPence / 100).toFixed(2)})
                </span>
              </label>
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
              {isPublicGuest && (
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
                  submittingBooking={submitting}
                  onChange={setBookingCompliance}
                />
              )}
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
              appointmentDepositPence={
                isStaffWalkInAppointment
                  ? null
                  : multiServiceSegments && multiServiceSegments.length > 1
                  ? multiServiceSegments.reduce((sum, s) => sum + (s.depositPence ?? 0), 0)
                  : effectiveOfferForBooking
                    ? onlineChargeFromCatalogOffer(effectiveOfferForBooking)?.amountPence ?? 0
                    : 0
              }
              appointmentChargeLabel={
                multiServiceSegments && multiServiceSegments.length > 1
                  ? multiServiceSegments.every((s) => s.onlineChargeLabel === 'full_payment')
                    ? 'full_payment'
                    : 'deposit'
                  : onlineChargeFromCatalogOffer(effectiveOfferForBooking ?? { price_pence: null, deposit_pence: null })
                        ?.chargeLabel === 'full_payment'
                    ? 'full_payment'
                    : 'deposit'
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
          partySize={1}
          onComplete={handlePaymentComplete}
          onBack={() => setStep('details')}
          cancellationPolicy={singleAppointmentPaymentPolicy}
          summaryMode="total"
          chargeKind={
            multiServiceSegments && multiServiceSegments.length > 1
              ? multiServiceSegments.every((s) => s.onlineChargeLabel === 'full_payment')
                ? 'full_payment'
                : 'deposit'
              : onlineChargeFromCatalogOffer(effectiveOfferForBooking ?? { price_pence: null, deposit_pence: null })
                    ?.chargeLabel === 'full_payment'
                ? 'full_payment'
                : 'deposit'
          }
        />
      )}

      {!isEdit && step === 'confirmation' && (
        <div className="rounded-2xl border border-brand-200 bg-brand-50 p-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-brand-100"><svg className="h-8 w-8 text-brand-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg></div>
          <h2 className="text-xl font-bold text-brand-900">{isEdit ? `${terms.booking} Updated` : `${terms.booking} Confirmed`}</h2>
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
            <p className="mt-3 text-xs text-brand-800">A deposit payment link was sent to the guest.</p>
          ) : null}
          {!isEdit && (createResult?.deposit_amount_pence ?? 0) > 0 ? (
            <p className="mt-4 max-w-sm mx-auto text-left text-xs text-brand-800/90">
              <span className="font-medium">Refund policy:</span>{' '}
              {singleConfirmationDepositCopy ??
                `Full refund if you cancel ≥${createResult?.cancellation_notice_hours ?? refundNoticeHours}h before start (see venue terms).`}
            </p>
          ) : !isEdit && isPublicGuest ? (
            <p className="mt-4 max-w-sm mx-auto text-left text-xs text-brand-800/90">
              No deposit was taken. You can cancel or change this booking at any time before your appointment (subject to the venue&apos;s terms).
            </p>
          ) : null}
          {isStaff && createResult?.compliance_warnings && createResult.compliance_warnings.length > 0 ? (
            <div className="mt-4 max-w-sm mx-auto rounded-lg border border-amber-200 bg-amber-50 p-3 text-left">
              <p className="text-xs font-semibold text-amber-900">Outstanding compliance forms</p>
              <p className="mt-0.5 text-xs text-amber-800">
                The booking is made, but{' '}
                {createResult.compliance_warnings.map((w) => w.compliance_type_name).join(', ')}{' '}
                {createResult.compliance_warnings.length === 1 ? 'is' : 'are'} not on file yet. Collect the record or
                send the form before the appointment.
              </p>
            </div>
          ) : null}
          {isStaff ? <StaffBookingConfirmationFooter onDone={acknowledgeStaffBooking} /> : null}
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
              ? 'Add each person and their service to build your group booking.'
              : `${groupPeople.length} ${groupPeople.length === 1 ? 'person' : 'people'} added. Add more or continue to checkout.`}
          </p>

          {/* Date selector for group */}
          <div className="mb-4 min-w-0">
            <label className="mb-1 block text-xs font-medium text-slate-500 uppercase tracking-wider">Booking date</label>
            <input type="date" value={date} min={todayStr()} onChange={(e) => setDate(e.target.value)} className="w-full min-w-0 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm shadow-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100 focus:outline-none" />
          </div>

          {/* People list */}
          {groupPeople.length > 0 && (
            <div className="mb-4 space-y-2">
              {groupPeople.map((person, idx) => (
                <div key={idx} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900">{person.label}</div>
                      <div className="mt-0.5 text-sm text-slate-600">{person.serviceName} with {person.practitionerName}</div>
                      <div className="mt-0.5 text-xs text-slate-500">{formatDateHuman(person.date)} at {person.time} &middot; {person.durationMinutes} min</div>
                      {person.pricePence != null && <div className="mt-0.5 text-xs font-medium text-brand-600">{formatPrice(person.pricePence)}</div>}
                      {person.addonIds && person.addonIds.length > 0 ? (
                        <ul className="mt-1 space-y-0.5 border-l-2 border-slate-200 pl-2 text-[11px] text-slate-500">
                          {addonSelectionDetails(catalogStaff, person.serviceId, person.addonIds).lines.map((e, i) => (
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
                    <button onClick={() => removePersonFromGroup(idx)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Remove">
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
              {totalGroupDepositPence > 0 && (
                <div className="rounded-xl border border-amber-100 bg-amber-50/60 px-4 py-2.5 text-sm">
                  <div className="flex justify-between">
                    <span className="font-medium text-amber-900">Total deposit due</span>
                    <span className="font-semibold text-amber-900">{formatPrice(totalGroupDepositPence)}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Add person button */}
          {groupPeople.length < 10 && (
            <button
              onClick={() => {
                setCurrentPersonLabel('');
                setGroupServiceId(null);
                setGroupVariantId(null);
                setGroupSelectedAddonIds([]);
                setGroupPractitionerId(null);
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
            onClick={() => setStep('group_service')}
            className="w-full rounded-xl bg-brand-600 px-4 py-3 text-sm font-medium text-white hover:bg-brand-700 shadow-sm disabled:opacity-50"
          >
            Continue
          </button>
        </div>
      )}

      {/* Group: select service */}
      {step === 'group_service' && (
        <div>
          <button onClick={() => setStep('group_person_label')} className="mb-3 inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
            Back
          </button>
          <div className="mb-3 rounded-xl border border-purple-100 bg-purple-50/50 px-4 py-2.5 text-sm text-purple-700 font-medium">
            Booking for: {currentPersonLabel}
          </div>
          <h2 className="mb-1 text-lg font-semibold text-slate-900">Select a service</h2>
          <p className="mb-4 text-sm text-slate-500">What would {currentPersonLabel} like?</p>
          {catalogLoading ? (
            <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-[72px] animate-pulse rounded-xl bg-slate-100" />)}</div>
          ) : servicesWithFromPrice.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-center">
              <p className="text-sm font-medium text-slate-600">No services are available right now</p>
            </div>
          ) : (
            <div className="space-y-2">
              {servicesWithFromPrice.map((svc) => (
                <button
                  key={svc.id}
                  type="button"
                  onClick={() => {
                    queuePrefetchForServicePractitioners(svc.id);
                    setGroupServiceId(svc.id);
                    setGroupVariantId(null);
                    setGroupSelectedAddonIds([]);
                    const hasVariants = catalogVariantsForServiceId(catalogStaff, svc.id).length > 0;
                    const hasAddons = catalogAddonGroupsForServiceId(catalogStaff, svc.id).length > 0;
                    setStep(
                      hasVariants ? 'group_variant' : hasAddons ? 'group_addons' : 'group_practitioner',
                    );
                  }}
                  className={choiceCardClass}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900">{svc.name}</div>
                      <div className="mt-0.5 text-xs text-slate-500">{svc.duration_minutes} min</div>
                      <ServiceCatalogDescription description={svc.description} />
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-2">
                      <span className={APPOINTMENT_PUBLIC_PRICE}>{formatFromPrice(svc.minPricePence)}</span>
                      <svg className={APPOINTMENT_PUBLIC_CHEVRON_SM} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                      </svg>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Group: select variant */}
      {step === 'group_variant' && groupServiceId && (() => {
        const variants = catalogVariantsForServiceId(catalogStaff, groupServiceId);
        const groupHasAddons = catalogAddonGroupsForServiceId(catalogStaff, groupServiceId).length > 0;
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
                    setStep(groupHasAddons ? 'group_addons' : 'group_practitioner');
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
        const addonGroups = catalogAddonGroupsForServiceId(catalogStaff, groupServiceId);
        const groupHasVariants = catalogVariantsForServiceId(catalogStaff, groupServiceId).length > 0;
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
                setStep(groupHasVariants ? 'group_variant' : 'group_service');
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
                    <legend className="px-1 text-sm font-semibold text-slate-800">{label}</legend>
                    <p className="mt-0.5 text-xs text-slate-500">{optHint}</p>
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
                  setStep('group_practitioner');
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
                        <span className="text-sm font-semibold text-brand-600">{formatPrice(offer?.price_pence ?? null)}</span>
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
          <button onClick={() => { setGroupPractitionerId(null); setStep('group_practitioner'); }} className="mb-3 inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
            Back
          </button>
          <div className="mb-3 rounded-xl border border-purple-100 bg-purple-50/50 px-4 py-2.5 text-sm">
            <span className="font-medium text-purple-700">{currentPersonLabel}</span>
            <span className="text-purple-500"> &middot; {groupSelectedService?.name} &middot; {groupSelectedPrac?.name}</span>
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
              {totalGroupDepositPence > 0 && (
                <div className="flex justify-between border-t border-amber-100 pt-2">
                  <span className="font-medium text-amber-900">Total deposit</span>
                  <span className="font-semibold text-amber-800">{formatPrice(totalGroupDepositPence)}</span>
                </div>
              )}
            </div>
          </div>
          {submitting ? (
            <BookingSubmittingPanel variant="appointment" />
          ) : (
            <>
              {isPublicGuest && (
                <BookingComplianceBlock
                  venueId={venue.id}
                  serviceIds={groupPeople.map((p) => p.serviceId)}
                  email={precheckEmail}
                  submittingBooking={submitting}
                  onChange={setBookingCompliance}
                />
              )}
              <DetailsStep
                slot={{ key: 'group', label: 'Group', start_time: groupPeople[0]?.time ?? '', end_time: '', available_covers: 1 }}
                date={groupPeople[0]?.date ?? date}
                partySize={groupPeople.length}
                onSubmit={handleGroupDetailsSubmit}
                onBack={() => setStep('group_review')}
                variant="appointment"
                appointmentDepositPence={totalGroupDepositPence}
                appointmentChargeLabel={
                  groupPeople.length > 0 && groupPeople.every((p) => p.onlineChargeLabel === 'full_payment')
                    ? 'full_payment'
                    : 'deposit'
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
          partySize={groupPeople.length}
          onComplete={handleGroupPaymentComplete}
          onBack={() => setStep('group_details')}
          cancellationPolicy={groupAppointmentPaymentPolicy}
          summaryMode="total"
          chargeKind={
            groupPeople.length > 0 && groupPeople.every((p) => p.onlineChargeLabel === 'full_payment')
              ? 'full_payment'
              : 'deposit'
          }
        />
      )}

      {/* Group: confirmation */}
      {step === 'group_confirmation' && (
        <div className="rounded-2xl border border-brand-200 bg-brand-50 p-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-brand-100">
            <svg className="h-8 w-8 text-brand-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
          </div>
          <h2 className="text-xl font-bold text-brand-900">Group Booking Confirmed</h2>
          <div className="mt-3 space-y-2">
            {groupPeople.map((person, idx) => (
              <div key={idx} className="text-sm text-brand-700">
                <span className="font-medium">{person.label}</span> &mdash; {person.serviceName} with {person.practitionerName} at {person.time}
              </div>
            ))}
          </div>
          <p className="mt-3 text-sm text-brand-600">{formatDateHuman(groupPeople[0]?.date ?? date)}</p>
          {(guestDetails?.email || guestDetails?.phone) ? (
            <p className="mt-3 text-xs text-brand-600">
              A confirmation will be sent to {guestDetails.email || guestDetails.phone}.
            </p>
          ) : null}
          {(groupCreateResult?.total_deposit_pence ?? 0) > 0 ? (
            <p className="mt-4 max-w-md mx-auto text-left text-xs text-brand-800/90">
              <span className="font-medium">Refund policy:</span>{' '}
              {groupConfirmationDepositCopy ??
                `Full refund per appointment if you cancel ≥${groupCreateResult?.cancellation_notice_hours ?? refundNoticeHours}h before each start (see venue terms).`}
            </p>
          ) : isPublicGuest ? (
            <p className="mt-4 max-w-md mx-auto text-left text-xs text-brand-800/90">
              No deposit was taken. You can cancel or change these appointments at any time before they start (subject to the venue&apos;s terms).
            </p>
          ) : null}
          {isStaff ? <StaffBookingConfirmationFooter onDone={acknowledgeStaffBooking} /> : null}
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
