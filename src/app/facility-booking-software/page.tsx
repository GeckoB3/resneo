import type { Metadata } from "next";
import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import ContactForm from "@/components/ContactForm";
import { RESNEO_MARKETING_PAYMENTS_AND_NO_HOLD } from "@/lib/booking-funds-copy";
import { STANDARD_PAYMENT_PROVIDER_FEES_NOTICE } from "@/lib/payment-provider-fees-notice";
import { SUBSCRIPTION_CANCELLATION_PUBLIC_NOTICE } from "@/lib/subscription-cancellation-copy";
import { APPOINTMENTS_LIGHT_PRICE } from "@/lib/pricing-constants";
import {
  LINKED_ACCOUNTS_HMRC_DISCLAIMER,
  LINKED_ACCOUNTS_HMRC_NOTE,
} from "@/lib/linked-accounts-marketing-copy";
import {
  ArrowPathIcon,
  ArrowRightIcon,
  BellIcon,
  BoltIcon,
  ClockIcon,
  CreditCardIcon,
  KeyIcon,
  LayoutGridIcon,
  LinkIcon,
  LockIcon,
  MoonIcon,
  PlusIcon,
  ShieldCheckIcon,
  ShieldPoundIcon,
  TickIcon,
  UserCardIcon,
} from "@/components/marketing/marketing-icons";

const PAGE_PATH = "/facility-booking-software";
const SIGNUP = "/#pricing";

export const metadata: Metadata = {
  title: "Facility Booking Software for Courts, Rooms & Hireable Spaces | Resneo",
  description:
    "Resneo is facility and court booking software for sports clubs, courts, studios, and venues for hire. Let customers book any space by the hour 24/7, set peak and off-peak pricing, take recurring and block bookings, sell memberships, and get paid online. No commission, no marketplace. Start a free 14-day trial.",
  keywords: [
    "facility booking software",
    "court booking software",
    "room hire booking software",
    "sports facility booking system",
    "hourly rental booking software",
    "space hire software",
    "tennis court booking system",
    "padel court booking software",
    "meeting room booking software",
    "venue hire software",
  ],
  alternates: { canonical: PAGE_PATH },
  openGraph: {
    title: "Facility Booking Software for Courts, Rooms & Hireable Spaces | Resneo",
    description:
      "Book any court, room, or space by the hour. Peak and off-peak pricing, recurring and block bookings, memberships, and online payment. Fill every slot, get paid up front.",
    url: PAGE_PATH,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Facility Booking Software for Courts, Rooms & Hireable Spaces | Resneo",
    description:
      "Hourly slot and resource booking with peak pricing, recurring bookings, and pay-to-book, built for courts, sports halls, and venues for hire.",
  },
};

/* ────────────────────────────────────────────────────────────────────────
   Content
   ──────────────────────────────────────────────────────────────────────── */

const outcomes = [
  {
    eyebrow: "Outcome 01",
    title: "Every slot, filled",
    promise:
      "An empty court or room is income you cannot rebill. Resneo puts your live availability in front of customers around the clock and makes booking a slot effortless.",
    accent: "brand" as const,
    features: [
      {
        title: "24/7 online booking",
        description:
          "A branded booking page for every court, room, and space, open day and night, on your own site or from a link.",
        icon: MoonIcon,
      },
      {
        title: "By-the-hour slots",
        description:
          "Let customers book a 30, 60, or 90 minute slot with the turnaround time you need built in between bookings.",
        icon: ClockIcon,
      },
      {
        title: "Recurring & block bookings",
        description:
          "Regulars, clubs, and leagues book the same slot every week, or a block of dates in a single booking.",
        icon: ArrowPathIcon,
      },
    ],
  },
  {
    eyebrow: "Outcome 02",
    title: "Paid before they play",
    promise:
      "Chasing payment and no-shows on the day is a drain. Resneo collects payment when the booking is made and prices each slot exactly how you run the venue.",
    accent: "accent" as const,
    features: [
      {
        title: "Pay online to confirm",
        description: `Take a deposit or full payment at the point of booking, paid straight to your account. ${RESNEO_MARKETING_PAYMENTS_AND_NO_HOLD}`,
        icon: ShieldPoundIcon,
      },
      {
        title: "Peak & off-peak pricing",
        description:
          "Charge more at peak times and less off-peak, with separate member and public rates, set per resource.",
        icon: BoltIcon,
      },
      {
        title: "Memberships & passes",
        description:
          "Sell memberships or multi-use passes for regulars, and let them book against their plan at member rates.",
        icon: CreditCardIcon,
      },
    ],
  },
  {
    eyebrow: "Outcome 03",
    title: "Run it from anywhere",
    promise:
      "Self-serve booking means fewer phone calls and no double-bookings. Resneo keeps every resource in one grid and the day running without you tied to the desk.",
    accent: "rose" as const,
    features: [
      {
        title: "One grid for every resource",
        description:
          "Courts, rooms, pitches, and bays in a single live view. See the whole day at a glance and drag to adjust.",
        icon: LayoutGridIcon,
      },
      {
        title: "Self-serve access",
        description:
          "Customers book and pay themselves, 24/7, so your team is not tied to the phone or the front desk.",
        icon: KeyIcon,
      },
      {
        title: "Reminders & confirmations",
        description:
          "Automated email and SMS confirmations and reminders cut no-shows and keep everyone on the same page.",
        icon: BellIcon,
      },
    ],
  },
];

