import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import Script from "next/script";
import ContactForm from "@/components/ContactForm";
import { EMBED_IFRAME_DEFAULT_HEIGHT_PX } from "@/lib/embed/widget-frame";
import { normalizePublicBaseUrl } from "@/lib/public-base-url";
import { RESNEO_MARKETING_PAYMENTS_AND_NO_HOLD } from "@/lib/booking-funds-copy";
import { STANDARD_PAYMENT_PROVIDER_FEES_NOTICE } from "@/lib/payment-provider-fees-notice";
import { SUBSCRIPTION_CANCELLATION_PUBLIC_NOTICE } from "@/lib/subscription-cancellation-copy";
import { APPOINTMENTS_LIGHT_PRICE, SMS_OVERAGE_GBP_PER_MESSAGE } from "@/lib/pricing-constants";
import { SMS_INCLUDED_PLUS } from "@/lib/billing/sms-allowance";

const PAGE_PATH = "/salon-booking-software";
const SIGNUP = "/#pricing";

export const metadata: Metadata = {
  title: "Salon Booking Software for Hair Salons & Barbers | Resneo",
  description:
    "Resneo is booking software for hair salons and barbers. Let clients book online 24/7, cut no-shows with deposits and automated reminders, and keep every chair full — no commission, no marketplace. Start a free 14-day trial.",
  keywords: [
    "salon booking software",
    "barber appointment software",
    "hair salon booking system",
    "online booking for barbers",
    "barbershop booking app",
    "salon scheduling software",
    "appointment software for hairdressers",
  ],
  alternates: { canonical: PAGE_PATH },
  openGraph: {
    title: "Salon & Barber Booking Software | Resneo",
    description:
      "Online booking, deposits, and automated reminders built for hair salons and barbershops. Fewer no-shows, fuller chairs, less admin.",
    url: PAGE_PATH,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Salon & Barber Booking Software | Resneo",
    description:
      "Online booking, deposits, and automated reminders built for hair salons and barbershops.",
  },
};

const demoPublicOrigin = normalizePublicBaseUrl(process.env.NEXT_PUBLIC_BASE_URL);
const demoEmbedSrc = `${demoPublicOrigin}/embed/resneo-demo?start=service`;
const demoResizeScriptSrc = `${demoPublicOrigin}/embed/resize.js`;

/* ────────────────────────────────────────────────────────────────────────
   Content data
   ──────────────────────────────────────────────────────────────────────── */

/** The three outcomes that lead the page, each mapped to the features that deliver it. */
const outcomes = [
  {
    eyebrow: "Outcome 01",
    title: "Fewer no-shows",
    promise:
      "Empty chairs from missed appointments are pure lost income you can never bill twice. Resneo gets clients to show up, or to cancel in time for you to refill the slot.",
    icon: ShieldPoundIcon,
    accent: "rose" as const,
    features: [
      {
        title: "Deposits & pay-at-booking",
        description: `Ask for a deposit or full payment on the chair-time that matters most. ${RESNEO_MARKETING_PAYMENTS_AND_NO_HOLD}`,
        icon: ShieldPoundIcon,
      },
      {
        title: "Automated SMS & email reminders",
        description:
          "Confirmations and reminders go out on autopilot before every appointment. No more chasing clients from your own phone.",
        icon: BellIcon,
      },
      {
        title: "Confirm-or-cancel replies",
        description:
          "Clients confirm or cancel from the reminder itself. A cancel frees the slot early so your waitlist can fill it.",
        icon: ChatIcon,
      },
    ],
  },
  {
    eyebrow: "Outcome 02",
    title: "Fully booked chairs",
    promise:
      "The busiest salons take bookings the moment a client decides — late at night, between meetings, mid-scroll. Resneo turns that intent into a confirmed appointment instead of a missed call.",
    icon: CalendarCheckIcon,
    accent: "brand" as const,
    features: [
      {
        title: "24/7 online booking page",
        description:
          "A branded booking page and website widget take appointments around the clock, even when the shutters are down.",
        icon: MoonIcon,
      },
      {
        title: "A link for every stylist & barber",
        description:
          "Each team member gets their own bookable link and live availability, so regulars rebook with the chair they love.",
        icon: UsersIcon,
      },
      {
        title: "Rebooking & gap-filling",
        description:
          "Encourage the next appointment at checkout and surface the gaps in your day so quiet hours fill themselves.",
        icon: SparklesIcon,
      },
    ],
  },
  {
    eyebrow: "Outcome 03",
    title: "Less admin",
    promise:
      "Your time is best spent behind the chair, not buried in DMs and a paper diary. Resneo takes the back-and-forth off your plate so the day runs itself.",
    icon: ClockIcon,
    accent: "accent" as const,
    features: [
      {
        title: "One live team calendar",
        description:
          "Every stylist, every chair, colour-coded and in sync. Drag to reschedule and spot clashes before they happen.",
        icon: LayoutGridIcon,
      },
      {
        title: "Client records that remember",
        description:
          "Formulas, colour notes, allergies, and visit history travel with each client, ready before they sit down.",
        icon: UserCardIcon,
      },
      {
        title: "Comms on autopilot",
        description:
          "Confirmations, reminders, and thank-you messages send themselves. No phone tag, no evenings spent replying to messages.",
        icon: ChatIcon,
      },
    ],
  },
];

