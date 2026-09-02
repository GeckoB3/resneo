import Link from 'next/link';
import {
  APPOINTMENTS_LIGHT_PRICE,
  APPOINTMENTS_PLUS_PRICE,
  APPOINTMENTS_PRO_PRICE,
  SMS_OVERAGE_GBP_PER_MESSAGE,
} from '@/lib/pricing-constants';
import { SMS_INCLUDED_APPOINTMENTS, SMS_INCLUDED_LIGHT, SMS_INCLUDED_PLUS } from '@/lib/billing/sms-allowance';
import { SIGNUP_TRIAL_SHORT_LABEL, publicPricingFooterDisclaimer } from '@/lib/signup-trial-copy';

/**
 * The three Appointments plans.
 *
 * Every plan has every feature. The cards therefore lead with the three things
 * that actually differ (calendars, team logins, included SMS) and then repeat
 * the same short "included on every plan" list on each card, so a reader
 * comparing them side by side sees at once that the feature set is identical.
 * The full feature list lives in the "Everything included" section below.
 *
 * No card is singled out: the plans differ by team size, not by value, so
 * nudging a reader towards one would contradict the point of the page.
 *
 * The Restaurant plan is discontinued and is no longer sold here.
 */

const SMS_OVERAGE_PENCE = Math.round(SMS_OVERAGE_GBP_PER_MESSAGE * 100);

type Plan = {
  name: string;
  price: number;
  tagline: string;
  calendars: string;
  logins: string;
  sms: number;
  href: string;
};

const PLANS: Plan[] = [
  {
    name: 'Appointments Light',
    price: APPOINTMENTS_LIGHT_PRICE,
    tagline: 'For sole traders and single-chair businesses.',
    calendars: '1 bookable calendar',
    logins: '1 team login',
    sms: SMS_INCLUDED_LIGHT,
    href: '/signup/appointments-light',
  },
  {
    name: 'Appointments Plus',
    price: APPOINTMENTS_PLUS_PRICE,
    tagline: 'For small teams working from one venue.',
    calendars: 'Up to 5 bookable calendars',
    logins: 'Up to 5 team logins',
    sms: SMS_INCLUDED_PLUS,
    href: '/signup/plan?plan=plus',
  },
  {
    name: 'Appointments Pro',
    price: APPOINTMENTS_PRO_PRICE,
    tagline: 'For larger teams and busy venues.',
    calendars: 'Unlimited bookable calendars',
    logins: 'Unlimited team logins',
    sms: SMS_INCLUDED_APPOINTMENTS,
    href: '/signup/plan?plan=appointments',
  },
];

/** The same on every card, on purpose. */
const INCLUDED_EVERYWHERE = [
  'Online booking page and website widget',
  'Appointments, classes, events and resources',
  'Deposits, card holds and online payments',
  'Email and SMS reminders and marketing messages',
  'Client records, forms and reports',
  'iOS and Android apps',
];

export function PricingSection() {
  return (
    <section id="pricing" className="relative scroll-mt-16 overflow-hidden bg-[#FDFBF7] py-20 sm:py-28">
      <div className="pointer-events-none absolute -left-40 top-24 h-96 w-96 rounded-[58%_42%_55%_45%/48%_60%_40%_52%] bg-brand-50" aria-hidden />
      <div className="pointer-events-none absolute -right-32 bottom-10 h-80 w-80 rounded-[48%_52%_41%_59%/55%_40%_60%_45%] bg-accent-100/60" aria-hidden />
      <div className="relative mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-black tracking-tight text-brand-600 sm:text-4xl">Simple, transparent pricing</h2>
          <p className="mt-4 text-base leading-relaxed text-slate-600 sm:text-lg">
            Every plan includes every feature. Pick the plan that fits your team size, with no hidden costs and no paid add-ons.
          </p>
        </div>

        <div className="mx-auto mt-14 grid items-stretch gap-6 lg:grid-cols-3 lg:gap-8">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className="relative flex flex-col rounded-[28px] border border-[#EEE9E0] bg-white p-8 shadow-[0_18px_40px_-24px_rgba(0,59,111,0.25)]"
            >
              <h3 className="text-lg font-extrabold text-slate-900">{plan.name}</h3>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-4xl font-black text-brand-600">&pound;{plan.price}</span>
                <span className="text-sm font-semibold text-slate-500">/month</span>
              </div>
              <p className="mt-1 text-sm font-bold text-accent-700">{SIGNUP_TRIAL_SHORT_LABEL}</p>
              <p className="mt-2 text-sm font-medium leading-snug text-slate-700">{plan.tagline}</p>

              {/* What is different about this plan. */}
              <div className="mt-6 rounded-[20px] border border-brand-100 bg-brand-50/60 p-4">
                <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-brand-600">What you get</p>
                <ul className="mt-3 space-y-2 text-sm font-semibold text-slate-900">
                  <PlanFact icon="calendar" text={plan.calendars} />
                  <PlanFact icon="people" text={plan.logins} />
                  <PlanFact
                    icon="sms"
                    text={`${plan.sms} SMS a month included`}
                    note={`then ${SMS_OVERAGE_PENCE}p each`}
                  />
                </ul>
              </div>

              {/* What is the same about every plan. */}
              <div className="mt-6 flex-1">
                <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-slate-500">Included on every plan</p>
                <ul className="mt-3 space-y-2.5 text-sm text-slate-600">
                  {INCLUDED_EVERYWHERE.map((text) => (
                    <PricingFeature key={text} text={text} />
                  ))}
                </ul>
                <a
                  href="#included"
                  className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-brand-600 underline decoration-accent-500/60 decoration-2 underline-offset-4 hover:text-brand-700"
                >
                  See every feature
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                  </svg>
                </a>
              </div>

              <Link
                href={plan.href}
                className="mt-8 inline-flex h-12 w-full items-center justify-center rounded-full bg-brand-600 text-sm font-extrabold text-white shadow-lg shadow-brand-600/20 transition-all hover:-translate-y-0.5 hover:bg-brand-700"
              >
                Get started
              </Link>
            </div>
          ))}
        </div>

        <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-slate-500">
          Each plan covers one venue. No setup fees, no contracts, and no commission on your bookings.
        </p>

        <p className="mx-auto mt-6 max-w-2xl text-center text-sm leading-relaxed text-slate-500">
          {publicPricingFooterDisclaimer()}
        </p>

        <p className="mx-auto mt-10 max-w-2xl text-center text-sm leading-relaxed text-slate-600">
          Would you like help with onboarding?{' '}
          <a
            href="#contact"
            className="font-bold text-brand-600 underline decoration-accent-500/60 decoration-2 underline-offset-4 hover:text-brand-700"
          >
            Use our contact form
          </a>{' '}
          and we will walk you through setup for your business.
        </p>
      </div>
    </section>
  );
}

function PlanFact({ icon, text, note }: { icon: 'calendar' | 'people' | 'sms'; text: string; note?: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="mt-0.5 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center text-brand-600" aria-hidden>
        {icon === 'calendar' ? (
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
          </svg>
        ) : icon === 'people' ? (
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
          </svg>
        ) : (
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 0 0 6 3.75v16.5a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 20.25V3.75a2.25 2.25 0 0 0-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3" />
          </svg>
        )}
      </span>
      <span>
        {text}
        {note ? <span className="font-normal text-slate-500">, {note}</span> : null}
      </span>
    </li>
  );
}

function PricingFeature({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent-600" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
      </svg>
      {text}
    </li>
  );
}
