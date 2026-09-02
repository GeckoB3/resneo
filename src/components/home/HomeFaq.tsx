'use client';

import { useCallback, useId, useState } from 'react';
import {
  APPOINTMENTS_LIGHT_PRICE,
  APPOINTMENTS_PLUS_PRICE,
  APPOINTMENTS_PRO_PRICE,
  SMS_OVERAGE_GBP_PER_MESSAGE,
} from '@/lib/pricing-constants';
import { SMS_INCLUDED_APPOINTMENTS, SMS_INCLUDED_LIGHT, SMS_INCLUDED_PLUS } from '@/lib/billing/sms-allowance';
import { RESNEO_MARKETING_PAYMENTS_AND_NO_HOLD } from '@/lib/booking-funds-copy';
import { STANDARD_PAYMENT_PROVIDER_FEES_NOTICE } from '@/lib/payment-provider-fees-notice';
import { SUBSCRIPTION_CANCELLATION_PUBLIC_NOTICE } from '@/lib/subscription-cancellation-copy';
import {
  SIGNUP_TRIAL_CARD_NOTICE,
  SIGNUP_TRIAL_SHORT_LABEL,
  signupTrialSmsDuringTrialNotice,
} from '@/lib/signup-trial-copy';

type FaqItem = { question: string; answer: string };

function buildFaqSections(): { heading: string; items: FaqItem[] }[] {
  return [
    {
      heading: 'Switching & Getting Started',
      items: [
        {
          question: 'I already use another booking system. Can I switch to ResNeo without losing my data?',
          answer:
            'Yes. Download your client list and bookings from your current provider as a CSV file and upload it to ResNeo. Our smart import tool automatically maps your data across, matching fields like client names, phone numbers, email addresses, and booking history. If anything needs attention, we will flag it for you before importing. Dedicated phone and email support is available if you need a hand.',
        },
        {
          question: 'How long does it take to get set up?',
          answer:
            'Most businesses are up and running within 15 minutes. Our setup wizard walks you through adding your services, setting your availability, and publishing your booking page. You can start accepting bookings on your first day.',
        },
        {
          question: 'Do I need any technical knowledge to use ResNeo?',
          answer:
            'None at all. If you can use a smartphone, you can use ResNeo. The dashboard is designed for busy business owners, not IT specialists. Everything from setting up services to managing bookings works through a clean, simple interface with no coding, no complicated settings menus, and no jargon.',
        },
      ],
    },
    {
      heading: 'Pricing & Costs',
      items: [
        {
          question: 'What does ResNeo cost?',
          answer: `New customers get a ${SIGNUP_TRIAL_SHORT_LABEL.toLowerCase()} on any paid plan (card required at checkout; first subscription charge after 14 days). ${signupTrialSmsDuringTrialNotice()} Appointments Light is £${APPOINTMENTS_LIGHT_PRICE} per month for one bookable calendar and one venue login, with appointments, classes, events, and resource booking plus email reminders. SMS includes ${SMS_INCLUDED_LIGHT} messages per month, then ${Math.round(SMS_OVERAGE_GBP_PER_MESSAGE * 100)}p each. Appointments Plus is £${APPOINTMENTS_PLUS_PRICE} per month for up to 5 calendars and 5 users, with ${SMS_INCLUDED_PLUS} SMS included then ${Math.round(SMS_OVERAGE_GBP_PER_MESSAGE * 100)}p each. Appointments Pro is £${APPOINTMENTS_PRO_PRICE} per month for unlimited calendars and team members, with ${SMS_INCLUDED_APPOINTMENTS} SMS included then ${Math.round(SMS_OVERAGE_GBP_PER_MESSAGE * 100)}p each. Every plan includes every feature: the plans differ only in the number of calendars, team logins and included SMS. There are no setup fees, no contracts, and no per-booking commissions. ${STANDARD_PAYMENT_PROVIDER_FEES_NOTICE} ${SUBSCRIPTION_CANCELLATION_PUBLIC_NOTICE}`,
        },
        {
          question: 'Are there any hidden fees or commissions?',
          answer: `No. Your monthly subscription covers the platform. We never take a commission on your bookings, and we never charge your customers a booking fee. ${STANDARD_PAYMENT_PROVIDER_FEES_NOTICE} Every plan includes a monthly SMS allowance; additional messages are ${Math.round(SMS_OVERAGE_GBP_PER_MESSAGE * 100)}p each, clearly shown in your dashboard. There are no add-on charges for features: marketing messages, online payments, reminders, forms and reports are all part of every plan.`,
        },
        {
          question: 'How does ResNeo compare to competitors on price?',
          answer:
            'Many competing platforms charge commission, per-staff pricing or higher monthly fees. ResNeo uses simple monthly pricing with no booking commission.',
        },
      ],
    },
    {
      heading: 'Features & Functionality',
      items: [
        {
          question: 'What types of business can use ResNeo?',
          answer:
            'Any business that takes bookings. Barbers, hairdressers, beauty salons, physiotherapists, personal trainers, yoga studios, escape rooms, sports facilities, tutors, dog groomers, and many more. ResNeo supports appointments, classes, events, and resource bookings, and you can offer any combination of these from a single account.',
        },
        {
          question: 'Can my customers book online without calling me?',
          answer:
            'Yes. Every ResNeo account gets a branded booking page that your clients can use 24 hours a day, 7 days a week. Share the link on your website, Instagram, Facebook, or WhatsApp. Clients choose their service, pick a time, and book instantly without needing to phone or message you.',
        },
        {
          question: 'Does ResNeo send booking reminders to my clients?',
          answer:
            'Yes. Automated email reminders are included on every plan. Every plan also includes SMS reminders within your monthly allowance (overage priced per message). Reminders include a one-tap confirm or cancel link, which can help reduce no-shows by making it easier for clients to confirm or cancel.',
        },
        {
          question: 'Can I collect deposits to protect against no-shows?',
          answer:
            `Yes. You can require a deposit at the time of booking, collected securely through Stripe. You set the amount and cancellation rules for each service. ${RESNEO_MARKETING_PAYMENTS_AND_NO_HOLD} Where configured, eligible refunds can be processed automatically according to your cancellation rules.`,
        },
        {
          question: 'Can my staff each have their own calendar and booking link?',
          answer:
            'On Appointments Plus and Pro, yes (within your plan limits). Each team member can have their own calendar with individual working hours, breaks, and services, plus a personal booking link to share with clients. Appointments Light is built for sole traders: one bookable calendar and one venue login. Upgrade to Plus or Pro when you need multiple staff with separate calendars.',
        },
      ],
    },
    {
      heading: 'Data, Security & Support',
      items: [
        {
          question: 'Is my data safe?',
          answer:
            'Yes. We use reputable cloud infrastructure providers, access controls, encryption in transit, and provider-level security measures. Payments are handled by Stripe, the world\'s most trusted payment processor. We never store card details on our servers.',
        },
        {
          question: 'What happens if I want to leave ResNeo?',
          answer: `Your business records remain under your control. You can export your client data and booking history as a CSV file while your account is active. ${SUBSCRIPTION_CANCELLATION_PUBLIC_NOTICE} We do not lock you into contracts or make it difficult to leave.`,
        },
        {
          question: 'What support do you offer if I get stuck?',
          answer:
            'Appointments Light includes email support. Appointments Plus and Pro include email and phone support. We are a small, founder-led team who understand independent businesses, so when you contact us you will reach someone who knows the product inside out, not a chatbot or an overseas call centre.',
        },
        {
          question: 'Can I try ResNeo before committing?',
          answer: `Yes. New customers get a ${SIGNUP_TRIAL_SHORT_LABEL.toLowerCase()} on any paid plan when they sign up online. ${SIGNUP_TRIAL_CARD_NOTICE} You can also contact us for a free demo tailored to your business. We will walk you through how ResNeo fits your setup and answer questions before you sign up.`,
        },
      ],
    },
  ];
}