const bookingSteps = [
  {
    step: "1",
    title: "Pick a service",
    description: "Cut, colour, beard trim, full restyle — clients choose from your real menu and prices.",
  },
  {
    step: "2",
    title: "Choose a stylist",
    description: "Book with a favourite barber or stylist, or let the client take the first free chair.",
  },
  {
    step: "3",
    title: "Find a time",
    description: "Live availability only. No double-bookings, no phone tag, no waiting for a reply.",
  },
  {
    step: "4",
    title: "Confirm & deposit",
    description: "Optional deposit at booking, instant confirmation, and a reminder queued automatically.",
  },
];

const features = [
  {
    title: "Branded booking page",
    description: "A beautiful, mobile-first page with your name, services, and team — no app download for clients.",
  },
  {
    title: "Website & Instagram widget",
    description: "Embed booking on your own site or link it straight from your Instagram and Google profile.",
  },
  {
    title: "Per-stylist availability",
    description: "Individual working hours, breaks, days off, and services for every chair in the shop.",
  },
  {
    title: "Deposits via Stripe",
    description: `Per-service deposits or full payment, paid straight to your account. ${RESNEO_MARKETING_PAYMENTS_AND_NO_HOLD}`,
  },
  {
    title: "Email + SMS reminders",
    description: "Automated confirmations and reminders that cut no-shows without you lifting a finger.",
  },
  {
    title: "Client history & notes",
    description: "Colour formulas, preferences, and past visits saved against every client profile.",
  },
  {
    title: "Walk-ins & phone bookings",
    description: "Add a walk-in or phone booking in seconds so the whole diary lives in one place.",
  },
  {
    title: "Waitlist",
    description: "Capture demand for full days and offer cancelled slots to waiting clients first.",
  },
  {
    title: "Reporting that matters",
    description: "See your busiest hours, top services, and which stylists are booking out.",
  },
  {
    title: "No booking commission",
    description: "One simple subscription. Resneo never takes a cut of your bookings or rents out your clients.",
  },
];

const businessTypes = [
  { name: "Barbershops", icon: "💈" },
  { name: "Hair salons", icon: "💇" },
  { name: "Men's grooming", icon: "🧔" },
  { name: "Colour specialists", icon: "🎨" },
  { name: "Blow-dry bars", icon: "💨" },
  { name: "Mobile hairdressers", icon: "🚗" },
  { name: "Hair & beauty studios", icon: "💅" },
  { name: "Afro & textured hair", icon: "✨" },
  { name: "Wedding & event stylists", icon: "👰" },
  { name: "Booth & chair renters", icon: "🪑" },
];

