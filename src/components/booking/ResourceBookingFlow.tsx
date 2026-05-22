'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { VenuePublic, GuestDetails } from './types';
import type { ClassPaymentRequirement } from '@/types/booking-models';
import { defaultPhoneCountryForVenueCurrency } from '@/lib/phone/default-country';
import { DetailsStep } from './DetailsStep';
import { BookingSubmittingPanel } from './BookingSubmittingPanel';
import { PaymentStep } from './PaymentStep';
import { ResourceCalendarMonth, todayYmdLocal } from './ResourceCalendarMonth';
import { slotIntervalDurationLabel } from '@/lib/booking/slot-interval-label';
import { formatResourcePricePerSlotLine } from '@/lib/booking/format-price-display';
import { resourceDurationCandidatesMinutes } from '@/lib/availability/resource-booking-engine';
import { currencySymbolFromCode } from '@/lib/money/currency-symbol';
import {
  type BookingFlowAudience,
  resourceOptionsUrl,
  resourceCalendarUrl,
  resourceSlotsUrl,
  bookingCreateUrl,
  bookingConfirmPaymentUrl,
  venueBookingsCreateUrl,
} from '@/lib/booking/booking-flow-api';
import { formatOnlinePaidRefundPolicyLine } from '@/lib/booking/public-deposit-refund-policy';
import { StaffBookingConfirmationFooter } from '@/components/booking/StaffBookingConfirmationFooter';
import { Skeleton } from '@/components/ui/Skeleton';
import { usePublicBookingAccountGateContext } from '@/components/booking/PublicBookingAccountGate';
import type {
  StaffRebookBootstrapPayloadV1,
  StaffRebookGuestPrefill,
} from '@/lib/booking/staff-rebook-bootstrap';
import {
  AppointmentPublicShell,
  AppointmentProgressBar,
  AppointmentStepHeader,
  AppointmentBackLink,
  AppointmentChoiceCard,
  AppointmentSummaryStrip,
  appointmentTimeSlotClass,
  APPOINTMENT_TIME_SLOTS_GRID_CLASS,
  APPOINTMENT_TIME_SLOT_LABEL_CLASS,
  APPOINTMENT_DETAILS_SUBMIT_CLASS,
  APPOINTMENT_PUBLIC_PRICE,
} from './appointment-public-ui';

function resourceProgressPhase(
  step: Step,
): { phase: 0 | 1 | 2; label: string } | null {
  if (step === 'pick_resource') return { phase: 0, label: 'Choose' };
  if (step === 'pick_date' || step === 'pick_duration' || step === 'pick_slot') {
    return { phase: 1, label: 'Schedule' };
  }
  if (step === 'summary' || step === 'details' || step === 'payment') {
    return { phase: 2, label: 'Confirm' };
  }
  return null;
}

function StaffBackLink({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-4 inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-800"
    >
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
      </svg>
      {children}
    </button>
  );
}

function ResourceFlowErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
    >
      {message}
    </div>
  );
}

interface ResourceSlot {
  resource_id: string;
  resource_name: string;
  start_time: string;
  price_per_slot_pence: number | null;
}

interface ResourceOption {
  id: string;
  name: string;
  resource_type: string | null;
  min_booking_minutes: number;
  max_booking_minutes: number;
  slot_interval_minutes: number;
  price_per_slot_pence: number | null;
  payment_requirement: ClassPaymentRequirement;
  deposit_amount_pence: number | null;
  cancellation_notice_hours: number;
}

interface ResourceAvail extends ResourceOption {
  slots: ResourceSlot[];
}

type Step =
  | 'pick_resource'
  | 'pick_date'
  | 'pick_duration'
  | 'pick_slot'
  | 'summary'
  | 'details'
  | 'payment'
  | 'confirmation';

