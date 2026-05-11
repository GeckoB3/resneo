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

function resourceCalendarCacheKey(resourceId: string, year: number, month: number): string {
  return `${resourceId}:${year}:${month}`;
}

export interface ResourceBookingFlowProps {
  venue: VenuePublic;
  cancellationPolicy?: string;
  bookingAudience?: BookingFlowAudience;
  /** Staff dashboard: walk-in vs phone booking source for venue API. */
  staffBookingSource?: 'phone' | 'walk-in';
  onBookingCreated?: () => void;
  /** Staff calendar deep-link: open the standard flow with a resource already selected. */
  initialResourceId?: string;
  initialDate?: string;
  initialTime?: string;
}

export function ResourceBookingFlow({
  venue,
  cancellationPolicy,
  bookingAudience = 'public',
  staffBookingSource = 'phone',
  onBookingCreated,
  initialResourceId,
  initialDate,
  initialTime,
}: ResourceBookingFlowProps) {
  const isStaff = bookingAudience === 'staff';
  const isStaffWalkIn = isStaff && staffBookingSource === 'walk-in';
  const detailsAudience =
    isStaff && staffBookingSource === 'walk-in' ? ('staff_walk_in' as const) : isStaff ? ('staff' as const) : ('public' as const);
  const phoneDefaultCountry = defaultPhoneCountryForVenueCurrency(venue.currency);
  const terms = venue.terminology ?? { client: 'Booker', booking: 'Booking', staff: 'Manager' };

  const [step, setStep] = useState<Step>('pick_resource');
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

  const durationOptions = useMemo(() => {
    if (!selectedMeta) return [];
    return resourceDurationCandidatesMinutes(selectedMeta);
  }, [selectedMeta]);

  useEffect(() => {
    if (!selectedMeta || durationOptions.length === 0) return;
    setDuration((d) => (durationOptions.includes(d) ? d : durationOptions[0]!));
  }, [selectedMeta, durationOptions]);

  useEffect(() => {
    if (initialSelectionAppliedRef.current || !initialResourceId || resourceOptions.length === 0) return;

    const resource = resourceOptions.find((r) => r.id === initialResourceId);
    if (!resource) return;

    const options = resourceDurationCandidatesMinutes(resource);
    const nextDuration = options[0] ?? resource.min_booking_minutes;
    const initialMonthDate = initialDate ? new Date(`${initialDate}T12:00:00`) : new Date();
    const initialStep: Step = initialDate ? 'pick_duration' : 'pick_date';

    initialSelectionAppliedRef.current = true;
    setError(null);
    setSelectedMeta(resource);
    setCalendarMonth({
      year: initialMonthDate.getFullYear(),
      month: initialMonthDate.getMonth() + 1,
    });
    setDate(initialDate ?? '');
    setDuration(nextDuration);
    setSelectedTime(null);
    setSelectedResource(null);
    setStep(initialStep);
  }, [initialDate, initialResourceId, initialTime, resourceOptions]);

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
        if (!cancelled) setError('Failed to load resources');
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
      } catch (e) {
        if (cancelled) return;
        setAvailableDates(new Set());
        setError('Could not load availability for this month.');
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
          setError('Failed to load available times.');
        }
      } finally {
        if (!cancelled) setLoadingSlots(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step, venue.id, date, duration, selectedMeta, bookingAudience]);

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
          onBookingCreated?.();
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
        if (!res.ok) throw new Error(data.error ?? 'Booking failed');
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
      staffBookingSource,
      onBookingCreated,
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

  return (
    <div className="mx-auto max-w-lg">
      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {step === 'pick_resource' && (
        <div>
          <h2 className="mb-2 text-lg font-semibold text-slate-900">Book a resource</h2>
          <p className="mb-4 text-sm text-slate-600">
            Choose a resource, then pick a date, how long you need it, and a start time.
          </p>
          {loadingOptions ? (
            <div className="space-y-3">{[1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100" />)}</div>
          ) : resourceOptions.length === 0 ? (
            <p className="text-sm text-slate-500">No resources are available to book. Please contact the venue.</p>
          ) : (
            <div className="space-y-3">
              {resourceOptions.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => selectResource(r)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-4 text-left shadow-sm transition hover:border-brand-300"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-slate-900">{r.name}</div>
                      {r.resource_type && <div className="text-xs text-slate-500">{r.resource_type}</div>}
                    </div>
                    <div className="text-right text-sm">
                      <span className="font-medium text-brand-600">
                        {formatResourcePricePerSlotLine(
                          r.price_per_slot_pence,
                          currencySymbolFromCode(venue.currency),
                          slotIntervalDurationLabel(r.slot_interval_minutes),
                        )}
                      </span>
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
          <button
            type="button"
            onClick={() => {
              setSelectedMeta(null);
              setStep('pick_resource');
            }}
            className="mb-4 text-sm text-brand-600 hover:underline"
          >
            &larr; Back to resources
          </button>
          <h2 className="mb-1 text-lg font-semibold text-slate-900">{selectedMeta.name}</h2>
          <p className="mb-4 text-sm text-slate-600">Green days have at least one bookable slot. Select a day to choose duration and time.</p>
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
          />
        </div>
      )}

      {step === 'pick_duration' && selectedMeta && date && (
        <div>
          <button
            type="button"
            onClick={() => {
              setDate('');
              setStep('pick_date');
            }}
            className="mb-4 text-sm text-brand-600 hover:underline"
          >
            &larr; Back to calendar
          </button>
          <h2 className="mb-1 text-lg font-semibold text-slate-900">How long?</h2>
          <p className="mb-4 text-sm text-slate-500">
            {selectedMeta.name} &middot; {date}
          </p>
          <div className="flex flex-wrap gap-2">
            {durationOptions.map((mins) => (
              <button
                key={mins}
                type="button"
                onClick={() => {
                  setDuration(mins);
                  setSelectedTime(null);
                  setStep('pick_slot');
                }}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 shadow-sm transition hover:border-brand-300 hover:text-brand-600"
              >
                {formatDurationLabel(mins)}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 'pick_slot' && selectedMeta && (
        <div>
          <button
            type="button"
            onClick={() => {
              setSelectedTime(null);
              setStep('pick_duration');
            }}
            className="mb-4 text-sm text-brand-600 hover:underline"
          >
            &larr; Back to duration
          </button>
          <h2 className="mb-1 text-lg font-semibold text-slate-900">Choose a start time</h2>
          <p className="mb-4 text-sm text-slate-500">
            {selectedMeta.name} &middot; {date} &middot; {formatDurationLabel(duration)}
          </p>
          {loadingSlots ? (
            <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
          ) : !selectedResource || selectedResource.slots.length === 0 ? (
            <p className="text-sm text-slate-500">
              No available times for this duration on this date. Go back and pick another duration or day.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {selectedResource.slots.map((slot) => (
                <button
                  key={slot.start_time}
                  type="button"
                  onClick={() => {
                    setSelectedTime(slot.start_time);
                    setStep('summary');
                  }}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-brand-300 hover:text-brand-600"
                >
                  {slot.start_time}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {step === 'summary' && selectedTime && selectedMeta && (
        <div>
          <button type="button" onClick={() => setStep('pick_slot')} className="mb-4 text-sm text-brand-600 hover:underline">
            &larr; Back to times
          </button>
          <h2 className="mb-4 text-lg font-semibold text-slate-900">Your selection</h2>
          <div className="mb-6 space-y-2 rounded-xl border border-slate-200 bg-white p-4 text-sm">
            <div className="font-medium text-slate-900">{selectedMeta.name}</div>
            <div className="text-slate-600">
              {date} &middot; {selectedTime} – {computeEndTime(selectedTime, duration)} ({formatDurationLabel(duration)})
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
          <button
            type="button"
            onClick={() => setStep('details')}
            className="w-full rounded-lg bg-brand-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-brand-700"
          >
            Continue to guest details
          </button>
        </div>
      )}

      {step === 'details' && selectedTime && (
        <div>
          <button type="button" onClick={() => setStep('summary')} className="mb-4 text-sm text-brand-600 hover:underline">
            &larr; Back to summary
          </button>
          <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 text-sm">
            <div className="font-medium text-slate-900">{selectedResource?.name ?? selectedMeta?.name}</div>
            <div className="text-slate-500">
              {date} &middot; {selectedTime} – {computeEndTime(selectedTime, duration)}
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
        <div className="rounded-2xl border border-green-200 bg-green-50 p-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
            <svg className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-green-900">{terms.booking} confirmed</h2>
          {isStaff && createResult?.payment_url ? (
            <p className="mt-3 text-sm text-green-800">
              Deposit link sent to the guest.{createResult.staffMessage ? ` ${createResult.staffMessage}` : ''}
            </p>
          ) : null}
          <p className="mt-2 text-sm text-green-700">
            {selectedResource?.name ?? selectedMeta?.name}
            <br />
            {date} &middot; {selectedTime} – {selectedTime ? computeEndTime(selectedTime, duration) : ''}
          </p>
        </div>
      )}
    </div>
  );
}
