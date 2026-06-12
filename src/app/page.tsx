import Link from "next/link";
import Script from "next/script";
import ContactForm from "@/components/ContactForm";
import { EMBED_IFRAME_DEFAULT_HEIGHT_PX } from "@/lib/embed/widget-frame";
import { normalizePublicBaseUrl } from "@/lib/public-base-url";
import HomeFaq from "@/components/home/HomeFaq";
import { PricingSection } from "@/components/home/PricingSection";
import { HomeReveal } from "@/components/home/HomeReveal";
import {
  BookingConfirmedCard,
  BookingFlowMock,
  CalendarMock,
  DepositCard,
  ReminderMock,
} from "@/components/home/HomeGraphics";
import { RESNEO_MARKETING_PAYMENTS_AND_NO_HOLD } from "@/lib/booking-funds-copy";
import { STANDARD_PAYMENT_PROVIDER_FEES_NOTICE } from "@/lib/payment-provider-fees-notice";

/**
 * "Book a demo" embed: the Resneo Demo venue (resneodemo@resneo.com) booking widget,
 * same origin as the dashboard embed snippet — on production this is the live venue.
 */
const demoPublicOrigin = normalizePublicBaseUrl(process.env.NEXT_PUBLIC_BASE_URL);
const demoEmbedSrc = `${demoPublicOrigin}/embed/resneo-demo?start=service`;
const demoResizeScriptSrc = `${demoPublicOrigin}/embed/resize.js`;

/** Secondary platform capabilities shown as a compact icon grid. */
const platformFeatures = [
  {
    title: "Deposit collection",
    description: `Per-head deposits via Stripe Connect. ${RESNEO_MARKETING_PAYMENTS_AND_NO_HOLD}`,
    icon: CreditCardIcon,
  },
  {
    title: "Smart communications",
    description:
      "Automated confirmations, deposit requests, reminders, and post-visit messages across email and SMS.",
    icon: ChatIcon,
  },
  {
    title: "Real-time dashboard",
    description:
      "Bookings, calendars, client records, and reporting in one place, updated live as bookings come in.",
    icon: DashboardIcon,
  },
  {
    title: "Easy setup",
    description: "Embed the booking widget on your website or print a QR code. Up and running in minutes.",
    icon: BoltIcon,
  },
  {
    title: "Any bookable business",
    description: "Barbers, salons, studios, clinics, courts, escape rooms, and restaurants. If it's bookable, Resneo handles it.",
    icon: GridIcon,
  },
  {
    title: "Honest, human support",
    description: "Real people who know the product, with no commissions and no hidden fees.",
    icon: LifebuoyIcon,
  },
];

const businessTypes = [
  "Barbers", "Hairdressers", "Beauty Therapists", "Physiotherapists",
  "Yoga Studios", "Gyms", "Tennis Courts", "Escape Rooms", "Dog Groomers",
  "Photography Studios", "Meeting Rooms", "Golf Tee Times", "Driving Instructors", "Restaurants",
];

const steps = [
  {
    number: "1",
    title: "Pick your plan",
    description:
      "Choose Appointments Light, Plus, or Pro, or the Restaurant plan, then create your account. Every paid plan includes a 14-day free trial.",
  },
  {
    number: "2",
    title: "Choose your booking models",
    description: "Appointments includes appointments, classes, events, and resources. Enable the ones you want to start with.",
  },
  {
    number: "3",
    title: "Start taking bookings",
    description: "Share your booking page link, embed the widget, or print a QR code so your clients can book instantly.",
  },
];

const heroTrust = ["14-day free trial", "No booking commission", "Cancel anytime"];

