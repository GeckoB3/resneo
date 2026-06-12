import type { Metadata } from "next";
import Link from "next/link";

const SIGNUP = "/#pricing";

export const metadata: Metadata = {
  title: "Booking Software by Business Type | Resneo Solutions",
  description:
    "See how Resneo works for your trade — salons and barbers, and more verticals coming soon. Online booking, deposits, and automated reminders, with no booking commission.",
  alternates: { canonical: "/solutions" },
  openGraph: {
    title: "Resneo Solutions — Booking Software for Your Business",
    description:
      "Booking software tailored to your business type: salons, barbers, and more. Cut no-shows, fill your diary, and lose the admin.",
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
    blurb: "Online booking, deposits, and per-stylist availability built for a busy floor.",
    href: "/salon-booking-software",
    icon: "💈",
    status: "live",
  },
  {
    name: "Beauty & aesthetics",
    blurb: "Treatment menus, patch-test notes, and deposits for clinics and beauty studios.",
    icon: "💅",
    status: "soon",
  },
  {
    name: "Health & wellbeing",
    blurb: "Physio, massage, and therapy bookings with reminders and client records.",
    icon: "🧘",
    status: "soon",
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
    icon: "🎟️",
    status: "soon",
  },
  {
    name: "Courts & venues",
    blurb: "Slot and resource booking for courts, rooms, and hire-by-the-hour spaces.",
    icon: "🎾",
    status: "soon",
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
            Resneo is one platform that flexes to how you actually work. Explore the guides below to see how
            it fits your business, or compare Resneo with the alternatives.
          </p>
        </div>
      </section>

      {/* Verticals */}
      <section className="bg-white py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-accent-700">By business type</h2>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {verticals.map((v) => {
              const inner = (
                <>
                  <div className="flex items-center justify-between">
                    <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-2xl">
                      {v.icon}
                    </span>
                    {v.status === "live" ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-accent-700">
                        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                        Guide live
                      </span>
                    ) : (
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

      {/* Comparisons */}
      <section className="bg-slate-50 py-16 sm:py-20">
        <div className="mx-auto max-w-4xl px-6">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-accent-700">
            Resneo vs the alternatives
          </h2>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-slate-600">
            Weighing up your options? These guides lay out how Resneo compares — honestly.
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
            Tell us about your business and we will point you to the right setup — or just start your free
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
            <Link href="/about" className="transition-colors hover:text-slate-900">
              About
            </Link>
            <a href={SIGNUP} className="transition-colors hover:text-slate-900">
              Sign up
            </a>
            <Link href="/login" className="transition-colors hover:text-slate-900">
              Login
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