const timeCols = ["18:00", "19:00", "20:00"];
const slotRows: { resource: string; cells: ("booked" | "free" | "peak" | "recurring")[] }[] = [
  { resource: "Court 1", cells: ["booked", "free", "peak"] },
  { resource: "Court 2", cells: ["free", "booked", "booked"] },
  { resource: "Studio A", cells: ["recurring", "free", "free"] },
  { resource: "Room B", cells: ["booked", "free", "booked"] },
];
const cellStyles: Record<string, { cls: string; label: string }> = {
  booked: { cls: "bg-brand-600 text-white", label: "Booked" },
  free: { cls: "bg-slate-100 text-slate-400", label: "Free" },
  peak: { cls: "bg-accent-100 text-accent-700", label: "Peak" },
  recurring: { cls: "bg-emerald-100 text-emerald-700", label: "Wkly" },
};

const slotPoints = [
  {
    title: "Per-resource availability",
    description:
      "Set hours, slot lengths, and turnaround time for each court, room, or space independently.",
    icon: LayoutGridIcon,
  },
  {
    title: "Hourly slots with buffers",
    description:
      "Offer 30, 60, or 90 minute slots and block the cleanup or changeover time you need between bookings.",
    icon: ClockIcon,
  },
  {
    title: "Peak, off-peak & member pricing",
    description:
      "Price by time of day and day of week, with separate rates for members and the public.",
    icon: BoltIcon,
  },
  {
    title: "Recurring & block bookings",
    description:
      "Lock in weekly regulars, leagues, and courses, or take a block of dates in a single booking.",
    icon: ArrowPathIcon,
  },
];

const bookingSteps = [
  { step: "1", title: "Pick a space", description: "A court, pitch, studio, or meeting room. Customers choose from your real resources and rates." },
  { step: "2", title: "Pick a date & time", description: "Live availability by the hour, with peak and off-peak prices shown up front." },
  { step: "3", title: "Pay & confirm", description: "Pay a deposit or in full to lock the slot, on member or public pricing." },
  { step: "4", title: "Booked", description: "Instant confirmation and a reminder queued. Set it to repeat every week in a tap." },
];

const resourceMenu = [
  {
    name: "Padel court",
    duration: "Per hour · peak",
    price: "£24",
    tags: ["Off-peak £16", "Members £12"],
    tone: "brand" as const,
  },
  {
    name: "5-a-side pitch",
    duration: "Per hour",
    price: "£60",
    tags: ["Recurring weekly", "Deposit £20"],
    tone: "accent" as const,
  },
  {
    name: "Meeting room",
    duration: "Per hour",
    price: "£18",
    tags: ["Min 1 hour", "Pay in full"],
    tone: "brand" as const,
  },
];

const businessTypes = [
  { name: "Tennis & padel clubs", icon: "🎾" },
  { name: "Squash & badminton", icon: "🏸" },
  { name: "5-a-side & football", icon: "⚽" },
  { name: "Sports halls & leisure", icon: "🏟️" },
  { name: "Golf bays & ranges", icon: "⛳" },
  { name: "Climbing centres", icon: "🧗" },
  { name: "Meeting & coworking rooms", icon: "🏢" },
  { name: "Photography studios", icon: "📸" },
  { name: "Music rehearsal rooms", icon: "🎸" },
  { name: "Dance & hire studios", icon: "🪩" },
  { name: "Community & church halls", icon: "🏛️" },
];

const compareRows: { label: string; resneo: string; other: string }[] = [
  { label: "Commission on bookings", resneo: "None, ever", other: "Often a % of every booking" },
  { label: "By-the-hour & recurring", resneo: "Built in", other: "Clunky or unsupported" },
  { label: "Peak & member pricing", resneo: "Built in, per resource", other: "Limited or one rate" },
  { label: "Who owns your customers", resneo: "You do", other: "Pooled in an aggregator" },
  { label: "Payouts", resneo: "Direct to your account", other: "Held and paid on their schedule" },
];

const faqs = [
  {
    q: "Is Resneo good booking software for a tennis or padel club?",
    a: "Yes. Resneo books courts by the hour around the clock, sets peak, off-peak, and member pricing, takes payment online, and supports recurring bookings for regulars and leagues. It works just as well for squash, badminton, 5-a-side, and sports halls.",
  },
  {
    q: "Can customers book a space by the hour?",
    a: "Yes. Every court, room, or space has its own hourly availability. Offer 30, 60, or 90 minute slots, build in turnaround time between bookings, and set a minimum or maximum duration.",
  },
  {
    q: "Does Resneo handle recurring or block bookings?",
    a: "Yes. Regulars, clubs, and leagues can book the same slot every week, and you can take a block of dates in a single booking. Recurring bookings hold the slot automatically so a regular keeps their place.",
  },
  {
    q: "Can I charge different peak, off-peak, or member prices?",
    a: "Yes. Price by time of day and day of week, and set separate member and public rates for each resource, so busy times earn more and quiet hours still fill.",
  },
  {
    q: "Can I manage multiple courts, rooms, or sites?",
    a: "Yes. Every resource sits in one live grid, and you can run multiple areas or sites from the same account, each with its own availability and pricing.",
  },
  {
    q: "Do customers need to download an app?",
    a: "No. Customers book and pay on a fast mobile-friendly web page, with no app and no account wall. You manage the whole venue from your phone, a tablet, or the front desk.",
  },
  {
    q: "I have coaches or clubs that take their own bookings. Can each keep separate books?",
    a: `Yes. Each coach, club, or operator can run their own Resneo with their own customers, calendar, and payouts, then link accounts to share the booking calendar. Either side can break the link in a click. ${LINKED_ACCOUNTS_HMRC_NOTE}`,
  },
  {
    q: "Does Resneo take commission, and how much does it cost?",
    a: `There is never any commission on your bookings. Plans start from £${APPOINTMENTS_LIGHT_PRICE}/month with a 14-day free trial on every paid plan. Connect Stripe and ${STANDARD_PAYMENT_PROVIDER_FEES_NOTICE.toLowerCase()} ${RESNEO_MARKETING_PAYMENTS_AND_NO_HOLD} ${SUBSCRIPTION_CANCELLATION_PUBLIC_NOTICE}`,
  },
];