const compareRows: { label: string; resneo: string; marketplace: string }[] = [
  { label: "Commission on bookings", resneo: "None, ever", marketplace: "Often a % of every booking" },
  { label: "Who owns your clients", resneo: "You do", marketplace: "Listed in a shared marketplace" },
  { label: "Payouts", resneo: "Direct to your account", marketplace: "Held and paid on their schedule" },
  { label: "Your branding", resneo: "Your page, your name", marketplace: "Their brand up front" },
  { label: "Pricing", resneo: "One flat monthly fee", marketplace: "Tiers, add-ons, and fees" },
];

const faqs = [
  {
    q: "Is Resneo good barber appointment software?",
    a: "Yes. Resneo is built for appointment businesses, and barbershops are right at home. Give each barber their own bookable link and hours, take deposits on the chair-time you want to protect, and let clients book 24/7 from your website, Instagram, or Google profile.",
  },
  {
    q: "Can clients book a specific stylist or barber?",
    a: "Absolutely. Every team member has their own services, working hours, and availability, so regulars can rebook the chair they love — or choose the first available if they are not fussy.",
  },
  {
    q: "How do deposits work for salons?",
    a: `Connect Stripe in a few minutes, then decide which services need a deposit or full payment up front. Clients pay when they book, the booking is held, and ${STANDARD_PAYMENT_PROVIDER_FEES_NOTICE.toLowerCase()} ${RESNEO_MARKETING_PAYMENTS_AND_NO_HOLD}`,
  },
  {
    q: "Will it really reduce no-shows?",
    a: "Two things move the needle most: a deposit that gives clients skin in the game, and automated reminders with one-tap confirm-or-cancel. Together they cut no-shows sharply and, when someone does cancel, they free the slot early enough for your waitlist to fill it.",
  },
  {
    q: "Do my clients need to download an app?",
    a: "No. Clients book on a fast, mobile-friendly web page — no app, no account wall. You manage everything from your phone or a tablet at the front desk.",
  },
  {
    q: "Can I switch from another salon booking system?",
    a: "Yes. Most salons are taking real bookings the same day: add your services, set each chair's hours, connect payments if you want deposits, and share your link. If you are moving from another system, talk to us and we will help you bring your details across.",
  },
  {
    q: "How much does it cost?",
    a: `Plans start from £${APPOINTMENTS_LIGHT_PRICE}/month with a 14-day free trial on every paid plan, and there is never any commission on your bookings. ${SUBSCRIPTION_CANCELLATION_PUBLIC_NOTICE}`,
  },
];

/* ────────────────────────────────────────────────────────────────────────
   Structured data (JSON-LD) for SEO
   ──────────────────────────────────────────────────────────────────────── */

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      name: "Resneo — Salon & Barber Booking Software",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description:
        "Online booking software for hair salons and barbershops: 24/7 booking, deposits, automated reminders, per-stylist availability, and client records.",
      offers: {
        "@type": "Offer",
        price: String(APPOINTMENTS_LIGHT_PRICE),
        priceCurrency: "GBP",
      },
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "/" },
        { "@type": "ListItem", position: 2, name: "Solutions", item: "/solutions" },
        { "@type": "ListItem", position: 3, name: "Salon & Barber Booking Software", item: PAGE_PATH },
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

