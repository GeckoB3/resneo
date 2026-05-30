import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import ContactForm from "@/components/ContactForm";
import {
  RESNEO_DEPOSIT_FLOWS_MARKETING_FOLLOW_ON,
  RESNEO_MARKETING_PAYMENTS_AND_NO_HOLD,
} from "@/lib/booking-funds-copy";
import { SMS_INCLUDED_RESTAURANT } from "@/lib/billing/sms-allowance";
import { RESTAURANT_PRICE, SMS_OVERAGE_GBP_PER_MESSAGE } from "@/lib/pricing-constants";
import { STANDARD_PAYMENT_PROVIDER_FEES_NOTICE } from "@/lib/payment-provider-fees-notice";
import { SUBSCRIPTION_CANCELLATION_PUBLIC_NOTICE } from "@/lib/subscription-cancellation-copy";

export const metadata: Metadata = {
  title: "Resneo for Restaurants | Table Booking & Deposit Protection",
  description:
    "Fill more covers with 24/7 online booking, deposits that reduce no-shows, and staff tools built for service: day sheet, table grid, and live floor plan.",
  openGraph: {
    title: "Resneo for Restaurants",
    description:
      "Take table bookings 24/7, protect revenue with deposits, and run service with day sheet, table grid, and floor plan.",
    type: "website",
  },
};

const SIGNUP_RESTAURANT = "/signup/plan?plan=restaurant";

const problems = [
  {
    title: "The phone rings when you are in the weeds",
    description:
      "During service, every unanswered call is a party that books somewhere else. Voicemail is not a booking system.",
    icon: PhoneOffIcon,
  },
  {
    title: "No-shows and late drops kill the room",
    description:
      "Empty tables at peak time are lost margin you cannot recover. Chasing deposits by hand is awkward and slow.",
    icon: GhostIcon,
  },
  {
    title: "Front door and back office tell different stories",
    description:
      "When the diary, the floor, and WhatsApp do not match, you double-book, disappoint guests, and burn team trust.",
    icon: CalendarAlertIcon,
  },
  {
    title: "Guests decide at night; you are closed",
    description:
      "Birthday dinners and weekend tables get planned after hours. If they cannot lock a time instantly, momentum fades.",
    icon: MoonIcon,
  },
  {
    title: "Allergies and occasions live in scribbles",
    description:
      "Critical guest details buried in notebooks or texts are a liability. Your team deserves them at a glance.",
    icon: ClipboardAlertIcon,
  },
  {
    title: "Your food is premium; booking should feel premium",
    description:
      "The booking journey is part of hospitality. Friction upfront sets the tone long before dessert.",
    icon: SparklesIcon,
  },
];

const ownerBenefits = [
  {
    title: "Reservations that never clock off",
    description:
      "Guests book confirmed tables while you prep, plate, or close. Availability and turn times stay yours to govern.",
    icon: MoonIcon,
  },
  {
    title: "See the shift before the doors open",
    description:
      "Day sheet for service, table timeline and floor plan for the room: a single operational picture.",
    icon: LayoutGridIcon,
  },
  {
    title: "Cover your risk with deposits",
    description: `Require a deposit or pre-payment where it suits you. ${RESNEO_MARKETING_PAYMENTS_AND_NO_HOLD}`,
    icon: ShieldPoundIcon,
  },
  {
    title: "Fewer ghosts, fuller rooms",
    description:
      "Automated confirmations, reminders, and confirm-or-cancel flows help guests show, or free the table early enough to refill.",
    icon: BellIcon,
  },
  {
    title: "Guest intelligence that survives the crush",
    description:
      "Dietaries, allergens, celebrations, VIP notes, not lost between shifts. Carry context from booking to greeting.",
    icon: UserCardIcon,
  },
  {
    title: "Reporting that respects the margins",
    description:
      "Covers, revenue signals, busiest services. See what drives the till without drowning in spreadsheets.",
    icon: TrendUpIcon,
  },
  {
    title: `Fair pricing from £${RESTAURANT_PRICE}/month`,
    description:
      `One subscription. No commission on bookings. ${STANDARD_PAYMENT_PROVIDER_FEES_NOTICE} The Restaurant plan includes ${SMS_INCLUDED_RESTAURANT} SMS per month (extra at ${Math.round(SMS_OVERAGE_GBP_PER_MESSAGE * 100)}p each when you exceed it). ${SUBSCRIPTION_CANCELLATION_PUBLIC_NOTICE}`,
    icon: TagIcon,
  },
];

const clientBenefits = [
  "Reserve a table in under a minute on any phone, with no app and no account wall.",
  "Instant confirmation email with what matters: time, covers, cancellation terms.",
  "SMS and email reminders so the booking does not get lost between life and diary.",
  "One-tap confirm or reschedule when plans shift, with fewer awkward phone calls.",
  "Deposit and policy spelled out clearly before payment, with no surprises at the door.",
];

const howItWorks = [
  {
    step: "1",
    title: "Shape your venue",
    description:
      "Services, openings, seating, deposit rules: set the guardrails once. Bring your menus and policies; Resneo adapts.",
  },
  {
    step: "2",
    title: "Put booking everywhere guests look",
    description:
      "Your link, QR on menus and windows, website embed. Incoming reservations land in one live diary.",
  },
  {
    step: "3",
    title: "Run service with certainty",
    description:
      "Front-of-house stays in sync from day sheet to floor plan while automation handles the confirmations.",
  },
];

const venueTypes = [
  { name: "Independent restaurants", icon: "🍽️" },
  { name: "Neighbourhood bistros", icon: "🥂" },
  { name: "Cafés & brunch rooms", icon: "☕" },
  { name: "Gastropubs", icon: "🍺" },
  { name: "Hotel dining", icon: "🏨" },
  { name: "Wine bars & small plates", icon: "🍷" },
  { name: "Steakhouses & grills", icon: "🥩" },
  { name: "Casual counters & deli seats", icon: "🧀" },
  { name: "Private dining studios", icon: "🕯️" },
  { name: "Chef's tables & tasting menus", icon: "👨‍🍳" },
];

