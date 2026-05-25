'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import type { VenuePublic, GuestDetails } from './types';
import { usePublicBookingAccountGateContext } from '@/components/booking/PublicBookingAccountGate';
import type { ClassPaymentRequirement } from '@/types/booking-models';
import { defaultPhoneCountryForVenueCurrency } from '@/lib/phone/default-country';
import { DetailsStep } from './DetailsStep';
import { BookingSubmittingPanel } from './BookingSubmittingPanel';
import { PaymentStep } from './PaymentStep';
import { ClassOfferingsCalendar } from './ClassOfferingsCalendar';
import {
  type BookingFlowAudience,
  classOfferingsUrl,
  localTodayISO,
  bookingCreateUrl,
  bookingConfirmPaymentUrl,
  venueBookingsCreateUrl,
} from '@/lib/booking/booking-flow-api';
import { formatOnlinePaidRefundPolicyLine } from '@/lib/booking/public-deposit-refund-policy';
import { StaffBookingConfirmationFooter } from '@/components/booking/StaffBookingConfirmationFooter';
import { RequireAuthModal } from '@/components/auth/RequireAuthModal';
import { createClient } from '@/lib/supabase/browser';
import type { ClassOfferingCommerceCatalog } from '@/lib/class-commerce/enrich-class-offerings';

interface ClassOfferingSummary {
  class_type_id: string;
  class_name: string;
  description: string | null;
  colour: string;
  price_pence: number | null;
  payment_requirement: ClassPaymentRequirement;
  deposit_amount_pence: number | null;
  instructor_name: string | null;
  dates: string[];
  session_count: number;
}

interface ClassSlot {
  instance_id: string;
  class_type_id: string;
  class_name: string;
  description: string | null;
  instance_date: string;
  start_time: string;
  duration_minutes: number;
  capacity: number;
  remaining: number;
  price_pence: number | null;
  payment_requirement: ClassPaymentRequirement;
  deposit_amount_pence: number | null;
  /** Hours before start for refund of online deposit / prepayment. */
  cancellation_notice_hours?: number;
  requires_stripe_checkout: boolean;
  instructor_name: string | null;
  colour: string;
}

type Step = 'pick-class' | 'pick-date' | 'summary' | 'details' | 'payment' | 'confirmation';

import { currencySymbolFromCode as symForCurrency } from '@/lib/money/currency-symbol';

function formatClassDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(d);
}

function classPriceLabel(cls: Pick<ClassOfferingSummary, 'price_pence' | 'payment_requirement' | 'deposit_amount_pence'>, sym: string): string {
  const price = cls.price_pence ?? 0;
  if (price <= 0) return 'Free';
  if (cls.payment_requirement === 'deposit' && (cls.deposit_amount_pence ?? 0) > 0) {
    return `${sym}${((cls.deposit_amount_pence ?? 0) / 100).toFixed(2)} deposit`;
  }
  if (cls.payment_requirement === 'none') {
    return `${sym}${(price / 100).toFixed(2)} pay at venue`;
  }
  return `${sym}${(price / 100).toFixed(2)} per person`;
}

function slotKey(slot: ClassSlot): string {
  return slot.instance_id;
}