export default function SalonBookingSoftwarePage() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Nav />
      <Hero />
      <TrustStrip />
      <OutcomesSection />
      <BookingFlowSection />
      <DashboardSection />
      <FeaturesSection />
      <BusinessTypesSection />
      <CompareSection />
      <FaqSection />
      <ClosingCta />
      <Footer />
      <Script src={demoResizeScriptSrc} strategy="afterInteractive" />
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
            Built for salons &amp; barbers
          </span>
          <h1 className="mt-6 text-4xl font-extrabold leading-[1.05] tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
            Booking software for hair salons &amp; barbers
          </h1>
          <p className="mt-5 text-xl font-semibold sm:text-2xl">
            <span className="bg-gradient-to-r from-brand-700 via-brand-600 to-accent-dark bg-clip-text text-transparent">
              Fewer no-shows. Fuller chairs. Less admin.
            </span>
          </p>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-600">
            Let clients book online 24/7, take deposits to protect your chair-time, and automate every
            reminder. Resneo is the simple, all-in-one booking platform for barbershops and hair salons —
            with no booking commission and no marketplace renting out your clients.
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
              href="#booking-flow"
              className="inline-flex h-12 items-center justify-center rounded-xl border border-slate-200 bg-white px-6 text-base font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:text-slate-900"
            >
              See the booking flow
            </a>
          </div>

          <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-slate-500">
            <span className="inline-flex items-center gap-2">
              <TickIcon />
              14-day free trial
            </span>
            <span className="inline-flex items-center gap-2">
              <TickIcon />
              No booking commission
            </span>
            <span className="inline-flex items-center gap-2">
              <TickIcon />
              Cancel anytime
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
        <li className="text-slate-700">Salons &amp; barbers</li>
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
            <h3 className="mt-2 text-lg font-bold text-slate-900">Cut &amp; finish · The Chair Co.</h3>
            <p className="mt-0.5 text-xs text-slate-500">Jordan Hughes · with Sophie</p>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <InfoTile label="Service" value="Cut & finish" />
              <InfoTile label="Stylist" value="Sophie M." accent />
              <InfoTile label="Time" value="Sat · 11:30" />
              <InfoTile label="Deposit" value="£10 paid" />
            </div>

            <div className="mt-4 rounded-xl border border-brand-100 bg-brand-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-600">Client note</p>
              <p className="mt-1 text-xs text-brand-800">Half head of foils last visit · prefers cooler tones.</p>
            </div>

            <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Reminder queued</p>
              <p className="mt-1 text-xs text-slate-700">SMS confirm-or-cancel · 24 hours before</p>
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
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-50 text-accent-700">
            <TickIcon />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-slate-900">Deposit settled</p>
            <p className="text-[10px] text-slate-500">£10.00 to your account</p>
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
            <p className="text-[10px] text-slate-500">Jordan · Sat 11:30</p>
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
        accent ? "border-accent-200 bg-accent-50" : "border-slate-100 bg-slate-50"
      }`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-1 text-sm font-bold ${accent ? "text-accent-700" : "text-slate-900"}`}>{value}</p>
    </div>
  );
}

/* ── Trust strip ──────────────────────────────────────────────────────── */

