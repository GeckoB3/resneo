import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { MarketingNav } from "@/components/marketing/MarketingNav";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { RESNEO_MARKETING_PAYMENTS_AND_NO_HOLD } from "@/lib/booking-funds-copy";
import { LINKED_ACCOUNTS_SEPARATE_BOOKS_NOTE } from "@/lib/linked-accounts-marketing-copy";
import { SUBSCRIPTION_CANCELLATION_PUBLIC_NOTICE } from "@/lib/subscription-cancellation-copy";
import { STANDARD_PAYMENT_PROVIDER_FEES_NOTICE } from "@/lib/payment-provider-fees-notice";
import { SIGNUP_TRIAL_SHORT_LABEL } from "@/lib/signup-trial-copy";
import { APPOINTMENTS_LIGHT_PRICE } from "@/lib/pricing-constants";
import { PUBLIC_SITE_ORIGIN as SITE_ORIGIN } from "@/lib/public-base-url";

const PAGE_PATH = "/solutions";
const SIGNUP = "/#pricing";

export const metadata: Metadata = {
  title: "Booking Software by Business Type | ResNeo Solutions",
  description:
    "See how ResNeo works for your trade: salons and barbers, beauty, wellbeing, classes, courts and restaurants. Online booking, deposits, and automated reminders, with no booking commission. Link independent chairs into one booking page and break the link in a click, while everyone keeps their own separate books.",
  keywords: [
    "booking software solutions",
    "booking system by business type",
    "rent a chair booking software",
    "linked accounts booking software",
    "self-employed booking software",
  ],
  alternates: { canonical: PAGE_PATH },
  openGraph: {
    title: "ResNeo Solutions: Booking Software for Your Business",
    description:
      "Booking software tailored to your business type: salons, barbers, beauty, wellbeing, classes, courts and restaurants. Cut no-shows, fill your diary, lose the admin, and link independent chairs while keeping separate books.",
    url: PAGE_PATH,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ResNeo Solutions: Booking Software for Your Business",
    description:
      "Booking software tailored to your business type. No booking commission, and your clients stay yours.",
  },
};

/* ────────────────────────────────────────────────────────────────────────
   Content data
   ──────────────────────────────────────────────────────────────────────── */

type Vertical = {
  name: string;
  /** Short line used on the in-hero jump chips. */
  short: string;
  blurb: string;
  href: string;
  /** Three concrete capabilities, each mirrored on the linked page. */
  highlights: [string, string, string];
  icon: (props: { className?: string }) => ReactNode;
  /** Brand-palette gradient for the icon tile, varied so the grid reads as six distinct trades. */
  tile: string;
};

const verticals: Vertical[] = [
  {
    name: "Hair salons & barbers",
    short: "Salons & barbers",
    blurb:
      "Online booking, deposits, and per-stylist availability for a busy floor, plus rent-a-chair linking that keeps every chair separate.",
    href: "/salon-booking-software",
    highlights: ["Per-stylist availability", "Deposits", "Rent-a-chair linking"],
    icon: ScissorsIcon,
    tile: "from-brand-600 to-brand-800",
  },
  {
    name: "Beauty & aesthetics",
    short: "Beauty",
    blurb:
      "Online booking and deposits, with consent forms, medical histories, and patch tests collected before every treatment.",
    href: "/beauty-booking-software",
    highlights: ["Consent forms", "Patch tests", "Medical histories"],
    icon: SparkleIcon,
    tile: "from-brand-500 to-accent-800",
  },
  {
    name: "Health & wellbeing",
    short: "Wellbeing",
    blurb:
      "Physio, massage, and therapy bookings with automatic intake forms and reminders, for clients seen in clinic, online, or at home.",
    href: "/wellness-booking-software",
    highlights: ["Intake forms", "Clinic, online or at home", "Automated reminders"],
    icon: PulseIcon,
    tile: "from-accent-700 to-brand-700",
  },
  {
    name: "Studios & classes",
    short: "Classes",
    blurb:
      "Group classes, courses, and memberships, with live rosters, automatic waitlists, and every recurring session set up once.",
    href: "/class-booking-software",
    highlights: ["Rosters", "Waitlists", "Memberships"],
    icon: UsersIcon,
    tile: "from-brand-600 to-accent-700",
  },
  {
    name: "Courts & venues",
    short: "Courts & venues",
    blurb:
      "Slot and resource booking for courts, rooms, and hire-by-the-hour spaces, with per-resource availability and buffers.",
    href: "/facility-booking-software",
    highlights: ["Court & room slots", "Hire by the hour", "Resource booking"],
    icon: CourtIcon,
    tile: "from-accent-800 to-brand-800",
  },
  {
    name: "Restaurants",
    short: "Restaurants",
    blurb:
      "Table reservations and deposits that protect covers, with a day sheet and a live floor plan to run the room through service.",
    href: "/restaurant",
    highlights: ["Table reservations", "Live floor plan", "Day sheet"],
    icon: TableIcon,
    tile: "from-brand-700 to-brand-900",
  },
];