function formatDurationLabel(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/** Compact label for duration grid chips (matches appointment time-slot density). */
function formatDurationSlotLabel(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function resourceCalendarCacheKey(resourceId: string, year: number, month: number): string {
  return `${resourceId}:${year}:${month}`;
}

function mergedStaffRebookGuestPrefill(
  bootstrap?: StaffRebookBootstrapPayloadV1 | null,
  override?: StaffRebookGuestPrefill,
): StaffRebookGuestPrefill | undefined {
  const merged = { ...(bootstrap?.guest ?? {}), ...(override ?? {}) };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function staffRebookResourceInitialDetails(
  guest: StaffRebookGuestPrefill | undefined,
): Partial<GuestDetails> | undefined {
  if (!guest) return undefined;
  return {
    first_name: guest.firstName?.trim() ?? '',
    last_name: guest.lastName?.trim() ?? '',
    email: typeof guest.email === 'string' ? guest.email : '',
    phone: typeof guest.phone === 'string' ? guest.phone : '',
    ...(guest.dietaryNotes?.trim() ? { dietary_notes: guest.dietaryNotes.trim() } : {}),
    ...(guest.occasion?.trim() ? { occasion: guest.occasion.trim() } : {}),
  };
}

export interface ResourceBookingFlowProps {
  venue: VenuePublic;
  cancellationPolicy?: string;
  bookingAudience?: BookingFlowAudience;
  /** Staff dashboard: walk-in vs phone booking source for venue API. */
  staffBookingSource?: 'phone' | 'walk-in';
  onBookingCreated?: () => void;
  /** Dismiss the hosting modal/sheet after staff confirms the success screen. */
  onClose?: () => void;
  /** Staff calendar deep-link: open the standard flow with a resource already selected. */
  initialResourceId?: string;
  initialDate?: string;
  initialTime?: string;
  /** Staff cancel+rebook: source booking id (metadata only; guest prefill comes from bootstrap / guestPrefill). */
  staffRebookFromBookingId?: string;
  /** One-shot staff rebook payload (resource surface) from guest history or modify modal. */
  staffRebookBootstrap?: StaffRebookBootstrapPayloadV1 | null;
  /** Guest fields pre-filled on the details step (merged with staffRebookBootstrap.guest). */
  staffRebookGuestPrefill?: StaffRebookGuestPrefill;
  /** Public embed iframe — passed through to the appointment shell. */
  embed?: boolean;
  accentColour?: string;
}

export function ResourceBookingFlow({
  venue,
  cancellationPolicy,
  bookingAudience = 'public',
  staffBookingSource = 'phone',
  onBookingCreated,
  onClose,
  initialResourceId,
  initialDate,
  initialTime,
  staffRebookFromBookingId,
  staffRebookBootstrap = null,
  staffRebookGuestPrefill,
  embed = false,
  accentColour,
}: ResourceBookingFlowProps) {
  const isStaff = bookingAudience === 'staff';
  const isPublicGuest = !isStaff;
  const accountGate = usePublicBookingAccountGateContext();
  const acknowledgeStaffBooking = useCallback(() => {
    onBookingCreated?.();
    onClose?.();
  }, [onBookingCreated, onClose]);
  const isStaffWalkIn = isStaff && staffBookingSource === 'walk-in';
  const detailsAudience =
    isStaff && staffBookingSource === 'walk-in' ? ('staff_walk_in' as const) : isStaff ? ('staff' as const) : ('public' as const);
  const phoneDefaultCountry = defaultPhoneCountryForVenueCurrency(venue.currency);
  const terms = venue.terminology ?? { client: 'Booker', booking: 'Booking', staff: 'Manager' };

  const [step, setStep] = useState<Step>('pick_resource');
  const advanceToGuestDetails = useCallback(async () => {
    if (isPublicGuest && !(await accountGate.ensureSignedIn())) return;
    setStep('details');
  }, [accountGate, isPublicGuest]);
  useEffect(() => {
    if (!isPublicGuest || step !== 'details') return;
    void accountGate.ensureSignedIn();
  }, [accountGate, isPublicGuest, step]);
  const [duration, setDuration] = useState(60);
  const [resourceOptions, setResourceOptions] = useState<ResourceOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [selectedMeta, setSelectedMeta] = useState<ResourceOption | null>(null);

  const [calendarMonth, setCalendarMonth] = useState(() => {
    const n = new Date();
    return { year: n.getFullYear(), month: n.getMonth() + 1 };
  });
  const [availableDates, setAvailableDates] = useState<Set<string>>(new Set());
  const [loadingCalendar, setLoadingCalendar] = useState(false);
  /** Month availability keyed by `resourceId:year:month` — populated by prefetch after resource list loads and by fetches. */
  const [calendarPrefetchByKey, setCalendarPrefetchByKey] = useState<Map<string, Set<string>>>(() => new Map());
  const calendarPrefetchByKeyRef = useRef(calendarPrefetchByKey);
  calendarPrefetchByKeyRef.current = calendarPrefetchByKey;
  const calendarInFlightRef = useRef<Map<string, Promise<Set<string>>>>(new Map());

  const [date, setDate] = useState('');
  const [selectedResource, setSelectedResource] = useState<ResourceAvail | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);

  const [createResult, setCreateResult] = useState<{
    booking_id: string;
    client_secret?: string;
    stripe_account_id?: string;
    requires_deposit: boolean;
    amount_pence_charged?: number;
    payment_url?: string;
    staffMessage?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const initialSelectionAppliedRef = useRef(false);
  const staffRebookApplyRef = useRef(false);

  const effectiveInitialResourceId =
    initialResourceId ?? staffRebookBootstrap?.resource?.resourceId ?? undefined;

  const staffGuestPrefill = useMemo(
    () => mergedStaffRebookGuestPrefill(staffRebookBootstrap, staffRebookGuestPrefill),
    [staffRebookBootstrap, staffRebookGuestPrefill],
  );

  const staffGuestInitialDetails = useMemo(
    () => staffRebookResourceInitialDetails(staffGuestPrefill),
    [staffGuestPrefill],
  );

  void staffRebookFromBookingId;

  const durationOptions = useMemo(() => {
    if (!selectedMeta) return [];
    return resourceDurationCandidatesMinutes(selectedMeta);
  }, [selectedMeta]);

  useEffect(() => {
    if (!selectedMeta || durationOptions.length === 0) return;
    setDuration((d) => (durationOptions.includes(d) ? d : durationOptions[0]!));
  }, [selectedMeta, durationOptions]);

  useEffect(() => {
    if (initialSelectionAppliedRef.current || !effectiveInitialResourceId || resourceOptions.length === 0) return;

    const resource = resourceOptions.find((r) => r.id === effectiveInitialResourceId);
    if (!resource) return;

    const options = resourceDurationCandidatesMinutes(resource);
    const bootstrapDuration = staffRebookBootstrap?.resource?.durationMinutes;
    const nextDuration =
      bootstrapDuration != null && options.includes(bootstrapDuration)
        ? bootstrapDuration
        : options[0] ?? resource.min_booking_minutes;
    const initialMonthDate = initialDate ? new Date(`${initialDate}T12:00:00`) : new Date();
    const prefilledTime = initialTime?.trim().slice(0, 5) ?? null;
    const initialStep: Step = initialDate ? 'pick_duration' : 'pick_date';

    initialSelectionAppliedRef.current = true;
    staffRebookApplyRef.current = true;
    setError(null);
    setSelectedMeta(resource);
    setCalendarMonth({
      year: initialMonthDate.getFullYear(),
      month: initialMonthDate.getMonth() + 1,
    });
    setDate(initialDate ?? '');
    setDuration(nextDuration);
    setSelectedTime(prefilledTime);
    setSelectedResource(null);
    setStep(initialStep);
  }, [effectiveInitialResourceId, initialDate, initialTime, resourceOptions, staffRebookBootstrap?.resource?.durationMinutes]);

  useEffect(() => {
    if (
      staffRebookApplyRef.current ||
      !isStaff ||
      !staffRebookBootstrap?.resource ||
      resourceOptions.length === 0 ||
      effectiveInitialResourceId
    ) {
      return;
    }

    const resource = resourceOptions.find((r) => r.id === staffRebookBootstrap.resource!.resourceId);
    if (!resource) {
      staffRebookApplyRef.current = true;
      setError('Could not reopen this resource booking in the picker. Choose a resource and time.');
      return;
    }

    const options = resourceDurationCandidatesMinutes(resource);
    const bootstrapDuration = staffRebookBootstrap.resource.durationMinutes;
    const nextDuration =
      bootstrapDuration != null && options.includes(bootstrapDuration)
        ? bootstrapDuration
        : options[0] ?? resource.min_booking_minutes;

    staffRebookApplyRef.current = true;
    initialSelectionAppliedRef.current = true;
    setError(null);
    setSelectedMeta(resource);
    setDuration(nextDuration);
    setSelectedResource(null);
    setSelectedTime(null);
    setDate('');
    setStep('pick_date');
  }, [effectiveInitialResourceId, isStaff, resourceOptions, staffRebookBootstrap]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingOptions(true);
      try {
        const res = await fetch(resourceOptionsUrl(bookingAudience, venue.id));
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error ?? 'Failed to load resources');
        setResourceOptions(data.resources ?? []);
      } catch {
        if (!cancelled) setError('We couldn’t load resources. Please refresh and try again.');
      } finally {
        if (!cancelled) setLoadingOptions(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [venue.id, bookingAudience]);

  const loadResourceCalendarMonth = useCallback(
    (resourceId: string, year: number, month: number): Promise<Set<string>> => {
      const key = resourceCalendarCacheKey(resourceId, year, month);
      const cached = calendarPrefetchByKeyRef.current.get(key);
      if (cached) return Promise.resolve(cached);

      const inFlight = calendarInFlightRef.current.get(key);
      if (inFlight) return inFlight;

      const promise = fetch(resourceCalendarUrl(bookingAudience, venue.id, resourceId, year, month, 'any'))
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? 'Failed to load calendar');
          return new Set((data.available_dates ?? []) as string[]);
        })
        .then((nextSet) => {
          setCalendarPrefetchByKey((prev) => {
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
    [bookingAudience, venue.id],
  );

  const cachedMonthForSelection = useMemo(() => {
    if (!selectedMeta) return undefined;
    return calendarPrefetchByKey.get(
      resourceCalendarCacheKey(selectedMeta.id, calendarMonth.year, calendarMonth.month),
    );
  }, [calendarPrefetchByKey, selectedMeta, calendarMonth.year, calendarMonth.month]);

  useEffect(() => {
    if (step !== 'pick_date' || !selectedMeta) return;
    if (cachedMonthForSelection !== undefined) {
      setAvailableDates(new Set(cachedMonthForSelection));
      setLoadingCalendar(false);
      return;
    }

    let cancelled = false;

    (async () => {
      setLoadingCalendar(true);
      try {
        const nextSet = await loadResourceCalendarMonth(selectedMeta.id, calendarMonth.year, calendarMonth.month);
        if (cancelled) return;
        setAvailableDates(nextSet);
      } catch (_e) {
        if (cancelled) return;
        setAvailableDates(new Set());
        setError('Couldn’t load availability for this month. Try again or pick another month.');
      } finally {
        if (!cancelled) setLoadingCalendar(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    step,
    selectedMeta,
    calendarMonth.year,
    calendarMonth.month,
    cachedMonthForSelection,
    loadResourceCalendarMonth,
  ]);

  useEffect(() => {
    if (step !== 'pick_date' || !date) return;
    const [y, m] = date.split('-').map(Number);
    if (y !== calendarMonth.year || m !== calendarMonth.month) {
      setDate('');
    }
  }, [step, calendarMonth.year, calendarMonth.month, date]);

  useEffect(() => {
    if (step !== 'pick_slot' && step !== 'summary' && step !== 'details' && step !== 'payment') return;
    if (!selectedMeta || !date) return;
    let cancelled = false;
    (async () => {
      setLoadingSlots(true);
      try {
        const url = resourceSlotsUrl(bookingAudience, venue.id, date, duration, selectedMeta.id);
        const res = await fetch(url);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error ?? 'Failed to load times');
        const r = (data.resources ?? []).find((x: ResourceAvail) => x.id === selectedMeta.id) as
          | ResourceAvail
          | undefined;
        setSelectedResource(r ?? null);
      } catch {
        if (!cancelled) {
          setSelectedResource(null);
          setError('No start times are available right now. Try another duration or date.');
        }
      } finally {
        if (!cancelled) setLoadingSlots(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step, venue.id, date, duration, selectedMeta, bookingAudience]);

  useEffect(() => {
    if (step !== 'pick_slot' || !selectedTime || loadingSlots || !selectedResource) return;
    const hasPrefilledSlot = selectedResource.slots.some((s) => s.start_time === selectedTime);
    if (hasPrefilledSlot) {
      setStep('summary');
    }
  }, [step, selectedTime, loadingSlots, selectedResource]);

  function computeEndTime(start: string, mins: number): string {
    const [h, m] = start.split(':').map(Number);
    const totalMins = h! * 60 + m! + mins;
    const eh = Math.floor(totalMins / 60) % 24;
    const em = totalMins % 60;
    return `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
  }

  const priceBasis = selectedResource ?? selectedMeta;
  const numSlotsCalc = priceBasis ? Math.ceil(duration / priceBasis.slot_interval_minutes) : 1;
  const totalPricePence = (priceBasis?.price_per_slot_pence ?? 0) * numSlotsCalc;
  const payReq = priceBasis?.payment_requirement ?? 'none';
  const onlineChargePence = useMemo(() => {
    if (isStaffWalkIn) return 0;
    if (!priceBasis) return 0;
    const req = priceBasis.payment_requirement ?? 'none';
    const n = Math.ceil(duration / priceBasis.slot_interval_minutes);
    const total = (priceBasis.price_per_slot_pence ?? 0) * n;
    if (req === 'full_payment' && total > 0) return total;
    if (req === 'deposit' && (priceBasis.deposit_amount_pence ?? 0) > 0) return priceBasis.deposit_amount_pence ?? 0;
    return 0;
  }, [priceBasis, duration, isStaffWalkIn]);

  const resourceRefundNoticeHours = useMemo(() => {
    const basis = selectedResource ?? selectedMeta;
    const h = basis?.cancellation_notice_hours;
    if (typeof h === 'number' && Number.isFinite(h)) return h;
    return venue.booking_rules?.cancellation_notice_hours ?? 48;
  }, [selectedResource, selectedMeta, venue.booking_rules?.cancellation_notice_hours]);

  const resourcePaymentRefundPolicy = useMemo(() => {
    if (cancellationPolicy) return cancellationPolicy;
    return formatOnlinePaidRefundPolicyLine(resourceRefundNoticeHours);
  }, [cancellationPolicy, resourceRefundNoticeHours]);

  const resourcePriceSummary = useMemo(() => {
    const sym = currencySymbolFromCode(venue.currency);
    if (totalPricePence <= 0) {
      return { primary: 'Free', secondary: null as string | null };
    }
    if (!isStaffWalkIn && payReq === 'full_payment') {
      return {
        primary: `${sym}${(totalPricePence / 100).toFixed(2)} due now (paid online in full)`,
        secondary: null,
      };
    }
    if (!isStaffWalkIn && payReq === 'deposit' && onlineChargePence > 0) {
      return {
        primary: `${sym}${(onlineChargePence / 100).toFixed(2)} deposit due now online`,
        secondary:
          totalPricePence > onlineChargePence
            ? `Total for this booking: ${sym}${(totalPricePence / 100).toFixed(2)} (remainder at venue)`
            : null,
      };
    }
    return {
      primary: `${sym}${(totalPricePence / 100).toFixed(2)} (pay at venue)`,
      secondary: null,
    };
  }, [totalPricePence, payReq, onlineChargePence, venue.currency, isStaffWalkIn]);

  const handleDetailsSubmit = useCallback(
    async (details: GuestDetails) => {
      setError(null);
      const resourceId = selectedResource?.id ?? selectedMeta?.id;
      if (!resourceId || !selectedTime) return;
      if (isPublicGuest) {
        const emailError = accountGate.validateGuestEmail(details.email);
        if (emailError) {
          setError(emailError);
          return;
        }
      }
      const endTime = computeEndTime(selectedTime, duration);
      setSubmitting(true);
      try {
        if (isStaff) {
          const res = await fetch(venueBookingsCreateUrl(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              booking_date: date,
              booking_time: selectedTime,
              booking_end_time: endTime,
              party_size: 1,
              first_name: details.first_name,
              last_name: details.last_name,
              phone: details.phone?.trim() || undefined,
              email: details.email || undefined,
              dietary_notes: details.dietary_notes || undefined,
              resource_id: resourceId,
              source: staffBookingSource,
              ...(details.returning_guest ? { returning_guest: true } : {}),
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? 'Booking failed');
          setCreateResult({
            booking_id: data.booking_id,
            payment_url: data.payment_url,
            staffMessage: typeof data.message === 'string' ? data.message : undefined,
            requires_deposit: Boolean(data.payment_url),
            amount_pence_charged: onlineChargePence,
          });
          setStep('confirmation');
          return;
        }

        const res = await fetch(bookingCreateUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            venue_id: venue.id,
            booking_date: date,
            booking_time: selectedTime,
            booking_end_time: endTime,
            party_size: 1,
            first_name: details.first_name,
              last_name: details.last_name,
            email: details.email || undefined,
            phone: details.phone,
            source: 'booking_page',
            resource_id: resourceId,
            marketing_consent: details.marketing_consent,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (isPublicGuest && accountGate.handleCreateResponseError(res.status, data.error)) {
            setError('Sign in is required to book this venue.');
            return;
          }
          throw new Error(data.error ?? 'Booking failed');
        }
        const charged = typeof data.deposit_amount_pence === 'number' ? data.deposit_amount_pence : onlineChargePence;
        setCreateResult({
          booking_id: data.booking_id,
          client_secret: data.client_secret,
          stripe_account_id: data.stripe_account_id,
          requires_deposit: data.requires_deposit ?? false,
          amount_pence_charged: charged,
        });
        setStep(data.requires_deposit && data.client_secret ? 'payment' : 'confirmation');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Booking failed');
      } finally {
        setSubmitting(false);
      }
    },
    [
      venue.id,
      date,
      selectedTime,
      selectedResource?.id,
      selectedMeta?.id,
      duration,
      onlineChargePence,
      isStaff,
      isPublicGuest,
      accountGate,
      staffBookingSource,
    ],
  );

  const handlePaymentComplete = useCallback(async () => {
    if (createResult?.booking_id) {
      try {
        await fetch(bookingConfirmPaymentUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ booking_id: createResult.booking_id }),
        });
      } catch {
        /* webhook fallback */
      }
    }
    setStep('confirmation');
  }, [createResult?.booking_id]);

  function selectResource(r: ResourceOption) {
    setError(null);
    setSelectedMeta(r);
    const n = new Date();
    const nextMonth = { year: n.getFullYear(), month: n.getMonth() + 1 };
    setCalendarMonth(nextMonth);
    setDate('');
    setSelectedTime(null);
    setSelectedResource(null);
    void loadResourceCalendarMonth(r.id, nextMonth.year, nextMonth.month).catch(() => {
      /* The mounted calendar effect will show the error state if the priority load fails. */
    });
    setStep('pick_date');
  }

  function onCalendarSelectDay(ymd: string) {
    setError(null);
    setDate(ymd);
    setSelectedTime(null);
    setSelectedResource(null);
    setStep('pick_duration');
  }

  function goPrevMonth() {
    setCalendarMonth((cm) => {
      if (cm.month <= 1) return { year: cm.year - 1, month: 12 };
      return { year: cm.year, month: cm.month - 1 };
    });
  }

  function goNextMonth() {
    setCalendarMonth((cm) => {
      if (cm.month >= 12) return { year: cm.year + 1, month: 1 };
      return { year: cm.year, month: cm.month + 1 };
    });
  }

  const minYmd = todayYmdLocal();
  const progressMeta = isPublicGuest ? resourceProgressPhase(step) : null;
  const primaryContinueClass = isPublicGuest
    ? APPOINTMENT_DETAILS_SUBMIT_CLASS
    : 'w-full min-h-11 rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-50';

  const flowContent = (
    <div className={isPublicGuest ? undefined : 'mx-auto max-w-lg'}>
      {error ? <ResourceFlowErrorBanner message={error} /> : null}

      {step === 'pick_resource' && (
        <div>
          {isPublicGuest ? (
            <AppointmentStepHeader
              title="Book a resource"
              description="Choose a resource, then pick a date, how long you need it, and a start time."
            />
          ) : (
            <>
              <h2 className="mb-2 text-lg font-semibold text-slate-900">Book a resource</h2>
              <p className="mb-4 text-sm leading-relaxed text-slate-600">
                Choose a resource, then pick a date, duration, and start time.
              </p>
            </>
          )}
          {loadingOptions ? (
            <div className="space-y-3" role="status" aria-label="Loading resources">
              {[1, 2, 3].map((i) => (
                <Skeleton.Block key={i} className="h-[4.5rem]" />
              ))}
            </div>
          ) : resourceOptions.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-6 py-8 text-center">
              <p className="text-sm font-medium text-slate-700">No resources available right now</p>
              <p className="mt-1.5 text-sm text-slate-500">Please contact the venue for help booking.</p>
            </div>
          ) : isPublicGuest ? (
            <div className="space-y-3">
              {resourceOptions.map((r) => (
                <AppointmentChoiceCard
                  key={r.id}
                  onClick={() => selectResource(r)}
                  title={r.name}
                  description={
                    [
                      r.resource_type,
                      formatResourcePricePerSlotLine(
                        r.price_per_slot_pence,
                        currencySymbolFromCode(venue.currency),
                        slotIntervalDurationLabel(r.slot_interval_minutes),
                      ),
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  }
                  icon={
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" />
                    </svg>
                  }
                />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {resourceOptions.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => selectResource(r)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-4 text-left shadow-sm transition hover:border-brand-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900">{r.name}</div>
                      {r.resource_type ? <div className="mt-0.5 text-xs text-slate-500">{r.resource_type}</div> : null}
                    </div>
                    <div className="shrink-0 text-right text-sm font-medium text-brand-600">
                      {formatResourcePricePerSlotLine(
                        r.price_per_slot_pence,
                        currencySymbolFromCode(venue.currency),
                        slotIntervalDurationLabel(r.slot_interval_minutes),
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {step === 'pick_date' && selectedMeta && (
        <div>
          {isPublicGuest ? (
            <AppointmentBackLink onClick={() => { setSelectedMeta(null); setStep('pick_resource'); }}>
              Back to resources
            </AppointmentBackLink>
          ) : (
            <StaffBackLink onClick={() => { setSelectedMeta(null); setStep('pick_resource'); }}>
              Back to resources
            </StaffBackLink>
          )}
          {isPublicGuest ? (
            <AppointmentStepHeader
              title={selectedMeta.name}
              description="Green days have at least one bookable slot. Select a day to choose duration and time."
            />
          ) : (
            <>
              <h2 className="mb-1 text-lg font-semibold text-slate-900">{selectedMeta.name}</h2>
              <p className="mb-4 text-sm text-slate-600">
                Green days have availability. Select a day to choose duration and time.
              </p>
            </>
          )}
          <ResourceCalendarMonth
            year={calendarMonth.year}
            month={calendarMonth.month}
            availableDates={availableDates}
            selectedDate={date || null}
            onSelectDate={onCalendarSelectDay}
            onPrevMonth={goPrevMonth}
            onNextMonth={goNextMonth}
            minSelectableDate={minYmd}
            loading={loadingCalendar}
            accentPublic={isPublicGuest}
          />
        </div>
      )}

      {step === 'pick_duration' && selectedMeta && date && (
        <div>
          {isPublicGuest ? (
            <AppointmentBackLink onClick={() => { setDate(''); setStep('pick_date'); }}>
              Back to calendar
            </AppointmentBackLink>
          ) : (
            <StaffBackLink onClick={() => { setDate(''); setStep('pick_date'); }}>
              Back to calendar
            </StaffBackLink>
          )}
          {isPublicGuest ? (
            <AppointmentStepHeader
              title="How long do you need it?"
              description={`${selectedMeta.name} · ${date}`}
            />
          ) : (
            <>
              <h2 className="mb-1 text-lg font-semibold text-slate-900">How long?</h2>
              <p className="mb-4 text-sm text-slate-500">
                {selectedMeta.name} · {date}
              </p>
            </>
          )}
          <div className={APPOINTMENT_TIME_SLOTS_GRID_CLASS}>
            {durationOptions.map((mins) => (
              <button
                key={mins}
                type="button"
                onClick={() => {
                  setDuration(mins);
                  setStep('pick_slot');
                }}
                className={appointmentTimeSlotClass(duration === mins, isPublicGuest)}
                aria-pressed={duration === mins}
              >
                <span className={APPOINTMENT_TIME_SLOT_LABEL_CLASS}>{formatDurationSlotLabel(mins)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 'pick_slot' && selectedMeta && (
        <div>
          {isPublicGuest ? (
            <AppointmentBackLink onClick={() => { setSelectedTime(null); setStep('pick_duration'); }}>
              Back to duration
            </AppointmentBackLink>
          ) : (
            <StaffBackLink onClick={() => { setSelectedTime(null); setStep('pick_duration'); }}>
              Back to duration
            </StaffBackLink>
          )}
          {isPublicGuest ? (
            <AppointmentStepHeader
              title="Choose a start time"
              description={`${selectedMeta.name} · ${date} · ${formatDurationLabel(duration)}`}
            />
          ) : (
            <>
              <h2 className="mb-1 text-lg font-semibold text-slate-900">Choose a start time</h2>
              <p className="mb-4 text-sm text-slate-500">
                {selectedMeta.name} · {date} · {formatDurationLabel(duration)}
              </p>
            </>
          )}
          {loadingSlots ? (
            <div className="space-y-2" role="status" aria-label="Loading times">
              <Skeleton.Block className="h-12" />
              <Skeleton.Block className="h-12" />
              <Skeleton.Block className="h-12 w-2/3" />
            </div>
          ) : !selectedResource || selectedResource.slots.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-6 text-center">
              <p className="text-sm font-medium text-slate-700">No times available</p>
              <p className="mt-1.5 text-sm text-slate-500">
                Try another duration or pick a different day.
              </p>
            </div>
          ) : (
            <div className={APPOINTMENT_TIME_SLOTS_GRID_CLASS}>
              {selectedResource.slots.map((slot) => (
                <button
                  key={slot.start_time}
                  type="button"
                  onClick={() => {
                    setSelectedTime(slot.start_time);
                    setError(null);
                    setStep('summary');
                  }}
                  className={appointmentTimeSlotClass(false, isPublicGuest)}
                >
                  <span className={APPOINTMENT_TIME_SLOT_LABEL_CLASS}>{slot.start_time}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {step === 'summary' && selectedTime && selectedMeta && (
        <div>
          {isPublicGuest ? (
            <AppointmentBackLink onClick={() => setStep('pick_slot')}>Back to times</AppointmentBackLink>
          ) : (
            <StaffBackLink onClick={() => setStep('pick_slot')}>Back to times</StaffBackLink>
          )}
          {isPublicGuest ? (
            <AppointmentStepHeader title="Review your booking" />
          ) : (
            <h2 className="mb-4 text-lg font-semibold text-slate-900">Your selection</h2>
          )}
          {isPublicGuest ? (
            <AppointmentSummaryStrip>
              <div className="font-medium text-slate-900">{selectedMeta.name}</div>
              <div className="mt-1 text-slate-600">
                {date} · {selectedTime} – {computeEndTime(selectedTime, duration)} ({formatDurationLabel(duration)})
              </div>
              {totalPricePence <= 0 ? (
                <div className={`mt-2 ${APPOINTMENT_PUBLIC_PRICE}`}>Free</div>
              ) : (
                <div className="mt-2 space-y-1">
                  <div className={APPOINTMENT_PUBLIC_PRICE}>{resourcePriceSummary.primary}</div>
                  {resourcePriceSummary.secondary ? (
                    <div className="text-xs text-slate-600">{resourcePriceSummary.secondary}</div>
                  ) : null}
                </div>
              )}
            </AppointmentSummaryStrip>
          ) : (
            <div className="mb-6 space-y-2 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
              <div className="font-medium text-slate-900">{selectedMeta.name}</div>
              <div className="text-slate-600">
                {date} · {selectedTime} – {computeEndTime(selectedTime, duration)} ({formatDurationLabel(duration)})
              </div>
              {totalPricePence <= 0 ? (
                <div className="font-medium text-brand-600">Free</div>
              ) : (
                <div className="space-y-1">
                  <div className="font-medium text-brand-600">{resourcePriceSummary.primary}</div>
                  {resourcePriceSummary.secondary ? (
                    <div className="text-xs text-slate-600">{resourcePriceSummary.secondary}</div>
                  ) : null}
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={() => void advanceToGuestDetails()}
            className={primaryContinueClass}
          >
            Continue to guest details
          </button>
        </div>
      )}

      {step === 'details' && selectedTime && (
        <div>
          {isPublicGuest ? (
            <AppointmentBackLink onClick={() => setStep('summary')}>Back to summary</AppointmentBackLink>
          ) : (
            <StaffBackLink onClick={() => setStep('summary')}>Back to summary</StaffBackLink>
          )}
          {isPublicGuest ? (
            <AppointmentSummaryStrip>
              <div className="font-medium text-slate-900">{selectedResource?.name ?? selectedMeta?.name}</div>
              <div className="mt-1 text-slate-500">
                {date} · {selectedTime} – {computeEndTime(selectedTime, duration)}
              </div>
              {totalPricePence <= 0 ? (
                <div className={`mt-2 ${APPOINTMENT_PUBLIC_PRICE}`}>Free</div>
              ) : (
                <div className="mt-2 space-y-1">
                  <div className={APPOINTMENT_PUBLIC_PRICE}>{resourcePriceSummary.primary}</div>
                  {resourcePriceSummary.secondary ? (
                    <div className="text-xs text-slate-600">{resourcePriceSummary.secondary}</div>
                  ) : null}
                </div>
              )}
            </AppointmentSummaryStrip>
          ) : (
            <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
              <div className="font-medium text-slate-900">{selectedResource?.name ?? selectedMeta?.name}</div>
              <div className="text-slate-500">
                {date} · {selectedTime} – {computeEndTime(selectedTime, duration)}
              </div>
              {totalPricePence <= 0 ? (
                <div className="mt-1 font-medium text-brand-600">Free</div>
              ) : (
                <div className="mt-1 space-y-1">
                  <div className="font-medium text-brand-600">{resourcePriceSummary.primary}</div>
                  {resourcePriceSummary.secondary ? (
                    <div className="text-xs text-slate-600">{resourcePriceSummary.secondary}</div>
                  ) : null}
                </div>
              )}
            </div>
          )}
          {submitting ? (
            <BookingSubmittingPanel variant="resource" />
          ) : (
            <DetailsStep
              slot={{
                key: selectedTime,
                label: selectedTime,
                start_time: selectedTime,
                end_time: computeEndTime(selectedTime, duration),
                available_covers: 1,
              }}
              date={date}
              partySize={1}
              onSubmit={handleDetailsSubmit}
              onBack={() => setStep('summary')}
              requiresDeposit={false}
              variant="appointment"
              appointmentDepositPence={isStaffWalkIn ? null : onlineChargePence > 0 ? onlineChargePence : null}
              appointmentChargeLabel={payReq === 'full_payment' ? 'full_payment' : 'deposit'}
              payAtVenueBalancePence={(isStaffWalkIn || payReq === 'none') && totalPricePence > 0 ? totalPricePence : null}
              payAtVenuePaymentRequirement={isStaffWalkIn || payReq === 'none' ? 'none' : undefined}
              currencySymbol={currencySymbolFromCode(venue.currency)}
              refundNoticeHours={resourceRefundNoticeHours}
              phoneDefaultCountry={phoneDefaultCountry}
              audience={detailsAudience}
              initialDetails={
                isPublicGuest ? accountGate.guestDetailsPrefill : staffGuestInitialDetails
              }
              emailReadOnly={isPublicGuest && accountGate.emailReadOnly}
            />
          )}
        </div>
      )}

      {step === 'payment' && createResult?.client_secret && (
        <PaymentStep
          clientSecret={createResult.client_secret}
          stripeAccountId={createResult.stripe_account_id}
          amountPence={createResult.amount_pence_charged ?? onlineChargePence}
          partySize={1}
          onComplete={handlePaymentComplete}
          onBack={() => setStep('details')}
          cancellationPolicy={resourcePaymentRefundPolicy}
          chargeKind={payReq === 'full_payment' ? 'full_payment' : 'deposit'}
        />
      )}

      {step === 'confirmation' && (
        <div className="rounded-2xl border border-green-200 bg-green-50 p-6 text-center sm:p-8">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100 sm:h-16 sm:w-16">
            <svg className="h-7 w-7 text-green-600 sm:h-8 sm:w-8" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-green-900">{terms.booking} confirmed</h2>
          {isStaff && createResult?.payment_url ? (
            <p className="mt-3 text-sm leading-relaxed text-green-800">
              Deposit link sent to the guest.{createResult.staffMessage ? ` ${createResult.staffMessage}` : ''}
            </p>
          ) : null}
          <p className="mt-2 text-sm leading-relaxed text-green-700">
            {selectedResource?.name ?? selectedMeta?.name}
            <br />
            {date} · {selectedTime} – {selectedTime ? computeEndTime(selectedTime, duration) : ''}
          </p>
          {isStaff ? <StaffBookingConfirmationFooter onDone={acknowledgeStaffBooking} /> : null}
        </div>
      )}
    </div>
  );

  if (isPublicGuest) {
    return (
      <AppointmentPublicShell accentColour={accentColour} embed={embed}>
        {progressMeta ? <AppointmentProgressBar phase={progressMeta.phase} /> : null}
        {flowContent}
      </AppointmentPublicShell>
    );
  }

  return flowContent;
}
