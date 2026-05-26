'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  APPOINTMENTS_LIGHT_PRICE,
  APPOINTMENTS_PLUS_PRICE,
  APPOINTMENTS_PRO_PRICE,
  RESTAURANT_PRICE,
  SMS_OVERAGE_GBP_PER_MESSAGE,
} from '@/lib/pricing-constants';
import { SMS_INCLUDED_APPOINTMENTS, SMS_INCLUDED_LIGHT, SMS_INCLUDED_PLUS, SMS_INCLUDED_RESTAURANT } from '@/lib/billing/sms-allowance';
import { SIGNUP_TRIAL_SHORT_LABEL, publicPricingFooterDisclaimer } from '@/lib/signup-trial-copy';

type Segment = 'appointments' | 'restaurant';

export function PricingSection() {
  const [segment, setSegment] = useState<Segment>('appointments');

  return (
    <section id="pricing" className="scroll-mt-16 bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-5xl px-6">
        <h2 className="text-center text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Simple, transparent pricing</h2>

        <div className="mx-auto mt-10 flex justify-center">
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
          <div className="mx-auto mt-14 grid max-w-6xl items-stretch gap-8 lg:grid-cols-3">
            {/* Appointments Light */}
            <div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
              <h3 className="text-lg font-bold text-slate-900">Appointments Light</h3>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-4xl font-extrabold text-slate-900">&pound;{APPOINTMENTS_LIGHT_PRICE}</span>
                <span className="text-sm text-slate-500">/month</span>
              </div>
              <p className="mt-1 text-sm font-semibold text-brand-600">{SIGNUP_TRIAL_SHORT_LABEL}</p>
              <p className="mt-2 text-sm font-medium leading-snug text-slate-700">For sole traders getting started.</p>
              <ul className="mt-6 flex-1 space-y-3 text-sm text-slate-600">
                <PricingFeature text="One calendar for you and your business" />
                <PricingFeature text="Online booking page your clients can use 24/7" />
                <PricingFeature text="Appointments, classes, events, and resource booking" />
                <PricingFeature text="Automated email reminders included" />
                <PricingFeature text={`${SMS_INCLUDED_LIGHT} SMS per month included, then ${Math.round(SMS_OVERAGE_GBP_PER_MESSAGE * 100)}p each`} />
                <PricingFeature text="Client records with visit history" />
                <PricingFeature text="Email support" />
              </ul>
              <Link href="/signup/appointments-light" className="mt-8 inline-flex h-11 w-full items-center justify-center rounded-xl bg-brand-600 text-sm font-semibold text-white shadow-lg shadow-brand-600/20 transition-colors hover:bg-brand-700">
                Get started
              </Link>
            </div>

            {/* Appointments Plus */}
            <div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
              <h3 className="text-lg font-bold text-slate-900">Appointments Plus</h3>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-4xl font-extrabold text-slate-900">&pound;{APPOINTMENTS_PLUS_PRICE}</span>
                <span className="text-sm text-slate-500">/month</span>
              </div>
              <p className="mt-1 text-sm font-semibold text-brand-600">{SIGNUP_TRIAL_SHORT_LABEL}</p>
              <p className="mt-2 text-sm font-medium leading-snug text-slate-700">For growing teams (up to 5 calendars and 5 users).</p>
              <p className="mt-1 text-xs text-slate-500">Single venue.</p>
              <ul className="mt-6 flex-1 space-y-3 text-sm text-slate-600">
                <PricingFeature text="Up to 5 bookable calendars and 5 team members" />
                <PricingFeature text="Everything in Light, plus:" />
                <PricingFeature text={`${SMS_INCLUDED_PLUS} SMS per month included, then ${Math.round(SMS_OVERAGE_GBP_PER_MESSAGE * 100)}p each`} />
                <PricingFeature text="Personal booking links per staff member" />
                <PricingFeature text="Phone and email support" />
              </ul>
              <Link href="/signup/plan?plan=plus" className="mt-8 inline-flex h-11 w-full items-center justify-center rounded-xl bg-brand-600 text-sm font-semibold text-white shadow-lg shadow-brand-600/20 transition-colors hover:bg-brand-700">
                Get started
              </Link>
            </div>

            {/* Appointments Pro */}
            <div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
              <h3 className="text-lg font-bold text-slate-900">Appointments Pro</h3>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-4xl font-extrabold text-slate-900">&pound;{APPOINTMENTS_PRO_PRICE}</span>
                <span className="text-sm text-slate-500">/month</span>
              </div>
              <p className="mt-1 text-sm font-semibold text-brand-600">{SIGNUP_TRIAL_SHORT_LABEL}</p>
              <p className="mt-2 text-sm font-medium leading-snug text-slate-700">For teams of any size.</p>
              <p className="mt-1 text-xs text-slate-500">Single venue.</p>
              <ul className="mt-6 flex-1 space-y-3 text-sm text-slate-600">
                <PricingFeature text="Unlimited calendars and team members" />
                <PricingFeature text="Everything in Light, plus:" />
                <PricingFeature text={`${SMS_INCLUDED_APPOINTMENTS} SMS per month included, then ${Math.round(SMS_OVERAGE_GBP_PER_MESSAGE * 100)}p each`} />
                <PricingFeature text="Personal booking links per staff member" />
                <PricingFeature text="Phone and email support" />
              </ul>
              <Link href="/signup/plan?plan=appointments" className="mt-8 inline-flex h-11 w-full items-center justify-center rounded-xl bg-brand-600 text-sm font-semibold text-white shadow-lg shadow-brand-600/20 transition-colors hover:bg-brand-700">
                Get started
              </Link>
            </div>
          </div>
        ) : (
          <div className="mx-auto mt-14 flex max-w-xl flex-col items-stretch gap-8">
            <div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
              <h3 className="text-lg font-bold text-slate-900">Restaurant</h3>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-4xl font-extrabold text-slate-900">&pound;{RESTAURANT_PRICE}</span>
                <span className="text-sm text-slate-500">/month</span>
              </div>
              <p className="mt-1 text-sm font-semibold text-brand-600">{SIGNUP_TRIAL_SHORT_LABEL}</p>
              <p className="mt-2 text-sm font-medium leading-snug text-slate-700">
                For restaurants, cafes, pubs, and hotel dining.
              </p>
              <p className="mt-1 text-xs text-slate-500">Single venue only.</p>
              <ul className="mt-6 flex-1 space-y-3 text-sm text-slate-600">
                <PricingFeature text="Table management with timeline grid and floor plan" />
                <PricingFeature text="Plus all appointment booking types if needed" />
                <PricingFeature text={`${SMS_INCLUDED_RESTAURANT} SMS messages included per month`} />
                <PricingFeature text={`Additional SMS at ${Math.round(SMS_OVERAGE_GBP_PER_MESSAGE * 100)}p each`} />
                <PricingFeature text="Bookings, deposits, reminders, guest records, reporting" />
                <PricingFeature text="Email and SMS communications" />
                <PricingFeature text="Priority support" />
              </ul>
              <Link href="/signup/plan?plan=restaurant" className="mt-8 inline-flex h-11 w-full items-center justify-center rounded-xl bg-brand-600 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700">
                Get started
              </Link>
            </div>
          </div>
        )}

        <p className="mx-auto mt-10 max-w-2xl text-center text-sm leading-relaxed text-slate-500">
          {publicPricingFooterDisclaimer()}
        </p>

        <p className="mx-auto mt-10 max-w-2xl text-center text-sm leading-relaxed text-slate-600">
          Would you like help with onboarding?{' '}
          <a
            href="#contact"
            className="font-semibold text-brand-600 underline decoration-brand-600/30 underline-offset-2 hover:text-brand-700"
          >
            Use our contact form
          </a>{' '}
          and we will walk you through setup for your business.
        </p>
      </div>
    </section>
  );
}

function PricingFeature({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-brand-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
      </svg>
      {text}
    </li>
  );
}
