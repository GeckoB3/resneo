import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import ContactForm from "@/components/ContactForm";
import { RESNEO_MARKETING_PAYMENTS_AND_NO_HOLD } from "@/lib/booking-funds-copy";
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
  CalendarCheckIcon,
  CalendarDaysIcon,
  ChatIcon,
  DocumentTextIcon,
  HeartIcon,
  LayoutGridIcon,
  LinkIcon,
  LockIcon,
  MapPinIcon,
  MoonIcon,
  PencilSquareIcon,
  PlusIcon,
  ShieldCheckIcon,
  ShieldPoundIcon,
  TickIcon,
  UserCardIcon,
  UsersIcon,
  VideoCameraIcon,
} from "@/components/marketing/marketing-icons";

const PAGE_PATH = "/wellness-booking-software";
const SIGNUP = "/#pricing";

export const metadata: Metadata = {
  title: "Health & Wellbeing Booking Software for Clinics & Therapists | Resneo",
  description:
    "Resneo is booking software for health and wellbeing practices: physiotherapy, massage, osteopathy, counselling, and more. Take bookings 24/7, cut missed appointments with deposits and reminders, send intake forms and health questionnaires automatically, and see clients in clinic, online, or at home. No commission. Start a free 14-day trial.",
  keywords: [
    "health and wellbeing booking software",
    "physiotherapy booking software",
    "massage therapy booking software",
    "therapy booking software",
    "counselling booking software",
    "osteopath booking system",
    "clinic booking software",
    "intake form software for clinics",
    "online booking for therapists",
  ],
  alternates: { canonical: PAGE_PATH },
  openGraph: {
    title: "Health & Wellbeing Booking Software | Resneo",
    description:
      "Online booking, deposits, reminders, and automatic intake forms for physiotherapists, massage therapists, osteopaths, and counsellors. See clients in clinic, online, or at home.",
    url: PAGE_PATH,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Health & Wellbeing Booking Software | Resneo",
    description:
      "Bookings, deposits, reminders, and intake forms for physio, massage, therapy, and more. In clinic, online, or at home.",
  },
};

/* ────────────────────────────────────────────────────────────────────────
   Content
   ──────────────────────────────────────────────────────────────────────── */

const outcomes = [
  {
    eyebrow: "Outcome 01",
    title: "Fewer missed appointments",
    promise:
      "A did-not-attend is an empty hour you cannot get back, and a client who may not rebook. Resneo gets people to show, or to cancel in time for someone else to take the slot.",
    accent: "rose" as const,
    features: [
      {
        title: "Deposits where they help",
        description: `Ask for a deposit or full payment on first appointments or longer sessions. ${RESNEO_MARKETING_PAYMENTS_AND_NO_HOLD}`,
        icon: ShieldPoundIcon,
      },
      {
        title: "Automated reminders",
        description:
          "Email and SMS confirmations and reminders go out before every session, so appointments are not forgotten.",
        icon: BellIcon,
      },
      {
        title: "Confirm or cancel in one tap",
        description:
          "Clients confirm or cancel straight from the reminder. An early cancel opens the slot for your waitlist.",
        icon: ChatIcon,
      },
    ],
  },
  {
    eyebrow: "Outcome 02",
    title: "A fuller diary",
    promise:
      "People book when it suits them, often outside clinic hours. Resneo captures that the moment they decide, and lets you see them however they need to be seen.",
    accent: "brand" as const,
    features: [
      {
        title: "24/7 online booking page",
        description:
          "A branded page and website widget take bookings around the clock, with live availability and no phone tag.",
        icon: MoonIcon,
      },
      {
        title: "A link for every practitioner",
        description:
          "Each therapist or clinician gets their own bookable link and hours, so regulars rebook with the person who knows them.",
        icon: UsersIcon,
      },
      {
        title: "In clinic, online, or at home",
        description:
          "Offer video sessions with a join link, or home visits that capture the client address, alongside in-clinic appointments.",
        icon: VideoCameraIcon,
      },
    ],
  },
  {
    eyebrow: "Outcome 03",
    title: "Less admin, more care",
    promise:
      "Intake forms, reminders, and rebooking should not eat into your day or your evenings. Resneo runs the routine so you can focus on the person in front of you.",
    accent: "accent" as const,
    features: [
      {
        title: "Intake sent on booking",
        description:
          "Health questionnaires, intake forms, and consents send themselves when a client books, then chase until done.",
        icon: DocumentTextIcon,
      },
      {
        title: "Confidential client records",
        description:
          "Notes, history, and custom fields on one secure profile, with every access to sensitive data logged.",
        icon: UserCardIcon,
      },
      {
        title: "One live diary",
        description:
          "Every practitioner and room in one colour-coded view. Drag to reschedule and spot clashes early.",
        icon: LayoutGridIcon,
      },
    ],
  },
];

