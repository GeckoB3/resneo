'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { VenuePublic, GuestDetails } from './types';
import { usePublicBookingAccountGateContext } from '@/components/booking/PublicBookingAccountGate';
import { defaultPhoneCountryForVenueCurrency } from '@/lib/phone/default-country';
import { DetailsStep } from './DetailsStep';
import { BookingSubmittingPanel } from './BookingSubmittingPanel';
import { PaymentStep } from './PaymentStep';
import { ClassOfferingsCalendar } from './ClassOfferingsCalendar';
import { formatBookablePricePence } from '@/lib/booking/format-price-display';
import {
  type BookingFlowAudience,
  eventOfferingsUrl,
  localTodayISO,
  bookingCreateUrl,
  bookingConfirmPaymentUrl,
  venueBookingsCreateUrl,
} from '@/lib/booking/booking-flow-api';
import { formatOnlinePaidRefundPolicyLine } from '@/lib/booking/public-deposit-refund-policy';
import { StaffBookingConfirmationFooter } from '@/components/booking/StaffBookingConfirmationFooter';

interface EventOfferingSummary {
  series_key: string;
  event_name: string;
  description: string | null;
  image_url: string | null;
  dates: string[];
  occurrence_count: number;
  from_price_pence: number | null;
  payment_requirement: 'none' | 'deposit' | 'full_payment';
  deposit_amount_pence: number | null;
}

interface TicketTypeAvail {
  id: string;
  name: string;
  price_pence: number;
  capacity: number | null;
  remaining: number;
  sort_order: number;
}

interface EventInstance {
  event_id: string;
  series_key: string;
  parent_event_id: string | null;
  event_name: string;
  event_date: string;
  start_time: string;
  end_time: string;
  description: string | null;
  image_url: string | null;
  total_capacity: number;
  remaining_capacity: number;
  payment_requirement: 'none' | 'deposit' | 'full_payment';
  deposit_amount_pence: number | null;
  /** Hours before start for refund of online deposit / prepayment. */
  cancellation_notice_hours?: number;
  ticket_types: TicketTypeAvail[];
}

type Step = 'pick-event' | 'pick-date' | 'summary' | 'details' | 'payment' | 'confirmation';

import { currencySymbolFromCode as symForCurrency } from '@/lib/money/currency-symbol';

function daysBetweenIso(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const fromMs = Date.UTC(fy!, fm! - 1, fd!);
  const toMs = Date.UTC(ty!, tm! - 1, td!);
  return Math.max(0, Math.round((toMs - fromMs) / 86_400_000));
}

function eventOfferingsRange(preselectedEventDate?: string): { from: string; days: number } {
  const today = localTodayISO();
  const from =
    preselectedEventDate && preselectedEventDate < today ? preselectedEventDate : today;
  const days = preselectedEventDate
    ? Math.min(120, Math.max(90, daysBetweenIso(from, preselectedEventDate) + 14))
    : 90;
  return { from, days };
}

function eventPaymentSummaryLines(
  occurrence: EventInstance,
  totalTickets: number,
  totalPricePence: number,
  currency: string,
  suppressOnlinePayment = false,
): { lines: string[]; chargePence: number } {
  const sym = symForCurrency(currency);
  const req = occurrence.payment_requirement ?? 'none';
  const depPerPerson = occurrence.deposit_amount_pence ?? 0;

  if (totalPricePence <= 0) {
    return { lines: ['Free - no payment required'], chargePence: 0 };
  }

  if (req === 'none' || suppressOnlinePayment) {
    return {
      lines: [
        `Total: ${sym}${(totalPricePence / 100).toFixed(2)} - pay at venue.`,
      ],
      chargePence: 0,
    };
  }

  if (req === 'full_payment') {
    return {
      lines: [`Total due now: ${sym}${(totalPricePence / 100).toFixed(2)}`],
      chargePence: totalPricePence,
    };
  }

  if (req === 'deposit' && depPerPerson > 0) {
    const totalDeposit = depPerPerson * totalTickets;
    const remainingPence = Math.max(0, totalPricePence - totalDeposit);
    return {
      lines: [
        `Deposit: ${sym}${(depPerPerson / 100).toFixed(2)} per person (total deposit: ${sym}${(totalDeposit / 100).toFixed(2)}).`,
        remainingPence > 0
          ? `Remaining ${sym}${(remainingPence / 100).toFixed(2)} due at venue.`
          : 'Balance due at venue.',
      ],
      chargePence: totalDeposit,
    };
  }

  return { lines: [`Total: ${sym}${(totalPricePence / 100).toFixed(2)}`], chargePence: 0 };
}