/* ────────────────────────────────────────────────────────────────────────
   Structured data (SEO + AI)
   ──────────────────────────────────────────────────────────────────────── */

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      name: "Resneo: Facility & Court Booking Software",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description:
        "Facility and court booking software for sports clubs and venues for hire: 24/7 by-the-hour slot and resource booking, peak and off-peak and member pricing, recurring and block bookings, memberships, and online payment, with every resource in one live grid.",
      offers: { "@type": "Offer", price: String(APPOINTMENTS_LIGHT_PRICE), priceCurrency: "GBP" },
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "/" },
        { "@type": "ListItem", position: 2, name: "Solutions", item: "/solutions" },
        { "@type": "ListItem", position: 3, name: "Courts & venues", item: PAGE_PATH },
      ],
    },
    {
      "@type": "FAQPage",
      mainEntity: faqs.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
  ],
};

/* ────────────────────────────────────────────────────────────────────────
   Page
   ──────────────────────────────────────────────────────────────────────── */

export default function FacilityBookingSoftwarePage() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Nav />
      <Hero />
      <TrustStrip />
      <SlotGridSection />
      <OutcomesSection />
      <BookingFlowSection />
      <PricingRulesSection />
      <AccessOpsSection />
      <LinkedAccountsSection />
      <BusinessTypesSection />
      <CompareSection />
      <FaqSection />
      <ClosingCta />
      <Footer />
    </div>
  );
}

/* ── Nav ──────────────────────────────────────────────────────────────── */

function Nav() {
  return (
    <nav className="sticky top-0 z-50 border-b border-slate-100 bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex-shrink-0">
          <img src="/Logo.png" alt="Resneo" className="h-9 w-auto" />
        </Link>
        <div className="flex items-center gap-2 sm:gap-4">
          <Link
            href="/solutions"
            className="hidden rounded-xl px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900 sm:inline-flex"
          >
            All solutions
          </Link>
          <a
            href="#contact"
            className="hidden rounded-xl px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900 sm:inline-flex"
          >
            Talk to us
          </a>
          <a
            href={SIGNUP}
            className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
          >
            Start free trial
          </a>
        </div>
      </div>
    </nav>
  );
}

/* ── Hero ─────────────────────────────────────────────────────────────── */

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-brand-50 via-white to-accent-50/40" />
      <div
        className="absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            "radial-gradient(circle at 18% 18%, rgba(0,59,111,0.14) 0%, transparent 45%), radial-gradient(circle at 88% 78%, rgba(0,194,199,0.12) 0%, transparent 50%)",
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
          <Breadcrumb />
          <span className="mt-5 inline-flex items-center gap-2 rounded-full border border-brand-200 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-brand-700 backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            Built for courts &amp; venues
          </span>
          <h1 className="mt-6 text-4xl font-extrabold leading-[1.05] tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
            Facility booking software for courts, rooms &amp; hireable spaces
          </h1>
          <p className="mt-5 text-xl font-semibold sm:text-2xl">
            <span className="bg-gradient-to-r from-brand-700 via-brand-600 to-accent-dark bg-clip-text text-transparent">
              Fill every slot. Get paid up front. Run it on autopilot.
            </span>
          </p>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-600">
            Let customers book any court, room, or space by the hour 24/7, set peak and off-peak pricing, take
            recurring and block bookings, and get paid online before they arrive. Resneo is the all-in-one booking
            platform for sports facilities and venues for hire, with no booking commission and no marketplace.
          </p>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <a
              href={SIGNUP}
              className="inline-flex h-12 items-center justify-center rounded-xl bg-brand-600 px-7 text-base font-semibold text-white shadow-lg shadow-brand-600/25 transition-all hover:-translate-y-0.5 hover:bg-brand-700 hover:shadow-xl hover:shadow-brand-600/30"
            >
              Start your free 14-day trial
              <ArrowRightIcon />
            </a>
            <a
              href="#slots"
              className="inline-flex h-12 items-center justify-center rounded-xl border border-slate-200 bg-white px-6 text-base font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:text-slate-900"
            >
              See slot booking
            </a>
          </div>

          <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-slate-500">
            <span className="inline-flex items-center gap-2">
              <TickIcon /> 14-day free trial
            </span>
            <span className="inline-flex items-center gap-2">
              <TickIcon /> No booking commission
            </span>
            <span className="inline-flex items-center gap-2">
              <TickIcon /> Pay-to-book built in
            </span>
          </div>
        </div>

        <div className="relative lg:col-span-2">
          <HeroPhoneVisual />
        </div>
      </div>
    </section>
  );
}

