import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { RESNEO_MARKETING_PAYMENTS_AND_NO_HOLD } from "@/lib/booking-funds-copy";
import {
  LINKED_ACCOUNTS_HMRC_DISCLAIMER,
  LINKED_ACCOUNTS_HMRC_NOTE,
} from "@/lib/linked-accounts-marketing-copy";

const SIGNUP = "/#pricing";

export const metadata: Metadata = {
  title: "Booking Software by Business Type | Resneo Solutions",
  description:
    "See how Resneo works for your trade: salons and barbers, restaurants, and more verticals coming soon. Online booking, deposits, and automated reminders, with no booking commission. Link independent chairs into one booking page and break the link in a click, while everyone keeps separate, HMRC-friendly books.",
  keywords: [
    "booking software solutions",
    "booking system by business type",
    "rent a chair booking software",
    "linked accounts booking software",
    "self-employed booking software",
  ],
  alternates: { canonical: "/solutions" },
  openGraph: {
    title: "Resneo Solutions: Booking Software for Your Business",
    description:
      "Booking software tailored to your business type: salons, barbers, restaurants, and more. Cut no-shows, fill your diary, lose the admin, and link independent chairs while keeping separate books.",
    url: "/solutions",
    type: "website",
  },
};

type Vertical = {
  name: string;
  blurb: string;
  href?: string;
  icon: string;
  status: "live" | "soon";
};

const verticals: Vertical[] = [
  {
    name: "Hair salons & barbers",
    blurb: "Online booking, deposits, and per-stylist availability built for a busy floor, plus rent-a-chair linking that keeps every chair's books separate.",
    href: "/salon-booking-software",
    icon: "💈",
    status: "live",
  },
  {
    name: "Beauty & aesthetics",
    blurb: "Online booking and deposits, with consent forms, medical histories, and patch tests collected automatically before every treatment.",
    href: "/beauty-booking-software",
    icon: "💅",
    status: "live",
  },
  {
    name: "Health & wellbeing",
    blurb: "Physio, massage, and therapy bookings with automatic intake forms, reminders, and clients seen in clinic, online, or at home.",
    href: "/wellness-booking-software",
    icon: "🧘",
    status: "live",
  },
  {
    name: "Restaurants",
    blurb: "Table reservations, deposits, day sheet, and a live floor plan.",
    href: "/restaurant",
    icon: "🍽️",
    status: "live",
  },
  {
    name: "Studios & classes",
    blurb: "Group classes, courses, and memberships with rosters and waitlists.",
    href: "/class-booking-software",
    icon: "🎟️",
    status: "live",
  },
  {
    name: "Courts & venues",
    blurb: "Slot and resource booking for courts, rooms, and hire-by-the-hour spaces.",
    href: "/facility-booking-software",
    icon: "🎾",
    status: "live",
  },
];

