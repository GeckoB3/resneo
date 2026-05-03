'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/browser';
import { formatSignupBusinessTypeLabel, isDirectModelBusinessType } from '@/lib/business-config';
import {
  APPOINTMENTS_LIGHT_PRICE,
  APPOINTMENTS_PLUS_PRICE,
  APPOINTMENTS_PRO_PRICE,
  RESTAURANT_PRICE,
  SMS_LIGHT_GBP_PER_MESSAGE,
  SMS_OVERAGE_GBP_PER_MESSAGE,
} from '@/lib/pricing-constants';
import { SMS_INCLUDED_APPOINTMENTS, SMS_INCLUDED_PLUS, SMS_INCLUDED_RESTAURANT } from '@/lib/billing/sms-allowance';
import { STANDARD_PAYMENT_PROVIDER_FEES_NOTICE } from '@/lib/payment-provider-fees-notice';
import { SUBSCRIPTION_CANCELLATION_PUBLIC_NOTICE } from '@/lib/subscription-cancellation-copy';
import { signupPlanToFamily, SIGNUP_PLAN_CONFLICT_MESSAGE } from '@/lib/signup-plan-family';
import { fetchPendingSignupSelection, syncPendingToSessionStorage } from '@/lib/signup-pending-client';
import { isSignupPaymentReady } from '@/lib/signup-pending-selection';
import { ensureDefaultRestaurantFamilyBusinessType } from '@/lib/signup-resume';

type PlanType = 'appointments' | 'plus' | 'light' | 'restaurant' | 'founding';

/** Hospitality keys from signup; redundant next to "Plan: Restaurant" / Founding on order summary. */
const HOSPITALITY_BUSINESS_TYPE_KEYS = new Set(['restaurant', 'cafe', 'pub', 'hotel_restaurant']);

