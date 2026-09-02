import { HomeReveal } from "@/components/home/HomeReveal";
import {
  APPOINTMENTS_LIGHT_PRICE,
  APPOINTMENTS_PLUS_PRICE,
  APPOINTMENTS_PRO_PRICE,
  SMS_OVERAGE_GBP_PER_MESSAGE,
} from "@/lib/pricing-constants";
import { SMS_INCLUDED_APPOINTMENTS, SMS_INCLUDED_LIGHT, SMS_INCLUDED_PLUS } from "@/lib/billing/sms-allowance";
import { RESNEO_DOES_NOT_HOLD_BOOKING_MONEY } from "@/lib/booking-funds-copy";

/**
 * "Everything included" on the homepage, directly under the pricing cards.
 *
 * The one thing this section has to land: every feature is in every plan. Most
 * booking platforms advertise a low headline rate and then charge separately
 * for marketing messages, online payments, reminders, forms or extra staff.
 * ResNeo's three plans differ only in calendars, team logins and included SMS,
 * so the layout puts those three lines in a small strip at the top and gives
 * the whole of the rest of the page to the features they all share.
 *
 * Every item below is a shipped feature. Optional features (waitlist, card
 * holds, compliance forms, class products and so on) are switched on from
 * Settings at no charge, which is why the copy says "included", not "on by
 * default". Nothing here claims two-way SMS replies, calendar sync with Google
 * or Apple, gift cards or appointment packages: none of those exist.
 */

const SMS_OVERAGE_PENCE = Math.round(SMS_OVERAGE_GBP_PER_MESSAGE * 100);

type Plan = {
  name: string;
  price: number;
  calendars: string;
  logins: string;
  sms: number;
};

const PLANS: Plan[] = [
  {
    name: "Light",
    price: APPOINTMENTS_LIGHT_PRICE,
    calendars: "1 calendar",
    logins: "1 team login",
    sms: SMS_INCLUDED_LIGHT,
  },
  {
    name: "Plus",
    price: APPOINTMENTS_PLUS_PRICE,
    calendars: "Up to 5 calendars",
    logins: "Up to 5 team logins",
    sms: SMS_INCLUDED_PLUS,
  },
  {
    name: "Pro",
    price: APPOINTMENTS_PRO_PRICE,
    calendars: "Unlimited calendars",
    logins: "Unlimited team logins",
    sms: SMS_INCLUDED_APPOINTMENTS,
  },
];

type FeatureGroup = {
  title: string;
  blurb: string;
  icon: React.ReactNode;
  items: string[];
};

const ICON_CLASS = "h-5 w-5";