const features = [
  {
    title: "Day sheet tuned for reservations",
    description:
      "Chronological arrivals and covers visible at arms-length: the view you want clipped to the host stand.",
  },
  {
    title: "Table grid & live floor plan",
    description:
      "Plan the room visually, reconcile status fast, reduce walk-in clashes with seated guests.",
  },
  {
    title: "Allergies & dietaries surfaced",
    description:
      "Flags that stand out before service, not buried in inbox threads or sticky notes.",
  },
  {
    title: "Online booking page + widget embed",
    description:
      "Branded journeys on Resneo-hosted pages or tucked into your own site without redirect fatigue.",
  },
  {
    title: "Deposits and pre-payments via Stripe Connect",
    description:
      "Charge per-booking or per-head; payouts route to your connected account. Resneo never holds booking money.",
  },
  {
    title: "Confirm-or-cancel by SMS",
    description:
      "Guests respond to reminders; declines release tables back into play before it is too late.",
  },
  {
    title: "Guest profiles & visits",
    description:
      "Notes, spends, milestones. Welcome regulars properly even when staffing changes.",
  },
  {
    title: "Classes or events still available",
    description:
      "Need workshops, tastings, chef collabs or buyouts alongside standard service? Appointment-style sessions stay on tap.",
  },
  {
    title: "UK/EU-aligned hosting",
    description:
      "Engineered around sensible data stewardship with row-level safeguards so rival venues never see yours.",
  },
  {
    title: "Real support humans",
    description:
      "Real people when you hit a snag setting up payouts, timings, or comms, not an endless FAQ maze.",
  },
];

const faqs = [
  {
    q: "Is there a discount for founding restaurants?",
    a: "Yes. Use RESERVE50 at checkout for 50% off eligible plans, including Restaurant, for six months during our founding partner window. Limited availability.",
  },
  {
    q: "We already pay for another booking stack. Why switch?",
    a: "Resneo is built for independent operators who want transparent pricing, direct Stripe payouts, and tooling that matches how you actually run service: day sheet, tables, floor plan, deposits, and comms in one stack, without per-cover commission.",
  },
  {
    q: "How do deposits work for restaurants?",
    a: `Connect Stripe in minutes. When a guest pays, ${RESNEO_DEPOSIT_FLOWS_MARKETING_FOLLOW_ON} You define policy, amounts, and when charges apply.`,
  },
  {
    q: "Can we still take walk-ins and phone bookings?",
    a: "Absolutely. Add walk-ins and phone reservations manually in seconds so every guest, however they arrive, lives in the same operational record.",
  },
  {
    q: "What about SMS volumes?",
    a: `The Restaurant plan includes ${SMS_INCLUDED_RESTAURANT} SMS per month. Additional messages are ${Math.round(SMS_OVERAGE_GBP_PER_MESSAGE * 100)}p each when you go beyond the allowance.`,
  },
  {
    q: "Do you cover cafés and pubs with food?",
    a: "Yes. If you take timed reservations, covers, or mixed service models, Resneo flexes to match: single venue today, built for the founders we know best.",
  },
  {
    q: "How fast can we go live?",
    a: "Many teams book their first real table the same day: connect payments, add services, define availability, share the link. We will hold your hand if you want a guided pass.",
  },
];

export default function RestaurantPlanPage() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <Nav />
      <Hero />
      <BookingChannelsSection />
      <ProblemSection />
      <SolutionIntro />
      <OwnerBenefitsSection />
      <ProductPreview />
      <ClientBenefitsSection />
      <StatsBand />
      <HowItWorksSection />
      <VenueTypesSection />
      <FeaturesSection />
      <FaqSection />
      <ClosingCta />
      <Footer />
    </div>
  );
}