export default function PaymentPage() {
  const router = useRouter();
  const [businessType, setBusinessType] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanType | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  /** Until checked, we do not know if the browser has a Supabase session (required for checkout). */
  const [sessionChecked, setSessionChecked] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  /** Plan + business type resolved from sessionStorage and/or server-persisted signup progress. */
  const [selectionHydrated, setSelectionHydrated] = useState(false);
  /** Logged-in user already has the other plan family: block checkout before hitting Stripe. */
  const [planFamilyBlocked, setPlanFamilyBlocked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let bt = sessionStorage.getItem('signup_business_type');
      let p = sessionStorage.getItem('signup_plan') as PlanType | null;

      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if ((!p || (p !== 'appointments' && p !== 'plus' && p !== 'light' && !bt)) && session) {
        const pending = await fetchPendingSignupSelection();
        if (cancelled) return;
        if (pending?.plan && isSignupPaymentReady(pending.plan, pending.business_type)) {
          p = pending.plan;
          bt = pending.business_type;
          syncPendingToSessionStorage(p, bt);
        }
      }

      ensureDefaultRestaurantFamilyBusinessType();
      bt = sessionStorage.getItem('signup_business_type');
      p = sessionStorage.getItem('signup_plan') as PlanType | null;

      if (cancelled) return;
      if (!p || (p !== 'appointments' && p !== 'plus' && p !== 'light' && !bt)) {
        router.push('/signup/business-type');
        return;
      }
      setBusinessType(bt);
      setPlan(p);
      setSelectionHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    const supabase = createClient();
    void supabase.auth.getSession().then(({ data: { session } }) => {
      setHasSession(!!session);
      setSessionChecked(true);
    });
  }, []);

  useEffect(() => {
    if (!sessionChecked || !hasSession || !plan) return;
    let cancelled = false;
    void (async () => {
      const res = await fetch('/api/signup/existing-plan', { credentials: 'same-origin' });
      if (!res.ok || cancelled) return;
      const data = (await res.json()) as { hasVenue?: boolean; planFamily?: 'appointments' | 'restaurant' };
      if (!data.hasVenue || !data.planFamily) return;
      const requested = signupPlanToFamily(plan);
      if (requested !== data.planFamily) {
        setPlanFamilyBlocked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionChecked, hasSession, plan]);

  const totalPrice = useMemo(() => {
    if (plan === 'light') return APPOINTMENTS_LIGHT_PRICE;
    if (plan === 'plus') return APPOINTMENTS_PLUS_PRICE;
    if (plan === 'appointments') return APPOINTMENTS_PRO_PRICE;
    if (plan === 'restaurant') return RESTAURANT_PRICE;
    return 0; // founding is free
  }, [plan]);

  async function handleCheckout() {
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      setError(
        'You must be signed in to continue. If you just registered, open the confirmation link in your email first, or sign in below.',
      );
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/signup/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          business_type: businessType,
          plan,
        }),
      });

      const data = (await res.json()) as { error?: string; redirect_url?: string };

      if (!res.ok) {
        const msg =
          res.status === 409
            ? (data.error ?? SIGNUP_PLAN_CONFLICT_MESSAGE)
            : data.error === 'Not authenticated'
              ? 'You must be signed in to continue. Confirm your email from the signup message, or sign in.'
              : data.error || 'Failed to start checkout.';
        setError(msg);
        setLoading(false);
        return;
      }

      if (data.redirect_url) {
        window.location.href = data.redirect_url;
        return;
      }

      setError('Unexpected response from server.');
    } catch {
      setError('Network error. Please try again.');
    }
    setLoading(false);
  }

  if (!plan || !sessionChecked || !selectionHydrated) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
      </div>
    );
  }

  const overagePence = Math.round(SMS_OVERAGE_GBP_PER_MESSAGE * 100);
  const lightSmsPence = Math.round(SMS_LIGHT_GBP_PER_MESSAGE * 100);
  const isRestaurant = plan === 'restaurant';
  const isFounding = plan === 'founding';
  const isLight = plan === 'light';
  const isPlus = plan === 'plus';
  const smsIncluded =
    isRestaurant || isFounding
      ? SMS_INCLUDED_RESTAURANT
      : isPlus
        ? SMS_INCLUDED_PLUS
        : SMS_INCLUDED_APPOINTMENTS;
  const planLabel = isFounding
    ? 'Founding Partner'
    : isRestaurant
      ? 'Restaurant'
      : isLight
        ? 'Appointments Light'
        : isPlus
          ? 'Appointments Plus'
          : 'Appointments Pro';
  const omitBusinessTypeRow =
    (isRestaurant || isFounding) &&
    !!businessType &&
    HOSPITALITY_BUSINESS_TYPE_KEYS.has(businessType);

  return (
    <div className="w-full max-w-md">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-slate-900">Order summary</h1>
        <p className="mt-2 text-sm text-slate-500">
          {isFounding
            ? 'Review your selection before completing setup.'
            : 'Review your selection before proceeding to secure checkout with Stripe.'}
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="space-y-4">
          {businessType && !omitBusinessTypeRow ? (
            <>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">
                  {isDirectModelBusinessType(businessType) ? 'Booking type' : 'Business type'}
                </span>
                <span className="max-w-[60%] text-right font-medium text-slate-900">
                  {formatSignupBusinessTypeLabel(businessType)}
                </span>
              </div>
              {isDirectModelBusinessType(businessType) && (
                <p className="text-xs text-slate-500">
                  You chose a general booking pattern. Labels and services can be customised in onboarding and
                  settings.
                </p>
              )}
            </>
          ) : !businessType && (plan === 'appointments' || plan === 'plus') ? (
            <div className="rounded-lg border border-brand-100 bg-brand-50/60 px-3 py-2 text-xs text-brand-900">
              Appointments plans include appointments, classes, events, and resources. After payment, you&apos;ll choose
              which booking models to enable first and can change them later in Settings.
            </div>
          ) : null}
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Plan</span>
            <span className="font-medium text-slate-900">{planLabel}</span>
          </div>

          {isFounding ? (
            <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-2 text-xs text-emerald-900">
              <p className="font-medium">
                Founding Partner: Restaurant plan free for 6 months, then &pound;{RESTAURANT_PRICE}/month.
              </p>
              <p className="mt-1 leading-relaxed">
                Full access: table management, {smsIncluded} SMS per month, deposit collection, guest messaging,
                and priority support. Additional SMS at {overagePence}p each.
              </p>
            </div>
          ) : isLight ? (
            <div className="rounded-lg border border-brand-100 bg-brand-50/60 px-3 py-2 text-xs text-brand-900">
              <p className="font-medium">Appointments Light: &pound;{APPOINTMENTS_LIGHT_PRICE}/month from signup.</p>
              <p className="mt-1.5 leading-relaxed">
                One bookable calendar and one venue login. Appointments, classes, events, and bookable resources.
                You choose which models to start with in onboarding; edit anytime in Settings. Email reminders are
                included.
              </p>
              <p className="mt-1.5 leading-relaxed">
                0 SMS included; metered SMS at {lightSmsPence}p per message (billed through Stripe with your subscription).
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 text-xs text-slate-600">
              <p className="font-medium text-slate-800">
                ReserveNI {planLabel}: &pound;{totalPrice}/month
              </p>
              <p className="mt-1 leading-relaxed">
                {isRestaurant
                  ? `Table management, floor plan, all booking types. ${smsIncluded} SMS per month included. Priority support. Additional SMS at ${overagePence}p each.`
                  : isPlus
                    ? `Up to 5 calendars and 5 team members. ${smsIncluded} SMS per month included, then ${overagePence}p each. Phone and email support.`
                    : `All booking types: appointments, classes, events, resources. Unlimited calendars and team members. You'll choose which models to enable first after payment. ${smsIncluded} SMS per month included. Additional SMS at ${overagePence}p each after your included allowance.`}
              </p>
            </div>
          )}

          <div className="border-t border-slate-100 pt-4">
            <div className="flex justify-between">
              <span className="text-base font-semibold text-slate-900">
                {isFounding ? 'Total' : 'Monthly total'}
              </span>
              <span className="text-base font-bold text-slate-900">
                {isFounding ? (
                  <span className="text-emerald-600">Free for 6 months</span>
                ) : (
                  <>&pound;{totalPrice}/mo</>
                )}
              </span>
            </div>
          </div>
        </div>

        {error && (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        )}

        {!hasSession && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
            <p className="font-medium">Sign in required</p>
            <p className="mt-1 text-amber-800/90">
              {isFounding ? 'Complete setup needs an active session.' : 'Checkout needs an active session.'}{' '}
              If you haven&apos;t confirmed your email yet, use the link we sent you, then return here. Already
              confirmed?{' '}
              <Link href="/login?redirectTo=/signup/payment" className="font-medium text-brand-700 underline">
                Sign in
              </Link>{' '}
              to continue.
            </p>
          </div>
        )}

        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <input
            type="checkbox"
            checked={termsAccepted}
            onChange={(e) => setTermsAccepted(e.target.checked)}
            className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          <span className="text-xs leading-relaxed text-slate-600">
            By signing up, I confirm I have authority to act for this business and agree to the ReserveNI{' '}
            <a
              href="/terms/customer"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-brand-600 underline hover:text-brand-700"
              onClick={(e) => e.stopPropagation()}
            >
              customer terms
            </a>
            {', '}
            <a
              href="/terms/data-processing"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-brand-600 underline hover:text-brand-700"
              onClick={(e) => e.stopPropagation()}
            >
              data processing terms
            </a>
            {', '}
            <a
              href="/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-brand-600 underline hover:text-brand-700"
              onClick={(e) => e.stopPropagation()}
            >
              Website Terms of Use
            </a>
            {' and '}
            <a
              href="/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-brand-600 underline hover:text-brand-700"
              onClick={(e) => e.stopPropagation()}
            >
              Privacy Policy
            </a>
            .
          </span>
        </label>

        <button
          type="button"
          onClick={handleCheckout}
          disabled={loading || !hasSession || planFamilyBlocked || !termsAccepted}
          className="mt-4 w-full rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50 transition-colors"
        >
          {loading
            ? 'Processing...'
            : isFounding ? 'Complete setup' : 'Proceed to payment'}
        </button>

        <p className="mt-3 text-center text-xs text-slate-500">
          No per-booking fees. No commission. {STANDARD_PAYMENT_PROVIDER_FEES_NOTICE}{' '}
          {SUBSCRIPTION_CANCELLATION_PUBLIC_NOTICE}
        </p>
        {!isFounding && (
          <p className="mt-1 text-center text-xs text-slate-400">
            You&apos;ll be redirected to Stripe for secure payment.
          </p>
        )}
      </div>

      <div className="mt-4 text-center">
        <button
          type="button"
          onClick={() => router.back()}
          className="text-sm font-medium text-slate-400 hover:text-slate-600 transition-colors"
        >
          Go back
        </button>
      </div>
    </div>
  );
}