const GROUPS: FeatureGroup[] = [
  {
    title: "Booking page and widget",
    blurb: "Take bookings around the clock, on your own page or your own website.",
    icon: (
      <svg className={ICON_CLASS} fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0 0c2.5 0 4.5-4 4.5-9S14.5 3 12 3 7.5 7 7.5 12s2 9 4.5 9Zm-8.5-9h17" />
      </svg>
    ),
    items: [
      "Branded booking page your clients can use 24/7",
      "Website widget that sizes itself to your site",
      "QR codes and short links for print and social media",
      "A personal booking link for every calendar",
      "Photos, team profiles, gallery and announcement banner",
      "Clients choose the person first or the service first",
    ],
  },
  {
    title: "Calendar and scheduling",
    blurb: "One calendar for the whole team, with the rules that keep your day running.",
    icon: (
      <svg className={ICON_CLASS} fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
      </svg>
    ),
    items: [
      "Day, week and month views with drag and drop",
      "Working hours, breaks, leave and closures per calendar",
      "Buffers and processing time between clients",
      "Multi-service visits and group bookings",
      "Waitlist that offers freed slots automatically",
      "Any-available booking and walk-ins",
    ],
  },
  {
    title: "Services and pricing",
    blurb: "Describe what you offer exactly the way you sell it.",
    icon: (
      <svg className={ICON_CLASS} fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6Z" />
      </svg>
    ),
    items: [
      "Variants such as short or long hair, 30 or 60 minutes",
      "Add-ons that adjust the price and the time",
      "Booking windows, minimum notice and cancellation rules per service",
      "Fixed start times and booking intervals",
      "Custom availability for individual services",
      "Each team member's own prices and durations",
    ],
  },
  {
    title: "Payments and deposits",
    blurb: "Protect your diary from no-shows and get paid straight to your own account.",
    icon: (
      <svg className={ICON_CLASS} fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z" />
      </svg>
    ),
    items: [
      "Online payments through Stripe, paid directly to you",
      "Deposit, full payment or pay on the day, chosen per service",
      "Card holds with a chargeable no-show fee",
      "Automatic refunds that follow your cancellation rules",
      "Payment links and reminders for phone bookings",
      "Tap to Pay in person from the ResNeo app",
    ],
  },
  {
    title: "Client communications",
    blurb: "Email and SMS that go out on their own, in your words.",
    icon: (
      <svg className={ICON_CLASS} fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
      </svg>
    ),
    items: [
      "Confirmations, reminders and follow-ups by email and SMS",
      "One-tap confirm or cancel links that free the slot",
      "Choose the channel and timing of every message",
      "Bulk marketing messages to your clients, included",
      "Google review requests after a visit",
      "Add-to-calendar links in every confirmation",
    ],
  },
  {
    title: "Clients, forms and records",
    blurb: "Everything you know about a client, in one place, kept properly.",
    icon: (
      <svg className={ICON_CLASS} fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
      </svg>
    ),
    items: [
      "Client records with full visit and payment history",
      "Notes, tags, custom fields and family links",
      "Consent, patch test and intake forms with a form builder",
      "Signed documents with expiry tracking and reminders",
      "Loyalty points",
      "Data export and erasure for any client",
    ],
  },
  {
    title: "Classes, events and resources",
    blurb: "Sell more than appointments from the same account.",
    icon: (
      <svg className={ICON_CLASS} fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
      </svg>
    ),
    items: [
      "Class timetables with check-in and attendance",
      "Class packs, courses and memberships",
      "Ticketed events with several ticket tiers",
      "Bookable rooms, courts and equipment",
      "Recurring class bookings for your regulars",
      "Client accounts with credits, bookings and saved cards",
    ],
  },
  {
    title: "Team, insights and support",
    blurb: "Run the business, not the software.",
    icon: (
      <svg className={ICON_CLASS} fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
      </svg>
    ),
    items: [
      "Staff logins with roles and calendar access",
      "Reports on revenue, no-shows, deposits, team and services",
      "Export everything as CSV, whenever you like",
      "Smart import from your old system, with undo",
      "Link calendars or share a booking page with other venues",
      "iOS and Android apps for you and your clients",
      "Help centre, in-app support and a free onboarding walkthrough",
    ],
  },
];

const NEVER_CHARGED = [
  "Setup fees",
  "Contracts",
  "Booking commission",
  "Client booking fees",
  "Marketing messages",
  "Online payments module",
  "Reminders",
  "Forms and reports",
  "Feature add-ons",
];

function Check() {
  return (
    <svg
      className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent-600"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2.5}
      stroke="currentColor"
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  );
}

