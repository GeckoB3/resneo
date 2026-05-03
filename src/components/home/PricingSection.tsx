'use client';

import { useState } from 'react';
import Link from 'next/link';
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
              <p className="mt-2 text-sm font-medium leading-snug text-slate-700">Card required at signup. For sole traders getting started.</p>
              <ul className="mt-6 flex-1 space-y-3 text-sm text-slate-600">
                <PricingFeature text="One calendar for you and your business" />
                <PricingFeature text="Online booking page your clients can use 24/7" />
                <PricingFeature text="Appointments, classes, events, and resource booking" />
                <PricingFeature text="Automated email reminders included" />
                <PricingFeature text={`0 SMS included; pay-as-you-go at ${Math.round(SMS_LIGHT_GBP_PER_MESSAGE * 100)}p per SMS`} />
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
              <p className="mt-2 text-sm font-medium leading-snug text-slate-700">For growing teams (up to 5 calendars and 5 users).</p>
              <p className="mt-1 text-xs text-slate-500">Single venue only.</p>
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
              <p className="mt-2 text-sm font-medium leading-snug text-slate-700">For teams of any size.</p>
              <p className="mt-1 text-xs text-slate-500">Single venue only.</p>
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

        <p className="mx-auto mt-10 max-w-2xl text-center text-sm text-slate-500">
          No per-booking fees. No commission. {STANDARD_PAYMENT_PROVIDER_FEES_NOTICE} {SUBSCRIPTION_CANCELLATION_PUBLIC_NOTICE}
        </p>

        <div className="mx-auto mt-10 max-w-4xl overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white shadow-sm">
          <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-bold text-slate-900">Founding Partner</h3>
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                  Limited
                </span>
                <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800 ring-1 ring-emerald-200">
                  50% off for six months
                </span>
              </div>
              <p className="mt-2 text-sm font-medium text-emerald-900">
                Choose any Appointments or Restaurant plan (whichever fits your business). We onboard you personally.
              </p>
              <p className="mt-1 text-xs text-emerald-700">Limited spots available.</p>
            </div>
            <a
              href="#contact"
              className="inline-flex h-11 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-600 px-6 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 sm:min-w-[10rem]"
            >
              Apply now
            </a>
          </div>
        </div>
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