/** Capabilities that come with every ResNeo plan, regardless of trade. */
const capabilities: {
  title: string;
  description: string;
  icon: (props: { className?: string }) => ReactNode;
}[] = [
  {
    title: "24/7 online booking",
    description:
      "A branded booking page you can embed on your website and link from Instagram takes appointments around the clock, with no app download for your clients.",
    icon: MoonIcon,
  },
  {
    title: "Deposits & reminders",
    description: `Stripe deposits and automated SMS and email reminders cut no-shows. ${RESNEO_MARKETING_PAYMENTS_AND_NO_HOLD}`,
    icon: ShieldPoundIcon,
  },
  {
    title: "Linked accounts: link & break",
    description:
      "Link independent chairs or practitioners into one booking page, then break the link in a click. Separate books, with everyone keeping full control of their clients and revenue.",
    icon: LinkIcon,
  },
  {
    title: "No booking commission",
    // payment-provider-fees-notice.ts requires this notice wherever "no
    // commission" appears, so processor charges are not implied to be zero.
    description: `One flat subscription. ResNeo never takes a cut of your bookings or rents your clients out to a marketplace. ${STANDARD_PAYMENT_PROVIDER_FEES_NOTICE}`,
    icon: TagIcon,
  },
  {
    title: "Your data stays yours",
    description:
      "Clients, bookings, and takings belong to you. Linking shares access, never ownership. Unlink and you simply keep what was always yours.",
    icon: DatabaseIcon,
  },
  {
    title: "One platform, every model",
    description:
      "Appointments, classes, events, resources, and restaurant tables: flip on the booking models you need as you grow.",
    icon: GridIcon,
  },
];

/** Longer-form guides that live under the solutions hub. */
const guides: { name: string; blurb: string; href: string; meta: string }[] = [
  {
    name: "Is your salon accidentally employing your chair renters?",
    blurb:
      "What HMRC actually checks in a chair rental arrangement, what reclassification costs, and why your booking system is part of the picture.",
    href: "/solutions/salon-chair-rental-hmrc-employment-status",
    meta: "Salons & barbers · 6 min read",
  },
  {
    name: "What is a subscription plus commission booking platform actually costing you?",
    blurb:
      "Some class and wellness platforms charge a subscription per location, then take a cut of the bookings their own app brings you. How the two layers work, and what to check on your bill.",
    href: "/solutions/fitness-studio-booking-software-true-cost",
    meta: "Studios, gyms & clinics · 7 min read",
  },
];

/** Only ships comparisons that exist. Placeholders belong in the backlog, not the page. */
const comparisons: { name: string; href: string }[] = [
  { name: "ResNeo vs marketplace booking apps", href: "/salon-booking-software#compare" },
];

/**
 * Structured data: the hub itself, its place under the homepage, and the six
 * vertical pages as an ordered list so search engines can surface them.
 *
 * URLs must be absolute. metadataBase rewrites Next's own metadata, but it never
 * touches a raw ld+json payload, so relative paths here would simply be invalid.
 */