const intakeRecords = [
  { type: "New client intake", client: "Tom B.", state: "Completed", tone: "emerald" as const },
  { type: "Health questionnaire", client: "Priya N.", state: "Completed", tone: "emerald" as const },
  { type: "Treatment consent", client: "Dan O.", state: "Signed today", tone: "accent" as const },
  { type: "Intake form", client: "Erin Q.", state: "Awaiting client", tone: "amber" as const },
];

const intakePoints = [
  {
    title: "Intake forms, ready to use",
    description:
      "Start from built-in templates for intake, health questionnaires, and treatment consent, then edit them to fit your practice. Set each as one-off, per-visit, or valid for a set period.",
    icon: DocumentTextIcon,
  },
  {
    title: "Sent on booking, chased until done",
    description:
      "Forms go out automatically when a client books and are followed up by reminder, so the first session starts with the history already on file.",
    icon: ArrowPathIcon,
  },
  {
    title: "Completed and signed online",
    description:
      "Clients fill in and sign on their phone before they arrive, with no app or login. Every record is stored on their confidential profile.",
    icon: PencilSquareIcon,
  },
  {
    title: "No intake, no first session",
    description:
      "Require a completed intake or signed consent before a new client can book a first appointment, so you are never caught without it.",
    icon: ShieldCheckIcon,
  },
];

const waysToWork = [
  { title: "1:1 appointments", description: "Assessments, treatments, and reviews with per-service duration, price, and buffer time.", icon: CalendarCheckIcon },
  { title: "Online video sessions", description: "Mark a service as online and Resneo adds the join link to confirmations and reminders.", icon: VideoCameraIcon },
  { title: "Home visits", description: "Capture the client address at booking for mobile physio, massage, and home therapy.", icon: MapPinIcon },
  { title: "Group classes", description: "Run yoga, pilates, rehab, or mindfulness classes with rosters, capacity, and waitlists.", icon: CalendarDaysIcon },
  { title: "Courses & memberships", description: "Sell a course of classes or a recurring membership, with enrolment tracked end to end.", icon: ArrowPathIcon },
  { title: "Rooms & equipment", description: "Book treatment rooms and shared equipment as resources, so nothing is double-booked.", icon: LayoutGridIcon },
];

const bookingSteps = [
  { step: "1", title: "Pick a service", description: "Assessment, treatment, class, or review. Clients choose from your real list and prices." },
  { step: "2", title: "Choose a practitioner", description: "Book the clinician they know, or take the first available appointment." },
  { step: "3", title: "Pick how & when", description: "In clinic, online, or at home, on a live, accurate diary. No double-bookings." },
  { step: "4", title: "Confirm & prepare", description: "Pay any deposit, then receive the intake form to complete before the first session." },
];

const businessTypes = [
  { name: "Physiotherapists", icon: "🦵" },
  { name: "Sports & remedial massage", icon: "💪" },
  { name: "Massage therapists", icon: "💆" },
  { name: "Osteopaths", icon: "🦴" },
  { name: "Chiropractors", icon: "🩻" },
  { name: "Counsellors & therapists", icon: "🧠" },
  { name: "Acupuncturists", icon: "🪡" },
  { name: "Nutritionists & dietitians", icon: "🥗" },
  { name: "Podiatrists", icon: "🦶" },
  { name: "Yoga & pilates studios", icon: "🧘" },
];