function paymentSummaryLines(
  slot: ClassSlot,
  spots: number,
  currency: string,
  suppressOnlinePayment = false,
): { lines: string[]; chargePence: number } {
  const sym = symForCurrency(currency);
  const price = slot.price_pence ?? 0;
  const dep = slot.deposit_amount_pence ?? 0;
  const req = slot.payment_requirement;

  if (price <= 0) {
    return { lines: ['Free - no payment required'], chargePence: 0 };
  }

  if (req === 'none' || suppressOnlinePayment) {
    return {
      lines: [
        `${sym}${(price / 100).toFixed(2)} per person - pay at venue.`,
        `Total for ${spots} spot${spots !== 1 ? 's' : ''}: ${sym}${((price * spots) / 100).toFixed(2)} (informational).`,
      ],
      chargePence: 0,
    };
  }

  if (req === 'full_payment') {
    const total = price * spots;
    return {
      lines: [`${sym}${(price / 100).toFixed(2)} per person`, `Total due now: ${sym}${(total / 100).toFixed(2)}`],
      chargePence: total,
    };
  }

  if (req === 'deposit' && dep > 0) {
    const totalDep = dep * spots;
    const remainingPerPerson = Math.max(0, price - dep);
    return {
      lines: [
        `Deposit: ${sym}${(dep / 100).toFixed(2)} per person (total deposit: ${sym}${(totalDep / 100).toFixed(2)}).`,
        remainingPerPerson > 0
          ? `Remaining ${sym}${(remainingPerPerson / 100).toFixed(2)} per person due at venue.`
          : 'Balance due at venue.',
      ],
      chargePence: totalDep,
    };
  }

  return { lines: [`${sym}${(price / 100).toFixed(2)} per person`], chargePence: 0 };
}

function mapInstanceToSlot(row: Record<string, unknown>): ClassSlot {
  return {
    instance_id: row.instance_id as string,
    class_type_id: row.class_type_id as string,
    class_name: row.class_name as string,
    description: (row.description as string | null) ?? null,
    instance_date: row.instance_date as string,
    start_time: row.start_time as string,
    duration_minutes: row.duration_minutes as number,
    capacity: row.capacity as number,
    remaining: row.remaining as number,
    price_pence: (row.price_pence as number | null) ?? null,
    payment_requirement: row.payment_requirement as ClassPaymentRequirement,
    deposit_amount_pence: (row.deposit_amount_pence as number | null) ?? null,
    cancellation_notice_hours:
      typeof row.cancellation_notice_hours === 'number' && Number.isFinite(row.cancellation_notice_hours)
        ? row.cancellation_notice_hours
        : undefined,
    requires_stripe_checkout: Boolean(row.requires_stripe_checkout),
    instructor_name: (row.instructor_name as string | null) ?? null,
    colour: (row.colour as string) ?? '#6366f1',
  };
}

export interface ClassBookingFlowProps {
  venue: VenuePublic;
  cancellationPolicy?: string;
  bookingAudience?: BookingFlowAudience;
  staffBookingSource?: 'phone' | 'walk-in';
  onBookingCreated?: () => void;
  linkedOwnerVenueId?: string;
}

