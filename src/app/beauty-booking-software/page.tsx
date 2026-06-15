import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { SocialLinks } from "@/components/marketing/SocialLinks";
import ContactForm from "@/components/ContactForm";
import { RESNEO_MARKETING_PAYMENTS_AND_NO_HOLD } from "@/lib/booking-funds-copy";
import { STANDARD_PAYMENT_PROVIDER_FEES_NOTICE } from "@/lib/payment-provider-fees-notice";
import { SUBSCRIPTION_CANCELLATION_PUBLIC_NOTICE } from "@/lib/subscription-cancellation-copy";
import { APPOINTMENTS_LIGHT_PRICE } from "@/lib/pricing-constants";
import { LINKED_ACCOUNTS_SEPARATE_BOOKS_NOTE } from "@/lib/linked-accounts-marketing-copy";
import {
  ArrowPathIcon,
  ArrowRightIcon,
  BeakerIcon,
  BellIcon,
  ChatIcon,
  DocumentTextIcon,
  LayoutGridIcon,
  LinkIcon,
  LockIcon,
  MoonIcon,
  PencilSquareIcon,
  PlusIcon,
  ShieldCheckIcon,
  ShieldPoundIcon,
  SparklesIcon,
  TickIcon,
  UserCardIcon,
  UsersIcon,
} from "@/components/marketing/marketing-icons";

const PAGE_PATH = "/beauty-booking-software";
const SIGNUP = "/#pricing";

export const metadata: Metadata = {
  title: "Beauty & Aesthetic Clinic Booking Software | ResNeo",
  description:
    "ResNeo is booking and consent software for beauty salons and aesthetic clinics. Take bookings online 24/7, collect deposits, and automatically send consent forms, medical histories, and patch tests that must be completed before the appointment. No commission, no marketplace. Start a free 14-day trial.",
  keywords: [
    "beauty salon booking software",
    "aesthetic clinic booking software",
    "aesthetics booking system",
    "consent form software for clinics",
    "patch test tracking software",
    "online booking for beauticians",
    "lash and brow booking software",
    "injectables clinic booking software",
    "medical aesthetics booking software",
  ],
  alternates: { canonical: PAGE_PATH },
  openGraph: {
    title: "Beauty & Aesthetic Clinic Booking Software | ResNeo",
    description:
      "Online booking, deposits, and automatic consent forms, medical histories, and patch tests for beauty and aesthetic clinics. Fewer no-shows, protected treatments, less paperwork.",
    url: PAGE_PATH,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Beauty & Aesthetic Clinic Booking Software | ResNeo",
    description:
      "Bookings, deposits, and consent forms and patch tests collected before the appointment, built for beauty and aesthetic clinics.",
  },
};

/* ────────────────────────────────────────────────────────────────────────
   Content
   ──────────────────────────────────────────────────────────────────────── */

