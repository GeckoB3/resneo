'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/browser';
import { fetchPendingSignupSelection, syncPendingToSessionStorage } from '@/lib/signup-pending-client';
import { isSignupPaymentReady } from '@/lib/signup-pending-selection';
import { formatSignupBusinessTypeLabel } from '@/lib/business-config';
import { DEFAULT_RESTAURANT_FAMILY_BUSINESS_TYPE } from '@/lib/signup-resume';
import {
  APPOINTMENTS_PLUS_PRICE,
  APPOINTMENTS_PRO_PRICE,
  RESTAURANT_PRICE,
  FOUNDING_PARTNER_CAP,
  SMS_OVERAGE_GBP_PER_MESSAGE,
} from '@/lib/pricing-constants';
import { SMS_INCLUDED_APPOINTMENTS, SMS_INCLUDED_PLUS, SMS_INCLUDED_RESTAURANT } from '@/lib/billing/sms-allowance';
import { STANDARD_PAYMENT_PROVIDER_FEES_NOTICE } from '@/lib/payment-provider-fees-notice';
import { SUBSCRIPTION_CANCELLATION_PUBLIC_NOTICE } from '@/lib/subscription-cancellation-copy';

type PlanType = 'appointments' | 'plus' | 'light' | 'restaurant' | 'founding';