function Breadcrumb() {
  return (
    <nav aria-label="Breadcrumb" className="text-xs font-medium text-slate-500">
      <ol className="flex items-center gap-1.5">
        <li>
          <Link href="/" className="hover:text-slate-800">
            Home
          </Link>
        </li>
        <li aria-hidden className="text-slate-300">
          /
        </li>
        <li>
          <Link href="/solutions" className="hover:text-slate-800">
            Solutions
          </Link>
        </li>
        <li aria-hidden className="text-slate-300">
          /
        </li>
        <li className="text-slate-700">Courts &amp; venues</li>
      </ol>
    </nav>
  );
}

function HeroPhoneVisual() {
  return (
    <div className="relative mx-auto w-full max-w-sm">
      <div className="absolute -inset-4 rounded-[2.5rem] bg-gradient-to-tr from-brand-200/60 via-white/0 to-accent-200/50 blur-2xl" />

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
            <div className="flex items-center gap-2 text-[11px] font-medium text-accent-700">
              <span className="inline-block h-2 w-2 rounded-full bg-accent" />
              Booking confirmed
            </div>
            <h3 className="mt-2 text-lg font-bold text-slate-900">Court 3 · Padel</h3>
            <p className="mt-0.5 text-xs text-slate-500">Riverside Courts · Tue 19:00</p>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <InfoTile label="When" value="Tue · 19:00" />
              <InfoTile label="Paid" value="£24" accent />
            </div>

            <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Your booking</p>
              <ul className="mt-2 space-y-1.5">
                <ChecklistRow label="Paid online" state="£24" done />
                <ChecklistRow label="Repeats weekly" state="Every Tue" done />
                <ChecklistRow label="Reminder" state="2h before" done />
              </ul>
            </div>

            <div className="mt-4 rounded-xl border border-brand-100 bg-brand-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-600">Pricing</p>
              <p className="mt-1 text-xs text-brand-800">Peak rate applied. Members pay £12 when signed in.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute -top-6 -left-6 hidden rotate-[-6deg] rounded-xl border border-slate-100 bg-white p-3 shadow-xl shadow-slate-900/10 sm:block">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-50 text-accent-700">
            <BoltIcon className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-slate-900">Peak rate</p>
            <p className="text-[10px] text-slate-500">Off-peak £16</p>
          </div>
        </div>
      </div>

      <div className="absolute -bottom-6 -right-4 hidden rotate-[4deg] rounded-xl border border-slate-100 bg-white p-3 shadow-xl shadow-slate-900/10 sm:block">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
            <ArrowPathIcon className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-slate-900">Recurring</p>
            <p className="text-[10px] text-slate-500">Every Tuesday</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoTile({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${accent ? "border-accent-200 bg-accent-50" : "border-slate-100 bg-slate-50"}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-1 text-sm font-bold ${accent ? "text-accent-700" : "text-slate-900"}`}>{value}</p>
    </div>
  );
}

function ChecklistRow({ label, state, done = false }: { label: string; state: string; done?: boolean }) {
  return (
    <li className="flex items-center justify-between gap-2 text-xs">
      <span className="flex items-center gap-2 text-slate-700">
        <span
          className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full ${
            done ? "bg-emerald-100 text-emerald-600" : "bg-amber-100 text-amber-600"
          }`}
        >
          <TickIcon className="h-2.5 w-2.5" />
        </span>
        {label}
      </span>
      <span className={`font-semibold ${done ? "text-emerald-600" : "text-amber-600"}`}>{state}</span>
    </li>
  );
}

/* ── Trust strip ──────────────────────────────────────────────────────── */

function TrustStrip() {
  const items = [
    { value: "24/7", label: "Self-serve booking" },
    { value: "0%", label: "Commission on bookings" },
    { value: "By the hour", label: "Or block & recurring" },
    { value: "15 min", label: "Typical setup time" },
  ];
  return (
    <section className="border-y border-slate-100 bg-white py-10">
      <div className="mx-auto grid max-w-5xl grid-cols-2 gap-6 px-6 text-center sm:grid-cols-4">
        {items.map((s) => (
          <div key={s.label}>
            <p className="text-2xl font-extrabold tracking-tight text-brand-700 sm:text-3xl">{s.value}</p>
            <p className="mt-1 text-xs font-medium text-slate-500 sm:text-sm">{s.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── Slot grid flagship ───────────────────────────────────────────────── */

function SlotGridSection() {
  return (
    <section id="slots" className="relative scroll-mt-16 overflow-hidden bg-white py-20 sm:py-28">
      <div className="absolute inset-0 bg-gradient-to-br from-brand-50 via-white to-accent-50/40" />
      <div className="relative mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-brand-700 backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            Slots, resources &amp; pricing
          </span>
          <h2 className="mt-5 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
            Every court, room, and space in one grid.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-600">
            Resneo books any resource by the hour, prices it by time and membership, and takes payment up front.
            Recurring and block bookings keep your regulars locked in, and one live grid shows the whole venue at a
            glance.
          </p>
        </div>

        <div className="mt-14 grid items-start gap-10 lg:grid-cols-2 lg:gap-14">
          {/* Mock: resource grid */}
          <div className="relative">
            <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-r from-brand-100/50 via-white/0 to-accent-200/50 blur-3xl" />
            <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-brand-900/5">
              <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
                <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
                <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
                <span className="ml-3 inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400">
                  <LockIcon /> resneo.com/calendar
                </span>
              </div>
              <div className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Today</p>
                    <h3 className="mt-0.5 text-lg font-bold text-slate-900">Riverside Courts</h3>
                  </div>
                  <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                    82% booked
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-[1fr_repeat(3,minmax(0,1fr))] gap-1.5 text-[10px]">
                  <div />
                  {timeCols.map((t) => (
                    <div key={t} className="text-center font-semibold text-slate-400">
                      {t}
                    </div>
                  ))}
                  {slotRows.map((r) => (
                    <Fragment key={r.resource}>
                      <div className="flex items-center text-[11px] font-bold text-slate-700">{r.resource}</div>
                      {r.cells.map((c, i) => (
                        <div
                          key={`${r.resource}-${i}`}
                          className={`rounded-md py-1.5 text-center text-[10px] font-bold ${cellStyles[c].cls}`}
                        >
                          {cellStyles[c].label}
                        </div>
                      ))}
                    </Fragment>
                  ))}
                </div>

                <div className="mt-4 flex items-center justify-between rounded-xl border border-accent-200 bg-accent-50 px-3 py-2.5">
                  <p className="text-[12px] font-medium text-accent-800">Court 1 · 20:00 is peak</p>
                  <span className="rounded-lg bg-accent px-2.5 py-1 text-[11px] font-bold text-white">£24 / hr</span>
                </div>

                <div className="mt-3 rounded-xl border border-brand-100 bg-brand-50 px-3 py-2.5">
                  <p className="text-[11px] font-semibold text-brand-700">Recurring booking</p>
                  <p className="mt-0.5 text-[12px] text-brand-800">Studio A · every Tuesday 18:00, held for the league.</p>
                </div>
              </div>
            </div>
          </div>

          {/* Points */}
          <div className="grid gap-4 sm:grid-cols-2">
            {slotPoints.map((p) => (
              <div key={p.title} className="rounded-2xl border border-slate-100 bg-white/80 p-5 shadow-sm backdrop-blur">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-100">
                  <p.icon />
                </div>
                <h3 className="mt-4 text-sm font-bold text-slate-900">{p.title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600">{p.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Outcomes ─────────────────────────────────────────────────────────── */

const accentStyles = {
  rose: { chip: "bg-rose-100 text-rose-700", icon: "bg-rose-50 text-rose-600 ring-rose-100", bar: "from-rose-400 to-rose-200" },
  brand: { chip: "bg-brand-100 text-brand-700", icon: "bg-brand-50 text-brand-600 ring-brand-100", bar: "from-brand-400 to-brand-200" },
  accent: { chip: "bg-accent-100 text-accent-700", icon: "bg-accent-50 text-accent-600 ring-accent-100", bar: "from-accent-400 to-accent-200" },
} as const;

function OutcomesSection() {
  return (
    <section className="bg-slate-50 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <span className="text-xs font-semibold uppercase tracking-widest text-accent-700">Outcomes first</span>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
            What every venue manager wants, and how Resneo delivers it.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-600">
            Each promise below maps to the exact Resneo features that make it happen. No buzzwords, just the tools
            doing the work.
          </p>
        </div>

        <div className="mt-16 space-y-6">
          {outcomes.map((o) => {
            const s = accentStyles[o.accent];
            return (
              <div key={o.title} className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm">
                <div className={`h-1.5 w-full bg-gradient-to-r ${s.bar}`} />
                <div className="grid gap-8 p-7 sm:p-10 lg:grid-cols-[0.9fr_1.6fr] lg:gap-12">
                  <div>
                    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider ${s.chip}`}>
                      {o.eyebrow}
                    </span>
                    <h3 className="mt-4 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">{o.title}</h3>
                    <p className="mt-3 text-sm leading-relaxed text-slate-600">{o.promise}</p>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-3">
                    {o.features.map((f) => (
                      <div key={f.title} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-5 transition-colors hover:border-slate-200 hover:bg-white">
                        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ring-1 ${s.icon}`}>
                          <f.icon />
                        </div>
                        <h4 className="mt-4 text-sm font-bold text-slate-900">{f.title}</h4>
                        <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600">{f.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ── Booking flow ─────────────────────────────────────────────────────── */

function BookingFlowSection() {
  return (
    <section className="bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <span className="text-xs font-semibold uppercase tracking-widest text-accent-700">The booking flow</span>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
            A booking journey your customers will actually finish.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-600">
            From &ldquo;is the court free?&rdquo; to a paid, confirmed slot: space, time, price, payment, and the
            option to repeat it weekly. No app, no account wall.
          </p>
        </div>

        <div className="relative mt-16">
          <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-r from-brand-100/40 via-white/0 to-accent-200/40 blur-3xl" />
          <div className="relative grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FlowStep step="1" title="Pick a space">
              <div className="mt-3 space-y-1.5">
                <FlowRow text="Padel court" meta="£24" active />
                <FlowRow text="5-a-side pitch" meta="£60" />
                <FlowRow text="Meeting room" meta="£18" />
              </div>
            </FlowStep>
            <FlowStep step="2" title="Pick a date & time">
              <div className="mt-3 grid grid-cols-3 gap-1.5">
                {["18:00", "19:00", "20:00", "20:30", "21:00", "21:30"].map((t, i) => (
                  <span key={t} className={`rounded-md px-1 py-1.5 text-center text-[10px] font-semibold ${i === 1 ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}>
                    {t}
                  </span>
                ))}
              </div>
            </FlowStep>
            <FlowStep step="3" title="Pay & confirm">
              <div className="mt-3 space-y-1.5">
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-500">Peak · 1 hr</span>
                  <span className="font-semibold text-slate-900">£24</span>
                </div>
                <FlowRow text="Member rate" meta="£12" />
                <div className="mt-1 rounded-md bg-brand-600 py-1.5 text-center text-[11px] font-bold text-white">Pay &amp; book</div>
              </div>
            </FlowStep>
            <FlowStep step="4" title="Booked">
              <div className="mt-3 space-y-1.5">
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-500">Slot</span>
                  <span className="font-semibold text-slate-900">Confirmed</span>
                </div>
                <div className="rounded-md bg-slate-50 px-2 py-1 text-[10px] leading-snug text-slate-600">
                  Reminder queued. Tap to repeat the same slot every week.
                </div>
                <div className="mt-1 rounded-md bg-emerald-100 py-1.5 text-center text-[11px] font-bold text-emerald-700">Repeats weekly</div>
              </div>
            </FlowStep>
          </div>
        </div>

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {bookingSteps.map((s, i) => (
            <div key={s.step} className="relative">
              {i < bookingSteps.length - 1 ? (
                <div className="absolute left-10 top-5 hidden h-0.5 w-full bg-gradient-to-r from-brand-200 to-transparent lg:block" />
              ) : null}
              <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 text-sm font-extrabold text-white shadow-md shadow-brand-600/25">
                {s.step}
              </div>
              <h4 className="mt-4 text-base font-bold text-slate-900">{s.title}</h4>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{s.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FlowStep({ step, title, children }: { step: string; title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-100 text-[10px] font-bold text-brand-700">{step}</span>
        <p className="text-xs font-semibold text-slate-900">{title}</p>
      </div>
      {children}
    </div>
  );
}

function FlowRow({ text, meta, active = false }: { text: string; meta: string; active?: boolean }) {
  return (
    <div className={`flex items-center justify-between rounded-md px-2 py-1.5 text-[11px] ${active ? "bg-brand-50 ring-1 ring-brand-200" : "bg-slate-50"}`}>
      <span className={active ? "font-semibold text-brand-800" : "text-slate-700"}>{text}</span>
      <span className={active ? "font-bold text-brand-800" : "text-slate-500"}>{meta}</span>
    </div>
  );
}

/* ── Pricing rules ────────────────────────────────────────────────────── */

function PricingRulesSection() {
  return (
    <section className="bg-slate-50 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
          <div>
            <span className="text-xs font-semibold uppercase tracking-widest text-accent-700">Pricing &amp; rules</span>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Price every space the way you run it.
            </h2>
            <p className="mt-5 text-base leading-relaxed text-slate-600">
              No venue charges one flat rate all week. Resneo lets you set the prices, slot lengths, and rules each
              resource needs, so peak hours earn more and quiet ones still fill.
            </p>
            <ul className="mt-7 space-y-4">
              {[
                { t: "Peak and off-peak rates", d: "Charge more at busy times and fill quiet hours with a lower price, automatically." },
                { t: "Member and public pricing", d: "Give members a better rate and let them book against a membership or pass." },
                { t: "Slot length and turnaround", d: "Set 30, 60, or 90 minute slots and protect cleanup time between bookings." },
                { t: "Deposits or pay in full", d: "Take a deposit or the full amount up front, paid direct to your account." },
              ].map((row) => (
                <li key={row.t} className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                    <TickIcon className="h-3.5 w-3.5" />
                  </span>
                  <span className="text-sm leading-relaxed text-slate-700">
                    <span className="font-semibold text-slate-900">{row.t}.</span> {row.d}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="relative">
            <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-r from-brand-100/40 via-white/0 to-accent-200/40 blur-3xl" />
            <div className="relative space-y-3">
              {resourceMenu.map((t) => (
                <div key={t.name} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-bold text-slate-900">{t.name}</h3>
                      <p className="mt-0.5 text-xs text-slate-500">{t.duration}</p>
                    </div>
                    <span className={`rounded-lg px-2.5 py-1 text-sm font-bold ${t.tone === "accent" ? "bg-accent-50 text-accent-700" : "bg-brand-50 text-brand-700"}`}>
                      {t.price}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {t.tags.map((tag) => (
                      <span key={tag} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-medium text-slate-600">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Access & operations ──────────────────────────────────────────────── */

function AccessOpsSection() {
  return (
    <section className="relative overflow-hidden bg-slate-900 py-20 text-white sm:py-28">
      <div
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "radial-gradient(circle at 28% 32%, rgba(0,59,111,0.6) 0%, transparent 50%), radial-gradient(circle at 80% 70%, rgba(0,194,199,0.22) 0%, transparent 50%)",
        }}
      />
      <div className="relative mx-auto max-w-6xl px-6">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-white/80 backdrop-blur">
              Access &amp; operations
            </span>
            <h2 className="mt-6 text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">
              Hand over the keys, not your evenings.
            </h2>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-white/80">
              Self-serve booking means your courts and rooms fill themselves while you get on with running the
              place. Every booking, payment, and regular in one dashboard, on any device.
            </p>
            <ul className="mt-7 space-y-3">
              {[
                "24/7 self-serve booking and payment",
                "Recurring and block bookings for regulars and clubs",
                "Every resource and site in one live calendar",
                "No-shows cut with pay-to-book and reminders",
              ].map((point) => (
                <li key={point} className="flex items-start gap-3 text-sm text-white/85">
                  <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-accent/20 text-accent-200">
                    <TickIcon className="h-3 w-3" />
                  </span>
                  {point}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white p-6 text-slate-900 shadow-2xl shadow-slate-900/40 sm:p-7">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-brand-600 to-brand-800 text-white">
                <LayoutGridIcon />
              </span>
              <div>
                <p className="text-base font-bold text-slate-900">Riverside Courts</p>
                <p className="text-xs text-slate-500">Today · 24 bookings across 6 resources</p>
              </div>
              <span className="ml-auto rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">82% booked</span>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-2 text-center">
              <Stat label="Booked" value="82%" />
              <Stat label="Today" value="£740" />
              <Stat label="Regulars" value="36" />
            </div>

            <div className="mt-4 space-y-2">
              <BookingLine slot="Court 1 · 19:00" meta="Padel · paid" tone="emerald" />
              <BookingLine slot="Court 2 · 19:00" meta="League · weekly" tone="accent" />
              <BookingLine slot="Room B · 18:00" meta="Members · paid" tone="brand" />
              <BookingLine slot="Court 3 · 20:00" meta="Peak · paid" tone="emerald" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
      <p className="text-lg font-extrabold text-slate-900">{value}</p>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
    </div>
  );
}

function BookingLine({ slot, meta, tone }: { slot: string; meta: string; tone: "accent" | "emerald" | "brand" }) {
  const toneClass: Record<string, string> = {
    accent: "bg-accent-100 text-accent-700",
    emerald: "bg-emerald-100 text-emerald-700",
    brand: "bg-brand-100 text-brand-700",
  };
  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2">
      <span className="text-[13px] font-semibold text-slate-800">{slot}</span>
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${toneClass[tone]}`}>{meta}</span>
    </div>
  );
}

/* ── Linked accounts (coaches, clubs & operators) ─────────────────────── */

function LinkedAccountsSection() {
  const benefits = [
    { title: "Separate books per operator", icon: UserCardIcon },
    { title: "One shared calendar", icon: LayoutGridIcon },
    { title: "Link and unlink in a click", icon: LinkIcon },
    { title: "Paid direct, never pooled", icon: ShieldPoundIcon },
  ];
  return (
    <section className="bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="overflow-hidden rounded-3xl border border-brand-100 bg-slate-50 shadow-sm">
          <div className="h-1.5 w-full bg-gradient-to-r from-brand-400 to-accent-400" />
          <div className="grid gap-10 p-8 sm:p-10 lg:grid-cols-2 lg:items-center lg:gap-14">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wider text-brand-700">
                <LinkIcon className="h-3.5 w-3.5" /> Coaches, clubs &amp; operators
              </span>
              <h2 className="mt-5 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                Share a venue. Keep separate books.
              </h2>
              <p className="mt-4 text-base leading-relaxed text-slate-600">
                Resident coaches, clubs, and operators who run their own sessions at your venue can each have their
                own Resneo, with their own customers, calendar, and payouts. Link accounts to share the booking
                calendar, and break the link in a click. Nothing is ever merged.
              </p>
              <div className="mt-6 grid grid-cols-2 gap-3">
                {benefits.map((b) => (
                  <div key={b.title} className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                    <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                      <b.icon className="h-4 w-4" />
                    </span>
                    <span className="text-[13px] font-semibold text-slate-800">{b.title}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white shadow-md shadow-brand-600/25">
                  <ShieldCheckIcon />
                </span>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-accent-700">Built to stay compliant</p>
                  <h3 className="text-xl font-bold text-slate-900">Clean, separate books for HMRC</h3>
                </div>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-slate-600">{LINKED_ACCOUNTS_HMRC_NOTE}</p>
              <p className="mt-3 text-xs leading-relaxed text-slate-400">{LINKED_ACCOUNTS_HMRC_DISCLAIMER}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Who it's for ─────────────────────────────────────────────────────── */

function BusinessTypesSection() {
  return (
    <section className="bg-slate-50 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <span className="text-xs font-semibold uppercase tracking-widest text-accent-700">Who it&rsquo;s for</span>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
            Made for every space you hire out.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-600">
            A single court or a multi-site sports centre, a rehearsal room or a community hall. If you rent space by
            the hour and want it filled, Resneo fits.
          </p>
        </div>
        <div className="mt-14 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {businessTypes.map((u) => (
            <div key={u.name} className="group flex items-center gap-3 rounded-xl border border-slate-100 bg-white p-4 transition-all hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-lg">{u.icon}</span>
              <span className="text-sm font-semibold text-slate-800">{u.name}</span>
            </div>
          ))}
          <div className="flex items-center justify-center rounded-xl border border-dashed border-accent-200 bg-accent-50/60 p-4 text-sm font-semibold text-accent-700">
            Yours too
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Comparison ───────────────────────────────────────────────────────── */

function CompareSection() {
  return (
    <section className="bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-5xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <span className="text-xs font-semibold uppercase tracking-widest text-accent-700">Resneo vs the rest</span>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
            Keep your customers. Keep your margin.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-600">
            Aggregator sites list your venue next to every other and take a cut. Generic schedulers were never built
            for by-the-hour slots or peak pricing. Resneo does both, under your brand.
          </p>
        </div>
        <div className="mt-14 overflow-hidden rounded-2xl border border-slate-200 shadow-sm">
          <div className="grid grid-cols-[1.3fr_1fr_1fr] bg-slate-50 text-xs font-bold uppercase tracking-wider text-slate-500 sm:text-sm">
            <div className="p-4" />
            <div className="border-l border-slate-200 bg-brand-600 p-4 text-center text-white">Resneo</div>
            <div className="border-l border-slate-200 p-4 text-center">Other apps</div>
          </div>
          {compareRows.map((row, i) => (
            <div key={row.label} className={`grid grid-cols-[1.3fr_1fr_1fr] text-sm ${i % 2 ? "bg-slate-50/50" : "bg-white"}`}>
              <div className="flex items-center p-4 font-semibold text-slate-800">{row.label}</div>
              <div className="flex items-center justify-center gap-1.5 border-l border-slate-100 bg-brand-50/40 p-4 text-center font-semibold text-brand-800">
                <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-brand-600 text-white">
                  <TickIcon className="h-3 w-3" />
                </span>
                {row.resneo}
              </div>
              <div className="flex items-center justify-center border-l border-slate-100 p-4 text-center text-slate-500">{row.other}</div>
            </div>
          ))}
        </div>
        <p className="mt-5 text-center text-xs text-slate-400">
          Comparison reflects how aggregator and general-purpose booking apps commonly operate. Specifics vary by
          provider.
        </p>
      </div>
    </section>
  );
}

/* ── FAQ ──────────────────────────────────────────────────────────────── */

function FaqSection() {
  return (
    <section className="bg-slate-50 py-20 sm:py-28">
      <div className="mx-auto max-w-4xl px-6">
        <div className="text-center">
          <span className="text-xs font-semibold uppercase tracking-widest text-accent-700">Good to know</span>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Questions, answered.</h2>
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

/* ── Closing CTA ──────────────────────────────────────────────────────── */

function ClosingCta() {
  return (
    <section id="contact" className="scroll-mt-16 bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-brand-800 to-brand-900 px-4 py-12 text-white shadow-2xl sm:px-8 sm:py-14 md:px-12 md:py-16">
          <div
            className="absolute inset-0 opacity-30"
            style={{
              backgroundImage:
                "radial-gradient(circle at 22% 32%, rgba(0,59,111,0.82) 0%, transparent 40%), radial-gradient(circle at 86% 70%, rgba(0,194,199,0.4) 0%, transparent 45%)",
            }}
          />
          <div className="relative grid grid-cols-1 gap-8 sm:gap-10 lg:grid-cols-2 lg:items-stretch lg:gap-12">
            <div className="min-w-0">
              <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-5xl">
                Fill every slot. Start free today.
              </h2>
              <p className="mt-5 max-w-lg text-base leading-relaxed text-white/80">
                Take bookings 24/7, price every slot by time and membership, and get paid before customers arrive.
                Set up in an afternoon and start your free 14-day trial. No card needed to look around, no booking
                commission, cancel anytime.
              </p>
              <div className="mt-6 grid max-w-xl grid-cols-1 gap-3 text-xs text-white/85 sm:grid-cols-2">
                <div className="rounded-lg border border-white/15 bg-white/10 px-3 py-2">14-day free trial on every paid plan</div>
                <div className="rounded-lg border border-white/15 bg-white/10 px-3 py-2">From £{APPOINTMENTS_LIGHT_PRICE}/month, no commission</div>
                <div className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 sm:col-span-2">{SUBSCRIPTION_CANCELLATION_PUBLIC_NOTICE}</div>
              </div>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <a href={SIGNUP} className="inline-flex h-12 items-center justify-center rounded-xl bg-white px-7 text-base font-semibold text-slate-900 shadow-lg transition-all hover:-translate-y-0.5 hover:bg-brand-50">
                  Start your free 14-day trial
                  <ArrowRightIcon />
                </a>
                <Link href="/solutions" className="inline-flex h-12 items-center justify-center rounded-xl border border-white/25 bg-transparent px-6 text-base font-semibold text-white backdrop-blur transition-colors hover:bg-white/10">
                  Explore all solutions
                </Link>
              </div>
            </div>

            <div className="min-w-0 w-full max-w-full rounded-2xl bg-white p-5 text-slate-900 shadow-xl sm:p-8">
              <h3 className="text-lg font-bold">Prefer to talk it through?</h3>
              <p className="mt-1 text-sm text-slate-500">Tell us about your venue and we&rsquo;ll reply within one working day.</p>
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

/* ── Footer ───────────────────────────────────────────────────────────── */

function Footer() {
  return (
    <footer className="border-t border-slate-100 bg-slate-50 py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-6 text-sm text-slate-500 sm:flex-row sm:justify-between">
        <p className="max-w-xl text-center leading-snug sm:text-left">
          &copy; 2026 Resneo · JAR 26 LTD (NI740269) · 100a Main Street, Bangor, BT20 4AG, UK
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 sm:justify-end">
          <Link href="/" className="transition-colors hover:text-slate-900">Home</Link>
          <Link href="/solutions" className="transition-colors hover:text-slate-900">Solutions</Link>
          <Link href="/class-booking-software" className="transition-colors hover:text-slate-900">Studios &amp; classes</Link>
          <a href={SIGNUP} className="transition-colors hover:text-slate-900">Sign up</a>
          <Link href="/login" className="transition-colors hover:text-slate-900">Login</Link>
          <Link href="/privacy" className="transition-colors hover:text-slate-900">Privacy Policy</Link>
        </div>
      </div>
    </footer>
  );
}