const outcomes = [
  {
    eyebrow: "Outcome 01",
    title: "Fewer no-shows",
    promise:
      "A missed aesthetics appointment is an hour of chair time and product prep you cannot rebill. ResNeo gets clients to show, or to cancel early enough to refill the slot.",
    accent: "rose" as const,
    features: [
      {
        title: "Deposits on high-value treatments",
        description: `Protect injectables, colour, and long treatments with a deposit or full payment at booking. ${RESNEO_MARKETING_PAYMENTS_AND_NO_HOLD}`,
        icon: ShieldPoundIcon,
      },
      {
        title: "Automated reminders",
        description:
          "Confirmations and reminders go out by email and SMS before every visit, so no one forgets their slot.",
        icon: BellIcon,
      },
      {
        title: "Confirm or cancel in one tap",
        description:
          "Clients confirm or cancel from the reminder itself. An early cancel frees the room for your waitlist.",
        icon: ChatIcon,
      },
    ],
  },
  {
    eyebrow: "Outcome 02",
    title: "A fuller column",
    promise:
      "Clients book the moment they decide, often late at night after scrolling your before-and-afters. ResNeo turns that intent into a confirmed appointment instead of a missed DM.",
    accent: "brand" as const,
    features: [
      {
        title: "24/7 online booking page",
        description:
          "A branded page and website widget take bookings around the clock, straight from your Instagram or Google profile.",
        icon: MoonIcon,
      },
      {
        title: "A link for every practitioner",
        description:
          "Each therapist, nurse, or technician gets their own bookable link and live availability, so regulars rebook with the person they trust.",
        icon: UsersIcon,
      },
      {
        title: "Variants, add-ons, and packages",
        description:
          "Offer a tint with the lift, a dermaplane add-on, or a course of sessions, and let the price and time adjust automatically.",
        icon: SparklesIcon,
      },
    ],
  },
  {
    eyebrow: "Outcome 03",
    title: "Less paperwork",
    promise:
      "Consent forms, patch tests, and medical histories should not eat your morning or pile up on the front desk. ResNeo collects them automatically and keeps them on file.",
    accent: "accent" as const,
    features: [
      {
        title: "Forms sent on booking",
        description:
          "Consent, medical history, and intake forms send themselves the moment a client books, then chase until they are done.",
        icon: DocumentTextIcon,
      },
      {
        title: "Records that remember",
        description:
          "Skin notes, allergies, colour formulas, and visit history live on each client profile, ready before they sit down.",
        icon: UserCardIcon,
      },
      {
        title: "One live clinic calendar",
        description:
          "Every room and practitioner in one colour-coded view. Drag to reschedule and spot clashes before they happen.",
        icon: LayoutGridIcon,
      },
    ],
  },
];

/** Rows shown in the Compliance flagship mock. */
const complianceRecords = [
  { type: "Anti-wrinkle consent", client: "Jon P.", state: "Signed today", tone: "accent" as const },
  { type: "Medical history", client: "Maya R.", state: "Completed", tone: "emerald" as const },
  { type: "PPD patch test", client: "Holly D.", state: "Valid · 142 days left", tone: "emerald" as const },
  { type: "Lash patch test", client: "Aisha K.", state: "Awaiting client", tone: "amber" as const },
];

const compliancePoints = [
  {
    title: "A library of forms, ready to use",
    description:
      "Start from built-in templates for patch tests, treatment consent, and new-client intake, then edit them to match your clinic. Set each as one-off, per-visit, or valid for a set number of days.",
    icon: DocumentTextIcon,
  },
  {
    title: "Sent automatically, chased until done",
    description:
      "Forms send the moment a client books and are chased by reminder until they are complete, so nothing lands on the day of the appointment.",
    icon: ArrowPathIcon,
  },
  {
    title: "Signed and stored online",
    description:
      "Clients complete and sign on their phone, with no app or login. Every record is saved against their profile and reused for future visits.",
    icon: PencilSquareIcon,
  },
  {
    title: "No paperwork, no booking",
    description:
      "Require a valid patch test or signed consent before a treatment can be booked, and enforce a lead time such as a patch test at least 48 hours ahead.",
    icon: ShieldCheckIcon,
  },
];

const bookingSteps = [
  { step: "1", title: "Pick a treatment", description: "Facials, lashes, peels, injectables. Clients choose from your real menu, prices, and add-ons." },
  { step: "2", title: "Choose a practitioner", description: "Book the therapist or nurse they trust, or take the first available slot." },
  { step: "3", title: "Find a time", description: "Live availability only, with buffer and prep time built in. No double-bookings." },
  { step: "4", title: "Confirm & prepare", description: "Pay a deposit, then receive the consent form and patch-test request to complete before the visit." },
];

const treatmentMenu = [
  {
    name: "HydraFacial",
    duration: "60 min",
    price: "£85",
    tags: ["Deposit £20", "Add dermaplane +£20"],
    tone: "brand" as const,
  },
  {
    name: "Anti-wrinkle · 3 areas",
    duration: "45 min",
    price: "£210",
    tags: ["Deposit £50", "Consent + history required"],
    tone: "accent" as const,
  },
  {
    name: "LVL lash lift",
    duration: "55 min",
    price: "£45",
    tags: ["With tint +£10", "Patch test required"],
    tone: "brand" as const,
  },
];