/** Capabilities that come with every Resneo plan, regardless of trade. */
const capabilities: {
  title: string;
  description: string;
  icon: (props: { className?: string }) => ReactNode;
}[] = [
  {
    title: "24/7 online booking",
    description:
      "A branded booking page and website or Instagram widget take appointments around the clock, with no app download for your clients.",
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
      "Link independent chairs or practitioners into one booking page, then break the link in a click. Separate books, kept clean for HMRC.",
    icon: LinkIcon,
  },
  {
    title: "No booking commission",
    description:
      "One flat subscription. Resneo never takes a cut of your bookings or rents your clients out to a marketplace.",
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

const comparisons: { name: string; href?: string; status: "live" | "soon" }[] = [
  { name: "Resneo vs marketplace booking apps", href: "/salon-booking-software#compare", status: "live" },
  { name: "Resneo vs spreadsheets & paper diaries", status: "soon" },
  { name: "Switching booking systems: a checklist", status: "soon" },
];

export default function SolutionsHubPage() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* Nav */}
      <nav className="sticky top-0 z-50 border-b border-slate-100 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex-shrink-0">
            <img src="/Logo.png" alt="Resneo" className="h-9 w-auto" />
          </Link>
          <div className="flex items-center gap-2 sm:gap-4">
            <Link
              href="/salon-booking-software"
              className="hidden rounded-xl px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900 sm:inline-flex"
            >
              Salons &amp; barbers
            </Link>
            <Link
              href="/#contact"
              className="hidden rounded-xl px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900 sm:inline-flex"
            >
              Talk to us
            </Link>
            <a
              href={SIGNUP}
              className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
            >
              Start free trial
            </a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-brand-50 via-white to-accent-50/40" />
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(to right, #0f172a 1px, transparent 1px), linear-gradient(to bottom, #0f172a 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
        <div className="relative mx-auto max-w-4xl px-6 py-20 text-center sm:py-24">
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-brand-700 backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            Solutions
          </span>
          <h1 className="mt-6 text-4xl font-extrabold leading-[1.05] tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
            Booking software, tuned to your trade.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-slate-600">
            Resneo is one platform that flexes to how you actually work: take bookings 24/7, cut no-shows,
            and lose the admin. And when independent people share a roof, link them into one booking page and
            break the link in a click, without ever merging anyone&rsquo;s books.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a
              href={SIGNUP}
              className="inline-flex h-12 items-center justify-center rounded-xl bg-brand-600 px-7 text-base font-semibold text-white shadow-lg shadow-brand-600/25 transition-all hover:-translate-y-0.5 hover:bg-brand-700"
            >
              Start your free 14-day trial
              <ArrowRightIcon />
            </a>
            <Link
              href="#by-business-type"
              className="inline-flex h-12 items-center justify-center rounded-xl border border-slate-200 bg-white px-6 text-base font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:text-slate-900"
            >
              Find your business type
            </Link>
          </div>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-slate-500">
            <span className="inline-flex items-center gap-2">
              <TickIcon /> No booking commission
            </span>
            <span className="inline-flex items-center gap-2">
              <TickIcon /> Payments paid direct
            </span>
            <span className="inline-flex items-center gap-2">
              <TickIcon /> Your data stays yours
            </span>
          </div>
        </div>
      </section>

      {/* What every plan gives you */}
      <section className="bg-white py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-accent-700">
              On every Resneo plan
            </h2>
            <p className="mt-3 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              The same dependable toolkit, whatever you book.
            </p>
          </div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {capabilities.map((c) => (
              <div
                key={c.title}
                className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-200"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-100">
                  <c.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-base font-bold text-slate-900">{c.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{c.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Verticals */}
      <section id="by-business-type" className="scroll-mt-16 bg-slate-50 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-accent-700">By business type</h2>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-slate-600">
            Pick your trade for a tailored guide. More verticals are landing soon, and every one runs on the same
            platform underneath.
          </p>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {verticals.map((v) => {
              const inner = (
                <>
                  <div className="flex items-center justify-between">
                    <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-2xl">
                      {v.icon}
                    </span>
                    {v.status === "live" ? null : (
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                        Coming soon
                      </span>
                    )}
                  </div>
                  <h3 className="mt-5 text-lg font-bold text-slate-900">{v.name}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{v.blurb}</p>
                  {v.href ? (
                    <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 group-hover:text-brand-700">
                      Read the guide
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                      </svg>
                    </span>
                  ) : null}
                </>
              );

              return v.href ? (
                <Link
                  key={v.name}
                  href={v.href}
                  className="group flex flex-col rounded-2xl border border-slate-100 bg-white p-6 shadow-sm transition-all hover:-translate-y-1 hover:border-brand-200 hover:shadow-xl hover:shadow-brand-600/5"
                >
                  {inner}
                </Link>
              ) : (
                <div
                  key={v.name}
                  className="flex flex-col rounded-2xl border border-slate-100 bg-slate-50/60 p-6"
                >
                  {inner}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Rent a chair: link & break flagship band */}
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
            <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-white/80 backdrop-blur">
              <LinkIcon className="h-3.5 w-3.5" /> Link &amp; break
            </span>
            <h2 className="mt-6 text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">
              Share a space without sharing the books.
            </h2>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-white/80">
              Rent-a-chair salons, co-located clinics, multi-practitioner studios: when independent people work
              side by side, Resneo links their calendars into one booking page and lets either side break the
              link in a single click. Nothing is ever merged.
            </p>
            <ul className="mt-7 space-y-3">
              {[
                "Each person keeps their own clients, calendar, and takings",
                "One combined booking page under a shared brand",
                "Either side can unlink instantly: access ends, ownership never moves",
                "Payments go directly to each person's own account, never pooled",
              ].map((point) => (
                <li key={point} className="flex items-start gap-3 text-sm text-white/85">
                  <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-accent/20 text-accent-200">
                    <TickIcon small />
                  </span>
                  {point}
                </li>
              ))}
            </ul>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href={SIGNUP}
                className="inline-flex h-12 items-center justify-center rounded-xl bg-white px-7 text-base font-semibold text-slate-900 shadow-lg transition-all hover:-translate-y-0.5 hover:bg-brand-50"
              >
                Start your free 14-day trial
                <ArrowRightIcon />
              </a>
              <Link
                href="/salon-booking-software#linked-accounts"
                className="inline-flex h-12 items-center justify-center rounded-xl border border-white/25 bg-transparent px-6 text-base font-semibold text-white backdrop-blur transition-colors hover:bg-white/10"
              >
                See how it works
              </Link>
            </div>
          </div>

          {/* HMRC callout card */}
          <div className="rounded-3xl border border-white/10 bg-white p-7 text-slate-900 shadow-2xl shadow-slate-900/40 sm:p-9">
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
            <div className="mt-5 grid grid-cols-2 gap-3">
              {[
                { label: "Books per person", value: "Separate" },
                { label: "Takings", value: "Paid direct" },
                { label: "Shared till", value: "Never" },
                { label: "Unlink", value: "One click" },
              ].map((stat) => (
                <div key={stat.label} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{stat.label}</p>
                  <p className="mt-1 text-sm font-bold text-brand-700">{stat.value}</p>
                </div>
              ))}
            </div>
            <p className="mt-5 text-xs leading-relaxed text-slate-400">{LINKED_ACCOUNTS_HMRC_DISCLAIMER}</p>
          </div>
        </div>
      </section>

      {/* Comparisons */}
      <section className="bg-slate-50 py-16 sm:py-20">
        <div className="mx-auto max-w-4xl px-6">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-accent-700">
            Resneo vs the alternatives
          </h2>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-slate-600">
            Weighing up your options? These guides lay out how Resneo compares, honestly.
          </p>
          <div className="mt-8 space-y-3">
            {comparisons.map((c) =>
              c.href ? (
                <Link
                  key={c.name}
                  href={c.href}
                  className="group flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-5 transition-colors hover:border-brand-200"
                >
                  <span className="text-sm font-semibold text-slate-800 sm:text-base">{c.name}</span>
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600">
                    Compare
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                    </svg>
                  </span>
                </Link>
              ) : (
                <div
                  key={c.name}
                  className="flex items-center justify-between rounded-2xl border border-slate-100 bg-white/60 p-5"
                >
                  <span className="text-sm font-semibold text-slate-500 sm:text-base">{c.name}</span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Coming soon
                  </span>
                </div>
              ),
            )}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-white py-20 sm:py-24">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Not sure which fits? We will help.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-slate-600">
            Tell us about your business and we will point you to the right setup, or just start your free
            trial and explore.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a
              href={SIGNUP}
              className="inline-flex h-12 items-center justify-center rounded-xl bg-brand-600 px-7 text-base font-semibold text-white shadow-lg shadow-brand-600/25 transition-all hover:-translate-y-0.5 hover:bg-brand-700"
            >
              Start your free 14-day trial
            </a>
            <Link
              href="/#contact"
              className="inline-flex h-12 items-center justify-center rounded-xl border border-slate-200 bg-white px-6 text-base font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300"
            >
              Talk to us
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-100 bg-slate-50 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-6 text-sm text-slate-500 sm:flex-row sm:justify-between">
          <p className="max-w-xl text-center leading-snug sm:text-left">
            &copy; 2026 Resneo · JAR 26 LTD (NI740269) · 100a Main Street, Bangor, BT20 4AG, UK
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 sm:justify-end">
            <Link href="/" className="transition-colors hover:text-slate-900">
              Home
            </Link>
            <Link href="/salon-booking-software" className="transition-colors hover:text-slate-900">
              Salons &amp; barbers
            </Link>
            <Link href="/about" className="transition-colors hover:text-slate-900">
              About
            </Link>
            <a href={SIGNUP} className="transition-colors hover:text-slate-900">
              Sign up
            </a>
            <Link href="/login" className="transition-colors hover:text-slate-900">
              Login
            </Link>
            <Link href="/terms" className="transition-colors hover:text-slate-900">
              Website Terms of Use
            </Link>
            <Link href="/privacy" className="transition-colors hover:text-slate-900">
              Privacy Policy
            </Link>
          </div>
        </div>
      </footer>
    </div>
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

function LinkIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
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
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
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
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12c0 5.25-4 9.75-9 9.75S3 17.25 3 12V6.75l9-3 9 3V12Z" />
    </svg>
  );
}

function MoonIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
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
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
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
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
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
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 6A2.25 2.25 0 0 1 15.75 3.75H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25h-2.25a2.25 2.25 0 0 1-2.25-2.25v-2.25ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25A2.25 2.25 0 0 1 10.5 15.75v2.25A2.25 2.25 0 0 1 8.25 20.25H6a2.25 2.25 0 0 1-2.25-2.25v-2.25Z"
      />
    </svg>
  );
}
