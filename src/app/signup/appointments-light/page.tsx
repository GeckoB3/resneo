'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LegalAcceptanceCheckbox } from '@/components/signup/LegalAcceptanceCheckbox';
import {
  APPOINTMENTS_LIGHT_PRICE,
  SMS_LIGHT_GBP_PER_MESSAGE,
} from '@/lib/pricing-constants';
import { STANDARD_PAYMENT_PROVIDER_FEES_NOTICE } from '@/lib/payment-provider-fees-notice';
import { SUBSCRIPTION_CANCELLATION_PUBLIC_NOTICE } from '@/lib/subscription-cancellation-copy';

export default function AppointmentsLightIntroPage() {
  const router = useRouter();
  const smsPence = Math.round(SMS_LIGHT_GBP_PER_MESSAGE * 100);
  const [termsAccepted, setTermsAccepted] = useState(false);

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
          &pound;{APPOINTMENTS_LIGHT_PRICE}/month from day one, with card at checkout. Built for sole traders who need one
          bookable calendar and a clear client booking page.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-medium text-slate-800">What you get</p>
        <ul className="mt-4 space-y-2.5 text-sm text-slate-600">
          <SummaryItem text="One calendar for you and your business" />
          <SummaryItem text="An online booking page your clients can use at any time" />
          <SummaryItem text="Appointments, classes, events, and resource booking in one place" />
          <SummaryItem text="Automated email reminders included" />
          <SummaryItem text={`0 SMS included; pay-as-you-go at ${smsPence}p per SMS via Stripe`} />
          <SummaryItem text="Client records with visit history" />
          <SummaryItem text="Email support" />
        </ul>
        <p className="mt-5 text-xs text-slate-500">
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