const stats = [
  { value: "15 min", label: "Typical setup time" },
  { value: "0%", label: "Commission on bookings" },
  { value: "24/7", label: "Online booking page" },
  { value: "Email + SMS", label: "Reminders included" },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* ── Nav ─────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 border-b border-slate-200/70 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
          <Link href="/" className="flex-shrink-0">
            <img src="/Logo.png" alt="Resneo" className="h-8 w-auto" />
          </Link>
          <div className="hidden items-center gap-8 md:flex">
            <a href="#features" className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-900">Features</a>
            <Link href="/solutions" className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-900">Solutions</Link>
            <a href="#pricing" className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-900">Pricing</a>
            <a href="#faq" className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-900">FAQ</a>
            <Link href="/about" className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-900">About</Link>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <Link href="/login" className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:text-slate-900">
              Log in
            </Link>
            <a href="#pricing" className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-brand-700 hover:shadow-md hover:shadow-brand-600/20">
              Start free
            </a>
          </div>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        {/* Ambient brand wash */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-brand-50/80 via-white to-white" aria-hidden />
        <div className="pointer-events-none absolute -left-32 -top-24 h-[28rem] w-[28rem] rounded-full bg-accent/10 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -right-32 top-10 h-[30rem] w-[30rem] rounded-full bg-brand-200/30 blur-3xl" aria-hidden />

        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 py-16 sm:py-20 lg:grid-cols-[1.05fr_1fr] lg:gap-10 lg:py-28">
          {/* Copy */}
          <div className="text-center lg:text-left">
            <HomeReveal>
              <span className="inline-flex items-center gap-2 rounded-full border border-brand-200/70 bg-white/80 px-3.5 py-1.5 text-xs font-bold uppercase tracking-[0.18em] text-brand-700 shadow-sm backdrop-blur">
                <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_rgba(0,194,199,0.8)]" />
                Booking software, simplified
              </span>
            </HomeReveal>
            <HomeReveal delay={80}>
              <h1 className="mt-6 text-4xl font-extrabold leading-[1.05] tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
                Take bookings your way.
                <span className="mt-1 block bg-gradient-to-r from-brand-600 via-brand-500 to-accent-dark bg-clip-text pb-[0.12em] text-transparent">
                  Cut no-shows for good.
                </span>
              </h1>
            </HomeReveal>
            <HomeReveal delay={150}>
              <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg lg:mx-0">
                Resneo is the simple, all-in-one booking platform for busy businesses. Fill your diary, automate every reminder, and take deposits or payments if needed, all without the admin.
              </p>
            </HomeReveal>
            <HomeReveal delay={220}>
              <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
                <a href="#pricing" className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-brand-600 px-7 text-base font-semibold text-white shadow-lg shadow-brand-600/25 transition-all hover:-translate-y-0.5 hover:bg-brand-700 hover:shadow-xl hover:shadow-brand-600/30 sm:w-auto">
                  Start your free trial
                </a>
                <a href="#video" className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-6 text-base font-semibold text-slate-700 shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50 sm:w-auto">
                  <svg className="h-4 w-4 text-brand-600" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l10.79-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14Z" />
                  </svg>
                  Watch the demo
                </a>
              </div>
            </HomeReveal>
            <HomeReveal delay={300}>
              <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 lg:justify-start">
                {heroTrust.map((t) => (
                  <li key={t} className="flex items-center gap-1.5 text-sm font-medium text-slate-600">
                    <svg className="h-4 w-4 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                    {t}
                  </li>
                ))}
              </ul>
            </HomeReveal>
          </div>

          {/* Product shot */}
          <HomeReveal delay={200} className="relative mx-auto w-full max-w-xl lg:max-w-none">
            <div className="relative">
              <CalendarMock className="motion-safe:animate-home-float-slow" />
              <BookingConfirmedCard className="absolute -right-3 -top-5 hidden w-60 motion-safe:animate-home-float sm:flex lg:-right-8" />
              <DepositCard className="absolute -bottom-6 -left-3 hidden w-56 motion-safe:animate-home-float-slow sm:flex lg:-left-8" />
            </div>
          </HomeReveal>
        </div>
      </section>

      {/* ── Trust marquee ───────────────────────────────────── */}
      <section className="border-y border-slate-100 bg-white py-7">
        <div className="mx-auto max-w-6xl px-6">
          <p className="text-center text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
            One platform for every business that takes bookings
          </p>
          <div className="home-marquee relative mt-5 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]">
            <div className="home-marquee-track flex w-max items-center gap-3">
              {[...businessTypes, ...businessTypes].map((bt, i) => (
                <span
                  key={`${bt}-${i}`}
                  className="whitespace-nowrap rounded-full border border-slate-200 bg-slate-50/80 px-4 py-1.5 text-sm font-medium text-slate-600"
                >
                  {bt}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Features bento ──────────────────────────────────── */}
      <section id="features" className="scroll-mt-16 bg-white py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-6">
          <HomeReveal className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-brand-600">Everything in one place</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Run your bookings on autopilot
            </h2>
            <p className="mt-4 text-slate-500">
              The tools busy owners actually use every day, designed to be simple, fast, and a pleasure to run.
            </p>
          </HomeReveal>

          <div className="mt-14 grid gap-5 lg:grid-cols-3">
            {/* Take bookings your way (wide) */}
            <HomeReveal className="lg:col-span-2">
              <BentoTile
                eyebrow="Take bookings"
                title="Take bookings your way"
                body="Embed a booking widget on your site, share a personal link for each team member, or build a beautiful booking page in minutes. No code, no fuss."
              >
                <BookingFlowMock />
              </BentoTile>
            </HomeReveal>

            {/* Cut no-shows */}
            <HomeReveal delay={80}>
              <BentoTile
                eyebrow="Cut no-shows"
                title="Reminders that bring them in"
                body="Automatic text and email reminders with one-tap confirm, so clients show up and your day runs on time."
              >
                <ReminderMock />
              </BentoTile>
            </HomeReveal>

            {/* Get paid up front */}
            <HomeReveal>
              <BentoTile
                eyebrow="Get paid"
                title="Deposits, taken up front"
                body="Collect a deposit or full payment at booking through Stripe, with cancellation rules you control."
              >
                <div className="flex h-full items-center">
                  <DepositCard className="w-full shadow-none ring-1 ring-slate-100" />
                </div>
              </BentoTile>
            </HomeReveal>

            {/* Your whole day, one view (wide) */}
            <HomeReveal delay={80} className="lg:col-span-2">
              <BentoTile
                eyebrow="Your day at a glance"
                title="Every booking, every team member"
                body="A live calendar across your whole team, with colour-coded statuses, drag-to-reschedule, and client records a click away."
              >
                <div className="overflow-hidden rounded-xl">
                  <CalendarMock />
                </div>
              </BentoTile>
            </HomeReveal>
          </div>

          {/* Secondary capabilities */}
          <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {platformFeatures.map((f, i) => (
              <HomeReveal key={f.title} delay={(i % 3) * 70}>
                <div className="group h-full rounded-2xl border border-slate-100 bg-white p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-lg hover:shadow-brand-600/5">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600 transition-colors group-hover:bg-brand-100">
                    <f.icon />
                  </div>
                  <h3 className="mt-4 text-base font-semibold text-slate-900">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-500">{f.description}</p>
                </div>
              </HomeReveal>
            ))}
          </div>
          <p className="mx-auto mt-8 max-w-2xl text-center text-xs leading-relaxed text-slate-400">
            {STANDARD_PAYMENT_PROVIDER_FEES_NOTICE}
          </p>
        </div>
      </section>

      {/* ── Stats band ──────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-brand-700 via-brand-600 to-brand-800 py-16">
        <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-accent/20 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-white/5 blur-3xl" aria-hidden />
        <div className="relative mx-auto grid max-w-5xl grid-cols-2 gap-8 px-6 text-center lg:grid-cols-4">
          {stats.map((s, i) => (
            <HomeReveal key={s.label} delay={i * 70}>
              <p className="bg-gradient-to-b from-white to-brand-100 bg-clip-text text-3xl font-extrabold tracking-tight text-transparent sm:text-4xl">
                {s.value}
              </p>
              <p className="mt-2 text-sm font-medium text-brand-100/90">{s.label}</p>
            </HomeReveal>
          ))}
        </div>
      </section>

      {/* ── How it works ────────────────────────────────────── */}
      <section className="bg-slate-50 py-20 sm:py-28">
        <div className="mx-auto max-w-5xl px-6">
          <HomeReveal className="text-center">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Live in three simple steps</h2>
            <p className="mx-auto mt-4 max-w-xl text-slate-500">From sign-up to your first booking in an afternoon.</p>
          </HomeReveal>
          <div className="relative mt-16">
            <div className="pointer-events-none absolute left-0 right-0 top-6 hidden h-px bg-gradient-to-r from-transparent via-brand-200 to-transparent sm:block" aria-hidden />
            <ol className="grid gap-10 sm:grid-cols-3">
              {steps.map((s, i) => (
                <HomeReveal as="li" key={s.number} delay={i * 90} className="relative text-center">
                  <span className="relative z-10 mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-600 text-lg font-bold text-white shadow-lg shadow-brand-600/25 ring-4 ring-slate-50">
                    {s.number}
                  </span>
                  <h3 className="mt-5 text-lg font-semibold text-slate-900">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-500">{s.description}</p>
                </HomeReveal>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* ── Video ───────────────────────────────────────────── */}
      <section id="video" className="scroll-mt-16 bg-white py-20 sm:py-24">
        <div className="mx-auto max-w-4xl px-6">
          <HomeReveal className="text-center">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">See Resneo in action</h2>
            <p className="mx-auto mt-4 max-w-2xl text-slate-500">
              A quick look at how Resneo helps you take bookings, cut no-shows, and get hours back every week.
            </p>
          </HomeReveal>
          <HomeReveal delay={100}>
            <div className="mt-10 overflow-hidden rounded-2xl border border-slate-200 bg-slate-900 shadow-2xl shadow-brand-900/20 ring-1 ring-slate-900/5">
              <div className="aspect-video">
                <iframe
                  className="h-full w-full"
                  src="https://www.youtube-nocookie.com/embed/o6QeXkH0q-0?rel=0&vq=hd720"
                  title="Resneo promo video"
                  loading="lazy"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              </div>
            </div>
          </HomeReveal>
        </div>
      </section>

      {/* ── Pricing ─────────────────────────────────────────── */}
      <PricingSection />

      {/* ── Founders card ───────────────────────────────────── */}
      <section className="border-t border-slate-100 bg-white py-16 sm:py-20">
        <div className="mx-auto max-w-4xl px-6">
          <HomeReveal>
            <div className="relative overflow-hidden rounded-3xl border border-brand-100 bg-gradient-to-br from-brand-50 via-white to-brand-50 p-8 shadow-sm sm:p-12">
              <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-accent/15 blur-3xl" aria-hidden />
              <div className="pointer-events-none absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-brand-200/30 blur-3xl" aria-hidden />
              <div className="relative flex flex-col items-start gap-7 sm:flex-row sm:items-center sm:justify-between">
                <div className="max-w-xl">
                  <div className="flex items-center gap-3">
                    <div className="flex -space-x-2.5">
                      {["J", "A", "R"].map((initial, i) => (
                        <span
                          key={initial}
                          className={`grid h-11 w-11 place-items-center rounded-full border-2 border-white text-sm font-bold text-white shadow-md ${
                            i === 0 ? "bg-brand-600" : i === 1 ? "bg-accent-dark" : "bg-brand-500"
                          }`}
                        >
                          {initial}
                        </span>
                      ))}
                    </div>
                    <span className="text-xs font-bold uppercase tracking-[0.18em] text-brand-600">Founder-led</span>
                  </div>
                  <h2 className="mt-5 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                    Three founders on a mission to help your business thrive
                  </h2>
                  <p className="mt-3 text-sm leading-relaxed text-slate-600 sm:text-base">
                    We are a small, independent team who build the product, answer the phone, and genuinely care that Resneo works for you. Meet us and see what we stand for.
                  </p>
                </div>
                <Link
                  href="/about"
                  className="group inline-flex h-12 flex-shrink-0 items-center rounded-xl bg-brand-600 px-7 text-sm font-semibold text-white shadow-lg shadow-brand-600/20 transition-all hover:bg-brand-700 hover:shadow-xl hover:shadow-brand-600/30 sm:text-base"
                >
                  About Resneo
                  <svg className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                  </svg>
                </Link>
              </div>
            </div>
          </HomeReveal>
        </div>
      </section>

      {/* ── FAQ ─────────────────────────────────────────────── */}
      <HomeFaq />

      {/* ── Final CTA band ──────────────────────────────────── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-brand-800 via-brand-700 to-brand-600 py-20 sm:py-24">
        <div className="pointer-events-none absolute -left-20 -top-20 h-80 w-80 rounded-full bg-accent/20 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-24 right-0 h-80 w-80 rounded-full bg-white/5 blur-3xl" aria-hidden />
        <div className="relative mx-auto max-w-3xl px-6 text-center">
          <HomeReveal>
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">
              Ready to get your time back?
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-brand-100/90 sm:text-lg">
              Start your 14-day free trial today. No setup fees, no booking commission, cancel anytime.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a href="#pricing" className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-white px-7 text-base font-semibold text-brand-700 shadow-lg shadow-brand-900/30 transition-all hover:-translate-y-0.5 hover:bg-brand-50 sm:w-auto">
                Start your free trial
              </a>
              <a href="#contact" className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-white/25 bg-white/10 px-7 text-base font-semibold text-white backdrop-blur transition-colors hover:bg-white/20 sm:w-auto">
                Talk to us
              </a>
            </div>
          </HomeReveal>
        </div>
      </section>

      {/* ── Contact ─────────────────────────────────────────── */}
      <section id="contact" className="scroll-mt-16 bg-slate-50 py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
            <HomeReveal>
              <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Get in touch</h2>
              <p className="mt-4 max-w-md text-slate-500">
                Ready to get started, or just want to learn more? Tell us about your business and we will help you find the right fit.
              </p>
              <ul className="mt-8 space-y-4">
                {[
                  "Free, no-pressure onboarding help",
                  "Switching from another system? We will move your data across",
                  "Speak to a real person who knows the product",
                ].map((point) => (
                  <li key={point} className="flex items-start gap-3 text-sm text-slate-600">
                    <span className="mt-0.5 grid h-5 w-5 flex-shrink-0 place-items-center rounded-full bg-brand-100 text-brand-700">
                      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                    </span>
                    {point}
                  </li>
                ))}
              </ul>
              <p className="mt-8 text-sm text-slate-500">
                Prefer email?{" "}
                <a href="mailto:hello@resneo.com" className="font-semibold text-brand-600 underline decoration-brand-600/30 underline-offset-2 hover:text-brand-700">
                  hello@resneo.com
                </a>
              </p>
            </HomeReveal>
            <HomeReveal delay={100}>
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
                <ContactForm className="space-y-4" />
                <p className="mt-4 text-center text-xs leading-relaxed text-slate-500">
                  We&rsquo;ll use the details you provide to respond to your enquiry. See our{" "}
                  <Link href="/privacy" className="font-medium text-brand-600 underline hover:text-brand-700">
                    Privacy Policy
                  </Link>{" "}
                  for more information.
                </p>
              </div>
            </HomeReveal>
          </div>
        </div>
      </section>

      {/* ── Book a demo ─────────────────────────────────────── */}
      <section id="book-demo" className="scroll-mt-16 bg-white py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
            <HomeReveal>
              <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Book a demo</h2>
              <p className="mt-4 max-w-md text-slate-500">
                Pick a time that suits you and one of the team will give you a personal walkthrough of Resneo.
              </p>
              <ul className="mt-8 space-y-4">
                {[
                  "See the dashboard, calendar, and booking flow live",
                  "Ask anything about pricing, setup, or switching from another system",
                  "No commitment",
                ].map((point) => (
                  <li key={point} className="flex items-start gap-3 text-sm text-slate-600">
                    <span className="mt-0.5 grid h-5 w-5 flex-shrink-0 place-items-center rounded-full bg-brand-100 text-brand-700">
                      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                    </span>
                    {point}
                  </li>
                ))}
              </ul>
              <p className="mt-8 text-sm text-slate-500">
                And here&rsquo;s the best part: the booking form on the right <em>is</em> Resneo, the same widget your
                customers would use on your website.
              </p>
            </HomeReveal>
            <HomeReveal delay={100}>
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <iframe
                  src={demoEmbedSrc}
                  width="100%"
                  height={EMBED_IFRAME_DEFAULT_HEIGHT_PX}
                  style={{ border: "none", overflow: "hidden" }}
                  scrolling="no"
                  id="reserveni-widget"
                  title="Book a Resneo demo"
                />
              </div>
            </HomeReveal>
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────── */}
      <footer className="border-t border-slate-100 bg-slate-50 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-6 text-sm text-slate-500 sm:flex-row sm:justify-between">
          <p className="max-w-xl text-center leading-snug sm:text-left">
            &copy; 2026 Resneo · JAR 26 LTD (NI740269) · 100a Main Street, Bangor, BT20 4AG, UK
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 sm:justify-end">
            <Link href="/solutions" className="transition-colors hover:text-slate-900">Solutions</Link>
            <Link href="/about" className="transition-colors hover:text-slate-900">About</Link>
            <a href="#pricing" className="transition-colors hover:text-slate-900">Sign up</a>
            <Link href="/login" className="transition-colors hover:text-slate-900">Login</Link>
            <a href="mailto:hello@resneo.com" className="transition-colors hover:text-slate-900">Contact</a>
            <Link href="/terms" className="transition-colors hover:text-slate-900">Website Terms of Use</Link>
            <Link href="/privacy" className="transition-colors hover:text-slate-900">Privacy Policy</Link>
          </div>
        </div>
      </footer>

      <Script src={demoResizeScriptSrc} strategy="afterInteractive" />
    </div>
  );
}

/** A feature tile in the bento grid: eyebrow + title + body, with a graphic slot below. */
function BentoTile({
  eyebrow,
  title,
  body,
  children,
}: {
  eyebrow: string;
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col rounded-3xl border border-slate-200/80 bg-gradient-to-b from-white to-slate-50/50 p-7 shadow-sm transition-all hover:border-brand-200 hover:shadow-lg hover:shadow-brand-600/5">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-accent-dark">{eyebrow}</p>
      <h3 className="mt-2 text-xl font-bold tracking-tight text-slate-900">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-500">{body}</p>
      <div className="mt-6 flex-1">{children}</div>
    </div>
  );
}

function CreditCardIcon() {
  return (
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
    </svg>
  );
}

function DashboardIcon() {
  return (
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25a2.25 2.25 0 0 1-2.25-2.25v-2.25Z" />
    </svg>
  );
}

function LifebuoyIcon() {
  return (
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.712 4.33a9.027 9.027 0 0 1 1.652 1.306c.51.51.944 1.064 1.306 1.652M16.712 4.33l-3.448 4.138m3.448-4.138a9.014 9.014 0 0 0-9.424 0M19.67 7.288l-4.138 3.448m4.138-3.448a9.014 9.014 0 0 1 0 9.424m-4.138-5.976a3.736 3.736 0 0 0-.88-1.388 3.737 3.737 0 0 0-1.388-.88m2.268 2.268a3.765 3.765 0 0 1 0 2.528m-2.268-4.796a3.765 3.765 0 0 0-2.528 0m4.796 4.796c-.181.506-.475.96-.88 1.388a3.736 3.736 0 0 1-1.388.88m2.268-2.268 4.138 3.448m0 0a9.027 9.027 0 0 1-1.306 1.652c-.51.51-1.064.944-1.652 1.306m0 0-3.448-4.138m3.448 4.138a9.014 9.014 0 0 1-9.424 0m5.976-4.138a3.765 3.765 0 0 1-2.528 0m0 0a3.736 3.736 0 0 1-1.388-.88 3.737 3.737 0 0 1-.88-1.388m2.268 2.268L7.288 19.67m0 0a9.024 9.024 0 0 1-1.652-1.306 9.027 9.027 0 0 1-1.306-1.652m0 0 4.138-3.448M4.33 16.712a9.014 9.014 0 0 1 0-9.424m4.138 5.976a3.765 3.765 0 0 1 0-2.528m0 0c.181-.506.475-.96.88-1.388a3.736 3.736 0 0 1 1.388-.88m-2.268 2.268L4.33 7.288m6.406 1.18L7.288 4.33m0 0a9.024 9.024 0 0 0-1.652 1.306A9.025 9.025 0 0 0 4.33 7.288" />
    </svg>
  );
}