function Nav() {
  return (
    <nav className="sticky top-0 z-50 border-b border-slate-100 bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex-shrink-0">
          <img src="/Logo.png" alt="Resneo" className="h-9 w-auto" />
        </Link>
        <div className="flex items-center gap-2 sm:gap-4">
          <a
            href="#contact"
            className="hidden rounded-xl px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900 sm:inline-flex"
          >
            Talk to us
          </a>
          <Link
            href={SIGNUP_RESTAURANT}
            className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
          >
            Start Restaurant plan
          </Link>
        </div>
      </div>
    </nav>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-brand-50 via-white to-brand-50/40" />
      <div
        className="absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            "radial-gradient(circle at 18% 18%, rgba(0,59,111,0.14) 0%, transparent 45%), radial-gradient(circle at 88% 78%, rgba(0,59,111,0.10) 0%, transparent 50%)",
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(to right, #0f172a 1px, transparent 1px), linear-gradient(to bottom, #0f172a 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      <div className="relative mx-auto grid max-w-6xl gap-12 px-6 py-20 sm:py-24 lg:grid-cols-5 lg:gap-10 lg:py-28">
        <div className="lg:col-span-3 lg:pt-6">
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-brand-700 backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
            Built for hospitality teams
          </span>
          <h1 className="mt-6 text-4xl font-extrabold leading-[1.05] tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
            Take every booking.
            <br />
            <span className="bg-gradient-to-r from-brand-700 via-brand-600 to-brand-800 bg-clip-text text-transparent">
              Protect every cover.
            </span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-600 sm:text-xl">
            Take bookings round the clock without lifting the phone.
            Reduce no-shows with deposits and automated reminders.
            Run every service from one live diary, with allergens and table assignments ready before doors open.
          </p>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <Link
              href={SIGNUP_RESTAURANT}
              className="inline-flex h-12 items-center justify-center rounded-xl bg-brand-600 px-7 text-base font-semibold text-white shadow-lg shadow-brand-600/25 transition-all hover:-translate-y-0.5 hover:bg-brand-700 hover:shadow-xl hover:shadow-brand-600/30"
            >
              Start Restaurant plan
              <ArrowRightIcon />
            </Link>
            <a
              href="#how"
              className="inline-flex h-12 items-center justify-center rounded-xl border border-slate-200 bg-white px-6 text-base font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:text-slate-900"
            >
              See launch steps
            </a>
          </div>

          <div className="mt-8 inline-flex items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3">
            <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
              <TagIcon small />
            </span>
            <div className="text-sm">
              <span className="font-semibold text-brand-800">Founding Partner Offer: </span>
              <span className="text-brand-700">Use code </span>
              <span className="rounded bg-brand-700 px-1.5 py-0.5 font-mono text-xs font-bold tracking-wider text-white">
                RESERVE50
              </span>
              <span className="text-brand-700"> at checkout for 50% off for 3 months.</span>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-slate-500">
            <span className="inline-flex items-center gap-2">
              <TickIcon />
              Table-ready operations view
            </span>
            <span className="inline-flex items-center gap-2">
              <TickIcon />
              Deposit-backed reservations
            </span>
            <span className="inline-flex items-center gap-2">
              <TickIcon />
              Automated confirm / remind / SMS reply
            </span>
            <span className="inline-flex basis-full max-w-2xl items-start gap-2">
              <TickIcon />
              <span>{SUBSCRIPTION_CANCELLATION_PUBLIC_NOTICE}</span>
            </span>
          </div>
        </div>

        <div className="relative lg:col-span-2">
          <HeroRestaurantVisual />
        </div>
      </div>
    </section>
  );
}

function HeroRestaurantVisual() {
  return (
    <div className="relative mx-auto w-full max-w-sm">
      <div className="absolute -inset-4 rounded-[2.5rem] bg-gradient-to-tr from-brand-200/60 via-white/0 to-brand-300/50 blur-2xl" />

      <div className="relative rounded-[2.25rem] border border-slate-200 bg-slate-900 p-2 shadow-2xl shadow-brand-900/20">
        <div className="relative overflow-hidden rounded-[1.85rem] bg-white">
          <div className="flex items-center justify-between px-5 pt-3 text-[10px] font-semibold text-slate-600">
            <span>9:41</span>
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
            </span>
          </div>

          <div className="px-5 pb-6 pt-4">
            <div className="flex items-center gap-2 text-[11px] font-medium text-brand-700">
              <span className="inline-block h-2 w-2 rounded-full bg-brand-500" />
              Table reservation confirmed
            </div>
            <h3 className="mt-2 text-lg font-bold text-slate-900">Saturday dinner · Bistro Quay</h3>
            <p className="mt-0.5 text-xs text-slate-500">Emma O&apos;Neill · Anniversary</p>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <InfoTile label="Guests" value="Cover 4" />
              <InfoTile label="Area" value="Window · Table 12" accent />
              <InfoTile label="Time" value="7:45 PM" />
              <InfoTile label="Deposit" value="£40 paid" />
            </div>

            <div className="mt-4 rounded-xl border border-rose-100 bg-rose-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-rose-600">Kitchen note</p>
              <p className="mt-1 text-xs text-rose-800">Severe nut allergy, communicated to brigade.</p>
            </div>

            <div className="mt-5 rounded-xl border border-slate-100 bg-slate-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Reminder queued</p>
              <p className="mt-1 text-xs text-slate-700">SMS confirm-or-cancel · 24 hours prior</p>
            </div>

            <div className="mt-5 flex gap-2">
              <div className="h-9 flex-1 rounded-lg bg-brand-600" />
              <div className="h-9 flex-1 rounded-lg border border-slate-200 bg-white" />
            </div>
          </div>
        </div>
      </div>

      <div className="absolute -top-6 -left-6 hidden rotate-[-6deg] rounded-xl border border-slate-100 bg-white p-3 shadow-xl shadow-slate-900/10 sm:block">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
            <TickIcon />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-slate-900">Deposit settled</p>
            <p className="text-[10px] text-slate-500">£40.00 to your Stripe</p>
          </div>
        </div>
      </div>

      <div className="absolute -bottom-6 -right-4 hidden rotate-[4deg] rounded-xl border border-slate-100 bg-white p-3 shadow-xl shadow-slate-900/10 sm:block">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
            <BellIcon />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-slate-900">Reminder armed</p>
            <p className="text-[10px] text-slate-500">Emma · Sat 7:45 PM</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoTile({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      className={`rounded-xl border p-3 ${
        accent ? "border-brand-200 bg-brand-50" : "border-slate-100 bg-slate-50"
      }`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-1 text-sm font-bold ${accent ? "text-brand-700" : "text-slate-900"}`}>{value}</p>
    </div>
  );
}

function ProblemSection() {
  return (
    <section className="bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <span className="text-xs font-semibold uppercase tracking-widest text-accent-700">Sound familiar?</span>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
            Hospitality never stops.
            <br className="hidden sm:block" />
            <span className="text-slate-500">Busy service still needs perfect information.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-600">
            You are choreographing heat, timing, and guest emotion in real time. Resneo keeps booking, money, and guest
            context off your mental load so the team can focus on the room.
          </p>
        </div>

        <div className="mt-16 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {problems.map((p) => (
            <div
              key={p.title}
              className="group relative overflow-hidden rounded-2xl border border-slate-100 bg-slate-50/60 p-6 transition-all hover:border-slate-200 hover:bg-white hover:shadow-md"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-brand-700 shadow-sm ring-1 ring-slate-100">
                <p.icon />
              </div>
              <h3 className="mt-4 text-base font-semibold text-slate-900">{p.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{p.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SolutionIntro() {
  return (
    <section className="relative overflow-hidden bg-slate-900 py-20 text-white sm:py-28">
      <div
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "radial-gradient(circle at 28% 32%, rgba(0,59,111,0.6) 0%, transparent 50%), radial-gradient(circle at 80% 70%, rgba(0,59,111,0.28) 0%, transparent 50%)",
        }}
      />
      <div className="relative mx-auto max-w-4xl px-6 text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-white/80 backdrop-blur">
          Resneo for Restaurants
        </span>
        <h2 className="mt-6 text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">One backbone for bookings, money and service.</h2>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-white/80">
          Replace voicemail roulette, frantic texts, rogue spreadsheets and siloed notebooks with a cohesive platform, from
          the moment a guest books online until they walk through your door, with operational clarity for every cover.
        </p>
        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link
            href={SIGNUP_RESTAURANT}
            className="inline-flex h-12 items-center justify-center rounded-xl bg-white px-7 text-base font-semibold text-slate-900 shadow-lg transition-all hover:-translate-y-0.5 hover:bg-brand-50"
          >
            Begin setup
            <ArrowRightIcon />
          </Link>
          <a
            href="#contact"
            className="inline-flex h-12 items-center justify-center rounded-xl border border-white/20 bg-white/5 px-6 text-base font-semibold text-white backdrop-blur transition-colors hover:bg-white/10"
          >
            Talk through your room
          </a>
        </div>
      </div>
    </section>
  );
}

function OwnerBenefitsSection() {
  return (
    <section className="bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <span className="text-xs font-semibold uppercase tracking-widest text-accent-700">For operators & chefs</span>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
            Confidence on the books, and on the pass.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-600">
            Technology should remove anxiety, not add taps. Built-in automation handles repetitive guest comms while you steer
            the experience that keeps reviews glowing.
          </p>
        </div>

        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {ownerBenefits.map((b) => (
            <div
              key={b.title}
              className="group relative rounded-2xl border border-slate-100 bg-gradient-to-br from-white to-slate-50 p-7 transition-all hover:-translate-y-1 hover:border-brand-200 hover:shadow-xl hover:shadow-brand-600/5"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-100 transition-colors group-hover:bg-brand-100">
                <b.icon />
              </div>
              <h3 className="mt-5 text-lg font-semibold text-slate-900">{b.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{b.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ProductPreview() {
  return (
    <section className="relative overflow-hidden bg-slate-50 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <span className="text-xs font-semibold uppercase tracking-widest text-accent-700">Ops cockpit</span>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Service intelligence the whole team trusts.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-slate-600">
            One stack for arrivals, pacing, allergens, deposits, messaging, readable on a mounted iPad behind the podium or on
            a phone in your pocket walking the floor.
          </p>
        </div>

        <div className="relative mt-16">
          <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-r from-brand-200/40 via-white/0 to-brand-300/40 blur-3xl" />
          <RestaurantDashboardMock />
        </div>
      </div>
    </section>
  );
}

function RestaurantDashboardMock() {
  const bookings = [
    { time: "17:45", covers: "2", name: "K. Hughes", tb: "T4 · Counter", allergy: "", dep: true },
    { time: "18:30", covers: "4", name: "O'Neill anniversary", tb: "T12 · Front", allergy: "Nuts", dep: true },
    { time: "19:00", covers: "6", name: "Tech NI dinner", tb: "PDR", allergy: "", dep: true },
    { time: "19:15", covers: "2", name: "Walk-in hold", tb: "", allergy: "", dep: false, hold: true },
    { time: "20:00", covers: "3", name: "M. Byrne", tb: "T7", allergy: "GF note", dep: true },
    { time: "20:45", covers: "2", name: "Open", tb: "Release buffer", allergy: "", dep: false, empty: true },
  ];

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/10">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-brand-400/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-brand-400/80" />
        <div className="ml-4 hidden h-5 w-72 rounded-md bg-white text-[10px] text-slate-400 sm:flex sm:items-center sm:justify-center sm:gap-1">
          <LockIcon /> resneo.com/dashboard
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[210px_1fr_268px]">
        <aside className="hidden border-r border-slate-100 bg-slate-50/60 p-4 lg:block">
          <div className="flex items-center gap-2 px-2 pb-4">
            <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-brand-600 to-brand-800" />
            <span className="text-sm font-bold text-slate-900">Bistro Quay</span>
          </div>
          <nav className="space-y-1 text-sm">
            <SidebarItem label="Day sheet" active />
            <SidebarItem label="Calendar" />
            <SidebarItem label="Floor plan live" />
            <SidebarItem label="Table grid" />
            <SidebarItem label="Guests" />
            <SidebarItem label="Reports" />
            <SidebarItem label="Settings" />
          </nav>
        </aside>

        <div className="p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Saturday service</p>
              <h3 className="mt-0.5 text-xl font-bold text-slate-900">Evening arrivals</h3>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-brand-100 px-2.5 py-1 text-[11px] font-semibold text-brand-700">
                Covers 148
              </span>
              <span className="rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-semibold text-brand-700">
                94% prepaid
              </span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                12 still open
              </span>
            </div>
          </div>

          <div className="mt-5 space-y-2">
            {bookings.map((b, i) => (
              <div
                key={i}
                className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 ${
                  b.empty
                    ? "border-dashed border-slate-200 bg-slate-50/70"
                    : b.hold
                      ? "border-brand-200 bg-brand-50/70"
                      : "border-slate-100 bg-white hover:border-brand-200"
                }`}
              >
                <span className="w-12 text-xs font-bold text-slate-900">{b.time}</span>
                <span className="w-10 text-center text-xs font-semibold text-slate-700">{b.covers}c</span>
                <div className="min-w-[120px] flex-1">
                  <p className={`text-sm font-semibold ${b.empty ? "text-slate-400" : "text-slate-900"}`}>{b.name}</p>
                  {b.tb ? <p className="text-xs text-slate-500">{b.tb}</p> : null}
                </div>
                {!b.empty && b.allergy ? (
                  <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-700">
                    {b.allergy}
                  </span>
                ) : null}
                {!b.empty && !b.hold && b.dep ? (
                  <span className="hidden rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-700 sm:inline">
                    Deposit
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <aside className="border-t border-slate-100 bg-slate-50/50 p-5 lg:border-l lg:border-t-0 lg:p-6">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Tonight</h4>
          <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-1">
            <StatCard label="Reservations" value="58" trend="+17 vs last Sat" />
            <StatCard label="No-show risk" value="Low" trend="deposit + SMS" />
            <StatCard label="Prep spend" value="£3.9k" trend="card + cash est." />
          </div>
          <h4 className="mt-6 text-xs font-semibold uppercase tracking-wider text-slate-500">Outbound comms</h4>
          <div className="mt-3 space-y-2">
            <MessageRow type="SMS" text="Confirm: Byrne party, 20:00" />
            <MessageRow type="Email" text="Menu preview · O'Neill" />
            <MessageRow type="SMS" text="Waitlist reopen · 19:15" />
          </div>
        </aside>
      </div>
    </div>
  );
}

function SidebarItem({ label, active = false }: { label: string; active?: boolean }) {
  return (
    <div
      className={`flex items-center rounded-lg px-3 py-2 font-medium ${
        active ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-100" : "text-slate-600"
      }`}
    >
      <span className={`mr-2 h-1.5 w-1.5 rounded-full ${active ? "bg-brand-600" : "bg-slate-300"}`} />
      {label}
    </div>
  );
}

function StatCard({
  label,
  value,
  trend,
}: {
  label: string;
  value: string;
  trend: string;
}) {
  return (
    <div className="rounded-xl border border-slate-100 bg-white p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-extrabold text-slate-900">{value}</p>
      <p className="text-[11px] font-semibold text-brand-600">{trend}</p>
    </div>
  );
}

function MessageRow({ type, text }: { type: string; text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-100 bg-white px-3 py-2">
      <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-brand-700">
        {type}
      </span>
      <span className="text-xs text-slate-600">{text}</span>
    </div>
  );
}

function ClientBenefitsSection() {
  return (
    <section className="bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
          <div>
            <span className="text-xs font-semibold uppercase tracking-widest text-accent-700">For your guests</span>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
              Booking that feels like the first course.
            </h2>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-600">
              Modern diners expect concierge-level certainty: instant confirmations, humane reminders, respectful deposit
              language. Resneo makes your digital handshake as warm as your welcome at the door.
            </p>
            <ul className="mt-8 space-y-3">
              {clientBenefits.map((c) => (
                <li key={c} className="flex items-start gap-3 text-sm text-slate-700">
                  <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                    <TickIcon small />
                  </span>
                  {c}
                </li>
              ))}
            </ul>
          </div>
          <RestaurantBookingFlowVisual />
        </div>
      </div>
    </section>
  );
}

function RestaurantBookingFlowVisual() {
  return (
    <div className="relative">
      <div className="absolute -inset-6 rounded-[2rem] bg-gradient-to-br from-brand-100 via-brand-50 to-white blur-2xl" />
      <div className="relative grid gap-3 sm:grid-cols-3">
        <MiniCard step="1" title="Pick sitting">
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {(
              [
                ["Lunch", false],
                ["Early", false],
                ["Peak", true],
                ["Late", false],
              ] as const
            ).map(([label, on]) => (
              <span
                key={label}
                className={`rounded-md px-1.5 py-1 text-center text-[10px] font-semibold ${
                  on ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"
                }`}
              >
                {label}
              </span>
            ))}
          </div>
        </MiniCard>
        <MiniCard step="2" title="Party & table">
          <div className="mt-2 space-y-1.5">
            <Row text="Guests" meta="Cover 4" />
            <Row text="Zone" meta="Restaurant" active />
            <Row text="Preference" meta="Quiet corner" />
          </div>
        </MiniCard>
        <MiniCard step="3" title="Deposit & confirm">
          <div className="mt-2 space-y-1.5">
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-500">Held deposit</span>
              <span className="font-semibold text-slate-900">£40</span>
            </div>
            <div className="rounded-md bg-slate-50 px-2 py-1 text-[10px] leading-snug text-slate-600">
              Policy shown before paying. Cancellation window clear as glass.
            </div>
            <div className="mt-2 rounded-md bg-brand-600 py-1.5 text-center text-[11px] font-bold text-white">
              Secure reservation
            </div>
          </div>
        </MiniCard>
      </div>
    </div>
  );
}

function MiniCard({ step, title, children }: { step: string; title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-100 text-[10px] font-bold text-brand-700">
          {step}
        </span>
        <p className="text-xs font-semibold text-slate-900">{title}</p>
      </div>
      {children}
    </div>
  );
}

function Row({
  text,
  meta,
  active = false,
}: {
  text: string;
  meta: string;
  active?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between rounded-md px-2 py-1.5 text-[11px] ${
        active ? "bg-brand-50 ring-1 ring-brand-200" : "bg-slate-50"
      }`}
    >
      <span className={active ? "font-semibold text-brand-800" : "text-slate-700"}>{text}</span>
      <span className={active ? "font-bold text-brand-800" : "text-slate-500"}>{meta}</span>
    </div>
  );
}

function StatsBand() {
  return (
    <section className="bg-gradient-to-br from-brand-600 via-brand-700 to-brand-800 py-16 text-white">
      <div className="mx-auto grid max-w-6xl gap-8 px-6 text-center sm:grid-cols-3">
        <Stat value={`£${RESTAURANT_PRICE}`} label="Restaurant plan anchors serious venues without per-cover rake" />
        <Stat value="-80%" label="typical no-show drop once deposits bite alongside reminders*" />
        <Stat value="+10hrs" label="weekly headspace reclaimed when comms automate themselves*" />
      </div>
      <p className="mx-auto mt-6 max-w-3xl px-6 text-center text-xs text-white/60">
        *Benchmarks reflective of NI independents layering SMS + Stripe-backed holds; your mileage tracks party mix and
        policy.
      </p>
    </section>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="text-4xl font-extrabold tracking-tight sm:text-5xl">{value}</p>
      <p className="mx-auto mt-2 max-w-xs text-sm text-white/80">{label}</p>
    </div>
  );
}

function HowItWorksSection() {
  return (
    <section id="how" className="scroll-mt-16 bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <span className="text-xs font-semibold uppercase tracking-widest text-accent-700">Rollout playbook</span>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
            Taste-test today. Full service tonight.
          </h2>
        </div>

        <div className="mt-16 grid gap-8 md:grid-cols-3">
          {howItWorks.map((s, i) => (
            <div key={s.step} className="relative">
              {i < howItWorks.length - 1 ? (
                <div className="absolute left-14 top-7 hidden h-0.5 w-full bg-gradient-to-r from-brand-200 to-transparent md:block" />
              ) : null}
              <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 text-xl font-extrabold text-white shadow-lg shadow-brand-600/25">
                {s.step}
              </div>
              <h3 className="mt-5 text-xl font-bold text-slate-900">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{s.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function BookingChannelsSection() {
  return (
    <section className="relative overflow-hidden bg-white py-16 sm:py-24">
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(to right, #0f172a 1px, transparent 1px), linear-gradient(to bottom, #0f172a 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      <div className="relative mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <span className="text-xs font-semibold uppercase tracking-widest text-accent-700">Omnichannel demand</span>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
            Guests book wherever they discover you. One live diary absorbs it all.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-600">
            Instagram stories, QR on menus, concierge links inside hotel confirmation emails: all route into Resneo without
            copy-pasting details into a rogue spreadsheet tonight at midnight.
          </p>
        </div>

        <div className="mt-16 grid gap-6 lg:grid-cols-3">
          <ChannelCard
            label="Embed"
            title="Keep traffic on your own site"
            description="Resneo disappears into your branded pages: fast load, cohesive story, bookings still sync centrally."
            visual={<EmbedRestaurantVisual />}
            featured
          />
          <ChannelCard
            label="Hosted booking page"
            title="Dedicated link for guests-on-the-move"
            description="Premium mobile UX with your story, imagery, openings, dietary reassurance, perfect when SEO or social clicks convert."
            visual={<RestaurantMiniSite />}
          />
          <ChannelCard
            label="Share anywhere"
            title="QR menus, concierge notes, influencer bios"
            description="Paste one URL or print QR codes tuned to brunch vs dinner. All roads lead back to sane availability."
            visual={<RestaurantShareVisual />}
          />
        </div>
      </div>
    </section>
  );
}

function ChannelCard({
  label,
  title,
  description,
  visual,
  featured = false,
}: {
  label: string;
  title: string;
  description: string;
  visual: ReactNode;
  featured?: boolean;
}) {
  return (
    <div
      className={`group relative flex flex-col overflow-hidden rounded-2xl border bg-gradient-to-br from-white to-slate-50 p-6 transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-brand-600/5 ${
        featured ? "border-brand-200 ring-2 ring-brand-100/70" : "border-slate-100 hover:border-brand-200"
      }`}
    >
      <div className="relative flex h-44 items-center justify-center overflow-hidden rounded-xl border border-slate-100 bg-white p-4">
        {visual}
      </div>
      <div className="mt-6">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-accent-700">{label}</span>
        <h3 className="mt-2 text-lg font-semibold text-slate-900">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">{description}</p>
      </div>
    </div>
  );
}

function RestaurantMiniSite() {
  return (
    <div className="relative flex w-full max-w-[200px] flex-col items-center">
      <div className="flex h-4 w-full items-center gap-1 rounded-t-md border border-b-0 border-slate-200 bg-slate-50 px-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
        <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
        <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
        <div className="ml-1 flex h-2.5 flex-1 items-center justify-center rounded bg-white px-1 text-[7px] font-semibold text-slate-500">
          resneo.com/book/bistro-quay
        </div>
      </div>
      <div className="w-full rounded-b-md border border-slate-200 bg-white p-2.5">
        <div className="h-2 w-20 rounded bg-slate-200" />
        <div className="mt-1 h-1.5 w-28 rounded bg-slate-100" />
        <div className="mt-3 grid grid-cols-3 gap-1">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span
              key={i}
              className={`h-4 rounded text-center text-[7px] font-bold ${
                i === 4 ? "bg-brand-600 text-white" : "bg-slate-100 text-transparent"
              }`}
            >
              19:30
            </span>
          ))}
        </div>
        <div className="mt-2 h-4 rounded bg-brand-600" />
      </div>
    </div>
  );
}

function EmbedRestaurantVisual() {
  return (
    <div className="relative w-full max-w-[220px] rounded-md border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-1 border-b border-slate-100 px-2 py-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
        <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
        <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
        <span className="ml-1 text-[7px] font-semibold text-slate-500">bistro-quay.co.uk</span>
      </div>
      <div className="p-2.5">
        <div className="h-2 w-28 rounded bg-slate-800" />
        <div className="mt-1 h-1.5 w-32 rounded bg-slate-200" />
        <div className="relative mt-2 rounded-md border-2 border-dashed border-brand-300 bg-brand-50/40 p-2">
          <span className="absolute -top-1.5 left-2 rounded bg-brand-600 px-1 py-0.5 text-[6px] font-bold uppercase tracking-wider text-white">
            Reservations
          </span>
          <div className="mt-2 grid grid-cols-4 gap-1">
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className={`h-3.5 rounded text-[7px] font-bold leading-[14px] ${
                  i === 2 ? "bg-brand-600 text-white" : "bg-white ring-1 ring-slate-200"
                }`}
              >
                {i === 0 ? "" : "\u00A0"}
              </span>
            ))}
          </div>
          <div className="mt-1.5 h-3 rounded bg-brand-600" />
        </div>
      </div>
    </div>
  );
}

function RestaurantShareVisual() {
  return (
    <div className="flex w-full max-w-[220px] flex-col items-center gap-2">
      <div className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 shadow-sm">
        <LinkChainIcon />
        <span className="truncate text-[9px] font-semibold text-slate-800">Book · tonight</span>
        <span className="ml-auto rounded bg-brand-600 px-1.5 py-0.5 text-[7px] font-bold text-white">Share</span>
      </div>
      <div className="grid w-full grid-cols-3 gap-1.5">
        {["Stories", "Menu QR", "Google", "Concierge", "Newsletter", "Walk-in flyer"].map((l) => (
          <ChannelChip key={l} label={l} />
        ))}
      </div>
    </div>
  );
}

function ChannelChip({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-md border border-slate-100 bg-slate-50 px-1 py-1.5">
      <span className="h-3 w-3 rounded-sm bg-brand-200" />
      <span className="text-[7px] font-semibold text-slate-600">{label}</span>
    </div>
  );
}

function LinkChainIcon() {
  return (
    <svg className="h-3.5 w-3.5 flex-shrink-0 text-brand-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"
      />
    </svg>
  );
}

function VenueTypesSection() {
  return (
    <section className="bg-slate-50 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <span className="text-xs font-semibold uppercase tracking-widest text-accent-700">Who we obsess over</span>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
            Independent rooms with something to prove.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-600">
            From coastal tasting menus to city brunch institutions, Resneo aligns with operators who obsess over vibe,
            pacing, plates, people.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {venueTypes.map((u) => (
            <div
              key={u.name}
              className="group flex items-center gap-3 rounded-xl border border-slate-100 bg-white p-4 transition-all hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-lg">{u.icon}</span>
              <span className="text-sm font-semibold text-slate-800">{u.name}</span>
            </div>
          ))}
          <div className="flex items-center justify-center rounded-xl border border-dashed border-brand-200 bg-brand-50/60 p-4 text-sm font-semibold text-brand-700">
            Tell us yours
          </div>
        </div>
      </div>
    </section>
  );
}

function FeaturesSection() {
  return (
    <section className="bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <span className="text-xs font-semibold uppercase tracking-widest text-accent-700">Under the hood</span>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
            Restaurant-grade tooling without enterprise theatre.
          </h2>
        </div>

        <div className="mt-16 grid gap-px overflow-hidden rounded-2xl bg-slate-100 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="bg-white p-6 transition-colors hover:bg-brand-50/40">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-50 text-brand-600">
                  <TickIcon small />
                </span>
                <h3 className="text-sm font-semibold text-slate-900">{f.title}</h3>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{f.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FaqSection() {
  return (
    <section className="bg-slate-50 py-20 sm:py-28">
      <div className="mx-auto max-w-4xl px-6">
        <div className="text-center">
          <span className="text-xs font-semibold uppercase tracking-widest text-accent-700">Still curious?</span>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Answers before dessert.</h2>
        </div>

        <div className="mt-12 space-y-3">
          {faqs.map((f) => (
            <details key={f.q} className="group rounded-2xl border border-slate-200 bg-white p-6 open:shadow-md">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold text-slate-900">
                {f.q}
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-transform group-open:rotate-45 group-open:bg-brand-100 group-open:text-brand-700">
                  <PlusIcon />
                </span>
              </summary>
              <p className="mt-4 text-sm leading-relaxed text-slate-600">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function ClosingCta() {
  return (
    <section id="contact" className="scroll-mt-16 bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-brand-800 to-brand-900 px-4 py-12 text-white shadow-2xl sm:px-8 sm:py-14 md:px-12 md:py-16">
          <div
            className="absolute inset-0 opacity-30"
            style={{
              backgroundImage:
                "radial-gradient(circle at 22% 32%, rgba(0,59,111,0.82) 0%, transparent 40%), radial-gradient(circle at 86% 70%, rgba(0,59,111,0.45) 0%, transparent 45%)",
            }}
          />
          <div className="relative grid grid-cols-1 gap-8 sm:gap-10 lg:grid-cols-2 lg:items-stretch lg:gap-12">
            <div className="min-w-0">
              <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-5xl">
                Ready to reshape how your room fills up?
              </h2>
              <p className="mt-5 max-w-lg text-base leading-relaxed text-white/80">
                Speak with NI operators who obsess over plating and pacing. Tell us where your pain sits and we&apos;ll sketch
                a launch path that respects service, not spreadsheets.
              </p>

              <div className="mt-6 flex w-full max-w-full flex-col gap-3 rounded-xl border border-white/20 bg-white/10 px-4 py-3 backdrop-blur sm:flex-row sm:items-start">
                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-white/20 text-white">
                  <TagIcon small />
                </span>
                <div className="min-w-0 flex-1 text-sm">
                  <span className="font-semibold text-white">Founding Partner Offer: </span>
                  <span className="text-white/80">Use code </span>
                  <span className="rounded bg-white/20 px-1.5 py-0.5 font-mono text-xs font-bold tracking-wider text-white">
                    RESERVE50
                  </span>
                  <span className="text-white/80"> at checkout for 50% off for 3 months.</span>
                </div>
              </div>

              <div className="mt-6 grid max-w-xl grid-cols-1 gap-3 text-xs text-white/85 sm:grid-cols-2">
                <div className="rounded-lg border border-white/15 bg-white/10 px-3 py-2">Same-week go-live commonplace</div>
                <div className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 leading-snug">
                  No commissions on bookings.
                  <span className="mt-1 block text-white/75">{STANDARD_PAYMENT_PROVIDER_FEES_NOTICE}</span>
                </div>
                <div className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 sm:col-span-2">
                  {SUBSCRIPTION_CANCELLATION_PUBLIC_NOTICE}
                </div>
                <div className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 sm:col-span-2">Local NI onboarding</div>
              </div>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <Link
                  href={SIGNUP_RESTAURANT}
                  className="inline-flex h-12 items-center justify-center rounded-xl bg-white px-7 text-base font-semibold text-slate-900 shadow-lg transition-all hover:-translate-y-0.5 hover:bg-brand-50"
                >
                  Start Restaurant plan
                  <ArrowRightIcon />
                </Link>
                <Link
                  href="/#pricing"
                  className="inline-flex h-12 items-center justify-center rounded-xl border border-white/25 bg-transparent px-6 text-base font-semibold text-white backdrop-blur transition-colors hover:bg-white/10"
                >
                  Compare all plans
                </Link>
                <a
                  href="mailto:hello@resneo.com"
                  className="inline-flex h-12 items-center justify-center rounded-xl border border-white/20 bg-white/5 px-6 text-base font-semibold text-white backdrop-blur transition-colors hover:bg-white/10"
                >
                  hello@resneo.com
                </a>
              </div>

              <div className="mt-10 grid grid-cols-2 gap-6 border-t border-white/10 pt-8 text-sm text-white/70">
                <div>
                  <p className="text-2xl font-bold text-white">Floor-first</p>
                  <p className="text-xs">Day sheet, grid, floor plan: front and back aligned.</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-white">{SMS_INCLUDED_RESTAURANT}</p>
                  <p className="text-xs text-white/85">included SMS/month on Restaurant plan*</p>
                  <p className="mt-1 text-[10px] text-white/60">*Beyond allowance → {Math.round(SMS_OVERAGE_GBP_PER_MESSAGE * 100)}p each.</p>
                </div>
              </div>
            </div>

            <div className="min-w-0 w-full max-w-full rounded-2xl bg-white p-5 text-slate-900 shadow-xl sm:p-8">
              <h3 className="text-lg font-bold">Brief us on your venue.</h3>
              <p className="mt-1 text-sm text-slate-500">We reply within one working day.</p>
              <div className="mt-5 w-full min-w-0">
                <ContactForm className="mx-0 w-full max-w-none" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-slate-100 bg-slate-50 py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-6 text-sm text-slate-500 sm:flex-row sm:justify-between">
        <p className="max-w-xl text-center leading-snug sm:text-left">
          &copy; 2026 Resneo · JAR 26 LTD (NI740269) · 100a Main Street, Bangor, BT20 4AG, UK
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 sm:justify-end">
          <Link href="/" className="transition-colors hover:text-slate-900">
            Home
          </Link>
          <Link href="/appointments-plan" className="transition-colors hover:text-slate-900">
            Appointments plan
          </Link>
          <Link href="/#pricing" className="transition-colors hover:text-slate-900">
            Sign up
          </Link>
          <Link href="/login" className="transition-colors hover:text-slate-900">
            Login
          </Link>
          <a href="mailto:hello@resneo.com" className="transition-colors hover:text-slate-900">
            Contact
          </a>
          <Link href="/terms" className="transition-colors hover:text-slate-900">
            Website Terms of Use
          </Link>
          <Link href="/privacy" className="transition-colors hover:text-slate-900">
            Privacy Policy
          </Link>
        </div>
      </div>
    </footer>
  );
}

function TickIcon({ small = false }: { small?: boolean }) {
  return (
    <svg
      className={small ? "h-3 w-3" : "h-4 w-4"}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2.5}
      stroke="currentColor"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg className="ml-2 h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
      />
    </svg>
  );
}

function PhoneOffIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14.25 9.75 21 3m0 0h-6.75M21 3v6.75M9 5.25h-.75A2.25 2.25 0 0 0 6 7.5v9a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 16.5v-5.25"
      />
    </svg>
  );
}

function GhostIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4.5 19.5V12a7.5 7.5 0 1 1 15 0v7.5l-2.25-1.5-2.25 1.5-2.25-1.5-2.25 1.5-2.25-1.5L4.5 19.5Z"
      />
      <circle cx="9.5" cy="11" r="0.75" fill="currentColor" />
      <circle cx="14.5" cy="11" r="0.75" fill="currentColor" />
    </svg>
  );
}

function CalendarAlertIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75M3 18.75V10.5A2.25 2.25 0 0 1 5.25 8.25h13.5A2.25 2.25 0 0 1 21 10.5v8.25M12 12.75v3m0 2.25h.007v.008H12v-.008Z"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75 9.75 9.75 0 0 1 8.25 6c0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.636 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z"
      />
    </svg>
  );
}

function ClipboardAlertIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
      />
    </svg>
  );
}

function SparklesIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.898 20.624 16.5 21.75l-.398-1.126a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.179-.398a2.25 2.25 0 0 0 1.423-1.423l.398-1.126.398 1.126a2.25 2.25 0 0 0 1.423 1.423L19.5 18.75l-1.179.398a2.25 2.25 0 0 0-1.423 1.423Z"
      />
    </svg>
  );
}

function LayoutGridIcon() {
  return (
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 6A2.25 2.25 0 0 1 15.75 3.75H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25h-2.25a2.25 2.25 0 0 1-2.25-2.25v-2.25ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25A2.25 2.25 0 0 1 10.5 15.75v2.25A2.25 2.25 0 0 1 8.25 20.25H6a2.25 2.25 0 0 1-2.25-2.25v-2.25Z"
      />
    </svg>
  );
}

function ShieldPoundIcon() {
  return (
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75 11.25 15 15 9.75M21 12c0 5.25-4 9.75-9 9.75S3 17.25 3 12V6.75l9-3 9 3V12Z"
      />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
      />
    </svg>
  );
}

function UserCardIcon() {
  return (
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Zm6-10.125a1.875 1.875 0 1 1-3.75 0 1.875 1.875 0 0 1 3.75 0Zm1.294 6.336a6.721 6.721 0 0 1-3.17.789 6.721 6.721 0 0 1-3.168-.789 3.376 3.376 0 0 1 6.338 0Z"
      />
    </svg>
  );
}

function TrendUpIcon() {
  return (
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941"
      />
    </svg>
  );
}

function TagIcon({ small = false }: { small?: boolean }) {
  return (
    <svg
      className={small ? "h-4 w-4" : "h-6 w-6"}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6Z" />
    </svg>
  );
}