export function ClassBookingFlow({
  venue,
  cancellationPolicy,
  bookingAudience = 'public',
  staffBookingSource = 'phone',
  onBookingCreated,
  linkedOwnerVenueId,
}: ClassBookingFlowProps) {
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

  const [step, setStep] = useState<Step>('pick-class');
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
  const [classSummaries, setClassSummaries] = useState<ClassOfferingSummary[]>([]);
  const [instances, setInstances] = useState<ClassSlot[]>([]);
  const [commerce, setCommerce] = useState<ClassOfferingCommerceCatalog | null>(null);
  const [selectedClassTypeId, setSelectedClassTypeId] = useState<string | null>(null);
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string | null>(null);
  const [selectedClass, setSelectedClass] = useState<ClassSlot | null>(null);
  const [selectedSlots, setSelectedSlots] = useState<ClassSlot[]>([]);
  const [spots, setSpots] = useState(1);
  const [createResult, setCreateResult] = useState<{
    booking_id: string;
    client_secret?: string;
    stripe_account_id?: string;
    requires_deposit: boolean;
    payment_url?: string;
    cart_total_amount_pence?: number;
    cart_primary_booking_id?: string;
    cart_booking_count?: number;
    cart_charge_kind?: 'deposit' | 'full_payment';
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const pathname = usePathname() ?? '/book';
  const [payWithClassCredits, setPayWithClassCredits] = useState(false);
  const [cartPayWithClassCredits, setCartPayWithClassCredits] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  /** Where to land after the "Sign in to buy" modal completes — defaults to the same page. */
  const [authRedirectTo, setAuthRedirectTo] = useState<string | null>(null);
  /** Live auth state so the commerce panel can swap between "Sign in to buy" and direct Buy links. */
  const [signedIn, setSignedIn] = useState<boolean>(false);

  // Detect auth state in the browser so the commerce CTA matches reality.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getUser();
      if (!cancelled) setSignedIn(Boolean(data.user?.id));
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(Boolean(session?.user?.id));
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    setPayWithClassCredits(false);
  }, [selectedClass?.instance_id]);

  useEffect(() => {
    if (selectedSlots.length < 2) setCartPayWithClassCredits(false);
  }, [selectedSlots.length]);

  const fetchOfferings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const from = localTodayISO();
      const res = await fetch(classOfferingsUrl(bookingAudience, venue.id, linkedOwnerVenueId));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load classes');
      setRangeFrom(data.from ?? from);
      setRangeTo(data.to ?? '');
      setClassSummaries((data.classes ?? []) as ClassOfferingSummary[]);
      setCommerce((data.commerce as ClassOfferingCommerceCatalog | undefined) ?? null);
      const raw = (data.instances ?? []) as Record<string, unknown>[];
      setInstances(raw.map(mapInstanceToSlot));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load classes');
      setClassSummaries([]);
      setInstances([]);
      setCommerce(null);
    } finally {
      setLoading(false);
    }
  }, [venue.id, bookingAudience, linkedOwnerVenueId]);

  useEffect(() => {
    void fetchOfferings();
  }, [fetchOfferings]);

  const selectedSummary = useMemo(
    () => classSummaries.find((c) => c.class_type_id === selectedClassTypeId) ?? null,
    [classSummaries, selectedClassTypeId],
  );

  const instancesForType = useMemo(
    () => instances.filter((i) => i.class_type_id === selectedClassTypeId && i.remaining > 0),
    [instances, selectedClassTypeId],
  );

  const candidatesForCalendarDate = useMemo(() => {
    if (!selectedCalendarDate) return [];
    return instancesForType.filter((i) => i.instance_date === selectedCalendarDate);
  }, [instancesForType, selectedCalendarDate]);

  const selectedDateSet = useMemo(
    () => [...new Set(selectedSlots.map((slot) => slot.instance_date))],
    [selectedSlots],
  );

  const commerceSummary = useMemo(() => {
    if (!commerce) return null;
    const packs = commerce.credit_products.slice(0, 3);
    const memberships = commerce.membership_products.slice(0, 2);
    const courses = commerce.course_products.slice(0, 2);
    if (packs.length === 0 && memberships.length === 0 && courses.length === 0) return null;
    return { packs, memberships, courses };
  }, [commerce]);

  function handleCalendarSelectDate(iso: string) {
    const candidates = instancesForType.filter((i) => i.instance_date === iso && i.remaining > 0);
    if (candidates.length === 1) {
      toggleSelectedSlot(candidates[0]!);
      return;
    }
    setSelectedCalendarDate(iso);
  }

  function toggleSelectedSlot(slot: ClassSlot) {
    setSelectedSlots((current) => {
      const exists = current.some((s) => slotKey(s) === slotKey(slot));
      if (exists) return current.filter((s) => slotKey(s) !== slotKey(slot));
      return [...current, slot].sort(
        (a, b) => a.instance_date.localeCompare(b.instance_date) || a.start_time.localeCompare(b.start_time),
      );
    });
  }

  const summary = useMemo(() => {
    if (!selectedClass) return null;
    return paymentSummaryLines(selectedClass, spots, currency, isStaffWalkIn);
  }, [selectedClass, spots, currency, isStaffWalkIn]);

  const classRefundNoticeHours = useMemo(() => {
    const h = selectedClass?.cancellation_notice_hours;
    if (typeof h === 'number' && Number.isFinite(h)) return h;
    return venue.booking_rules?.cancellation_notice_hours ?? 48;
  }, [selectedClass?.cancellation_notice_hours, venue.booking_rules?.cancellation_notice_hours]);

  const classPaymentRefundPolicy = useMemo(() => {
    if (cancellationPolicy) return cancellationPolicy;
    return formatOnlinePaidRefundPolicyLine(classRefundNoticeHours);
  }, [cancellationPolicy, classRefundNoticeHours]);

  const handleDetailsSubmit = useCallback(
    async (details: GuestDetails) => {
      setError(null);
      if (!selectedClass) return;
      if (isPublicGuest) {
        const emailError = accountGate.validateGuestEmail(details.email);
        if (emailError) {
          setError(emailError);
          return;
        }
      }
      setSubmitting(true);
      try {
        if (isStaff) {
          const res = await fetch(venueBookingsCreateUrl(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              booking_date: selectedClass.instance_date,
              booking_time: selectedClass.start_time,
              party_size: spots,
              first_name: details.first_name,
              last_name: details.last_name,
              email: details.email || undefined,
              phone: details.phone,
              class_instance_id: selectedClass.instance_id,
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
          });
          setStep('confirmation');
          return;
        }

        if (payWithClassCredits) {
          const supabase = createClient();
          const { data: authData } = await supabase.auth.getUser();
          if (!authData.user) {
            setAuthModalOpen(true);
            setSubmitting(false);
            return;
          }
        }

        const res = await fetch(bookingCreateUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            venue_id: venue.id,
            booking_date: selectedClass.instance_date,
            booking_time: selectedClass.start_time,
            party_size: spots,
            first_name: details.first_name,
              last_name: details.last_name,
            email: details.email || undefined,
            phone: details.phone,
            source: 'booking_page',
            class_instance_id: selectedClass.instance_id,
            dietary_notes: details.dietary_notes,
            marketing_consent: details.marketing_consent,
            ...(payWithClassCredits ? { pay_with_class_credits: true } : {}),
          }),
        });
        const data = await res.json();
        if (res.status === 401 && payWithClassCredits) {
          setAuthModalOpen(true);
          setSubmitting(false);
          return;
        }
        if (!res.ok) {
          if (isPublicGuest && accountGate.handleCreateResponseError(res.status, data.error)) {
            setError('Sign in is required to book this venue.');
            setSubmitting(false);
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
    [venue.id, selectedClass, spots, isStaff, isPublicGuest, accountGate, staffBookingSource, payWithClassCredits, linkedOwnerVenueId],
  );

  const depositPenceForDetails = isStaffWalkIn || payWithClassCredits ? 0 : (summary?.chargePence ?? 0);

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
    } else if (createResult?.cart_primary_booking_id) {
      try {
        const supabase = createClient();
        const { data: auth } = await supabase.auth.getUser();
        await fetch(bookingConfirmPaymentUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            booking_id: createResult.cart_primary_booking_id,
            ...(auth.user?.email ? { guest_email: auth.user.email } : {}),
          }),
        });
      } catch {
        /* webhook fallback */
      }
    }
    setStep('confirmation');
  }, [createResult?.booking_id, createResult?.cart_primary_booking_id]);

  function continueWithSelectedDates() {
    setError(null);
    if (selectedSlots.length === 0) {
      setError('Choose at least one date.');
      return;
    }
    if (selectedSlots.length === 1) {
      setSelectedClass(selectedSlots[0]!);
      setStep('summary');
      return;
    }
    void runMultiDateCheckout();
  }

  async function runMultiDateCheckout() {
    if (selectedSlots.length < 2) return;
    const supabase = createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      setAuthModalOpen(true);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/booking/class-cart/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venue_id: venue.id,
          lines: selectedSlots.map((slot) => ({ class_instance_id: slot.instance_id, party_size: spots })),
          pay_with_class_credits: cartPayWithClassCredits,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Checkout failed');

      if (data.status === 'payment_required') {
        setCreateResult({
          booking_id: '',
          client_secret: data.client_secret,
          stripe_account_id: data.stripe_account_id,
          requires_deposit: true,
          cart_total_amount_pence: data.total_amount_pence,
          cart_primary_booking_id: data.primary_booking_id,
          cart_booking_count: Array.isArray(data.booking_ids) ? data.booking_ids.length : selectedSlots.length,
          cart_charge_kind: data.checkout_charge_kind === 'full_payment' ? 'full_payment' : 'deposit',
        });
        setSelectedClass(selectedSlots[0] ?? null);
        setStep('payment');
        return;
      }

      setCreateResult({
        booking_id: '',
        requires_deposit: false,
        cart_booking_count: Array.isArray(data.booking_ids) ? data.booking_ids.length : selectedSlots.length,
      });
      setSelectedClass(selectedSlots[0] ?? null);
      setStep('confirmation');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Checkout failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreditsToggle(next: boolean) {
    if (!next) {
      setPayWithClassCredits(false);
      return;
    }
    const supabase = createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      setAuthModalOpen(true);
      return;
    }
    setPayWithClassCredits(true);
  }

  async function handleCartCreditsToggle(next: boolean) {
    if (!next) {
      setCartPayWithClassCredits(false);
      return;
    }
    const supabase = createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      setAuthModalOpen(true);
      return;
    }
    setCartPayWithClassCredits(true);
  }

  return (
    <div className="mx-auto max-w-lg">
      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {step === 'pick-class' && (
        <div>
          <div className="mb-5 rounded-2xl border border-brand-100 bg-brand-50/70 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Classes</p>
            <h2 className="mt-1 text-xl font-bold text-slate-950">Choose your class first</h2>
            <p className="mt-2 text-sm leading-6 text-slate-700">
              Pick the class you want to attend, then choose one or more dates on the calendar.
            </p>
          </div>
          {loading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100" />
              ))}
            </div>
          ) : classSummaries.length === 0 ? (
            <p className="text-sm text-slate-500">
              No upcoming classes in the next few months. Please check back later or contact the venue.
            </p>
          ) : (
            <div className="space-y-3">
              {classSummaries.map((cls) => {
                const priceLabel = classPriceLabel(cls, sym);
                return (
                  <button
                    key={cls.class_type_id}
                    type="button"
                    onClick={() => {
                      setSelectedClassTypeId(cls.class_type_id);
                      setSelectedCalendarDate(null);
                      setSelectedClass(null);
                      setSelectedSlots([]);
                      setSpots(1);
                      setStep('pick-date');
                    }}
                    className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-brand-300 hover:bg-brand-50/30"
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: cls.colour }} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-semibold text-slate-900">{cls.class_name}</div>
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                            {priceLabel}
                          </span>
                        </div>
                        <div className="mt-1 text-sm text-slate-500">
                          {cls.session_count} session{cls.session_count !== 1 ? 's' : ''} available
                          {cls.instructor_name ? ` · ${cls.instructor_name}` : ''}
                        </div>
                        {cls.description ? (
                          <p className="mt-1 line-clamp-2 text-xs text-slate-600">{cls.description}</p>
                        ) : null}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          {commerceSummary ? (
            <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Passes, courses & memberships</p>
                  <h3 className="mt-1 text-base font-semibold text-slate-900">Come often? Save with a pack or plan.</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    {signedIn
                      ? 'Buy a pack, enroll in a course, or start a membership — then come back to book.'
                      : 'Sign in to buy packs, enroll in courses, or start a membership — then book classes from your account.'}
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:items-end">
                  <Link
                    href={`/account/classes?venue=${encodeURIComponent(venue.id)}`}
                    className="text-center text-xs font-semibold text-brand-700 hover:underline sm:text-right"
                  >
                    Open class account hub
                  </Link>
                </div>
              </div>
              <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                {commerceSummary.packs.map((p) => (
                  <CommerceLine
                    key={p.id}
                    label={p.name}
                    detail={`${p.credits_count} credits · ${sym}${(p.price_pence / 100).toFixed(2)}`}
                    actionLabel={signedIn ? 'Buy pack' : 'Sign in to buy'}
                    onClick={() => {
                      const target = `/account/credits?venue=${encodeURIComponent(venue.id)}&product=${encodeURIComponent(p.id)}&autostart=1`;
                      if (signedIn) {
                        window.location.href = target;
                      } else {
                        setAuthRedirectTo(target);
                        setAuthModalOpen(true);
                      }
                    }}
                  />
                ))}
                {commerceSummary.courses.map((c) => (
                  <CommerceLine
                    key={c.id}
                    label={c.name}
                    detail={`course · ${c.price_pence <= 0 ? 'free' : `${sym}${(c.price_pence / 100).toFixed(2)}`}`}
                    actionLabel={signedIn ? (c.price_pence <= 0 ? 'Enroll free' : 'Enroll') : 'Sign in to enroll'}
                    onClick={() => {
                      const target = `/account/courses?venue=${encodeURIComponent(venue.id)}&course=${encodeURIComponent(c.id)}&autostart=1`;
                      if (signedIn) {
                        window.location.href = target;
                      } else {
                        setAuthRedirectTo(target);
                        setAuthModalOpen(true);
                      }
                    }}
                  />
                ))}
                {commerceSummary.memberships.map((m) => (
                  <CommerceLine
                    key={m.id}
                    label={m.name}
                    detail="membership"
                    actionLabel={signedIn ? 'Start membership' : 'Sign in to subscribe'}
                    onClick={() => {
                      const target = `/account/memberships?venue=${encodeURIComponent(venue.id)}&plan=${encodeURIComponent(m.id)}&autostart=1`;
                      if (signedIn) {
                        window.location.href = target;
                      } else {
                        setAuthRedirectTo(target);
                        setAuthModalOpen(true);
                      }
                    }}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {step === 'pick-date' && selectedSummary && rangeFrom && rangeTo && (
        <div>
          <button
            type="button"
            onClick={() => {
              setStep('pick-class');
              setSelectedClassTypeId(null);
              setSelectedCalendarDate(null);
              setSelectedSlots([]);
            }}
            className="mb-4 text-sm text-brand-600 hover:underline"
          >
            &larr; Back to classes
          </button>
          <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{selectedSummary.class_name}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Select one date to book as a guest, or multiple dates to buy through your account.
                </p>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                {classPriceLabel(selectedSummary, sym)}
              </span>
            </div>
          </div>

          <ClassOfferingsCalendar
            rangeFrom={rangeFrom}
            rangeTo={rangeTo}
            highlightedDates={selectedSummary.dates}
            selectedDate={selectedCalendarDate}
            selectedDates={selectedDateSet}
            onSelectDate={handleCalendarSelectDate}
            footerMessage="Dates with a session are highlighted in green. Select one date for a standard booking, or multiple dates for account checkout."
          />

          {selectedCalendarDate && candidatesForCalendarDate.length > 1 && (
            <div className="mt-4">
              <p className="mb-2 text-sm font-medium text-slate-800">Choose a time</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {candidatesForCalendarDate.map((slot) => {
                  const selected = selectedSlots.some((s) => slotKey(s) === slotKey(slot));
                  return (
                    <button
                      key={slot.instance_id}
                      type="button"
                      onClick={() => toggleSelectedSlot(slot)}
                      className={`rounded-xl border px-4 py-3 text-left text-sm font-medium shadow-sm ${
                        selected
                          ? 'border-brand-500 bg-brand-50 text-brand-950'
                          : 'border-slate-200 bg-white text-slate-900 hover:border-brand-400 hover:bg-brand-50'
                      }`}
                    >
                      <span className="block">{slot.start_time.slice(0, 5)}</span>
                      <span className="mt-1 block text-xs font-normal text-slate-500">
                        {slot.remaining} spot{slot.remaining !== 1 ? 's' : ''} left
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {selectedSlots.length === 0
                    ? 'No dates selected'
                    : `${selectedSlots.length} date${selectedSlots.length !== 1 ? 's' : ''} selected`}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {selectedSlots.length > 1
                    ? 'Multiple dates require sign in so your purchases and bookings stay linked to your account.'
                    : 'Single dates can be booked quickly without creating an account.'}
                </p>
              </div>
              {selectedSlots.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setSelectedSlots([])}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-800"
                >
                  Clear
                </button>
              ) : null}
            </div>
            {selectedSlots.length > 0 ? (
              <div className="mt-3 space-y-2">
                {selectedSlots.map((slot) => (
                  <div key={slot.instance_id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
                    <span className="font-medium text-slate-900">
                      {formatClassDate(slot.instance_date)} · {slot.start_time.slice(0, 5)}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleSelectedSlot(slot)}
                      className="text-xs font-semibold text-slate-500 hover:text-red-600"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            {!isStaff && selectedSlots.length > 1 ? (
              <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={cartPayWithClassCredits}
                  onChange={(e) => void handleCartCreditsToggle(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-slate-300"
                />
                <span>
                  <span className="block font-semibold text-slate-900">Use class credits for all paid sessions</span>
                  <span className="block text-xs text-slate-600">
                    Applies only to sessions that accept credits. Remaining balance will be charged by card.
                  </span>
                </span>
              </label>
            ) : null}
            <button
              type="button"
              disabled={selectedSlots.length === 0 || submitting}
              onClick={continueWithSelectedDates}
              className="mt-4 w-full rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Preparing checkout...' : selectedSlots.length > 1 ? 'Sign In To Buy' : 'Book the class'}
            </button>
          </div>
        </div>
      )}

      {step === 'summary' && selectedClass && (
        <div>
          <button
            type="button"
            onClick={() => {
              setSelectedClass(null);
              setStep('pick-date');
            }}
            className="mb-4 text-sm text-brand-600 hover:underline"
          >
            &larr; Back
          </button>
          <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
            <div className="font-semibold text-slate-900">{selectedClass.class_name}</div>
            <div className="text-slate-500">
              {selectedClass.instance_date} at {selectedClass.start_time.slice(0, 5)}
            </div>
            <div className="mt-2 text-slate-600">
              {selectedClass.duration_minutes} min
              {selectedClass.instructor_name ? ` · ${terms.staff}: ${selectedClass.instructor_name}` : ''}
            </div>
            {selectedClass.description ? (
              <p className="mt-2 text-xs text-slate-600">{selectedClass.description}</p>
            ) : null}
          </div>

          {selectedClass.remaining > 1 && (
            <div className="mb-4">
              <label className="text-sm font-medium text-slate-700" htmlFor="class-spots">
                Spots
              </label>
              <select
                id="class-spots"
                value={spots}
                onChange={(e) => setSpots(Number(e.target.value))}
                className="ml-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
              >
                {Array.from({ length: Math.min(selectedClass.remaining, 10) }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="mb-4 rounded-xl border border-slate-100 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Payment summary</p>
            {payWithClassCredits && (selectedClass.price_pence ?? 0) > 0 ? (
              <ul className="mt-2 space-y-1 text-sm text-slate-800">
                <li>
                  Pay with class credits — {spots} credit{spots !== 1 ? 's' : ''} (same email as your account).
                </li>
              </ul>
            ) : (
              <ul className="mt-2 space-y-1 text-sm text-slate-800">
                {(summary?.lines ?? []).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </div>

          {!isStaff && (selectedClass.price_pence ?? 0) > 0 ? (
            <label className="mb-4 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 shadow-sm">
              <input
                type="checkbox"
                checked={payWithClassCredits}
                onChange={(e) => void handleCreditsToggle(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-slate-300"
              />
              <span>
                <span className="block font-semibold text-slate-900">Use class credits or a pack</span>
                <span className="block text-slate-600">
                  Optional. Sign in only if you already have credits; otherwise continue as a guest.
                </span>
              </span>
            </label>
          ) : null}

          <button
            type="button"
            onClick={() => void advanceToGuestDetails()}
            className="w-full rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-brand-700"
          >
            Book the class
          </button>
          <p className="mt-2 text-center text-xs text-slate-500">
            You only need your name, email, and phone to reserve this single class.
          </p>
        </div>
      )}

      {step === 'details' && selectedClass && (
        <div>
          <button type="button" onClick={() => setStep('summary')} className="mb-4 text-sm text-brand-600 hover:underline">
            &larr; Back
          </button>
          <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 text-sm">
            <div className="font-medium text-slate-900">{selectedClass.class_name}</div>
            <div className="text-slate-500">
              {selectedClass.instance_date} at {selectedClass.start_time.slice(0, 5)} · {spots} spot
              {spots !== 1 ? 's' : ''}
            </div>
          </div>
          {submitting ? (
            <BookingSubmittingPanel variant="class" />
          ) : (
            <DetailsStep
              slot={{
                key: selectedClass.instance_id,
                label: selectedClass.class_name,
                start_time: selectedClass.start_time,
                end_time: '',
                available_covers: selectedClass.remaining,
              }}
              date={selectedClass.instance_date}
              partySize={spots}
              onSubmit={handleDetailsSubmit}
              onBack={() => setStep('summary')}
              requiresDeposit={false}
              variant="class"
              appointmentDepositPence={depositPenceForDetails > 0 ? depositPenceForDetails : null}
              appointmentChargeLabel={selectedClass.payment_requirement === 'full_payment' ? 'full_payment' : 'deposit'}
              payAtVenueBalancePence={
                (isStaffWalkIn || selectedClass.payment_requirement === 'none') && (selectedClass.price_pence ?? 0) > 0
                  ? (selectedClass.price_pence ?? 0) * spots
                  : null
              }
              payAtVenuePaymentRequirement={isStaffWalkIn ? 'none' : selectedClass.payment_requirement}
              currencySymbol={sym}
              refundNoticeHours={classRefundNoticeHours}
              phoneDefaultCountry={phoneDefaultCountry}
              audience={detailsAudience}
              initialDetails={isPublicGuest ? accountGate.guestDetailsPrefill : undefined}
              emailReadOnly={isPublicGuest && accountGate.emailReadOnly}
            />
          )}
        </div>
      )}

      {step === 'payment' && !isStaff && createResult?.client_secret && selectedClass && (
        <PaymentStep
          clientSecret={createResult.client_secret}
          stripeAccountId={createResult.stripe_account_id}
          amountPence={createResult.cart_total_amount_pence ?? summary?.chargePence ?? 0}
          partySize={spots}
          onComplete={handlePaymentComplete}
          onBack={() => setStep(createResult.cart_primary_booking_id ? 'pick-date' : 'details')}
          cancellationPolicy={classPaymentRefundPolicy}
          summaryMode="total"
          chargeKind={
            createResult.cart_charge_kind ??
            (selectedClass.payment_requirement === 'full_payment' ? 'full_payment' : 'deposit')
          }
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
          {createResult?.cart_booking_count && createResult.cart_booking_count > 1 ? (
            <p className="mt-2 text-sm text-green-800">
              {selectedClass?.class_name}
              <br />
              {createResult.cart_booking_count} dates booked through your account.
            </p>
          ) : (
            <p className="mt-2 text-sm text-green-800">
              {selectedClass?.class_name}
              <br />
              {selectedClass?.instance_date} at {selectedClass?.start_time.slice(0, 5)}
              <br />
              {spots} spot{spots !== 1 ? 's' : ''}
            </p>
          )}
          {isStaff && createResult?.payment_url ? (
            <p className="mt-4 text-xs text-green-800">Deposit link sent to the guest.</p>
          ) : (
            <p className="mt-4 text-xs text-green-700">You&apos;ll receive a confirmation email shortly.</p>
          )}
          {isStaff ? <StaffBookingConfirmationFooter onDone={acknowledgeStaffBooking} /> : null}
        </div>
      )}

      <RequireAuthModal
        open={authModalOpen}
        redirectTo={authRedirectTo ?? pathname}
        onClose={() => {
          setAuthModalOpen(false);
          setAuthRedirectTo(null);
        }}
      />
    </div>
  );
}

function CommerceLine({
  label,
  detail,
  actionLabel,
  onClick,
}: {
  label: string;
  detail: string;
  actionLabel: string;
  onClick: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-slate-900">{label}</div>
        <div className="truncate text-xs text-slate-500">{detail}</div>
      </div>
      <button
        type="button"
        onClick={onClick}
        className="shrink-0 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
      >
        {actionLabel}
      </button>
    </div>
  );
}