const FAQ_SECTIONS = buildFaqSections();

function FaqToggleIcon({ open }: { open: boolean }) {
  return (
    <span
      className={`relative flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border transition-all duration-300 ease-out ${
        open
          ? 'border-brand-300/80 bg-brand-600 text-white shadow-md shadow-brand-900/15'
          : 'border-[#EEE9E0] bg-[#FDFBF7] text-slate-500 shadow-sm group-hover:border-accent-200 group-hover:bg-accent-50 group-hover:text-brand-700'
      }`}
      aria-hidden
    >
      <svg
        className={`absolute h-4 w-4 transition-all duration-300 ease-out ${
          open ? 'scale-75 opacity-0 rotate-90' : 'scale-100 opacity-100 rotate-0'
        }`}
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={2.25}
        stroke="currentColor"
      >
        <path strokeLinecap="round" d="M12 5v14M5 12h14" />
      </svg>
      <svg
        className={`absolute h-4 w-4 transition-all duration-300 ease-out ${
          open ? 'scale-100 opacity-100 rotate-0' : 'scale-75 opacity-0 -rotate-90'
        }`}
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={2.25}
        stroke="currentColor"
      >
        <path strokeLinecap="round" d="M5 12h14" />
      </svg>
    </span>
  );
}

export default function HomeFaq() {
  const baseId = useId();
  const [openKey, setOpenKey] = useState<string | null>(null);

  const toggle = useCallback((key: string) => {
    setOpenKey((prev) => (prev === key ? null : key));
  }, []);

  return (
    <section
      id="faq"
      aria-labelledby="faq-heading"
      className="relative scroll-mt-16 overflow-hidden bg-[#FDFBF7] py-20 sm:py-28"
    >
      {/* Soft shapes on the cream ground. */}
      <div className="pointer-events-none absolute -left-40 top-1/3 h-80 w-80 rounded-[58%_42%_55%_45%/48%_60%_40%_52%] bg-brand-50" aria-hidden />
      <div className="pointer-events-none absolute -right-32 bottom-20 h-72 w-72 rounded-[48%_52%_41%_59%/55%_40%_60%_45%] bg-accent-100/60" aria-hidden />
      <div className="relative mx-auto max-w-4xl px-6">
        <div className="text-center">
          <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-accent-100 bg-white px-4 py-1.5 shadow-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-accent-500" />
            <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-accent-700">
              Questions
            </p>
          </div>
          <h2
            id="faq-heading"
            className="mt-5 text-3xl font-black tracking-tight text-brand-600 sm:text-4xl"
          >
            Frequently asked questions
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-slate-600">
            Straight answers about switching, pricing, features, and how we keep your data safe.
          </p>
        </div>

        <div className="mt-16 space-y-16 sm:mt-20 sm:space-y-20">
          {FAQ_SECTIONS.map((section, sIdx) => (
            <div key={section.heading}>
              <div className="mb-5 flex items-start gap-4 sm:mb-6 sm:items-center">
                <span
                  className="mt-1 hidden h-10 w-1.5 shrink-0 rounded-full bg-accent-400 sm:mt-0 sm:block sm:h-12"
                  aria-hidden
                />
                <div className="min-w-0 flex-1 text-left sm:flex sm:items-baseline sm:gap-3">
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-xs font-bold tabular-nums text-brand-800 ring-1 ring-brand-200/60 sm:hidden">
                    {sIdx + 1}
                  </span>
                  <h3 className="text-lg font-bold tracking-tight text-slate-900 sm:text-xl">
                    {section.heading}
                  </h3>
                </div>
              </div>

              <ul className="flex flex-col gap-3 sm:gap-3.5">
                {section.items.map((item, iIdx) => {
                  const key = `${sIdx}-${iIdx}`;
                  const isOpen = openKey === key;
                  const panelId = `${baseId}-panel-${sIdx}-${iIdx}`;
                  const buttonId = `${baseId}-btn-${sIdx}-${iIdx}`;

                  return (
                    <li key={key}>
                      <div
                        className={`group relative overflow-hidden rounded-[22px] border transition-all duration-300 ease-out ${
                          isOpen
                            ? 'border-accent-200 bg-white shadow-xl shadow-brand-900/[0.08]'
                            : 'border-[#EEE9E0] bg-white hover:border-accent-200 hover:shadow-md hover:shadow-brand-900/5'
                        }`}
                      >
                        {isOpen ? (
                          <div
                            className="absolute inset-y-0 left-0 w-1.5 bg-accent-500"
                            aria-hidden
                          />
                        ) : null}
                        <h4 className="m-0">
                          <button
                            id={buttonId}
                            type="button"
                            aria-expanded={isOpen}
                            aria-controls={panelId}
                            onClick={() => toggle(key)}
                            className={`group flex w-full items-start gap-4 px-4 py-4 text-left transition-colors sm:gap-5 sm:px-6 sm:py-5 ${
                              isOpen ? 'pl-5 sm:pl-7' : 'pl-4 sm:pl-6'
                            }`}
                          >
                            <span className="min-w-0 flex-1 pt-0.5 text-[15px] font-semibold leading-snug tracking-tight text-slate-900 sm:text-base sm:leading-snug">
                              {item.question}
                            </span>
                            <FaqToggleIcon open={isOpen} />
                          </button>
                        </h4>
                        <div
                          id={panelId}
                          role="region"
                          aria-labelledby={buttonId}
                          className={`grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none ${
                            isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                          }`}
                        >
                          <div className="min-h-0 overflow-hidden">
                            <div
                              className={`border-t border-slate-100/90 transition-opacity duration-300 ease-out motion-reduce:transition-none ${
                                isOpen ? 'opacity-100 delay-75' : 'opacity-0'
                              }`}
                            >
                              <p className="max-w-prose px-4 pb-5 pl-4 text-[15px] leading-[1.7] text-slate-600 sm:px-6 sm:pb-6 sm:pl-7 sm:text-base sm:leading-[1.75]">
                                {item.answer}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