function TrustStrip() {
  const items = [
    { value: "24/7", label: "Online booking page" },
    { value: "0%", label: "Commission on bookings" },
    { value: "Email + SMS", label: "Reminders included" },
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

/* ── Outcomes → features ──────────────────────────────────────────────── */

const accentStyles = {
  rose: {
    chip: "bg-rose-100 text-rose-700",
    icon: "bg-rose-50 text-rose-600 ring-rose-100",
    bar: "from-rose-400 to-rose-200",
  },
  brand: {
    chip: "bg-brand-100 text-brand-700",
    icon: "bg-brand-50 text-brand-600 ring-brand-100",
    bar: "from-brand-400 to-brand-200",
  },
  accent: {
    chip: "bg-accent-100 text-accent-700",
    icon: "bg-accent-50 text-accent-600 ring-accent-100",
    bar: "from-accent-400 to-accent-200",
  },
} as const;

function OutcomesSection() {
  return (
    <section className="bg-slate-50 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <span className="text-xs font-semibold uppercase tracking-widest text-accent-700">
            Outcomes first
          </span>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
            Three things every owner wants. Here is how Resneo delivers them.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-600">
            Software should earn its keep. Each promise below maps to the exact Resneo features that make it
            happen — no buzzwords, just the tools doing the work.
          </p>
        </div>

        <div className="mt-16 space-y-6">
          {outcomes.map((o) => {
            const s = accentStyles[o.accent];
            return (
              <div
                key={o.title}
                className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm"
              >
                <div className={`h-1.5 w-full bg-gradient-to-r ${s.bar}`} />
                <div className="grid gap-8 p-7 sm:p-10 lg:grid-cols-[0.9fr_1.6fr] lg:gap-12">
                  <div>
                    <span
                      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider ${s.chip}`}
                    >
                      {o.eyebrow}
                    </span>
                    <h3 className="mt-4 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
                      {o.title}
                    </h3>
                    <p className="mt-3 text-sm leading-relaxed text-slate-600">{o.promise}</p>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-3">
                    {o.features.map((f) => (
                      <div
                        key={f.title}
                        className="rounded-2xl border border-slate-100 bg-slate-50/70 p-5 transition-colors hover:border-slate-200 hover:bg-white"
                      >
                        <div
                          className={`flex h-10 w-10 items-center justify-center rounded-xl ring-1 ${s.icon}`}
                        >
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

/* ── Booking flow (mock + live demo) ──────────────────────────────────── */

function BookingFlowSection() {
  return (
    <section id="booking-flow" className="scroll-mt-16 bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <span className="text-xs font-semibold uppercase tracking-widest text-accent-700">
            The actual booking flow
          </span>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
            A booking journey your clients will actually finish.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-600">
            Four taps from &ldquo;I need a trim&rdquo; to a confirmed appointment — service, stylist, time,
            done. No app, no account wall, no friction.
          </p>
        </div>

        {/* Step mock */}
        <div className="relative mt-16">
          <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-r from-brand-100/40 via-white/0 to-accent-200/40 blur-3xl" />
          <div className="relative grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FlowStep step="1" title="Pick a service">
              <div className="mt-3 space-y-1.5">
                <FlowRow text="Skin fade" meta="£18" />
                <FlowRow text="Cut & finish" meta="£32" active />
                <FlowRow text="Full colour" meta="£70" />
              </div>
            </FlowStep>
            <FlowStep step="2" title="Choose a stylist">
              <div className="mt-3 grid grid-cols-3 gap-1.5">
                {(
                  [
                    ["Sophie", true],
                    ["Aaron", false],
                    ["Any", false],
                  ] as const
                ).map(([name, on]) => (
                  <div key={name} className="flex flex-col items-center gap-1">
                    <span
                      className={`flex h-9 w-9 items-center justify-center rounded-full text-[11px] font-bold ${
                        on ? "bg-brand-600 text-white ring-2 ring-brand-200" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {name === "Any" ? "★" : name[0]}
                    </span>
                    <span className="text-[9px] font-semibold text-slate-600">{name}</span>
                  </div>
                ))}
              </div>
            </FlowStep>
            <FlowStep step="3" title="Find a time">
              <div className="mt-3 grid grid-cols-3 gap-1.5">
                {["10:00", "10:45", "11:30", "13:15", "14:00", "15:30"].map((t, i) => (
                  <span
                    key={t}
                    className={`rounded-md px-1 py-1.5 text-center text-[10px] font-semibold ${
                      i === 2 ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {t}
                  </span>
                ))}
              </div>
            </FlowStep>
            <FlowStep step="4" title="Confirm & deposit">
              <div className="mt-3 space-y-1.5">
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-500">Deposit</span>
                  <span className="font-semibold text-slate-900">£10</span>
                </div>
                <div className="rounded-md bg-slate-50 px-2 py-1 text-[10px] leading-snug text-slate-600">
                  Reminder sends automatically. Cancellation policy shown up front.
                </div>
                <div className="mt-1 rounded-md bg-brand-600 py-1.5 text-center text-[11px] font-bold text-white">
                  Book appointment
                </div>
              </div>
            </FlowStep>
          </div>
        </div>

        {/* Live demo widget — the real Resneo booking page */}
        <div className="mt-16 grid items-start gap-10 lg:grid-cols-2 lg:gap-14">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-accent-200 bg-accent-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-accent-700">
              Try it yourself
            </span>
            <h3 className="mt-4 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              This is the real thing, not a screenshot.
            </h3>
            <p className="mt-4 max-w-md text-base leading-relaxed text-slate-600">
              The widget on the right is a live Resneo booking page — the same one your clients would use on
              your website or from your link. Pick a service and walk through a real booking.
            </p>
            <ul className="mt-7 space-y-3">
              {[
                "Mobile-first and fast on any phone",
                "No app to download, no account to create",
                "Embed it on your site or share the link anywhere",
              ].map((c) => (
                <li key={c} className="flex items-start gap-3 text-sm text-slate-700">
                  <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-accent-50 text-accent-700">
                    <TickIcon small />
                  </span>
                  {c}
                </li>
              ))}
            </ul>
            <a
              href={SIGNUP}
              className="mt-8 inline-flex h-12 items-center justify-center rounded-xl bg-brand-600 px-7 text-base font-semibold text-white shadow-lg shadow-brand-600/25 transition-all hover:-translate-y-0.5 hover:bg-brand-700"
            >
              Start your free 14-day trial
              <ArrowRightIcon />
            </a>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-brand-900/5">
            <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
              <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
              <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
              <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
              <span className="ml-3 inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400">
                <LockIcon /> resneo.com/book
              </span>
            </div>
            <iframe
              src={demoEmbedSrc}
              width="100%"
              height={EMBED_IFRAME_DEFAULT_HEIGHT_PX}
              style={{ border: "none", overflow: "hidden" }}
              scrolling="no"
              id="reserveni-widget"
              title="Live Resneo salon booking demo"
              loading="lazy"
            />
          </div>
        </div>

        {/* Step labels under the mock */}
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
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-100 text-[10px] font-bold text-brand-700">
          {step}
        </span>
        <p className="text-xs font-semibold text-slate-900">{title}</p>
      </div>
      {children}
    </div>
  );
}

function FlowRow({ text, meta, active = false }: { text: string; meta: string; active?: boolean }) {
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

/* ── Dashboard preview ────────────────────────────────────────────────── */

function DashboardSection() {
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
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-white/80 backdrop-blur">
            Your day at a glance
          </span>
          <h2 className="mt-6 text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">
            Every chair, every booking, on one live calendar.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-white/80">
            See the whole team&rsquo;s day in one place — colour-coded, drag-to-reschedule, with client notes
            a tap away. On the front desk or in your pocket.
          </p>
        </div>

        <div className="relative mt-14">
          <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-r from-brand-500/30 via-white/0 to-accent-400/30 blur-3xl" />
          <SalonDashboardMock />
        </div>
      </div>
    </section>
  );
}

function SalonDashboardMock() {
  const columns = [
    {
      name: "Sophie",
      chair: "Chair 1",
      bookings: [
        { time: "10:00", svc: "Cut & finish", client: "M. Reilly", tone: "brand" as const },
        { time: "11:30", svc: "Half head foils", client: "J. Hughes", tone: "accent" as const, dep: true },
        { time: "14:00", svc: "Toner & blow-dry", client: "L. Park", tone: "brand" as const },
      ],
    },
    {
      name: "Aaron",
      chair: "Chair 2",
      bookings: [
        { time: "10:15", svc: "Skin fade", client: "T. Boyd", tone: "slate" as const, dep: true },
        { time: "11:00", svc: "Beard trim", client: "Walk-in", tone: "slate" as const },
        { time: "12:30", svc: "Cut & beard", client: "D. Okafor", tone: "brand" as const },
      ],
    },
    {
      name: "Priya",
      chair: "Chair 3",
      bookings: [
        { time: "10:30", svc: "Restyle", client: "E. Quinn", tone: "accent" as const },
        { time: "13:15", svc: "Root tint", client: "S. Adeyemi", tone: "brand" as const, dep: true },
        { time: "15:30", svc: "Open slot", client: "Available", tone: "empty" as const },
      ],
    },
  ];

  const toneClass: Record<string, string> = {
    brand: "border-brand-200 bg-brand-50 text-brand-900",
    accent: "border-accent-200 bg-accent-50 text-accent-900",
    slate: "border-slate-200 bg-white text-slate-900",
    empty: "border-dashed border-slate-200 bg-slate-50 text-slate-400",
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl shadow-slate-900/30">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-300/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-accent/80" />
        <div className="ml-4 hidden h-5 w-64 items-center justify-center gap-1 rounded-md bg-white text-[10px] text-slate-400 sm:flex">
          <LockIcon /> resneo.com/dashboard
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Saturday</p>
          <h3 className="mt-0.5 text-lg font-bold text-slate-900">The Chair Co. · Day view</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-brand-100 px-2.5 py-1 text-[11px] font-semibold text-brand-700">
            27 booked
          </span>
          <span className="rounded-full bg-accent-100 px-2.5 py-1 text-[11px] font-semibold text-accent-700">
            £640 in deposits
          </span>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
            3 gaps to fill
          </span>
        </div>
      </div>

      <div className="grid gap-px bg-slate-100 sm:grid-cols-3">
        {columns.map((col) => (
          <div key={col.name} className="bg-white p-4">
            <div className="flex items-center gap-2 pb-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-brand-600 to-brand-800 text-xs font-bold text-white">
                {col.name[0]}
              </span>
              <div>
                <p className="text-sm font-bold text-slate-900">{col.name}</p>
                <p className="text-[11px] text-slate-500">{col.chair}</p>
              </div>
            </div>
            <div className="space-y-2">
              {col.bookings.map((b, i) => (
                <div key={i} className={`rounded-xl border p-3 ${toneClass[b.tone]}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold">{b.time}</span>
                    {"dep" in b && b.dep ? (
                      <span className="rounded-full bg-white/70 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide">
                        Deposit
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-[13px] font-semibold leading-tight">{b.svc}</p>
                  <p className="text-[11px] opacity-70">{b.client}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Features ─────────────────────────────────────────────────────────── */

function FeaturesSection() {
  return (
    <section className="bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <span className="text-xs font-semibold uppercase tracking-widest text-accent-700">
            Everything in the kit
          </span>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
            Salon-grade tooling, without the enterprise price tag.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-600">
            Everything you need to take bookings, get paid, and run a busy floor — and nothing you don&rsquo;t.
          </p>
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

        <p className="mx-auto mt-8 max-w-2xl text-center text-xs leading-relaxed text-slate-400">
          The Plus plan includes {SMS_INCLUDED_PLUS} SMS per month (extra at{" "}
          {Math.round(SMS_OVERAGE_GBP_PER_MESSAGE * 100)}p each beyond the allowance).{" "}
          {STANDARD_PAYMENT_PROVIDER_FEES_NOTICE}
        </p>
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
            Made for every kind of chair.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-600">
            One barber or a full team of stylists, a high-street salon or a mobile round — if you take
            appointments, Resneo fits.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {businessTypes.map((u) => (
            <div
              key={u.name}
              className="group flex items-center gap-3 rounded-xl border border-slate-100 bg-white p-4 transition-all hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-lg">
                {u.icon}
              </span>
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
          <span className="text-xs font-semibold uppercase tracking-widest text-accent-700">
            Resneo vs marketplace apps
          </span>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
            Keep your clients. Keep your margin.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-600">
            Many salon booking apps list you in a shared marketplace and take a cut of every booking. Resneo
            is your booking system, not a middleman — your page, your clients, your money.
          </p>
        </div>

        <div className="mt-14 overflow-hidden rounded-2xl border border-slate-200 shadow-sm">
          <div className="grid grid-cols-[1.3fr_1fr_1fr] bg-slate-50 text-xs font-bold uppercase tracking-wider text-slate-500 sm:text-sm">
            <div className="p-4" />
            <div className="border-l border-slate-200 bg-brand-600 p-4 text-center text-white">Resneo</div>
            <div className="border-l border-slate-200 p-4 text-center">Marketplace apps</div>
          </div>
          {compareRows.map((row, i) => (
            <div
              key={row.label}
              className={`grid grid-cols-[1.3fr_1fr_1fr] text-sm ${i % 2 ? "bg-slate-50/50" : "bg-white"}`}
            >
              <div className="flex items-center p-4 font-semibold text-slate-800">{row.label}</div>
              <div className="flex items-center justify-center gap-1.5 border-l border-slate-100 bg-brand-50/40 p-4 text-center font-semibold text-brand-800">
                <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-brand-600 text-white">
                  <TickIcon small />
                </span>
                {row.resneo}
              </div>
              <div className="flex items-center justify-center border-l border-slate-100 p-4 text-center text-slate-500">
                {row.marketplace}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-5 text-center text-xs text-slate-400">
          Comparison reflects how marketplace-style booking apps commonly operate; specifics vary by provider.
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
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Questions, answered.
          </h2>
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
                Fill your chairs. Start free today.
              </h2>
              <p className="mt-5 max-w-lg text-base leading-relaxed text-white/80">
                Take bookings 24/7, cut no-shows with deposits and reminders, and get your evenings back.
                Set up in an afternoon and start your free 14-day trial — no card needed to look around, no
                booking commission, cancel anytime.
              </p>

              <div className="mt-6 grid max-w-xl grid-cols-1 gap-3 text-xs text-white/85 sm:grid-cols-2">
                <div className="rounded-lg border border-white/15 bg-white/10 px-3 py-2">
                  14-day free trial on every paid plan
                </div>
                <div className="rounded-lg border border-white/15 bg-white/10 px-3 py-2">
                  From £{APPOINTMENTS_LIGHT_PRICE}/month, no commission
                </div>
                <div className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 sm:col-span-2">
                  {SUBSCRIPTION_CANCELLATION_PUBLIC_NOTICE}
                </div>
              </div>

              <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <a
                  href={SIGNUP}
                  className="inline-flex h-12 items-center justify-center rounded-xl bg-white px-7 text-base font-semibold text-slate-900 shadow-lg transition-all hover:-translate-y-0.5 hover:bg-brand-50"
                >
                  Start your free 14-day trial
                  <ArrowRightIcon />
                </a>
                <Link
                  href="/solutions"
                  className="inline-flex h-12 items-center justify-center rounded-xl border border-white/25 bg-transparent px-6 text-base font-semibold text-white backdrop-blur transition-colors hover:bg-white/10"
                >
                  Explore all solutions
                </Link>
              </div>
            </div>

            <div className="min-w-0 w-full max-w-full rounded-2xl bg-white p-5 text-slate-900 shadow-xl sm:p-8">
              <h3 className="text-lg font-bold">Prefer to talk it through?</h3>
              <p className="mt-1 text-sm text-slate-500">
                Tell us about your salon and we&rsquo;ll reply within one working day.
              </p>
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
          <Link href="/" className="transition-colors hover:text-slate-900">
            Home
          </Link>
          <Link href="/solutions" className="transition-colors hover:text-slate-900">
            Solutions
          </Link>
          <a href={SIGNUP} className="transition-colors hover:text-slate-900">
            Sign up
          </a>
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

/* ── Icons ────────────────────────────────────────────────────────────── */

function TickIcon({ small = false }: { small?: boolean }) {
  return (
    <svg className={small ? "h-3 w-3" : "h-4 w-4"} fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
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

function ShieldPoundIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12c0 5.25-4 9.75-9 9.75S3 17.25 3 12V6.75l9-3 9 3V12Z" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
      />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z"
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

function UsersIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z"
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
        d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z"
      />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}

function LayoutGridIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 6A2.25 2.25 0 0 1 15.75 3.75H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25h-2.25a2.25 2.25 0 0 1-2.25-2.25v-2.25ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25A2.25 2.25 0 0 1 10.5 15.75v2.25A2.25 2.25 0 0 1 8.25 20.25H6a2.25 2.25 0 0 1-2.25-2.25v-2.25Z"
      />
    </svg>
  );
}

function UserCardIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Zm6-10.125a1.875 1.875 0 1 1-3.75 0 1.875 1.875 0 0 1 3.75 0Zm1.294 6.336a6.721 6.721 0 0 1-3.17.789 6.721 6.721 0 0 1-3.168-.789 3.376 3.376 0 0 1 6.338 0Z"
      />
    </svg>
  );
}

function CalendarCheckIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75M3 18.75V11.25A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5m-9-6 1.5 1.5 3-3"
      />
    </svg>
  );
}
