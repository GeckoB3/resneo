'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AvailabilityResponse, AvailableSlot, BookingRulesPublic, GuestDetails, ServiceGroup, VenuePublic } from './types';
import { defaultPhoneCountryForVenueCurrency } from '@/lib/phone/default-country';
import { DateStep } from './DateStep';
import { DetailsStep } from './DetailsStep';
import { PaymentStep } from './PaymentStep';
import { ConfirmationStep } from './ConfirmationStep';
import { BookingSubmittingPanel } from './BookingSubmittingPanel';
import { formatOnlinePaidRefundPolicyLine } from '@/lib/booking/public-deposit-refund-policy';
import { isCardHoldPaymentMode, type CardHoldPaymentMode } from './card-hold-copy';
import { DEFAULT_ENTITY_BOOKING_WINDOW } from '@/lib/booking/entity-booking-window';
import { usePublicBookingAccountGateContext } from '@/components/booking/PublicBookingAccountGate';

export interface BookingFlowProps {
  venue: VenuePublic;
  embed?: boolean;
  onHeightChange?: () => void;
  cancellationPolicy?: string;
  accentColour?: string;
}

const steps: Array<'date' | 'details' | 'payment' | 'confirmation'> = ['date', 'details', 'payment', 'confirmation'];

export function BookingFlow({ venue, embed, onHeightChange, cancellationPolicy, accentColour }: BookingFlowProps) {
  const accountGate = usePublicBookingAccountGateContext();
  const areaList = venue.areas ?? [];
  const showAreaTabs = useMemo(() => {
    return areaList.length > 1 && venue.public_booking_area_mode === 'manual';
  }, [areaList.length, venue.public_booking_area_mode]);

  const [guestAreaId, setGuestAreaId] = useState<string | null>(() => {
    if (venue.public_booking_area_mode !== 'manual' || areaList.length <= 1) return null;
    return areaList[0]!.id;
  });

  const [stepIndex, setStepIndex] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [serviceGroups, setServiceGroups] = useState<ServiceGroup[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [partySize, setPartySize] = useState(() => {
    const min = venue.booking_rules?.min_party_size ?? 1;
    const max = venue.booking_rules?.max_party_size ?? 20;
    return Math.min(Math.max(2, min), max);
  });
  const [guestDetails, setGuestDetails] = useState<GuestDetails | null>(null);
  const [createResult, setCreateResult] = useState<{
    booking_id: string;
    client_secret?: string;
    stripe_account_id?: string;
    requires_deposit: boolean;
    /** Card capture mode from the create response ('setup' = card hold, no payment today). */
    payment_mode?: CardHoldPaymentMode;
    card_hold_fee_pence?: number | null;
  } | null>(null);
  const [_paymentComplete, setPaymentComplete] = useState(false);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [largePartyRedirect, setLargePartyRedirect] = useState(false);
  const [largePartyMessage, setLargePartyMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const step = steps[stepIndex];
  const rules: BookingRulesPublic = venue.booking_rules ?? {
    min_party_size: 1,
    max_party_size: 20,
    max_advance_booking_days: DEFAULT_ENTITY_BOOKING_WINDOW.max_advance_booking_days,
  };
  const maxAdvanceBookingDays =
    rules.max_advance_booking_days ?? DEFAULT_ENTITY_BOOKING_WINDOW.max_advance_booking_days;
  const phoneDefaultCountry = defaultPhoneCountryForVenueCurrency(venue.currency);

  const requiresDeposit = useMemo(() => {
    if (!selectedSlot) return false;
    return Boolean(selectedSlot.deposit_required);
  }, [selectedSlot]);

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!embed || !onHeightChange) return;
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      onHeightChange();
    });
    ro.observe(el);
    onHeightChange();
    return () => ro.disconnect();
  }, [embed, onHeightChange]);

  const goNext = useCallback(() => {
    setError(null);
    if (step === 'details' && !requiresDeposit) {
      setStepIndex(steps.indexOf('confirmation'));
    } else {
      setStepIndex((i) => Math.min(i + 1, steps.length - 1));
    }
  }, [step, requiresDeposit]);

  const goBack = useCallback(() => {
    setError(null);
    setStepIndex((i) => Math.max(0, i - 1));
  }, []);

  const fetchSlots = useCallback(async (date: string, areaOverride?: string | null) => {
    setSlotsLoading(true);
    setLargePartyRedirect(false);
    setLargePartyMessage(null);
    try {
      let url = `/api/booking/availability?venue_id=${encodeURIComponent(venue.id)}&date=${encodeURIComponent(date)}&party_size=${partySize}`;
      const areaForQuery = areaOverride !== undefined ? areaOverride : guestAreaId;
      if (venue.public_booking_area_mode === 'manual' && areaForQuery) {
        url += `&area_id=${encodeURIComponent(areaForQuery)}`;
      }
      const res = await fetch(url);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? 'Failed to load times');
      }
      const data: AvailabilityResponse = await res.json();
      setSlots(data.slots ?? []);
      setServiceGroups(data.services ?? []);

      if (data.large_party_redirect) {
        setLargePartyRedirect(true);
        setLargePartyMessage(data.large_party_message ?? null);
      }
    } finally {
      setSlotsLoading(false);
    }
  }, [venue.id, partySize, venue.public_booking_area_mode, guestAreaId]);

  // On mount: find the next date with availability and pre-load it
  useEffect(() => {
    const initPartySize = Math.min(Math.max(2, venue.booking_rules?.min_party_size ?? 1), venue.booking_rules?.max_party_size ?? 20);
    const initAreaId = venue.public_booking_area_mode !== 'manual' || areaList.length <= 1 ? null : areaList[0]!.id;

    async function findFirstAvailableDate() {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      for (let dayOffset = 0; dayOffset <= 30; dayOffset++) {
        const checkDate = new Date(today);
        checkDate.setDate(checkDate.getDate() + dayOffset);
        const y = checkDate.getFullYear();
        const m = String(checkDate.getMonth() + 1).padStart(2, '0');
        const d = String(checkDate.getDate()).padStart(2, '0');
        const dateStr = `${y}-${m}-${d}`;

        let url = `/api/booking/availability?venue_id=${encodeURIComponent(venue.id)}&date=${encodeURIComponent(dateStr)}&party_size=${initPartySize}`;
        if (venue.public_booking_area_mode === 'manual' && initAreaId) {
          url += `&area_id=${encodeURIComponent(initAreaId)}`;
        }

        try {
          const res = await fetch(url);
          if (!res.ok) break;
          const data: AvailabilityResponse = await res.json();
          const hasSlots =
            (data.slots ?? []).length > 0 ||
            (data.services ?? []).some((s) => s.slots.length > 0) ||
            data.large_party_redirect;

          if (hasSlots) {
            setSelectedDate(dateStr);
            setSlots(data.slots ?? []);
            setServiceGroups(data.services ?? []);
            if (data.large_party_redirect) {
              setLargePartyRedirect(true);
              setLargePartyMessage(data.large_party_message ?? null);
            }
            break;
          }
        } catch {
          break;
        }
      }

      setInitialLoading(false);
    }

    findFirstAvailableDate();
  // Only run on mount — venue props are stable server-rendered values
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch slots when party size changes (if a date is already selected)
  const isInitialPartyMount = useRef(true);
  useEffect(() => {
    if (isInitialPartyMount.current) {
      isInitialPartyMount.current = false;
      return;
    }
    if (selectedDate) {
      setSelectedSlot(null);
      fetchSlots(selectedDate).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partySize]);

  // Date selected from calendar — fetch slots inline, stay on step 1
  const handleDateSelect = useCallback((date: string) => {
    setSelectedDate(date);
    setSelectedSlot(null);
    fetchSlots(date).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [fetchSlots]);

  // Time slot selected — advance to details
  const handleSlotSelect = useCallback(async (slot: AvailableSlot) => {
    setSelectedSlot(slot);
    if (!(await accountGate.ensureSignedIn())) return;
    goNext();
  }, [accountGate, goNext]);

  const handleGuestAreaTabChange = useCallback(
    (areaId: string) => {
      setGuestAreaId(areaId);
      setSelectedSlot(null);
      if (selectedDate) {
        fetchSlots(selectedDate, areaId).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
      }
    },
    [selectedDate, fetchSlots],
  );

  const handleDetailsSubmit = useCallback(async (details: GuestDetails) => {
    setGuestDetails(details);
    setError(null);
    const emailError = accountGate.validateGuestEmail(details.email);
    if (emailError) {
      setError(emailError);
      return;
    }
    if (!selectedDate || !selectedSlot) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/booking/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venue_id: venue.id,
          booking_date: selectedDate,
          booking_time: selectedSlot.start_time,
          party_size: partySize,
          first_name: details.first_name,
          last_name: details.last_name,
          email: details.email || undefined,
          phone: details.phone,
          dietary_notes: details.dietary_notes || undefined,
          occasion: details.occasion || undefined,
          source: embed ? 'widget' : 'booking_page',
          service_id: selectedSlot.service_id || undefined,
          area_id: selectedSlot.area_id ?? guestAreaId ?? undefined,
          marketing_consent: details.marketing_consent,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (accountGate.handleCreateResponseError(res.status, data.error)) {
          setError('Sign in is required to book this venue.');
          return;
        }
        if (res.status === 409) {
          const altMsg = data.alternatives?.length
            ? `This time is no longer available. Try: ${data.alternatives.map((a: { time: string }) => a.time).join(', ')}`
            : data.error ?? 'This time slot is no longer available';
          setError(altMsg);
          return;
        }
        throw new Error(data.error ?? 'Booking failed');
      }
      setCreateResult({
        booking_id: data.booking_id,
        client_secret: data.client_secret,
        stripe_account_id: data.stripe_account_id,
        requires_deposit: data.requires_deposit ?? false,
        payment_mode: data.payment_mode,
        card_hold_fee_pence: data.card_hold_fee_pence ?? null,
      });
      if (data.requires_deposit && data.client_secret) {
        setStepIndex(steps.indexOf('payment'));
      } else {
        setStepIndex(steps.indexOf('confirmation'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Booking failed');
    } finally {
      setSubmitting(false);
    }
  }, [venue.id, selectedDate, selectedSlot, partySize, embed, guestAreaId, accountGate]);

  const handlePaymentComplete = useCallback(async () => {
    if (!createResult?.booking_id) {
      setPaymentComplete(true);
      goNext();
      return;
    }
    let confirmed = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch('/api/booking/confirm-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ booking_id: createResult.booking_id }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.confirmed) { confirmed = true; break; }
        }
      } catch {
        // Network error - retry
      }
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
    if (!confirmed) {
      console.warn('confirm-payment: all attempts failed - webhook will handle confirmation');
    }
    setPaymentComplete(true);
    goNext();
  }, [goNext, createResult?.booking_id]);

  const accentStyle = accentColour
    ? { '--accent-color': `#${accentColour.replace(/^#/, '')}` } as React.CSSProperties
    : undefined;

  const tableRefundNoticeHours = useMemo(() => {
    const fromSlot = selectedSlot?.cancellation_notice_hours;
    if (typeof fromSlot === 'number' && Number.isFinite(fromSlot)) return fromSlot;
    const fromVenue = rules.cancellation_notice_hours;
    if (typeof fromVenue === 'number' && Number.isFinite(fromVenue)) return fromVenue;
    return 48;
  }, [selectedSlot?.cancellation_notice_hours, rules.cancellation_notice_hours]);

  const tablePaymentPolicy = useMemo(() => {
    if (cancellationPolicy) return cancellationPolicy;
    return formatOnlinePaidRefundPolicyLine(tableRefundNoticeHours);
  }, [cancellationPolicy, tableRefundNoticeHours]);

  return (
    <div ref={containerRef} className="mx-auto max-w-lg" style={accentStyle}>
      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {step === 'date' && (
        <DateStep
          minParty={rules.min_party_size}
          maxParty={rules.max_party_size}
          partySize={partySize}
          maxAdvanceBookingDays={maxAdvanceBookingDays}
          onPartySizeChange={setPartySize}
          onDateSelect={handleDateSelect}
          selectedDate={selectedDate}
          slots={slots}
          serviceGroups={serviceGroups.length > 0 ? serviceGroups : undefined}
          slotsLoading={slotsLoading}
          initialLoading={initialLoading}
          largePartyRedirect={largePartyRedirect}
          largePartyMessage={largePartyMessage}
          onSlotSelect={handleSlotSelect}
          venueId={venue.id}
          phoneDefaultCountry={phoneDefaultCountry}
          showAreaTabs={showAreaTabs}
          areas={areaList}
          selectedAreaId={guestAreaId}
          onAreaChange={handleGuestAreaTabChange}
          availabilityAreaId={showAreaTabs ? guestAreaId : null}
          publicBookingAreaMode={venue.public_booking_area_mode}
          onHeightChange={embed ? onHeightChange : undefined}
        />
      )}
      {step === 'details' && selectedSlot && (
        submitting ? (
          <BookingSubmittingPanel variant="table" />
        ) : (
          <DetailsStep
            slot={selectedSlot}
            date={selectedDate!}
            partySize={partySize}
            onSubmit={handleDetailsSubmit}
            onBack={goBack}
            requiresDeposit={requiresDeposit}
            initialDetails={accountGate.guestDetailsPrefill}
            emailReadOnly={accountGate.emailReadOnly}
            depositPerPerson={
              selectedSlot.deposit_amount != null && partySize > 0
                ? selectedSlot.deposit_amount / partySize
                : undefined
            }
            refundNoticeHours={tableRefundNoticeHours}
            phoneDefaultCountry={phoneDefaultCountry}
          />
        )
      )}
      {step === 'payment' && createResult?.client_secret && (
        <PaymentStep
          clientSecret={createResult.client_secret}
          stripeAccountId={createResult.stripe_account_id}
          amountPence={Math.round((selectedSlot?.deposit_amount ?? 0) * 100)}
          partySize={partySize}
          onComplete={handlePaymentComplete}
          onBack={goBack}
          // Hold modes: the consent line covers the cancellation rule, so the deposit
          // refund-policy line is suppressed (design doc 7.3).
          cancellationPolicy={isCardHoldPaymentMode(createResult.payment_mode) ? undefined : tablePaymentPolicy}
          mode={createResult.payment_mode ?? 'payment'}
          cardHoldFeePence={createResult.card_hold_fee_pence}
          venueName={venue.name}
        />
      )}
      {step === 'confirmation' && (
        <ConfirmationStep venue={venue} date={selectedDate!} slot={selectedSlot!} partySize={partySize} guest={guestDetails!} bookingId={createResult?.booking_id} requiresDeposit={requiresDeposit} paymentMode={createResult?.payment_mode} />
      )}
    </div>
  );
}