export default function PlanPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [businessType, setBusinessType] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanType | null>(null);
  const [foundingRemaining, setFoundingRemaining] = useState<number | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let bt = sessionStorage.getItem('signup_business_type');
      const queryPlan = searchParams.get('plan') as PlanType | null;
      let storedPlan = sessionStorage.getItem('signup_plan') as PlanType | null;

      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      let resolvedPlan = queryPlan ?? storedPlan;
      let resolvedBt = bt;

      if (
        (!resolvedPlan ||
          (resolvedPlan !== 'appointments' &&
            resolvedPlan !== 'plus' &&
            resolvedPlan !== 'light' &&
            !resolvedBt)) &&
        session
      ) {
        const pending = await fetchPendingSignupSelection();
        if (cancelled) return;
        if (pending?.plan && isSignupPaymentReady(pending.plan, pending.business_type)) {
          syncPendingToSessionStorage(pending.plan, pending.business_type);
          router.replace('/signup/payment');
          return;
        }
        if (
          pending?.plan &&
          (pending.plan === 'appointments' || pending.plan === 'plus' || pending.plan === 'light' || pending.business_type)
        ) {
          syncPendingToSessionStorage(pending.plan, pending.business_type);
          storedPlan = pending.plan;
          bt = pending.business_type;
          resolvedPlan = queryPlan ?? storedPlan;
          resolvedBt = bt;
        }
      }

      if (cancelled) return;
      if (resolvedPlan) {
        sessionStorage.setItem('signup_plan', resolvedPlan);
      }
      if (
        resolvedPlan &&
        (resolvedPlan === 'restaurant' || resolvedPlan === 'founding') &&
        !resolvedBt
      ) {
        resolvedBt = DEFAULT_RESTAURANT_FAMILY_BUSINESS_TYPE;
        sessionStorage.setItem('signup_business_type', resolvedBt);
      }
      if (!resolvedPlan) {
        router.push('/signup/business-type');
        return;
      }
      if (resolvedPlan === 'light') {
        if (!cancelled) router.replace('/signup');
        return;
      }
      setBusinessType(resolvedBt);
      setPlan(resolvedPlan);
    })();
    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  useEffect(() => {
    if (plan !== 'founding') return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/signup/founding-spots');
        const data = (await res.json()) as { remaining?: number };
        const rem = typeof data.remaining === 'number' ? data.remaining : 0;
        if (cancelled) return;
        setFoundingRemaining(rem);
        if (rem <= 0) setPlan('restaurant');
      } catch {
        if (!cancelled) {
          setFoundingRemaining(0);
          setPlan('restaurant');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [plan]);

  function handleContinue() {
    if (!plan) return;
    sessionStorage.setItem('signup_plan', plan);
    router.push('/signup');
  }

  if (!plan) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
      </div>
    );
  }

  const overagePence = Math.round(SMS_OVERAGE_GBP_PER_MESSAGE * 100);

  if (plan === 'founding') {
    if (foundingRemaining === null) {
      return (
        <div className="flex min-h-[40vh] w-full max-w-xl flex-col items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
          <p className="mt-3 text-sm text-slate-500">Checking availability…</p>
        </div>
      );
    }

    return (
      <div className="w-full max-w-xl">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-slate-900">Founding Partner</h1>
          <p className="mt-2 text-sm text-slate-500">
            {businessType ? `Your selection: ${formatSignupBusinessTypeLabel(businessType)}` : 'Restaurant plan for early founding venues'}
          </p>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-6 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold text-slate-900">Founding Partner</h2>
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
              {foundingRemaining} of {FOUNDING_PARTNER_CAP} spots remaining
            </span>
          </div>
          <p className="mt-3 text-sm text-slate-700">
            Restaurant plan free for 6 months, then &pound;{RESTAURANT_PRICE}/month. Full access including SMS reminders,
            deposit collection, and table management.
          </p>
          <ul className="mt-4 space-y-2 text-sm text-slate-600">
            <FeatureItem text="Table management with timeline grid and floor plan" />
            <FeatureItem text={`${SMS_INCLUDED_RESTAURANT} SMS messages included per month`} />
            <FeatureItem text="Deposit and payment collection via Stripe" />
            <FeatureItem text="Priority support" />
          </ul>
        </div>
        <p className="mt-6 text-center text-xs text-slate-500">
          No per-booking fees. No commission. {STANDARD_PAYMENT_PROVIDER_FEES_NOTICE}{' '}
          {SUBSCRIPTION_CANCELLATION_PUBLIC_NOTICE}
        </p>
        <LegalAcceptanceCheckbox accepted={termsAccepted} onChange={setTermsAccepted} />
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={handleContinue}
            disabled={!termsAccepted}
            className="rounded-xl bg-emerald-600 px-8 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Activate Founding Partner Plan
          </button>
        </div>
      </div>
    );
  }

  const isRestaurant = plan === 'restaurant';

  if (isRestaurant) {
    const smsIncluded = SMS_INCLUDED_RESTAURANT;
    return (
      <div className="w-full max-w-xl">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-slate-900">Your plan</h1>
          {businessType ? (
            <p className="mt-2 text-sm text-slate-500">
              Your selection: {formatSignupBusinessTypeLabel(businessType)}
            </p>
          ) : null}
        </div>
        <div className="rounded-2xl border border-brand-200 bg-brand-50/30 p-6 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900">Restaurant</h2>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-2xl font-extrabold text-slate-900">&pound;{RESTAURANT_PRICE}</span>
            <span className="text-sm text-slate-500">/month</span>
          </div>
          <p className="mt-2 text-xs text-slate-500">Single venue only.</p>
          <ul className="mt-4 space-y-2 text-sm text-slate-600">
            <FeatureItem text="Table management with timeline grid and floor plan" />
            <FeatureItem text="Plus all appointment booking types if needed" />
            <FeatureItem text={`${smsIncluded} SMS messages included per month`} />
            <FeatureItem text={`Additional SMS at ${overagePence}p each`} />
            <FeatureItem text="Bookings, deposits, reminders, guest records, reporting" />
            <FeatureItem text="Priority support" />
          </ul>
        </div>
        <p className="mt-6 text-center text-xs text-slate-500">
          No per-booking fees. No commission. {STANDARD_PAYMENT_PROVIDER_FEES_NOTICE}{' '}
          {SUBSCRIPTION_CANCELLATION_PUBLIC_NOTICE}
        </p>
        <LegalAcceptanceCheckbox accepted={termsAccepted} onChange={setTermsAccepted} />
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={handleContinue}
            disabled={!termsAccepted}
            className="rounded-xl bg-brand-600 px-8 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  if (plan === 'plus') {
    const smsIncluded = SMS_INCLUDED_PLUS;
    return (
      <div className="w-full max-w-xl">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-slate-900">Your plan</h1>
          {businessType ? (
            <p className="mt-2 text-sm text-slate-500">
              Your business: {formatSignupBusinessTypeLabel(businessType)}
            </p>
          ) : (
            <p className="mt-2 text-sm text-slate-500">Appointments Plus: up to 5 calendars and 5 team members.</p>
          )}
        </div>
        <div className="rounded-2xl border border-brand-200 bg-brand-50/30 p-6 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900">Appointments Plus</h2>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-2xl font-extrabold text-slate-900">&pound;{APPOINTMENTS_PLUS_PRICE}</span>
            <span className="text-sm text-slate-500">/month</span>
          </div>
          <p className="mt-2 text-xs text-slate-500">Single venue only.</p>
          <ul className="mt-4 space-y-2 text-sm text-slate-600">
            <FeatureItem text="Up to 5 bookable calendars and 5 team members" />
            <FeatureItem text="Appointments, classes, events, and resource booking" />
            <FeatureItem text={`${smsIncluded} SMS per month included, then ${overagePence}p each`} />
            <FeatureItem text="Personal booking links per staff member" />
            <FeatureItem text="Phone and email support" />
          </ul>
        </div>
        <p className="mt-6 text-center text-xs text-slate-500">
          No per-booking fees. No commission. {STANDARD_PAYMENT_PROVIDER_FEES_NOTICE}{' '}
          {SUBSCRIPTION_CANCELLATION_PUBLIC_NOTICE}
        </p>
        <LegalAcceptanceCheckbox accepted={termsAccepted} onChange={setTermsAccepted} />
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={handleContinue}
            disabled={!termsAccepted}
            className="rounded-xl bg-brand-600 px-8 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Get Started
          </button>
        </div>
      </div>
    );
  }

  if (plan === 'appointments') {
    const smsIncluded = SMS_INCLUDED_APPOINTMENTS;
    return (
      <div className="w-full max-w-xl">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-slate-900">Your plan</h1>
          {businessType ? (
            <p className="mt-2 text-sm text-slate-500">
              Your business: {formatSignupBusinessTypeLabel(businessType)}
            </p>
          ) : (
            <p className="mt-2 text-sm text-slate-500">Appointments Pro: unlimited calendars and team members.</p>
          )}
        </div>
        <div className="rounded-2xl border border-brand-200 bg-brand-50/30 p-6 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900">Appointments Pro</h2>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-2xl font-extrabold text-slate-900">&pound;{APPOINTMENTS_PRO_PRICE}</span>
            <span className="text-sm text-slate-500">/month</span>
          </div>
          <p className="mt-2 text-xs text-slate-500">Single venue only. For teams of any size.</p>
          <ul className="mt-4 space-y-2 text-sm text-slate-600">
            <FeatureItem text="Unlimited calendars and team members" />
            <FeatureItem text="Appointments, classes, events, and resource booking" />
            <FeatureItem text={`${smsIncluded} SMS per month included, then ${overagePence}p each`} />
            <FeatureItem text="Personal booking links per staff member" />
            <FeatureItem text="Phone and email support" />
          </ul>
        </div>
        <p className="mt-6 text-center text-xs text-slate-500">
          No per-booking fees. No commission. {STANDARD_PAYMENT_PROVIDER_FEES_NOTICE}{' '}
          {SUBSCRIPTION_CANCELLATION_PUBLIC_NOTICE}
        </p>
        <LegalAcceptanceCheckbox accepted={termsAccepted} onChange={setTermsAccepted} />
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={handleContinue}
            disabled={!termsAccepted}
            className="rounded-xl bg-brand-600 px-8 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Get Started
          </button>
        </div>
      </div>
    );
  }

  return null;
}

function LegalAcceptanceCheckbox({
  accepted,
  onChange,
}: {
  accepted: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <input
        type="checkbox"
        checked={accepted}
        onChange={(e) => onChange(e.target.checked)}
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
  );
}

function FeatureItem({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-2">
      <svg
        className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-600"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={2}
        stroke="currentColor"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
      </svg>
      {text}
    </li>
  );
}