const compareRows: { label: string; resneo: string; other: string }[] = [
  { label: "Intake & consent forms", resneo: "Built in and enforced", other: "A separate paper or app job" },
  { label: "In clinic, online & home", resneo: "All on one diary", other: "Often in-person only" },
  { label: "Commission on bookings", resneo: "None, ever", other: "Often a % of every booking" },
  { label: "Deposits & payouts", resneo: "Direct to your account", other: "Held and paid on their schedule" },
  { label: "Associate books", resneo: "Separate per room, link to share", other: "Pooled into one account" },
];

const faqs = [
  {
    q: "Is Resneo good booking software for a physiotherapy or therapy clinic?",
    a: "Yes. Resneo is built for appointment businesses, and health and wellbeing practices fit naturally: physiotherapists, massage therapists, osteopaths, chiropractors, counsellors, and more. Take bookings 24/7, reduce missed appointments with deposits and reminders, collect intake forms automatically, and see clients in clinic, online, or at home.",
  },
  {
    q: "Can Resneo send intake forms and health questionnaires before the first appointment?",
    a: "Yes. With Compliance turned on, you choose which services need an intake form, health questionnaire, or consent. The form is sent automatically when the client books, they complete and sign it on their phone with no app, and it is stored on their confidential record. You can require it to be completed before a first appointment is allowed.",
  },
  {
    q: "Does Resneo support online video sessions and home visits?",
    a: "Yes. A service can be set as online, and Resneo adds a join link to the confirmation and reminders. It can also be set as a home visit, where the client address is captured at booking and saved to their record, all on the same diary as your in-clinic appointments.",
  },
  {
    q: "Can I run group classes as well as one-to-one appointments?",
    a: "Yes. Alongside 1:1 appointments you can run group classes such as yoga, pilates, rehab, or mindfulness, with capacity, rosters, and waitlists. You can also sell a course of classes or a recurring membership, with enrolment tracked from payment to completion.",
  },
  {
    q: "How does Resneo handle confidential client data?",
    a: "Each client record, including notes and completed forms, is stored under your own account, and access to sensitive data is logged. You control marketing consent per client and can record only the information you need. Resneo helps you keep tidy records, but it is not a substitute for your own data-protection and clinical-governance obligations.",
  },
  {
    q: "Will it reduce did-not-attends?",
    a: "Two things move the needle most: a deposit that gives clients a reason to keep the appointment, and automated reminders with one-tap confirm or cancel. Together they cut missed appointments, and an early cancellation frees the slot for your waitlist.",
  },
  {
    q: "I rent rooms to associate practitioners. Can each keep separate books?",
    a: `Yes. Each associate runs their own Resneo with their own clients, calendar, and payouts, then you link accounts to share availability and a combined booking page. Either side can break the link in a click. ${LINKED_ACCOUNTS_HMRC_NOTE}`,
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
      name: "Resneo: Health & Wellbeing Booking Software",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description:
        "Booking software for health and wellbeing practices: 24/7 online booking, deposits, reminders, automatic intake forms and health questionnaires with booking enforcement, in-clinic, online, and home-visit services, group classes, and confidential client records.",
      offers: { "@type": "Offer", price: String(APPOINTMENTS_LIGHT_PRICE), priceCurrency: "GBP" },
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "/" },
        { "@type": "ListItem", position: 2, name: "Solutions", item: "/solutions" },
        { "@type": "ListItem", position: 3, name: "Health & wellbeing", item: PAGE_PATH },
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

export default function WellnessBookingSoftwarePage() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Nav />
      <Hero />
      <TrustStrip />
      <IntakeSection />
      <OutcomesSection />
      <WaysToWorkSection />
      <BookingFlowSection />
      <RecordsSection />
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
          <Link href="/solutions" className="hidden rounded-xl px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900 sm:inline-flex">
            All solutions
          </Link>
          <a href="#contact" className="hidden rounded-xl px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900 sm:inline-flex">
            Talk to us
          </a>
          <a href={SIGNUP} className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700">
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
            <HeartIcon className="h-3.5 w-3.5 text-accent-600" />
            Built for health &amp; wellbeing
          </span>
          <h1 className="mt-6 text-4xl font-extrabold leading-[1.05] tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
            Booking software for health &amp; wellbeing
          </h1>
          <p className="mt-5 text-xl font-semibold sm:text-2xl">
            <span className="bg-gradient-to-r from-brand-700 via-brand-600 to-accent-dark bg-clip-text text-transparent">
              Fewer missed appointments. A fuller diary. The paperwork, sorted.
            </span>
          </p>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-600">
            Let clients book 24/7, reduce did-not-attends with deposits and reminders, and collect intake
            forms and health questionnaires automatically before the first session. See clients in clinic,
            online, or at home. Resneo is the all-in-one booking platform for physiotherapy, massage,
            therapy, and wellbeing practices, with no booking commission.
          </p>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <a href={SIGNUP} className="inline-flex h-12 items-center justify-center rounded-xl bg-brand-600 px-7 text-base font-semibold text-white shadow-lg shadow-brand-600/25 transition-all hover:-translate-y-0.5 hover:bg-brand-700 hover:shadow-xl hover:shadow-brand-600/30">
              Start your free 14-day trial
              <ArrowRightIcon />
            </a>
            <a href="#intake" className="inline-flex h-12 items-center justify-center rounded-xl border border-slate-200 bg-white px-6 text-base font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:text-slate-900">
              See intake forms
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
              <TickIcon /> In clinic, online &amp; at home
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
          <Link href="/" className="hover:text-slate-800">Home</Link>
        </li>
        <li aria-hidden className="text-slate-300">/</li>
        <li>
          <Link href="/solutions" className="hover:text-slate-800">Solutions</Link>
        </li>
        <li aria-hidden className="text-slate-300">/</li>
        <li className="text-slate-700">Health &amp; wellbeing</li>
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
            <h3 className="mt-2 text-lg font-bold text-slate-900">Initial assessment · Align Physio</h3>
            <p className="mt-0.5 text-xs text-slate-500">Tom Bennett · with Dr Sara Hill</p>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <InfoTile label="When" value="Tue · 09:30" />
              <InfoTile label="Where" value="In clinic" accent />
            </div>

            <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Before your visit</p>
              <ul className="mt-2 space-y-1.5">
                <ChecklistRow label="New client intake" state="Completed" done />
                <ChecklistRow label="Health questionnaire" state="Completed" done />
              </ul>
            </div>

            <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Reminder queued</p>
              <p className="mt-1 text-xs text-slate-700">SMS confirm or cancel · 24 hours before</p>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute -top-6 -left-6 hidden rotate-[-6deg] rounded-xl border border-slate-100 bg-white p-3 shadow-xl shadow-slate-900/10 sm:block">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-50 text-accent-700">
            <DocumentTextIcon className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-slate-900">Intake completed</p>
            <p className="text-[10px] text-slate-500">On file before day one</p>
          </div>
        </div>
      </div>

      <div className="absolute -bottom-6 -right-4 hidden rotate-[4deg] rounded-xl border border-slate-100 bg-white p-3 shadow-xl shadow-slate-900/10 sm:block">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
            <BellIcon className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-slate-900">Reminder armed</p>
            <p className="text-[10px] text-slate-500">Tom · Tue 09:30</p>
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
        <span className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full ${done ? "bg-emerald-100 text-emerald-600" : "bg-amber-100 text-amber-600"}`}>
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
    { value: "Auto", label: "Intake & consent forms" },
    { value: "3 ways", label: "Clinic, online & home" },
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

/* ── Intake flagship ──────────────────────────────────────────────────── */

const recordTone: Record<string, string> = {
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  accent: "border-accent-200 bg-accent-50 text-accent-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
};

function IntakeSection() {
  return (
    <section id="intake" className="relative scroll-mt-16 overflow-hidden bg-white py-20 sm:py-28">
      <div className="absolute inset-0 bg-gradient-to-br from-brand-50 via-white to-accent-50/40" />
      <div className="relative mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-brand-700 backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            Intake, questionnaires &amp; consent
          </span>
          <h2 className="mt-5 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
            The intake form is done before the first session.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-600">
            Resneo&rsquo;s Compliance tools send the right intake form, health questionnaire, or consent the
            moment a client books, chase it until it is complete, and can stop a first appointment going ahead
            without it. You start every session with the history already on file.
          </p>
        </div>

        <div className="mt-14 grid items-start gap-10 lg:grid-cols-2 lg:gap-14">
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
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Before first session</p>
                    <h3 className="mt-0.5 text-lg font-bold text-slate-900">Intake &amp; consent</h3>
                  </div>
                  <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">3 of 4 ready</span>
                </div>

                <div className="mt-4 space-y-2">
                  {intakeRecords.map((r) => (
                    <div key={r.type + r.client} className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-bold text-slate-900">{r.type}</p>
                        <p className="text-[11px] text-slate-500">{r.client}</p>
                      </div>
                      <span className={`flex-shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${recordTone[r.tone]}`}>{r.state}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
                  <p className="text-[12px] font-medium text-amber-800">One intake outstanding</p>
                  <span className="rounded-lg bg-amber-500 px-2.5 py-1 text-[11px] font-bold text-white">Send link</span>
                </div>

                <div className="mt-3 rounded-xl border border-brand-100 bg-brand-50 px-3 py-2.5">
                  <p className="text-[11px] font-semibold text-brand-700">Booking rule</p>
                  <p className="mt-0.5 text-[12px] text-brand-800">New clients must complete the intake form before their first appointment.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {intakePoints.map((p) => (
              <div key={p.title} className="rounded-2xl border border-slate-100 bg-white/80 p-5 shadow-sm backdrop-blur">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-100">
                  <p.icon />
                </div>
                <h3 className="mt-4 text-sm font-bold text-slate-900">{p.title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600">{p.description}</p>
              </div>
            ))}
            <p className="text-[11px] leading-relaxed text-slate-400 sm:col-span-2">
              Compliance tools support your own record-keeping. They are not legal, medical, or data-protection
              advice. Check your obligations with your professional body and insurer.
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
            What every practice wants, and how Resneo delivers it.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-600">
            Each promise below maps to the exact Resneo features that make it happen. No buzzwords, just the
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
                    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider ${s.chip}`}>{o.eyebrow}</span>
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

