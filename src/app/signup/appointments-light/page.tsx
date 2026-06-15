'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LegalAcceptanceCheckbox } from '@/components/signup/LegalAcceptanceCheckbox';
import { APPOINTMENTS_LIGHT_PRICE, SMS_OVERAGE_GBP_PER_MESSAGE } from '@/lib/pricing-constants';
import { SMS_INCLUDED_LIGHT } from '@/lib/billing/sms-allowance';
import { STANDARD_PAYMENT_PROVIDER_FEES_NOTICE } from '@/lib/payment-provider-fees-notice';
import { SUBSCRIPTION_CANCELLATION_PUBLIC_NOTICE } from '@/lib/subscription-cancellation-copy';
import {
  SIGNUP_TRIAL_DAYS,
  SIGNUP_TRIAL_PAYMENT_FAILURE_NOTICE,
  signupTrialCardNotice,
  signupTrialThenPrice,
  signupTrialSmsDuringTrialNotice,
} from '@/lib/signup-trial-copy';
import { SALES_SIGNUP_TRIAL_DAYS } from '@/lib/sales/constants';
import { useSalesTrial } from '@/lib/sales/use-sales-trial';

export default function AppointmentsLightIntroPage() {
  const router = useRouter();
  const overagePence = Math.round(SMS_OVERAGE_GBP_PER_MESSAGE * 100);
  const [termsAccepted, setTermsAccepted] = useState(false);
  // A validated commissioned-sales code (persisted as a cookie upstream) earns 1 month free, so
  // the trial copy matches the offer payment validates and Stripe charges.
  const salesTrial = useSalesTrial();
  const trialDays = salesTrial ? SALES_SIGNUP_TRIAL_DAYS : SIGNUP_TRIAL_DAYS;

  useEffect(() => {
    sessionStorage.removeItem('signup_business_type');
  }, []);

  function handleContinue() {
    if (!termsAccepted) return;
    sessionStorage.setItem('signup_plan', 'light');
    router.push('/signup');
  }

  return (
    <div className="w-full max-w-xl">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-slate-900">Appointments Light</h1>
        <p className="mt-2 text-sm text-slate-500">
          {signupTrialThenPrice(APPOINTMENTS_LIGHT_PRICE, trialDays)} with card at checkout. Built for sole traders who
          need one bookable calendar and a clear client booking page.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-medium text-slate-800">What you get</p>
        <ul className="mt-4 space-y-2.5 text-sm text-slate-600">
          <SummaryItem text="One calendar for you and your business" />
          <SummaryItem text="An online booking page your clients can use at any time" />
          <SummaryItem text="Appointments, classes, events, and resource booking in one place" />
          <SummaryItem text="Automated email reminders included" />
          <SummaryItem text={`${SMS_INCLUDED_LIGHT} SMS per month included, then ${overagePence}p each`} />
          <SummaryItem text="Client records with visit history" />
          <SummaryItem text="Email support" />
        </ul>
        <p className="mt-5 text-xs text-slate-500">
          {signupTrialCardNotice(trialDays)} {signupTrialSmsDuringTrialNotice()} {SIGNUP_TRIAL_PAYMENT_FAILURE_NOTICE}
        </p>
        <p className="mt-3 text-xs text-slate-500">
          After checkout you will choose which booking models to use for your venue, then onboarding will guide you
          through setup. You can change models later in Settings.
        </p>
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
          className="rounded-xl bg-brand-600 px-8 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

function SummaryItem({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-2">
      <svg
        className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-600"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={2}
        stroke="currentColor"
        aria-hidden
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
      </svg>
      <span>{text}</span>
    </li>
  );
}