const businessTypes = [
  { name: "Aesthetic clinics", icon: "💉" },
  { name: "Skin & facial studios", icon: "🧖" },
  { name: "Lash & brow bars", icon: "👁️" },
  { name: "Nail salons", icon: "💅" },
  { name: "Waxing & threading", icon: "🪒" },
  { name: "Laser & IPL", icon: "✨" },
  { name: "Semi-permanent makeup", icon: "🖊️" },
  { name: "Cosmetic injectables", icon: "🩺" },
  { name: "Tanning studios", icon: "🌅" },
  { name: "Holistic & day spas", icon: "🌿" },
];

const compareRows: { label: string; resneo: string; other: string }[] = [
  { label: "Consent & patch tests", resneo: "Built in and enforced", other: "A separate paper or app job" },
  { label: "Commission on bookings", resneo: "None, ever", other: "Often a % of every booking" },
  { label: "Who owns your clients", resneo: "You do", other: "Listed in a shared marketplace" },
  { label: "Deposits & payouts", resneo: "Direct to your account", other: "Held and paid on their schedule" },
  { label: "Rent-a-room books", resneo: "Separate per room, link to share", other: "Pooled into one account" },
];

const faqs = [
  {
    q: "Is ResNeo good booking software for an aesthetic clinic?",
    a: "Yes. ResNeo is built for appointment businesses, and aesthetic and beauty clinics are a natural fit. Take bookings 24/7, protect high-value treatments with deposits, give each practitioner their own bookable link, and collect consent forms, medical histories, and patch tests automatically before every appointment.",
  },
  {
    q: "Can ResNeo collect consent forms and medical histories before an appointment?",
    a: "Yes. With Compliance turned on, you choose which treatments need a consent form, medical history, or intake form. The form is sent automatically when the client books, they complete and sign it on their phone with no app, and the record is stored on their profile. You can require the form to be completed before the booking is allowed.",
  },
  {
    q: "Does ResNeo track patch tests and their expiry?",
    a: "Yes. Patch tests can be set to stay valid for a fixed period, such as 180 days, and ResNeo flags them as they approach expiry and sends a renewal request. You can also require a patch test to be completed a minimum time before the appointment, for example at least 48 hours ahead, and block bookings that do not meet it.",
  },
  {
    q: "How do deposits work for treatments?",
    a: `Connect Stripe in a few minutes, then decide which treatments take a deposit or full payment up front. Clients pay when they book, the slot is held, and ${STANDARD_PAYMENT_PROVIDER_FEES_NOTICE.toLowerCase()} ${RESNEO_MARKETING_PAYMENTS_AND_NO_HOLD}`,
  },
  {
    q: "Will it reduce no-shows?",
    a: "Two things move the needle most: a deposit that gives clients skin in the game, and automated reminders with one-tap confirm or cancel. Together they cut no-shows sharply, and when someone does cancel, they free the slot early enough for your waitlist to fill it.",
  },
  {
    q: "I rent rooms to self-employed practitioners. Can each keep separate books?",
    a: `Yes. Each practitioner runs their own ResNeo with their own clients, calendar, and payouts, then you link accounts to share availability and a combined booking page. Either side can break the link in a click. ${LINKED_ACCOUNTS_SEPARATE_BOOKS_NOTE}`,
  },
  {
    q: "Do my clients need to download an app?",
    a: "No. Clients book, pay a deposit, and complete their forms on a fast, mobile-friendly web page, with no app and no account to create. You manage everything from your phone or a tablet at reception.",
  },
  {
    q: "How much does it cost?",
    a: `Plans start from £${APPOINTMENTS_LIGHT_PRICE}/month with a 14-day free trial on every paid plan, and there is never any commission on your bookings. ${SUBSCRIPTION_CANCELLATION_PUBLIC_NOTICE}`,
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
      name: "ResNeo: Beauty & Aesthetic Clinic Booking Software",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description:
        "Booking and consent software for beauty salons and aesthetic clinics: 24/7 online booking, deposits, automatic consent forms, medical histories, and patch-test tracking with booking enforcement, plus per-practitioner availability and client records.",
      offers: { "@type": "Offer", price: String(APPOINTMENTS_LIGHT_PRICE), priceCurrency: "GBP" },
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "/" },
        { "@type": "ListItem", position: 2, name: "Solutions", item: "/solutions" },
        { "@type": "ListItem", position: 3, name: "Beauty & aesthetics", item: PAGE_PATH },
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

export default function BeautyBookingSoftwarePage() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Nav />
      <Hero />
      <TrustStrip />
      <ComplianceSection />
      <OutcomesSection />
      <BookingFlowSection />
      <TreatmentMenuSection />
      <ClientRecordsSection />
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
          <img src="/Logo.png" alt="ResNeo" className="h-9 w-auto" />
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
            Built for beauty &amp; aesthetics
          </span>
          <h1 className="mt-6 text-4xl font-extrabold leading-[1.05] tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
            Booking and consent software for beauty &amp; aesthetic clinics
          </h1>
          <p className="mt-5 text-xl font-semibold sm:text-2xl">
            <span className="bg-gradient-to-r from-brand-700 via-brand-600 to-accent-dark bg-clip-text text-transparent">
              Fewer no-shows. Protected treatments. Less paperwork.
            </span>
          </p>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-600">
            Let clients book 24/7, take deposits on high-value treatments, and collect consent forms, medical
            histories, and patch tests automatically before every appointment. ResNeo is the all-in-one
            booking platform for beauty salons and aesthetic clinics, with no booking commission and no
            marketplace renting out your clients.
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
              href="#compliance"
              className="inline-flex h-12 items-center justify-center rounded-xl border border-slate-200 bg-white px-6 text-base font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:text-slate-900"
            >
              See consent &amp; patch tests
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
              <TickIcon /> Consent &amp; patch tests built in
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
        <li className="text-slate-700">Beauty &amp; aesthetics</li>
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
              Appointment confirmed
            </div>
            <h3 className="mt-2 text-lg font-bold text-slate-900">Anti-wrinkle review · Lumière</h3>
            <p className="mt-0.5 text-xs text-slate-500">Maya Reilly · with Nurse Amara</p>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <InfoTile label="When" value="Thu · 14:30" />
              <InfoTile label="Deposit" value="£50 paid" accent />
            </div>

            <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Before your visit</p>
              <ul className="mt-2 space-y-1.5">
                <ChecklistRow label="Consent form" state="Signed" done />
                <ChecklistRow label="Medical history" state="Completed" done />
                <ChecklistRow label="Patch test" state="Valid · 142 days" done />
              </ul>
            </div>

            <div className="mt-4 rounded-xl border border-brand-100 bg-brand-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-600">Clinic note</p>
              <p className="mt-1 text-xs text-brand-800">Sensitive skin. Patch tested for lidocaine, no reaction.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute -top-6 -left-6 hidden rotate-[-6deg] rounded-xl border border-slate-100 bg-white p-3 shadow-xl shadow-slate-900/10 sm:block">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-50 text-accent-700">
            <PencilSquareIcon className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-slate-900">Consent signed</p>
            <p className="text-[10px] text-slate-500">Stored on file</p>
          </div>
        </div>
      </div>

      <div className="absolute -bottom-6 -right-4 hidden rotate-[4deg] rounded-xl border border-slate-100 bg-white p-3 shadow-xl shadow-slate-900/10 sm:block">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
            <BeakerIcon className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-slate-900">Patch test valid</p>
            <p className="text-[10px] text-slate-500">142 days left</p>
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
    { value: "24/7", label: "Online booking page" },
    { value: "0%", label: "Commission on bookings" },
    { value: "Auto", label: "Consent & patch tests" },
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

/* ── Compliance flagship ──────────────────────────────────────────────── */

const recordTone: Record<string, string> = {
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  accent: "border-accent-200 bg-accent-50 text-accent-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
};

function ComplianceSection() {
  return (
    <section id="compliance" className="relative scroll-mt-16 overflow-hidden bg-white py-20 sm:py-28">
      <div className="absolute inset-0 bg-gradient-to-br from-brand-50 via-white to-accent-50/40" />
      <div className="relative mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-brand-700 backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            Consent, patch tests &amp; histories
          </span>
          <h2 className="mt-5 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
            The paperwork is done before they sit down.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-600">
            ResNeo&rsquo;s Compliance tools send the right consent form, medical history, or patch test the
            moment a client books, chase it until it is complete, and can stop a treatment being booked
            without it. No clipboards, no day-of scramble, no missing records.
          </p>
        </div>

        <div className="mt-14 grid items-start gap-10 lg:grid-cols-2 lg:gap-14">
          {/* Mock: compliance check-in panel */}
          <div className="relative">
            <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-r from-brand-100/50 via-white/0 to-accent-200/50 blur-3xl" />
            <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-brand-900/5">
              <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
                <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
                <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
                <span className="ml-3 inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400">
                  <LockIcon /> resneo.com/dashboard/compliance
                </span>
              </div>
              <div className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Check-in today</p>
                    <h3 className="mt-0.5 text-lg font-bold text-slate-900">Forms &amp; records</h3>
                  </div>
                  <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                    3 of 4 ready
                  </span>
                </div>

                <div className="mt-4 space-y-2">
                  {complianceRecords.map((r) => (
                    <div
                      key={r.type + r.client}
                      className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-bold text-slate-900">{r.type}</p>
                        <p className="text-[11px] text-slate-500">{r.client}</p>
                      </div>
                      <span className={`flex-shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${recordTone[r.tone]}`}>
                        {r.state}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
                  <p className="text-[12px] font-medium text-amber-800">Lash patch test outstanding</p>
                  <span className="rounded-lg bg-amber-500 px-2.5 py-1 text-[11px] font-bold text-white">Send link</span>
                </div>

                <div className="mt-3 rounded-xl border border-brand-100 bg-brand-50 px-3 py-2.5">
                  <p className="text-[11px] font-semibold text-brand-700">Booking rule</p>
                  <p className="mt-0.5 text-[12px] text-brand-800">
                    Patch test must be completed at least 48 hours before the appointment.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Points */}
          <div className="grid gap-4 sm:grid-cols-2">
            {compliancePoints.map((p) => (
              <div key={p.title} className="rounded-2xl border border-slate-100 bg-white/80 p-5 shadow-sm backdrop-blur">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-100">
                  <p.icon />
                </div>
                <h3 className="mt-4 text-sm font-bold text-slate-900">{p.title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600">{p.description}</p>
              </div>
            ))}
            <p className="text-[11px] leading-relaxed text-slate-400 sm:col-span-2">
              Compliance tools support your own record-keeping. They are not legal, medical, or insurance
              advice. Check your obligations with your insurer or governing body.
            </p>
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
            What every clinic owner wants, and how ResNeo delivers it.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-600">
            Each promise below maps to the exact ResNeo features that make it happen. No buzzwords, just the
            tools doing the work.
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
            A booking journey your clients will actually finish.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-600">
            From &ldquo;I need a top-up&rdquo; to a confirmed, prepared appointment: treatment, practitioner,
            time, deposit, and the forms queued to complete. No app, no account wall.
          </p>
        </div>

        <div className="relative mt-16">
          <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-r from-brand-100/40 via-white/0 to-accent-200/40 blur-3xl" />
          <div className="relative grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FlowStep step="1" title="Pick a treatment">
              <div className="mt-3 space-y-1.5">
                <FlowRow text="HydraFacial" meta="£85" />
                <FlowRow text="Anti-wrinkle · 3 areas" meta="£210" active />
                <FlowRow text="LVL lash lift" meta="£45" />
              </div>
            </FlowStep>
            <FlowStep step="2" title="Choose a practitioner">
              <div className="mt-3 grid grid-cols-3 gap-1.5">
                {([["Amara", true], ["Sofia", false], ["Any", false]] as const).map(([name, on]) => (
                  <div key={name} className="flex flex-col items-center gap-1">
                    <span className={`flex h-9 w-9 items-center justify-center rounded-full text-[11px] font-bold ${on ? "bg-brand-600 text-white ring-2 ring-brand-200" : "bg-slate-100 text-slate-500"}`}>
                      {name === "Any" ? "★" : name[0]}
                    </span>
                    <span className="text-[9px] font-semibold text-slate-600">{name}</span>
                  </div>
                ))}
              </div>
            </FlowStep>
            <FlowStep step="3" title="Find a time">
              <div className="mt-3 grid grid-cols-3 gap-1.5">
                {["10:00", "11:30", "13:15", "14:30", "15:45", "17:00"].map((t, i) => (
                  <span key={t} className={`rounded-md px-1 py-1.5 text-center text-[10px] font-semibold ${i === 3 ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}>
                    {t}
                  </span>
                ))}
              </div>
            </FlowStep>
            <FlowStep step="4" title="Confirm & prepare">
              <div className="mt-3 space-y-1.5">
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-500">Deposit</span>
                  <span className="font-semibold text-slate-900">£50</span>
                </div>
                <div className="rounded-md bg-slate-50 px-2 py-1 text-[10px] leading-snug text-slate-600">
                  Consent form &amp; medical history sent to complete before your visit.
                </div>
                <div className="mt-1 rounded-md bg-brand-600 py-1.5 text-center text-[11px] font-bold text-white">Book appointment</div>
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

/* ── Treatment menu ───────────────────────────────────────────────────── */

function TreatmentMenuSection() {
  return (
    <section className="bg-slate-50 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
          <div>
            <span className="text-xs font-semibold uppercase tracking-widest text-accent-700">Your treatment menu</span>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Price every treatment exactly how you work.
            </h2>
            <p className="mt-5 text-base leading-relaxed text-slate-600">
              Real clinics are not one-price-fits-all. ResNeo lets you build a menu with variants, add-ons,
              deposits, and the buffer and prep time each treatment needs, so the diary reflects reality.
            </p>
            <ul className="mt-7 space-y-4">
              {[
                { t: "Variants & add-ons", d: "Offer a lift with or without tint, or a dermaplane upgrade. Time and price adjust on the fly." },
                { t: "Deposits per treatment", d: "Protect injectables and long sessions with a deposit or full payment. Paid direct to you." },
                { t: "Buffer, cleanup & processing time", d: "Block turnaround between clients, and free yourself during developing or numbing time." },
                { t: "Custom booking rules", d: "Set the minimum notice, how far ahead clients can book, and your cancellation window, per treatment." },
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
              {treatmentMenu.map((t) => (
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

/* ── Client records ───────────────────────────────────────────────────── */

function ClientRecordsSection() {
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
              Client records
            </span>
            <h2 className="mt-6 text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">
              Every client&rsquo;s history, ready before they arrive.
            </h2>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-white/80">
              Skin notes, allergies, colour formulas, signed consents, and past visits all live on one
              profile, so the next appointment starts with full context, not a memory test.
            </p>
            <ul className="mt-7 space-y-3">
              {[
                "Shared notes for allergies, sensitivities, and preferences",
                "Forms and signed consents attached to the record",
                "Visit history, deposits paid, and no-show count at a glance",
                "Custom fields for anything your clinic needs to track",
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
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-brand-600 to-brand-800 text-base font-bold text-white">MR</span>
              <div>
                <p className="text-base font-bold text-slate-900">Maya Reilly</p>
                <p className="text-xs text-slate-500">Client since Mar 2024 · 18 visits</p>
              </div>
              <span className="ml-auto rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">Forms current</span>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-2 text-center">
              <Stat label="Visits" value="18" />
              <Stat label="No-shows" value="0" />
              <Stat label="Deposits" value="£640" />
            </div>

            <div className="mt-4 rounded-xl border border-rose-100 bg-rose-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-rose-500">Allergies & sensitivities</p>
              <p className="mt-1 text-xs text-rose-800">Sensitive skin. Reaction to glycolic over 10%. Lidocaine tested, clear.</p>
            </div>

            <div className="mt-3 space-y-2">
              <RecordLine label="Anti-wrinkle consent" meta="Signed today" tone="accent" />
              <RecordLine label="Medical history" meta="Completed" tone="emerald" />
              <RecordLine label="PPD patch test" meta="Valid · 142 days" tone="emerald" />
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

function RecordLine({ label, meta, tone }: { label: string; meta: string; tone: "accent" | "emerald" }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2">
      <span className="text-[13px] font-semibold text-slate-800">{label}</span>
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${tone === "accent" ? "bg-accent-100 text-accent-700" : "bg-emerald-100 text-emerald-700"}`}>
        {meta}
      </span>
    </div>
  );
}

/* ── Linked accounts (rent a room) ────────────────────────────────────── */

function LinkedAccountsSection() {
  const benefits = [
    { title: "Separate books per room", icon: UserCardIcon },
    { title: "One combined booking page", icon: LayoutGridIcon },
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
                <LinkIcon className="h-3.5 w-3.5" /> Rent-a-room &amp; self-employed practitioners
              </span>
              <h2 className="mt-5 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                Share a clinic. Keep separate books.
              </h2>
              <p className="mt-4 text-base leading-relaxed text-slate-600">
                Renting rooms to self-employed injectors, aestheticians, or therapists? Each runs their own
                ResNeo with their own clients, calendar, and payouts. Link accounts to share availability and
                a combined booking page, and break the link in a click. Nothing is ever merged.
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
                  <p className="text-xs font-semibold uppercase tracking-wider text-accent-700">Built for independents</p>
                  <h3 className="text-xl font-bold text-slate-900">Clean, separate books for everyone</h3>
                </div>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-slate-600">{LINKED_ACCOUNTS_SEPARATE_BOOKS_NOTE}</p>
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
            Made for every kind of treatment room.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-600">
            A solo facialist or a full aesthetics team, a high-street studio or a medical clinic. If you take
            appointments and need the paperwork done right, ResNeo fits.
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
          <span className="text-xs font-semibold uppercase tracking-widest text-accent-700">ResNeo vs the rest</span>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
            Keep your clients. Keep your margin. Keep the records.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-600">
            Marketplace apps list you alongside your competitors and take a cut. Generic schedulers leave
            consent and patch tests to you. ResNeo does both, in one place.
          </p>
        </div>
        <div className="mt-14 overflow-hidden rounded-2xl border border-slate-200 shadow-sm">
          <div className="grid grid-cols-[1.3fr_1fr_1fr] bg-slate-50 text-xs font-bold uppercase tracking-wider text-slate-500 sm:text-sm">
            <div className="p-4" />
            <div className="border-l border-slate-200 bg-brand-600 p-4 text-center text-white">ResNeo</div>
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
          Comparison reflects how marketplace and general-purpose booking apps commonly operate. Specifics
          vary by provider.
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
                Book it. Protect it. Start free today.
              </h2>
              <p className="mt-5 max-w-lg text-base leading-relaxed text-white/80">
                Take bookings 24/7, cut no-shows with deposits and reminders, and collect every consent form
                and patch test before the appointment. Set up in an afternoon and start your free 14-day
                trial. No card needed to look around, no booking commission, cancel anytime.
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
              <p className="mt-1 text-sm text-slate-500">Tell us about your clinic and we&rsquo;ll reply within one working day.</p>
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
          &copy; 2026 ResNeo · JAR 26 LTD (NI740269) · 100a Main Street, Bangor, BT20 4AG, UK
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 sm:justify-end">
          <Link href="/" className="transition-colors hover:text-slate-900">Home</Link>
          <Link href="/solutions" className="transition-colors hover:text-slate-900">Solutions</Link>
          <Link href="/wellness-booking-software" className="transition-colors hover:text-slate-900">Health &amp; wellbeing</Link>
          <a href={SIGNUP} className="transition-colors hover:text-slate-900">Sign up</a>
          <Link href="/login" className="transition-colors hover:text-slate-900">Login</Link>
          <Link href="/privacy" className="transition-colors hover:text-slate-900">Privacy Policy</Link>
          <SocialLinks />
        </div>
      </div>
    </footer>
  );
}