/* ── Ways to work ─────────────────────────────────────────────────────── */

function WaysToWorkSection() {
  return (
    <section className="bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <span className="text-xs font-semibold uppercase tracking-widest text-accent-700">However you practise</span>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
            One platform for every way you see clients.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-600">
            Few practices are only one thing. Mix one-to-one sessions, online consults, home visits, and group
            classes, all on the same diary and the same booking page.
          </p>
        </div>

        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {waysToWork.map((w) => (
            <div key={w.title} className="group rounded-2xl border border-slate-100 bg-white p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-100">
                <w.icon />
              </div>
              <h3 className="mt-4 text-base font-bold text-slate-900">{w.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{w.description}</p>
            </div>
          ))}
        </div>

        {/* Class timetable mock */}
        <div className="relative mt-12">
          <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-r from-brand-100/40 via-white/0 to-accent-200/40 blur-3xl" />
          <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-brand-900/5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">This week</p>
                <h3 className="mt-0.5 text-lg font-bold text-slate-900">Class timetable</h3>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-brand-100 px-2.5 py-1 text-[11px] font-semibold text-brand-700">6 classes</span>
                <span className="rounded-full bg-accent-100 px-2.5 py-1 text-[11px] font-semibold text-accent-700">2 waitlists</span>
              </div>
            </div>
            <div className="grid gap-px bg-slate-100 sm:grid-cols-3">
              {[
                { day: "Monday", classes: [{ t: "07:00", n: "Rehab Pilates", s: "8 / 10", tone: "brand" as const }, { t: "18:30", n: "Hatha Yoga", s: "Full · waitlist", tone: "accent" as const }] },
                { day: "Wednesday", classes: [{ t: "09:30", n: "Clinical Pilates", s: "6 / 10", tone: "brand" as const }, { t: "19:00", n: "Mindfulness", s: "11 / 14", tone: "slate" as const }] },
                { day: "Friday", classes: [{ t: "08:00", n: "Back Care Class", s: "Full · waitlist", tone: "accent" as const }, { t: "17:30", n: "Vinyasa Yoga", s: "9 / 14", tone: "brand" as const }] },
              ].map((col) => (
                <div key={col.day} className="bg-white p-4">
                  <p className="pb-2 text-sm font-bold text-slate-900">{col.day}</p>
                  <div className="space-y-2">
                    {col.classes.map((c) => (
                      <div
                        key={c.t}
                        className={`rounded-xl border p-3 ${
                          c.tone === "brand" ? "border-brand-200 bg-brand-50" : c.tone === "accent" ? "border-accent-200 bg-accent-50" : "border-slate-200 bg-white"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-bold text-slate-700">{c.t}</span>
                          <span className="text-[10px] font-semibold text-slate-500">{c.s}</span>
                        </div>
                        <p className="mt-1 text-[13px] font-semibold text-slate-900">{c.n}</p>
                      </div>
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

/* ── Booking flow ─────────────────────────────────────────────────────── */

function BookingFlowSection() {
  return (
    <section className="bg-slate-50 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <span className="text-xs font-semibold uppercase tracking-widest text-accent-700">The booking flow</span>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
            A booking journey your clients will actually finish.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-600">
            From &ldquo;I need to see someone&rdquo; to a confirmed, prepared appointment: service,
            practitioner, how and when, and the intake queued to complete. No app, no account wall.
          </p>
        </div>

        <div className="relative mt-16">
          <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-r from-brand-100/40 via-white/0 to-accent-200/40 blur-3xl" />
          <div className="relative grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FlowStep step="1" title="Pick a service">
              <div className="mt-3 space-y-1.5">
                <FlowRow text="Initial assessment" meta="£60" active />
                <FlowRow text="Follow-up" meta="£45" />
                <FlowRow text="Sports massage" meta="£50" />
              </div>
            </FlowStep>
            <FlowStep step="2" title="Choose a practitioner">
              <div className="mt-3 grid grid-cols-3 gap-1.5">
                {([["Sara", true], ["Mo", false], ["Any", false]] as const).map(([name, on]) => (
                  <div key={name} className="flex flex-col items-center gap-1">
                    <span className={`flex h-9 w-9 items-center justify-center rounded-full text-[11px] font-bold ${on ? "bg-brand-600 text-white ring-2 ring-brand-200" : "bg-slate-100 text-slate-500"}`}>
                      {name === "Any" ? "★" : name[0]}
                    </span>
                    <span className="text-[9px] font-semibold text-slate-600">{name}</span>
                  </div>
                ))}
              </div>
            </FlowStep>
            <FlowStep step="3" title="How & when">
              <div className="mt-3 space-y-1.5">
                <div className="grid grid-cols-3 gap-1">
                  {([["In clinic", true], ["Online", false], ["Home", false]] as const).map(([m, on]) => (
                    <span key={m} className={`rounded-md px-1 py-1 text-center text-[9px] font-semibold ${on ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}>{m}</span>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {["09:30", "11:00", "14:15"].map((t, i) => (
                    <span key={t} className={`rounded-md px-1 py-1.5 text-center text-[10px] font-semibold ${i === 0 ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}>{t}</span>
                  ))}
                </div>
              </div>
            </FlowStep>
            <FlowStep step="4" title="Confirm & prepare">
              <div className="mt-3 space-y-1.5">
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-500">Deposit</span>
                  <span className="font-semibold text-slate-900">£20</span>
                </div>
                <div className="rounded-md bg-white px-2 py-1 text-[10px] leading-snug text-slate-600 ring-1 ring-slate-100">
                  Intake form sent to complete before your first session.
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
              <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 text-sm font-extrabold text-white shadow-md shadow-brand-600/25">{s.step}</div>
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

/* ── Confidential records ─────────────────────────────────────────────── */

function RecordsSection() {
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
              Confidential records
            </span>
            <h2 className="mt-6 text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">
              Every client&rsquo;s history, kept private and to hand.
            </h2>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-white/80">
              Notes, completed forms, and the details that matter live on one secure profile, so you are
              prepared for every session and never digging through paper or inboxes.
            </p>
            <ul className="mt-7 space-y-3">
              {[
                "Notes and completed intake forms on one record",
                "Custom fields for GP, referral source, or conditions",
                "Visit history, deposits, and attendance at a glance",
                "Access to sensitive data is logged, consent tracked per client",
              ].map((point) => (
                <li key={point} className="flex items-start gap-3 text-sm text-white/85">
                  <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-accent/20 text-accent-200">
                    <TickIcon className="h-3 w-3" />
                  </span>
                  {point}
                </li>
              ))}
            </ul>
            <p className="mt-6 max-w-xl text-xs leading-relaxed text-white/50">
              Resneo helps you keep tidy records. It is not a substitute for your own data-protection and
              clinical-governance obligations.
            </p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white p-6 text-slate-900 shadow-2xl shadow-slate-900/40 sm:p-7">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-brand-600 to-brand-800 text-base font-bold text-white">TB</span>
              <div>
                <p className="text-base font-bold text-slate-900">Tom Bennett</p>
                <p className="text-xs text-slate-500">Client since Jan 2025 · 9 sessions</p>
              </div>
              <span className="ml-auto rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">Intake complete</span>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-2 text-center">
              <Stat label="Sessions" value="9" />
              <Stat label="Missed" value="0" />
              <Stat label="Deposits" value="£180" />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <FieldChip label="GP" value="Dr Khan, Elm Surgery" />
              <FieldChip label="Referral" value="Self-referral" />
              <FieldChip label="Focus" value="Lower back, L4/L5" />
              <FieldChip label="Marketing" value="Opted in" />
            </div>

            <div className="mt-4 space-y-2">
              <RecordLine label="New client intake" meta="Completed" tone="emerald" />
              <RecordLine label="Treatment consent" meta="Signed" tone="accent" />
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

function FieldChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-0.5 text-[12px] font-semibold text-slate-800">{value}</p>
    </div>
  );
}

function RecordLine({ label, meta, tone }: { label: string; meta: string; tone: "accent" | "emerald" }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2">
      <span className="text-[13px] font-semibold text-slate-800">{label}</span>
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${tone === "accent" ? "bg-accent-100 text-accent-700" : "bg-emerald-100 text-emerald-700"}`}>{meta}</span>
    </div>
  );
}

/* ── Linked accounts (associates / room renters) ──────────────────────── */

function LinkedAccountsSection() {
  const benefits = [
    { title: "Separate books per associate", icon: UserCardIcon },
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
                <LinkIcon className="h-3.5 w-3.5" /> Associates, room renters &amp; clinics
              </span>
              <h2 className="mt-5 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                Share a clinic. Keep separate books.
              </h2>
              <p className="mt-4 text-base leading-relaxed text-slate-600">
                A multi-disciplinary clinic of self-employed associates, or rooms rented to visiting
                practitioners? Each runs their own Resneo with their own clients, calendar, and payouts. Link
                accounts to share availability and a combined booking page, and break the link in a click.
                Nothing is ever merged.
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
            Made for every kind of practitioner.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-600">
            A solo therapist or a multi-disciplinary clinic, seeing clients in person, online, or at home. If
            you take appointments and care about your records, Resneo fits.
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
            Keep your clients. Keep your margin. Keep the records.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-600">
            Marketplace apps list you next to your competitors and take a cut. Generic schedulers leave intake
            and consent to you. Resneo does both, in one place.
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
                See more clients. Chase less paper. Start free today.
              </h2>
              <p className="mt-5 max-w-lg text-base leading-relaxed text-white/80">
                Take bookings 24/7, cut missed appointments with deposits and reminders, and collect every
                intake form before the first session. Set up in an afternoon and start your free 14-day trial.
                No card needed to look around, no booking commission, cancel anytime.
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
              <p className="mt-1 text-sm text-slate-500">Tell us about your practice and we&rsquo;ll reply within one working day.</p>
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
          <Link href="/beauty-booking-software" className="transition-colors hover:text-slate-900">Beauty &amp; aesthetics</Link>
          <a href={SIGNUP} className="transition-colors hover:text-slate-900">Sign up</a>
          <Link href="/login" className="transition-colors hover:text-slate-900">Login</Link>
          <Link href="/privacy" className="transition-colors hover:text-slate-900">Privacy Policy</Link>
        </div>
      </div>
    </footer>
  );
}