function eventListingPriceLabel(
  ev: EventOfferingSummary,
  sym: string,
): string {
  const req = ev.payment_requirement ?? 'none';
  if (ev.from_price_pence == null || ev.from_price_pence <= 0) return 'Free';
  const base = `From ${sym}${(ev.from_price_pence / 100).toFixed(2)}`;
  if (req === 'none') return `${base} (pay at venue)`;
  if (req === 'deposit' && ev.deposit_amount_pence != null && ev.deposit_amount_pence > 0) {
    return `${base} (${sym}${(ev.deposit_amount_pence / 100).toFixed(2)} deposit pp)`;
  }
  return base;
}

export interface EventBookingFlowProps {
  venue: VenuePublic;
  cancellationPolicy?: string;
  bookingAudience?: BookingFlowAudience;
  staffBookingSource?: 'phone' | 'walk-in';
  onBookingCreated?: () => void;
  /** When set, load offerings and create bookings in a linked owner venue. */
  linkedOwnerVenueId?: string;
  /** Skip event/date pickers and open ticket selection for this occurrence. */
  preselectedExperienceEventId?: string;
  preselectedEventDate?: string;
  preselectedEventTime?: string;
}

export function EventBookingFlow({
  venue,
  cancellationPolicy,
  bookingAudience = 'public',
  staffBookingSource = 'phone',
  onBookingCreated,
  linkedOwnerVenueId,
  preselectedExperienceEventId,
  preselectedEventDate,
  preselectedEventTime,
}: EventBookingFlowProps) {
  const isStaff = bookingAudience === 'staff';
  const isPublicGuest = !isStaff;
  const accountGate = usePublicBookingAccountGateContext();
  const acknowledgeStaffBooking = useCallback(() => {
    onBookingCreated?.();
  }, [onBookingCreated]);
  const isStaffWalkIn = isStaff && staffBookingSource === 'walk-in';
  const detailsAudience =
    isStaff && staffBookingSource === 'walk-in' ? ('staff_walk_in' as const) : isStaff ? ('staff' as const) : ('public' as const);
  const currency = venue.currency ?? 'GBP';
  const phoneDefaultCountry = defaultPhoneCountryForVenueCurrency(currency);
  const terms = venue.terminology ?? { client: 'Member', booking: 'Booking', staff: 'Instructor' };
  const sym = symForCurrency(currency);

  const [step, setStep] = useState<Step>(() =>
    preselectedExperienceEventId ? 'summary' : 'pick-event',
  );
  const advanceToGuestDetails = useCallback(async () => {
    if (isPublicGuest && !(await accountGate.ensureSignedIn())) return;
    setStep('details');
  }, [accountGate, isPublicGuest]);
  useEffect(() => {
    if (!isPublicGuest || step !== 'details') return;
    void accountGate.ensureSignedIn();
  }, [accountGate, isPublicGuest, step]);
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  const [eventSummaries, setEventSummaries] = useState<EventOfferingSummary[]>([]);
  const [instances, setInstances] = useState<EventInstance[]>([]);
  const [selectedSeriesKey, setSelectedSeriesKey] = useState<string | null>(null);
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string | null>(null);
  const [selectedOccurrence, setSelectedOccurrence] = useState<EventInstance | null>(null);
  const [ticketSelections, setTicketSelections] = useState<Record<string, number>>({});
  const [createResult, setCreateResult] = useState<{
    booking_id: string;
    client_secret?: string;
    stripe_account_id?: string;
    requires_deposit: boolean;
    payment_url?: string;
    staffMessage?: string;
  } | null>(null);
  const [loading, setLoading] = useState(() => Boolean(preselectedExperienceEventId));
  const [offeringsReady, setOfferingsReady] = useState(() => !preselectedExperienceEventId);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const prefillAppliedRef = useRef(false);

  const fetchOfferings = useCallback(async () => {
    if (preselectedExperienceEventId) {
      prefillAppliedRef.current = false;
    }
    setOfferingsReady(false);
    setLoading(true);
    setError(null);
    try {
      const { from, days } = eventOfferingsRange(preselectedEventDate);
      const res = await fetch(
        eventOfferingsUrl(bookingAudience, venue.id, linkedOwnerVenueId, { from, days }),
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load events');
      setRangeFrom(data.from ?? from);
      setRangeTo(data.to ?? '');
      setEventSummaries((data.events ?? []) as EventOfferingSummary[]);
      setInstances((data.instances ?? []) as EventInstance[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load events');
      setEventSummaries([]);
      setInstances([]);
    } finally {
      setLoading(false);
      setOfferingsReady(true);
    }
  }, [venue.id, bookingAudience, linkedOwnerVenueId, preselectedEventDate]);

  useEffect(() => {
    void fetchOfferings();
  }, [fetchOfferings]);

  const eventPrefillActive = Boolean(preselectedExperienceEventId);
  const eventPrefillPending =
    eventPrefillActive && !selectedOccurrence && (loading || !offeringsReady);

  useEffect(() => {
    if (!preselectedExperienceEventId) {
      prefillAppliedRef.current = false;
      return;
    }
    if (loading || !offeringsReady || prefillAppliedRef.current) return;

    const normalizedTime = preselectedEventTime?.slice(0, 5);
    const matchesEvent = (i: EventInstance) =>
      i.event_id === preselectedExperienceEventId &&
      (!preselectedEventDate || i.event_date === preselectedEventDate) &&
      i.remaining_capacity > 0;

    const match =
      (normalizedTime
        ? instances.find(
            (i) => matchesEvent(i) && i.start_time.slice(0, 5) === normalizedTime,
          )
        : undefined) ?? instances.find(matchesEvent);

    prefillAppliedRef.current = true;

    if (!match) {
      setError('This event is no longer available to book.');
      setStep('pick-event');
      return;
    }

    setSelectedSeriesKey(match.series_key);
    setSelectedOccurrence(match);
    setTicketSelections({});
    setStep('summary');
    setError(null);
  }, [
    preselectedExperienceEventId,
    preselectedEventDate,
    preselectedEventTime,
    instances,
    loading,
    offeringsReady,
  ]);

  const selectedSummary = useMemo(
    () => eventSummaries.find((e) => e.series_key === selectedSeriesKey) ?? null,
    [eventSummaries, selectedSeriesKey],
  );

  const instancesForSeries = useMemo(
    () => instances.filter((i) => i.series_key === selectedSeriesKey && i.remaining_capacity > 0),
    [instances, selectedSeriesKey],
  );

  const candidatesForCalendarDate = useMemo(() => {
    if (!selectedCalendarDate) return [];
    return instancesForSeries.filter((i) => i.event_date === selectedCalendarDate);
  }, [instancesForSeries, selectedCalendarDate]);

  function handleCalendarSelectDate(iso: string) {
    const candidates = instancesForSeries.filter((i) => i.event_date === iso && i.remaining_capacity > 0);
    if (candidates.length === 1) {
      setSelectedOccurrence(candidates[0]!);
      setTicketSelections({});
      setStep('summary');
      setSelectedCalendarDate(null);
      return;
    }
    setSelectedCalendarDate(iso);
  }

  function pickTimeSlot(slot: EventInstance) {
    setSelectedOccurrence(slot);
    setTicketSelections({});
    setStep('summary');
    setSelectedCalendarDate(null);
  }

  const totalTickets = selectedOccurrence
    ? selectedOccurrence.ticket_types.reduce((sum, tt) => sum + (ticketSelections[tt.id] ?? 0), 0)
    : 0;
  const totalPricePence = selectedOccurrence
    ? selectedOccurrence.ticket_types.reduce((sum, tt) => sum + (ticketSelections[tt.id] ?? 0) * tt.price_pence, 0)
    : 0;

  const paymentSummary = useMemo(() => {
    if (!selectedOccurrence || totalTickets <= 0) return null;
    return eventPaymentSummaryLines(selectedOccurrence, totalTickets, totalPricePence, currency, isStaffWalkIn);
  }, [selectedOccurrence, totalTickets, totalPricePence, currency, isStaffWalkIn]);

  const chargePence = paymentSummary?.chargePence ?? 0;

  const eventRefundNoticeHours = useMemo(() => {
    const h = selectedOccurrence?.cancellation_notice_hours;
    if (typeof h === 'number' && Number.isFinite(h)) return h;
    return venue.booking_rules?.cancellation_notice_hours ?? 48;
  }, [selectedOccurrence?.cancellation_notice_hours, venue.booking_rules?.cancellation_notice_hours]);

  const eventPaymentRefundPolicy = useMemo(() => {
    if (cancellationPolicy) return cancellationPolicy;
    return formatOnlinePaidRefundPolicyLine(eventRefundNoticeHours);
  }, [cancellationPolicy, eventRefundNoticeHours]);

  const handleDetailsSubmit = useCallback(
    async (details: GuestDetails) => {
      setError(null);
      if (!selectedOccurrence) return;
      if (isPublicGuest) {
        const emailError = accountGate.validateGuestEmail(details.email);
        if (emailError) {
          setError(emailError);
          return;
        }
      }
      setSubmitting(true);
      try {
        const ticket_lines = selectedOccurrence.ticket_types
          .filter((tt) => (ticketSelections[tt.id] ?? 0) > 0)
          .map((tt) => ({
            ticket_type_id: tt.id,
            label: tt.name,
            quantity: ticketSelections[tt.id]!,
            unit_price_pence: tt.price_pence,
          }));

        if (isStaff) {
          const res = await fetch(venueBookingsCreateUrl(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              booking_date: selectedOccurrence.event_date,
              booking_time: selectedOccurrence.start_time,
              party_size: totalTickets,
              first_name: details.first_name,
              last_name: details.last_name,
              email: details.email || undefined,
              phone: details.phone?.trim() || undefined,
              experience_event_id: selectedOccurrence.event_id,
              ticket_lines,
              dietary_notes: details.dietary_notes,
              source: staffBookingSource,
              ...(details.returning_guest ? { returning_guest: true } : {}),
              ...(linkedOwnerVenueId ? { owner_venue_id: linkedOwnerVenueId } : {}),
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? 'Booking failed');
          setCreateResult({
            booking_id: data.booking_id,
            requires_deposit: Boolean(data.payment_url),
            payment_url: data.payment_url,
            staffMessage: typeof data.message === 'string' ? data.message : undefined,
          });
          setStep('confirmation');
          return;
        }

        const res = await fetch(bookingCreateUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            venue_id: venue.id,
            booking_date: selectedOccurrence.event_date,
            booking_time: selectedOccurrence.start_time,
            party_size: totalTickets,
            first_name: details.first_name,
              last_name: details.last_name,
            email: details.email || undefined,
            phone: details.phone,
            source: 'booking_page',
            experience_event_id: selectedOccurrence.event_id,
            ticket_lines,
            dietary_notes: details.dietary_notes,
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
        setCreateResult({
          booking_id: data.booking_id,
          client_secret: data.client_secret,
          stripe_account_id: data.stripe_account_id,
          requires_deposit: data.requires_deposit ?? false,
        });
        const needsStripe = Boolean(data.requires_deposit && data.client_secret);
        setStep(needsStripe ? 'payment' : 'confirmation');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Booking failed');
      } finally {
        setSubmitting(false);
      }
    },
    [
      venue.id,
      selectedOccurrence,
      ticketSelections,
      totalTickets,
      isStaff,
      isPublicGuest,
      accountGate,
      staffBookingSource,
      linkedOwnerVenueId,
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

  return (
    <div className={isPublicGuest ? 'w-full' : 'mx-auto w-full max-w-lg'}>
      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {step === 'pick-event' && (
        <div>
          <h2 className="mb-1 text-lg font-semibold text-slate-900">Choose an event</h2>
          <p className="mb-4 text-sm text-slate-500">
            Events with sessions scheduled in the next 3 months. Pick one, then choose a date on the next step.
          </p>
          {loading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100" />
              ))}
            </div>
          ) : eventSummaries.length === 0 ? (
            <p className="text-sm text-slate-500">
              No upcoming events in the next few months. Please check back later or contact the venue.
            </p>
          ) : (
            <div className="space-y-3">
              {eventSummaries.map((ev) => {
                const priceLabel = eventListingPriceLabel(ev, sym);
                return (
                  <button
                    key={ev.series_key}
                    type="button"
                    onClick={() => {
                      setSelectedSeriesKey(ev.series_key);
                      setSelectedCalendarDate(null);
                      setStep('pick-date');
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-4 text-left shadow-sm transition hover:border-brand-300"
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-1 h-3 w-3 shrink-0 rounded-full bg-brand-500" />
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-slate-900">{ev.event_name}</div>
                        <div className="text-sm text-slate-500">
                          {ev.occurrence_count} date{ev.occurrence_count !== 1 ? 's' : ''} available
                        </div>
                        {ev.description ? (
                          <p className="mt-1 line-clamp-2 text-xs text-slate-600">{ev.description}</p>
                        ) : null}
                        <div className="mt-2 text-sm font-medium text-slate-700">{priceLabel}</div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {step === 'pick-date' && selectedSummary && rangeFrom && rangeTo && (
        <div>
          <button
            type="button"
            onClick={() => {
              setStep('pick-event');
              setSelectedSeriesKey(null);
              setSelectedCalendarDate(null);
            }}
            className="mb-4 text-sm text-brand-600 hover:underline"
          >
            &larr; Back to events
          </button>
          <h2 className="mb-1 text-lg font-semibold text-slate-900">{selectedSummary.event_name}</h2>
          <p className="mb-4 text-sm text-slate-500">Select a date when this event is running.</p>

          <ClassOfferingsCalendar
            rangeFrom={rangeFrom}
            rangeTo={rangeTo}
            highlightedDates={selectedSummary.dates}
            selectedDate={selectedCalendarDate}
            onSelectDate={handleCalendarSelectDate}
            footerMessage="Dates when this event runs are highlighted in green. Select a date to continue."
          />

          {selectedCalendarDate && candidatesForCalendarDate.length > 1 && (
            <div className="mt-4">
              <p className="mb-2 text-sm font-medium text-slate-800">Choose a time</p>
              <div className="flex flex-wrap gap-2">
                {candidatesForCalendarDate.map((slot) => (
                  <button
                    key={slot.event_id}
                    type="button"
                    onClick={() => pickTimeSlot(slot)}
                    className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow-sm hover:border-brand-400 hover:bg-brand-50"
                  >
                    {slot.start_time.slice(0, 5)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {step === 'summary' && eventPrefillPending && (
        <div className="flex flex-col items-center justify-center gap-3 py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
          <p className="text-sm text-slate-500">Loading tickets for this event…</p>
        </div>
      )}

      {step === 'summary' && selectedOccurrence && (
        <div>
          {!eventPrefillActive ? (
            <button
              type="button"
              onClick={() => {
                setSelectedOccurrence(null);
                setTicketSelections({});
                setStep('pick-date');
              }}
              className="mb-4 text-sm text-brand-600 hover:underline"
            >
              &larr; Back
            </button>
          ) : null}
          <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
            <div className="font-semibold text-slate-900">{selectedOccurrence.event_name}</div>
            <div className="text-slate-500">
              {selectedOccurrence.event_date} at {selectedOccurrence.start_time.slice(0, 5)} –{' '}
              {selectedOccurrence.end_time.slice(0, 5)}
            </div>
            {selectedOccurrence.description ? (
              <p className="mt-2 text-xs text-slate-600">{selectedOccurrence.description}</p>
            ) : null}
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium text-slate-800">Tickets</p>
            {selectedOccurrence.ticket_types.map((tt) => (
              <div
                key={tt.id}
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
              >
                <div>
                  <div className="font-medium text-slate-900">{tt.name}</div>
                  <div className="text-sm text-slate-500">
                    {formatBookablePricePence(tt.price_pence, sym)} · {tt.remaining} left
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setTicketSelections((p) => ({ ...p, [tt.id]: Math.max(0, (p[tt.id] ?? 0) - 1) }))
                    }
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 text-slate-600 hover:bg-slate-50"
                    disabled={(ticketSelections[tt.id] ?? 0) <= 0}
                  >
                    −
                  </button>
                  <span className="w-6 text-center text-sm font-medium">{ticketSelections[tt.id] ?? 0}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setTicketSelections((p) => ({
                        ...p,
                        [tt.id]: Math.min(tt.remaining, (p[tt.id] ?? 0) + 1),
                      }))
                    }
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 text-slate-600 hover:bg-slate-50"
                    disabled={(ticketSelections[tt.id] ?? 0) >= tt.remaining}
                  >
                    +
                  </button>
                </div>
              </div>
            ))}
          </div>

          {totalTickets > 0 && paymentSummary && (
            <>
              <div className="mt-6 mb-4 rounded-xl border border-slate-100 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Order summary</p>
                <p className="mt-2 text-sm text-slate-800">
                  {totalTickets} ticket{totalTickets !== 1 ? 's' : ''} · {sym}
                  {(totalPricePence / 100).toFixed(2)}
                </p>
                <div className="mt-2 space-y-1">
                  {paymentSummary.lines.map((line, i) => (
                    <p key={i} className="text-sm text-slate-600">{line}</p>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void advanceToGuestDetails()}
                className="w-full rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-brand-700"
              >
                Continue to guest details
              </button>
            </>
          )}
        </div>
      )}

      {step === 'details' && selectedOccurrence && (
        <div>
          <button type="button" onClick={() => setStep('summary')} className="mb-4 text-sm text-brand-600 hover:underline">
            &larr; Back
          </button>
          <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 text-sm">
            <div className="font-medium text-slate-900">{selectedOccurrence.event_name}</div>
            <div className="text-slate-500">
              {selectedOccurrence.event_date} at {selectedOccurrence.start_time.slice(0, 5)} · {totalTickets} ticket
              {totalTickets !== 1 ? 's' : ''}
            </div>
          </div>
          {submitting ? (
            <BookingSubmittingPanel variant="event" />
          ) : (
            <DetailsStep
              slot={{
                key: selectedOccurrence.event_id,
                label: selectedOccurrence.event_name,
                start_time: selectedOccurrence.start_time,
                end_time: selectedOccurrence.end_time,
                available_covers: totalTickets,
              }}
              date={selectedOccurrence.event_date}
              partySize={totalTickets}
              onSubmit={handleDetailsSubmit}
              onBack={() => setStep('summary')}
              requiresDeposit={false}
              variant="class"
              appointmentDepositPence={isStaffWalkIn ? null : chargePence > 0 ? chargePence : null}
              appointmentChargeLabel={selectedOccurrence.payment_requirement === 'full_payment' ? 'full_payment' : 'deposit'}
              payAtVenueBalancePence={
                (isStaffWalkIn || selectedOccurrence.payment_requirement === 'none') && totalPricePence > 0 ? totalPricePence : null
              }
              payAtVenuePaymentRequirement={
                isStaffWalkIn || selectedOccurrence.payment_requirement === 'none' ? 'none' : undefined
              }
              currencySymbol={sym}
              refundNoticeHours={eventRefundNoticeHours}
              phoneDefaultCountry={phoneDefaultCountry}
              audience={detailsAudience}
              initialDetails={isPublicGuest ? accountGate.guestDetailsPrefill : undefined}
              emailReadOnly={isPublicGuest && accountGate.emailReadOnly}
            />
          )}
        </div>
      )}

      {step === 'payment' && !isStaff && createResult?.client_secret && selectedOccurrence && (
        <PaymentStep
          clientSecret={createResult.client_secret}
          stripeAccountId={createResult.stripe_account_id}
          amountPence={chargePence}
          partySize={totalTickets}
          onComplete={handlePaymentComplete}
          onBack={() => setStep('details')}
          cancellationPolicy={eventPaymentRefundPolicy}
          summaryMode="total"
          chargeKind={selectedOccurrence.payment_requirement === 'full_payment' ? 'full_payment' : 'deposit'}
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
          <p className="mt-2 text-sm text-green-800">
            {selectedOccurrence?.event_name}
            <br />
            {selectedOccurrence?.event_date} at {selectedOccurrence?.start_time.slice(0, 5)}
            <br />
            {totalTickets} ticket{totalTickets !== 1 ? 's' : ''}
          </p>
          {isStaff && createResult?.payment_url ? (
            <p className="mt-4 text-xs text-green-800">Deposit link sent to the guest.</p>
          ) : (
            <p className="mt-4 text-xs text-green-700">You&apos;ll receive a confirmation email shortly.</p>
          )}
          {isStaff ? <StaffBookingConfirmationFooter onDone={acknowledgeStaffBooking} /> : null}
        </div>
      )}
    </div>
  );
}