export function IncludedFeaturesSection() {
  return (
    <section id="included" className="scroll-mt-16 bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <HomeReveal className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-accent-700">Everything included</p>
          <h2 className="mt-3 text-balance text-3xl font-black tracking-tight text-brand-600 sm:text-4xl">
            One price. Every feature. No add-ons.
          </h2>
          <p className="mt-4 text-balance text-base leading-relaxed text-slate-600 sm:text-lg">
            Plenty of booking platforms advertise a low monthly rate, then charge extra for marketing messages,
            online payments, reminders or another member of staff. ResNeo does not. Every feature on this page is
            in every plan. The only things that change between plans are how many calendars you get and how many
            SMS are included.
          </p>
        </HomeReveal>

        {/* What changes between plans: three short lines, then the band that covers everything else. */}
        <HomeReveal delay={80} className="mt-12">
          <div className="overflow-hidden rounded-[32px] border border-[#EEE9E0] bg-[#FDFBF7]">
            <div className="grid divide-y divide-[#EEE9E0] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              {PLANS.map((plan) => (
                <div key={plan.name} className="px-6 py-6 sm:px-8">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="text-sm font-bold uppercase tracking-[0.14em] text-brand-600">Appointments {plan.name}</h3>
                    <span className="text-sm font-semibold text-slate-500">
                      &pound;{plan.price}
                      <span className="font-normal text-slate-400">/mo</span>
                    </span>
                  </div>
                  <dl className="mt-4 space-y-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-slate-500">Calendars</dt>
                      <dd className="font-semibold text-slate-900">{plan.calendars}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-slate-500">Team logins</dt>
                      <dd className="font-semibold text-slate-900">{plan.logins}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-slate-500">SMS included</dt>
                      <dd className="font-semibold text-slate-900">{plan.sms} a month</dd>
                    </div>
                  </dl>
                </div>
              ))}
            </div>
            <div className="flex flex-col items-center gap-3 border-t border-[#EEE9E0] bg-brand-600 px-6 py-5 text-center sm:flex-row sm:justify-center sm:gap-4">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-accent-500 text-brand-900 shadow-md">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
              </span>
              <p className="text-base font-semibold text-white sm:text-lg">
                Everything else below is included in all three plans, at no extra cost.
              </p>
            </div>
          </div>
        </HomeReveal>

        {/* The features themselves. */}
        <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {GROUPS.map((group, i) => (
            <HomeReveal as="li" key={group.title} delay={(i % 4) * 70} className="flex">
              <div className="flex w-full flex-col rounded-[28px] border border-[#EEE9E0] bg-[#FDFBF7] p-6 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-brand-600/10">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-accent-100 text-accent-800">
                    {group.icon}
                  </span>
                  <h3 className="text-base font-bold leading-tight text-slate-900">{group.title}</h3>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-slate-500">{group.blurb}</p>
                <ul className="mt-4 flex-1 space-y-2.5 border-t border-[#EEE9E0] pt-4 text-sm text-slate-700">
                  {group.items.map((item) => (
                    <li key={item} className="flex items-start gap-2.5">
                      <Check />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-5 inline-flex items-center gap-1.5 self-start rounded-full bg-accent-50 px-2.5 py-1 text-xs font-semibold text-accent-800 ring-1 ring-accent-200">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                  Included in every plan
                </p>
              </div>
            </HomeReveal>
          ))}
        </ul>

        {/* The honest bit: the two costs that sit outside the plan fee, and the list of things that never will. */}
        <HomeReveal delay={100} className="mt-12">
          <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
            <div className="rounded-[32px] border border-[#EEE9E0] bg-[#FDFBF7] p-7 sm:p-8">
              <p className="text-sm font-bold uppercase tracking-[0.14em] text-brand-600">The only extra costs</p>
              <h3 className="mt-2 text-xl font-bold tracking-tight text-slate-900">Just two, and you can see both coming</h3>
              <dl className="mt-6 space-y-5">
                <div className="flex gap-4">
                  <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z" />
                    </svg>
                  </span>
                  <div>
                    <dt className="font-semibold text-slate-900">Payment provider fees</dt>
                    <dd className="mt-1 text-sm leading-relaxed text-slate-600">
                      When a client pays online, Stripe charges its standard card processing fee. That fee goes to
                      Stripe. ResNeo takes no cut of any payment and adds nothing on top. {RESNEO_DOES_NOT_HOLD_BOOKING_MONEY}
                    </dd>
                  </div>
                </div>
                <div className="flex gap-4">
                  <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 0 0 6 3.75v16.5a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 20.25V3.75a2.25 2.25 0 0 0-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3" />
                    </svg>
                  </span>
                  <div>
                    <dt className="font-semibold text-slate-900">SMS beyond your monthly allowance</dt>
                    <dd className="mt-1 text-sm leading-relaxed text-slate-600">
                      Every plan includes a monthly SMS allowance. If you send more, each extra message segment is{" "}
                      {SMS_OVERAGE_PENCE}p, shown clearly in your dashboard as you go. Messages keep sending, so a
                      busy month never cuts your clients off.
                    </dd>
                  </div>
                </div>
              </dl>
            </div>
            <div className="rounded-[32px] border border-accent-100 bg-accent-50/60 p-7 sm:p-8">
              <p className="text-sm font-bold uppercase tracking-[0.14em] text-brand-600">What you will never pay for</p>
              <h3 className="mt-2 text-xl font-bold tracking-tight text-slate-900">No add-ons. No surprises.</h3>
              <ul className="mt-6 flex flex-wrap gap-2">
                {NEVER_CHARGED.map((item) => (
                  <li
                    key={item}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[#EEE9E0] bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 shadow-sm"
                  >
                    <svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636" />
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
              <p className="mt-6 text-sm leading-relaxed text-slate-600">
                Pick the plan that fits your team size. Everything else is already in it, and you can change plan or
                cancel whenever you like.
              </p>
              <a
                href="#pricing"
                className="mt-5 inline-flex h-11 items-center rounded-full bg-brand-600 px-6 text-sm font-extrabold text-white shadow-lg shadow-brand-600/20 transition-all hover:-translate-y-0.5 hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                Choose your plan
              </a>
            </div>
          </div>
        </HomeReveal>
      </div>
    </section>
  );
}
