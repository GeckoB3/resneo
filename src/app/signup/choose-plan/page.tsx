'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  APPOINTMENTS_LIGHT_PRICE,
  APPOINTMENTS_PLUS_PRICE,
  APPOINTMENTS_PRO_PRICE,
  RESTAURANT_PRICE,
  SMS_OVERAGE_GBP_PER_MESSAGE,
} from '@/lib/pricing-constants';
import {
  SMS_INCLUDED_APPOINTMENTS,
  SMS_INCLUDED_LIGHT,
  SMS_INCLUDED_PLUS,
  SMS_INCLUDED_RESTAURANT,
} from '@/lib/billing/sms-allowance';
import { SIGNUP_TRIAL_SHORT_LABEL, publicPricingFooterDisclaimer } from '@/lib/signup-trial-copy';
import {
  loadReferralCodeFromCookieOrUrl,
  persistReferralCodeCookie,
  clearReferralCodeCookie,
  validateReferralCodeClient,
  type ReferralValidationOk,
} from '@/lib/referrals/client';
import {
  loadSalesCodeFromCookieOrUrl,
  validateSalesCodeClient,
  type SalesValidationOk,
} from '@/lib/sales/client';
import { SALES_REFEREE_BONUS_DAYS } from '@/lib/sales/constants';

type Segment = 'appointments' | 'restaurant';

/**
 * Plan-selection landing page for referral links and any deep-link signup entry that
 * needs the user to pick a plan first. The destination CTAs match the homepage
 * PricingSection so the funnel continues as normal — only the referral cookie is
 * persisted before the user lands on /signup/plan or /signup/appointments-light.
 */