const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_ORIGIN}/` },
        { "@type": "ListItem", position: 2, name: "Solutions", item: `${SITE_ORIGIN}${PAGE_PATH}` },
      ],
    },
    {
      "@type": "ItemList",
      name: "ResNeo booking software by business type",
      itemListElement: verticals.map((v, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: v.name,
        url: `${SITE_ORIGIN}${v.href}`,
      })),
    },
  ],
};

/* ────────────────────────────────────────────────────────────────────────
   Page
   ──────────────────────────────────────────────────────────────────────── */

export default function SolutionsHubPage() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <MarketingNav
        currentHref="/solutions"
        extraLink={{ href: "#by-business-type", label: "By business type" }}
      />
      <Hero />
      <VerticalsSection />
      <CapabilitiesSection />
      <LinkBreakBand />
      <GuidesSection />
      <ComparisonsSection />
      <ClosingCta />
      <MarketingFooter />
    </div>
  );
}

/* ── Hero ─────────────────────────────────────────────────────────────── */

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-brand-50 via-white to-accent-50/50" />
      <div
        className="absolute inset-0 opacity-70"
        style={{
          backgroundImage:
            "radial-gradient(circle at 12% 16%, rgba(0,59,111,0.16) 0%, transparent 46%), radial-gradient(circle at 88% 8%, rgba(0,194,199,0.16) 0%, transparent 44%), radial-gradient(circle at 62% 100%, rgba(0,59,111,0.10) 0%, transparent 52%)",
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            "linear-gradient(to right, #0f172a 1px, transparent 1px), linear-gradient(to bottom, #0f172a 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />
      {/* Soft horizon so the hero melts into the card grid below. */}
      <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-white" />

      {/* Tight top padding below sm so the primary CTA clears an 812px phone
          viewport. The trade chips sit under the CTA rather than above it: they
          duplicate the card grid further down, so they must not push it. */}
      <div className="relative mx-auto grid max-w-6xl gap-12 px-6 pb-16 pt-10 sm:pb-20 sm:pt-16 lg:grid-cols-5 lg:gap-10 lg:pt-20">
        <div className="lg:col-span-3">
          <nav aria-label="Breadcrumb" className="text-xs font-medium text-slate-500">
            <ol className="flex items-center gap-1.5">
              <li>
                <Link href="/" className="inline-flex min-h-11 items-center rounded hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
                  Home
                </Link>
              </li>
              <li aria-hidden className="text-slate-300">
                /
              </li>
              <li className="text-slate-700">Solutions</li>
            </ol>
          </nav>

          <span className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-brand-700 backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-accent-600" />
            Solutions
          </span>
          <h1 className="mt-5 text-4xl font-extrabold leading-[1.05] tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
            Booking software,{" "}
            <span className="bg-gradient-to-r from-brand-700 via-brand-600 to-accent-700 bg-clip-text text-transparent">
              tuned to your trade.
            </span>
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-600">
            ResNeo is one platform that flexes to how you actually work: take bookings 24/7, cut
            no-shows, and lose the admin. And when independent people share a roof, link them into
            one booking page and break the link in a click, without ever merging anyone&rsquo;s
            books.
          </p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <a
              href={SIGNUP}
              className="inline-flex h-12 items-center justify-center rounded-xl bg-brand-600 px-7 text-base font-semibold text-white shadow-lg shadow-brand-600/25 transition-all hover:bg-brand-700 motion-safe:hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              Start your {SIGNUP_TRIAL_SHORT_LABEL}
              <ArrowRightIcon />
            </a>
            <a
              href="#by-business-type"
              className="inline-flex h-12 items-center justify-center rounded-xl border border-slate-200 bg-white px-6 text-base font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              Browse business types
            </a>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-slate-600">
            <span className="inline-flex items-center gap-2">
              <TickIcon /> No booking commission
            </span>
            <span className="inline-flex items-center gap-2">
              <TickIcon /> Payments paid direct
            </span>
            <span className="inline-flex items-center gap-2">
              <TickIcon /> From &pound;{APPOINTMENTS_LIGHT_PRICE} a month
            </span>
          </div>

          <ul className="mt-8 flex flex-wrap items-center gap-2">
            {verticals.map((v) => (
              <li key={v.href}>
                <Link
                  href={v.href}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full border border-slate-200 bg-white/90 px-4 text-sm font-semibold text-slate-700 shadow-sm backdrop-blur transition-all hover:border-brand-300 hover:text-brand-700 motion-safe:hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                >
                  <v.icon className="h-4 w-4 text-brand-600" />
                  {v.short}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="lg:col-span-2">
          <HeroBookingVisual />
        </div>
      </div>
    </section>
  );
}

/**
 * The hub was the only marketing page that never showed the product. This is the
 * shared booking page every trade gets: service list, live slot grid, deposit
 * line. Decorative, so it is hidden from assistive tech, and every label is
 * generic rather than naming a venue that does not exist.
 */
function HeroBookingVisual() {
  const slots = ["09:00", "10:30", "12:00", "13:30", "15:00", "16:30"];
  return (
    <div aria-hidden className="relative mx-auto w-full max-w-sm">
      <div className="absolute -inset-4 rounded-[2.5rem] bg-gradient-to-tr from-brand-200/60 via-white/0 to-accent-200/50 blur-2xl" />

      <div className="relative rounded-[2.25rem] border border-slate-200 bg-slate-900 p-2 shadow-2xl shadow-brand-900/25">
        <div className="overflow-hidden rounded-[1.85rem] bg-white">
          {/* Branded header */}
          <div className="bg-gradient-to-br from-brand-600 to-brand-800 px-5 pb-5 pt-4 text-white">
            <div className="flex items-center justify-between text-[10px] font-semibold text-white/70">
              <span>9:41</span>
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-accent-400" />
                Your booking page
              </span>
            </div>
            <p className="mt-4 text-base font-bold">Book an appointment</p>
            <p className="mt-1 text-xs text-white/70">Choose a service, then a time.</p>
          </div>

          {/* Service list */}
          <div className="space-y-2 px-4 pt-4">
            {[
              { name: "Consultation", meta: "30 min" },
              { name: "Full treatment", meta: "1 hr 15" },
            ].map((s, i) => (
              <div
                key={s.name}
                className={`flex items-center justify-between rounded-xl border px-3 py-2.5 ${
                  i === 1 ? "border-brand-300 bg-brand-50" : "border-slate-200 bg-white"
                }`}
              >
                <div>
                  <p className="text-xs font-bold text-slate-900">{s.name}</p>
                  <p className="text-[10px] text-slate-500">{s.meta}</p>
                </div>
                <span
                  className={`h-4 w-4 rounded-full border-2 ${
                    i === 1 ? "border-brand-600 bg-brand-600" : "border-slate-300"
                  }`}
                />
              </div>
            ))}
          </div>

          {/* Slot grid */}
          <div className="px-4 pt-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Thursday
            </p>
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              {slots.map((t, i) => (
                <span
                  key={t}
                  className={`rounded-lg py-1.5 text-center text-[11px] font-semibold ${
                    i === 2
                      ? "bg-brand-600 text-white"
                      : i === 4
                        ? "bg-slate-100 text-slate-300 line-through"
                        : "bg-slate-50 text-slate-700 ring-1 ring-slate-200"
                  }`}
                >
                  {t}
                </span>
              ))}
            </div>
          </div>

          {/* Deposit + confirm */}
          <div className="mt-4 border-t border-slate-100 bg-slate-50 px-4 py-3">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-semibold text-slate-600">Deposit to confirm</span>
              <span className="font-bold text-slate-900">&pound;15</span>
            </div>
            <div className="mt-2 rounded-xl bg-brand-600 py-2 text-center text-xs font-bold text-white">
              Confirm booking
            </div>
            <p className="mt-2 text-center text-[9px] leading-tight text-slate-500">
              Paid direct to the business. ResNeo does not hold booking money.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── By business type ─────────────────────────────────────────────────── */

function SectionHeading({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="max-w-2xl">
      <p className="text-xs font-semibold uppercase tracking-widest text-accent-700">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">{title}</h2>
      {children ? (
        <p className="mt-4 text-base leading-relaxed text-slate-600">{children}</p>
      ) : null}
    </div>
  );
}

function VerticalsSection() {
  return (
    <section id="by-business-type" className="scroll-mt-16 bg-white pb-20 pt-4 sm:pb-24">
      <div className="mx-auto max-w-6xl px-6">
        <SectionHeading eyebrow="By business type" title="Find your trade.">
          Every trade runs on the same platform underneath. The difference is what we switch on, and
          which guide explains it in your language.
        </SectionHeading>

        <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {verticals.map((v) => (
            <li key={v.href} className="flex">
              <Link
                href={v.href}
                // Without this the whole card (icon, blurb, every chip) becomes
                // one 232-character link name, read out six times over.
                aria-label={v.name}
                className="group relative flex w-full flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition-all hover:border-brand-300 hover:shadow-xl hover:shadow-brand-600/10 motion-safe:hover:-translate-y-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                {/* Brand wash that blooms on hover, kept behind the content. */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-gradient-to-br from-brand-100 to-accent-100 opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100"
                />

                <span className="relative flex items-start justify-between">
                  <span
                    className={`flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-lg shadow-brand-900/15 ${v.tile}`}
                  >
                    <v.icon className="h-7 w-7" />
                  </span>
                  <span className="mt-1 flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-400 transition-all group-hover:border-brand-300 group-hover:bg-brand-600 group-hover:text-white">
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={2.5}
                      stroke="currentColor"
                      aria-hidden
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3"
                      />
                    </svg>
                  </span>
                </span>

                <h3 className="relative mt-5 text-lg font-bold text-slate-900 group-hover:text-brand-700">
                  {v.name}
                </h3>
                <p className="relative mb-5 mt-2 text-sm leading-relaxed text-slate-600">
                  {v.blurb}
                </p>

                {/* mt-auto pins the chips and the CTA to the card floor, so the
                    six cards line up despite blurbs of different lengths. */}
                <span className="relative mt-auto flex min-h-[4.5rem] flex-wrap content-start gap-1.5 border-t border-slate-100 pt-4">
                  {v.highlights.map((h) => (
                    <span
                      key={h}
                      className="rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200/70"
                    >
                      {h}
                    </span>
                  ))}
                </span>

                <span className="relative mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 group-hover:text-brand-700">
                  See how it works
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ── On every plan ────────────────────────────────────────────────────── */

function CapabilitiesSection() {
  return (
    <section className="border-y border-slate-100 bg-slate-50 py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-accent-700">
            On every ResNeo plan
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            The same dependable toolkit, whatever you book.
          </h2>
        </div>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {capabilities.map((c) => (
            <div
              key={c.title}
              className="group rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all hover:border-brand-200 hover:shadow-lg hover:shadow-brand-600/5 motion-safe:hover:-translate-y-0.5"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-100 transition-colors group-hover:bg-brand-600 group-hover:text-white">
                <c.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-base font-bold text-slate-900">{c.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{c.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Link & break ─────────────────────────────────────────────────────── */

function LinkBreakBand() {
  return (
    <section className="relative overflow-hidden bg-slate-900 py-20 text-white sm:py-24">
      <div
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "radial-gradient(circle at 22% 30%, rgba(0,59,111,0.7) 0%, transparent 50%), radial-gradient(circle at 84% 72%, rgba(0,194,199,0.28) 0%, transparent 50%)",
        }}
      />
      <div className="relative mx-auto grid max-w-6xl gap-12 px-6 lg:grid-cols-2 lg:items-center lg:gap-16">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-white/90 backdrop-blur">
            <LinkIcon className="h-3.5 w-3.5" /> Link &amp; break
          </span>
          <h2 className="mt-6 text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">
            Share a space without sharing the books.
          </h2>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-white/80">
            Rent-a-chair salons, co-located clinics, multi-practitioner studios: when independent
            people work side by side, ResNeo links their calendars into one booking page and lets
            either side break the link in a single click. Nothing is ever merged.
          </p>
          <ul className="mt-7 space-y-3">
            {[
              "Each person keeps their own clients, calendar, and takings",
              "One combined booking page under a shared brand",
              "Either side can unlink instantly: access ends, ownership never moves",
              "Payments go directly to each person's own account, never pooled",
            ].map((point) => (
              <li key={point} className="flex items-start gap-3 text-sm text-white/90">
                <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-accent-400/25 text-accent-200">
                  <TickIcon small />
                </span>
                {point}
              </li>
            ))}
          </ul>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a
              href={SIGNUP}
              className="inline-flex h-12 items-center justify-center rounded-xl bg-white px-7 text-base font-semibold text-slate-900 shadow-lg transition-all hover:bg-brand-50 motion-safe:hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              Start your {SIGNUP_TRIAL_SHORT_LABEL}
              <ArrowRightIcon />
            </a>
            <Link
              href="/salon-booking-software#linked-accounts"
              className="inline-flex h-12 items-center justify-center rounded-xl border border-white/30 bg-transparent px-6 text-base font-semibold text-white backdrop-blur transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              See how it works
            </Link>
          </div>
        </div>

        {/* Separate-books callout card */}
        <div className="rounded-3xl border border-white/10 bg-white p-7 text-slate-900 shadow-2xl shadow-slate-900/40 sm:p-9">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white shadow-md shadow-brand-600/25">
              <ShieldCheckIcon />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-accent-700">
                Built for independents
              </p>
              <h3 className="text-xl font-bold text-slate-900">Clean, separate books for everyone</h3>
            </div>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-slate-600">
            {LINKED_ACCOUNTS_SEPARATE_BOOKS_NOTE}
          </p>
          <dl className="mt-5 grid grid-cols-2 gap-3">
            {[
              { label: "Books per person", value: "Separate" },
              { label: "Takings", value: "Paid direct" },
              { label: "Shared till", value: "Never" },
              { label: "Unlink", value: "One click" },
            ].map((stat) => (
              <div key={stat.label} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                  {stat.label}
                </dt>
                <dd className="mt-1 text-sm font-bold text-brand-700">{stat.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

/* ── Guides ───────────────────────────────────────────────────────────── */

function GuidesSection() {
  return (
    <section id="guides" className="scroll-mt-16 bg-white py-16 sm:py-20">
      <div className="mx-auto max-w-4xl px-6">
        {/* No reading time in the title: the card below states the real one. */}
        <SectionHeading eyebrow="Guide" title="A longer read, worth your coffee break.">
          The questions that actually keep owners up at night, written out properly.
        </SectionHeading>
        <div className="mt-8 space-y-4">
          {guides.map((g) => (
            <Link
              key={g.href}
              href={g.href}
              className="group block rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all hover:border-brand-300 hover:shadow-lg hover:shadow-brand-600/5 motion-safe:hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{g.meta}</p>
              <h3 className="mt-2 text-lg font-bold text-slate-900 group-hover:text-brand-700">
                {g.name}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{g.blurb}</p>
              <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600">
                Read the guide
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2.5}
                  stroke="currentColor"
                  aria-hidden
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3"
                  />
                </svg>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Comparisons ──────────────────────────────────────────────────────── */

function ComparisonsSection() {
  return (
    <section className="border-t border-slate-100 bg-slate-50 py-16 sm:py-20">
      <div className="mx-auto max-w-4xl px-6">
        <SectionHeading eyebrow="ResNeo vs the alternatives" title="Weighing up your options?">
          An honest look at how ResNeo compares.
        </SectionHeading>
        <div className="mt-8 space-y-3">
          {comparisons.map((c) => (
            <Link
              key={c.name}
              href={c.href}
              className="group flex min-h-14 items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 transition-colors hover:border-brand-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              <span className="text-sm font-semibold text-slate-800 sm:text-base">{c.name}</span>
              <span className="inline-flex flex-shrink-0 items-center gap-1.5 text-sm font-semibold text-brand-600">
                Compare
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2.5}
                  stroke="currentColor"
                  aria-hidden
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3"
                  />
                </svg>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Closing CTA ──────────────────────────────────────────────────────── */

function ClosingCta() {
  return (
    <section className="bg-white py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-brand-800 to-brand-900 px-6 py-14 text-center text-white shadow-2xl shadow-brand-900/25 sm:px-10 sm:py-16">
          <div
            className="absolute inset-0 opacity-40"
            style={{
              backgroundImage:
                "radial-gradient(circle at 20% 20%, rgba(0,194,199,0.25) 0%, transparent 45%), radial-gradient(circle at 80% 80%, rgba(0,59,111,0.6) 0%, transparent 50%)",
            }}
          />
          <div className="relative mx-auto max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Not sure which fits? We will help.
            </h2>
            <p className="mx-auto mt-4 text-base leading-relaxed text-white/80">
              Tell us about your business and we will point you to the right setup, or just start
              your free trial and explore. {SUBSCRIPTION_CANCELLATION_PUBLIC_NOTICE}
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a
                href={SIGNUP}
                className="inline-flex h-12 items-center justify-center rounded-xl bg-white px-7 text-base font-semibold text-slate-900 shadow-lg transition-all hover:bg-brand-50 motion-safe:hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                Start your {SIGNUP_TRIAL_SHORT_LABEL}
                <ArrowRightIcon />
              </a>
              <Link
                href="/#contact"
                className="inline-flex h-12 items-center justify-center rounded-xl border border-white/30 px-6 text-base font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                Talk to us
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Icons ────────────────────────────────────────────────────────────── */

function TickIcon({ small = false }: { small?: boolean }) {
  return (
    <svg
      className={small ? "h-3 w-3" : "h-4 w-4"}
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

function ArrowRightIcon() {
  return (
    <svg
      className="ml-2 h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2.5}
      stroke="currentColor"
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
    </svg>
  );
}

function LinkIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.8}
      stroke="currentColor"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"
      />
    </svg>
  );
}

function ShieldCheckIcon() {
  return (
    <svg
      className="h-6 w-6"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.249-8.25-3.285Z"
      />
    </svg>
  );
}

function ShieldPoundIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75 11.25 15 15 9.75M21 12c0 5.25-4 9.75-9 9.75S3 17.25 3 12V6.75l9-3 9 3V12Z"
      />
    </svg>
  );
}

function MoonIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75 9.75 9.75 0 0 1 8.25 6c0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.636 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z"
      />
    </svg>
  );
}

function TagIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      aria-hidden
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

function DatabaseIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125"
      />
    </svg>
  );
}

function GridIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 6A2.25 2.25 0 0 1 15.75 3.75H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25h-2.25a2.25 2.25 0 0 1-2.25-2.25v-2.25ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25A2.25 2.25 0 0 1 10.5 15.75v2.25A2.25 2.25 0 0 1 8.25 20.25H6a2.25 2.25 0 0 1-2.25-2.25v-2.25Z"
      />
    </svg>
  );
}

/* Trade icons: hand-built line marks so the grid reads as a professional set
   rather than a row of emoji. */

function ScissorsIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.6}
      stroke="currentColor"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7.848 8.25l1.536.887M7.848 8.25a3 3 0 1 1-5.196-3 3 3 0 0 1 5.196 3Zm1.536.887a2.165 2.165 0 0 1 1.083 1.839c.005.351.054.695.14 1.024M9.384 9.137l2.077 1.199M7.848 15.75l1.536-.887m-1.536.887a3 3 0 1 1-5.196 3 3 3 0 0 1 5.196-3Zm1.536-.887a2.165 2.165 0 0 0 1.083-1.838c.005-.352.054-.695.14-1.025m-1.223 2.863 2.077-1.199m0-2.63 4.5-2.598m-4.5 2.598 4.5 2.598M21.75 4.5l-6.75 3.897m0 7.206L21.75 19.5"
      />
    </svg>
  );
}

function SparkleIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.6}
      stroke="currentColor"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z"
      />
    </svg>
  );
}

function PulseIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.6}
      stroke="currentColor"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 .626.079 1.232.229 1.811M3.75 14.25h3l1.5-3 2.25 6 2.25-4.5 1.5 1.5h5.25"
      />
    </svg>
  );
}

function UsersIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.6}
      stroke="currentColor"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"
      />
    </svg>
  );
}

function CourtIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.6}
      stroke="currentColor"
      aria-hidden
    >
      <rect x="3" y="4.5" width="18" height="15" rx="1.5" />
      <path strokeLinecap="round" d="M12 4.5v15M3 12h18" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 9.75h9v4.5h-9z" />
    </svg>
  );
}

function TableIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.6}
      stroke="currentColor"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6.75 3v6a2.25 2.25 0 0 0 4.5 0V3M9 9v12M17.25 3c-1.243 0-2.25 1.79-2.25 4s1.007 4 2.25 4V3Zm0 0v18"
      />
    </svg>
  );
}