export default function ChoosePlanPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [segment, setSegment] = useState<Segment>('appointments');
  const [referralValid, setReferralValid] = useState<ReferralValidationOk | null>(null);
  const [salesValid, setSalesValid] = useState<SalesValidationOk | null>(null);
  const [referralLoading, setReferralLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const salesFromUrl = searchParams?.get('sales') ?? null;
      const salesInitial = loadSalesCodeFromCookieOrUrl(salesFromUrl);
      if (salesInitial) {
        const salesResult = await validateSalesCodeClient(salesInitial);
        if (cancelled) return;
        if (salesResult.ok) {
          setSalesValid(salesResult);
          setReferralValid(null);
          setReferralLoading(false);
          return;
        }
      }

      const fromUrl = searchParams?.get('ref') ?? null;
      const initial = loadReferralCodeFromCookieOrUrl(fromUrl);
      if (!initial) {
        if (!cancelled) setReferralLoading(false);
        return;
      }
      const result = await validateReferralCodeClient(initial);
      if (cancelled) return;
      if (result.ok) {
        setReferralValid(result);
        persistReferralCodeCookie(result.code);
      } else {
        setReferralValid(null);
        clearReferralCodeCookie();
      }
      setReferralLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  const overagePence = Math.round(SMS_OVERAGE_GBP_PER_MESSAGE * 100);

  // Internal navigation helpers — keep sessionStorage in sync with each CTA so the
  // subsequent /signup or /signup/plan page resumes cleanly.
  function chooseAppointmentsLight() {
    sessionStorage.setItem('signup_plan', 'light');
    sessionStorage.removeItem('signup_business_type');
    router.push('/signup/appointments-light');
  }
  function chooseAppointmentsPlus() {
    sessionStorage.setItem('signup_plan', 'plus');
    sessionStorage.removeItem('signup_business_type');
    router.push('/signup/plan?plan=plus');
  }
  function chooseAppointmentsPro() {
    sessionStorage.setItem('signup_plan', 'appointments');
    sessionStorage.removeItem('signup_business_type');
    router.push('/signup/plan?plan=appointments');
  }
  function chooseRestaurant() {
    sessionStorage.setItem('signup_plan', 'restaurant');
    router.push('/signup/plan?plan=restaurant');
  }

  return (
    <div className="w-full max-w-5xl">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Choose your plan</h1>
        <p className="mt-2 text-sm text-slate-500">
          Pick the plan that fits your business. You can change it later.
        </p>
      </div>

      {!referralLoading && salesValid && (
        <div className="mx-auto mb-6 max-w-2xl rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <p className="font-medium">Sales offer applied ({salesValid.code})</p>
          <p className="mt-1 text-blue-800">
            Your trial includes an extra {SALES_REFEREE_BONUS_DAYS} days on any plan you choose below.
          </p>
        </div>
      )}

      {!referralLoading && referralValid && !salesValid && (
        <div className="mx-auto mb-6 max-w-2xl rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <p className="font-medium">Referred by {referralValid.referrer_venue_name}</p>
          <p className="mt-1 text-emerald-800">
            Your first month is free after your 14-day trial — on any plan you choose below.
          </p>
        </div>
      )}

      <div className="mx-auto mt-2 flex justify-center">
        <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-1 shadow-sm">
          <button
            type="button"
            onClick={() => setSegment('appointments')}
            className={`rounded-full px-5 py-2 text-sm font-semibold transition-colors ${
              segment === 'appointments'
                ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Appointments business
          </button>
          <button
            type="button"
            onClick={() => setSegment('restaurant')}
            className={`rounded-full px-5 py-2 text-sm font-semibold transition-colors ${
              segment === 'restaurant'
                ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Restaurant
          </button>
        </div>
      </div>

      {segment === 'appointments' ? (
        <div className="mx-auto mt-10 grid items-stretch gap-6 lg:grid-cols-3">
          <PlanCard
            title="Appointments Light"
            price={APPOINTMENTS_LIGHT_PRICE}
            tagline="For sole traders getting started."
            features={[
              'One calendar for you and your business',
              'Online booking page your clients can use 24/7',
              'Appointments, classes, events, and resource booking',
              'Automated email reminders included',
              `${SMS_INCLUDED_LIGHT} SMS per month included, then ${overagePence}p each`,
              'Client records with visit history',
              'Email support',
            ]}
            ctaLabel="Choose Light"
            onClick={chooseAppointmentsLight}
          />
          <PlanCard
            title="Appointments Plus"
            price={APPOINTMENTS_PLUS_PRICE}
            tagline="For growing teams (up to 5 calendars and 5 users)."
            features={[
              'Up to 5 bookable calendars and 5 team members',
              'Everything in Light, plus:',
              `${SMS_INCLUDED_PLUS} SMS per month included, then ${overagePence}p each`,
              'Personal booking links per staff member',
              'Phone and email support',
            ]}
            ctaLabel="Choose Plus"
            onClick={chooseAppointmentsPlus}
            highlight
          />
          <PlanCard
            title="Appointments Pro"
            price={APPOINTMENTS_PRO_PRICE}
            tagline="For teams of any size."
            features={[
              'Unlimited calendars and team members',
              'Everything in Light, plus:',
              `${SMS_INCLUDED_APPOINTMENTS} SMS per month included, then ${overagePence}p each`,
              'Personal booking links per staff member',
              'Phone and email support',
            ]}
            ctaLabel="Choose Pro"
            onClick={chooseAppointmentsPro}
          />
        </div>
      ) : (
        <div className="mx-auto mt-10 flex max-w-xl flex-col items-stretch gap-6">
          <PlanCard
            title="Restaurant"
            price={RESTAURANT_PRICE}
            tagline="For restaurants, cafes, pubs, and hotel dining."
            features={[
              'Table management with timeline grid and floor plan',
              'Plus all appointment booking types if needed',
              `${SMS_INCLUDED_RESTAURANT} SMS messages included per month`,
              `Additional SMS at ${overagePence}p each`,
              'Bookings, deposits, reminders, guest records, reporting',
              'Email and SMS communications',
              'Priority support',
            ]}
            ctaLabel="Choose Restaurant"
            onClick={chooseRestaurant}
          />
        </div>
      )}

      <p className="mx-auto mt-10 max-w-2xl text-center text-sm leading-relaxed text-slate-500">
        {publicPricingFooterDisclaimer()}
      </p>

      <p className="mx-auto mt-6 max-w-2xl text-center text-xs text-slate-500">
        Already have an account?{' '}
        <Link href="/login" className="font-semibold text-brand-600 hover:text-brand-700">
          Sign in
        </Link>
      </p>
    </div>
  );
}

function PlanCard({
  title,
  price,
  tagline,
  features,
  ctaLabel,
  onClick,
  highlight = false,
}: {
  title: string;
  price: number;
  tagline: string;
  features: string[];
  ctaLabel: string;
  onClick: () => void;
  highlight?: boolean;
}) {
  return (
    <div
      className={`flex flex-col rounded-2xl border bg-white p-7 shadow-sm ${
        highlight ? 'border-brand-200 ring-1 ring-brand-100' : 'border-slate-200'
      }`}
    >
      <h3 className="text-lg font-bold text-slate-900">{title}</h3>
      <div className="mt-3 flex items-baseline gap-1">
        <span className="text-4xl font-extrabold text-slate-900">&pound;{price}</span>
        <span className="text-sm text-slate-500">/month</span>
      </div>
      <p className="mt-1 text-sm font-semibold text-brand-600">{SIGNUP_TRIAL_SHORT_LABEL}</p>
      <p className="mt-2 text-sm font-medium leading-snug text-slate-700">{tagline}</p>
      <ul className="mt-6 flex-1 space-y-3 text-sm text-slate-600">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2.5">
            <svg
              className="mt-0.5 h-5 w-5 flex-shrink-0 text-brand-600"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onClick}
        className="mt-8 inline-flex h-11 w-full items-center justify-center rounded-xl bg-brand-600 text-sm font-semibold text-white shadow-lg shadow-brand-600/20 transition-colors hover:bg-brand-700"
      >
        {ctaLabel}
      </button>
    </div>
  );
}
