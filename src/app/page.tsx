import Link from "next/link";
import { SocialLinks } from "@/components/marketing/SocialLinks";
import Script from "next/script";
import ContactForm from "@/components/ContactForm";
import { EMBED_IFRAME_DEFAULT_HEIGHT_PX } from "@/lib/embed/widget-frame";
import { normalizePublicBaseUrl } from "@/lib/public-base-url";
import HomeFaq from "@/components/home/HomeFaq";
import { PricingSection } from "@/components/home/PricingSection";
import { HomeReveal } from "@/components/home/HomeReveal";
import { AppShowcase } from "@/components/home/AppShowcase";
import { HomeMobileNav } from "@/components/home/HomeMobileNav";
import { LinkBreakSection } from "@/components/home/LinkBreakSection";
import { RESNEO_MARKETING_PAYMENTS_AND_NO_HOLD } from "@/lib/booking-funds-copy";
import { STANDARD_PAYMENT_PROVIDER_FEES_NOTICE } from "@/lib/payment-provider-fees-notice";
import {
  BookingConfirmedCard,
  BookingFlowMock,
  CalendarMock,
  DepositCard,
  ReminderMock,
} from "@/components/home/HomeGraphics";

/**
 * "Book a demo" embed: the ResNeo Demo venue (resneodemo@resneo.com) booking widget,
 * same origin as the dashboard embed snippet. On production this is the live venue.
 */
const demoPublicOrigin = normalizePublicBaseUrl(process.env.NEXT_PUBLIC_BASE_URL);
const demoEmbedSrc = `${demoPublicOrigin}/embed/resneo-demo?start=service`;
const demoResizeScriptSrc = `${demoPublicOrigin}/embed/resize.js`;



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

/** "Cancel anytime" lives in the Promises section; the differentiator earns this slot. */
const heroTrust = ["14-day free trial", "No booking commission"];

/**
 * The commercial promises behind the price. Every line here is the same claim
 * the pricing page and FAQ already make, including the payment provider fees
 * caveat, so the section stays honest under scrutiny.
 */
const promises = [
  {
    title: "0% booking commission",
    body: "Your subscription covers the platform. We never take a cut of a booking, and we never charge your clients a booking fee.",
    note: STANDARD_PAYMENT_PROVIDER_FEES_NOTICE,
  },
  {
    title: "Paid straight to you",
    body: RESNEO_MARKETING_PAYMENTS_AND_NO_HOLD,
  },
  {
    title: "Simple monthly pricing",
    // "Cancel anytime" carries the billing bound from
    // SUBSCRIPTION_CANCELLATION_PUBLIC_NOTICE rather than standing alone.
    body: "No setup fees, no contracts, and no per-booking commissions. Cancel anytime: your plan stays active to the end of the billing period you have paid for, with no charge after that.",
  },
  {
    title: "Free help switching in",
    body: "Upload a CSV from your current system and our import tool maps your clients and bookings across. If anything needs attention, we flag it for you before importing.",
  },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* ── Nav ─────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 border-b border-slate-200/70 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
          <Link href="/" className="flex min-h-11 flex-shrink-0 items-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
            <img src="/Logo.png" alt="ResNeo" className="h-8 w-auto" />
          </Link>
          {/* Four links so the bar still fits at 768px. Link & break, FAQ and
              About stay reachable from the mobile menu and the footer. */}
          <div className="hidden items-center gap-6 md:flex lg:gap-8">
            <a href="#features" className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-900">Features</a>
            <Link href="/solutions" className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-900">Solutions</Link>
            <a href="#pricing" className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-900">Pricing</a>
            <Link href="/help" className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-900">Help</Link>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <Link href="/login" className="hidden min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-slate-700 transition-colors hover:text-slate-900 sm:inline-flex">
              Log in
            </Link>
            <a href="#pricing" className="inline-flex min-h-11 items-center rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white shadow-sm transition-all hover:bg-brand-700 hover:shadow-md hover:shadow-brand-600/20">
              Start free
            </a>
            <HomeMobileNav />
          </div>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        {/* Ambient brand wash */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-brand-50/80 via-white to-white" aria-hidden />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.04] [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]"
          style={{
            backgroundImage:
              "linear-gradient(to right, #0f172a 1px, transparent 1px), linear-gradient(to bottom, #0f172a 1px, transparent 1px)",
            backgroundSize: "44px 44px",
          }}
          aria-hidden
        />
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
              <h1 className="mt-6 text-balance text-4xl font-extrabold leading-[1.05] tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
                Take bookings your way.
                <span className="mt-1 block bg-gradient-to-r from-brand-600 via-brand-500 to-accent-dark bg-clip-text pb-[0.12em] text-transparent">
                  Cut no-shows for good.
                </span>
              </h1>
            </HomeReveal>
            <HomeReveal delay={150}>
              <p className="mx-auto mt-6 max-w-xl text-pretty text-base leading-relaxed text-slate-600 sm:text-lg lg:mx-0">
                ResNeo is the simple, all-in-one booking platform for busy businesses. Fill your diary, automate every reminder, and take deposits or payments if needed, all without the admin.
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
                {/* The differentiator, promoted into the trust row as the one
                    interactive chip rather than a grey footnote below it. */}
                <li>
                  <a
                    href="#link-break"
                    className="group inline-flex min-h-11 items-center gap-2 rounded-full border border-brand-200 bg-white px-4 text-sm font-semibold text-brand-700 shadow-sm transition-all hover:border-brand-300 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                  >
                    <svg className="h-4 w-4 shrink-0 text-accent-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.2 10.8a4.5 4.5 0 0 0-6.4 0l-2.5 2.5a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10.8 13.2a4.5 4.5 0 0 0 6.4 0l2.5-2.5a4.5 4.5 0 1 0-6.4-6.4l-1.2 1.2" />
                    </svg>
                    Share a booking page, keep separate books
                    <svg className="h-3.5 w-3.5 shrink-0 transition-transform motion-safe:group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                    </svg>
                  </a>
                </li>
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
          <p className="text-center text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
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
            <h2 className="mt-3 text-balance text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Run your bookings on autopilot
            </h2>
            <p className="mt-4 text-slate-500">
              The tools busy owners actually use every day, designed to be simple, fast, and a pleasure to run.
            </p>
          </HomeReveal>

          <div className="mt-14 grid gap-5 lg:grid-cols-3">
            {/* Take bookings your way (wide) */}
            <HomeReveal className="min-w-0 lg:col-span-2">
              <BentoTile
                eyebrow="Take bookings"
                title="Take bookings your way"
                body="Embed a booking widget on your site, share a personal link for each team member, or build a beautiful booking page in minutes. No code, no fuss."
              >
                <BookingFlowMock />
              </BentoTile>
            </HomeReveal>

            {/* Cut no-shows */}
            <HomeReveal delay={80} className="min-w-0">
              <BentoTile
                eyebrow="Cut no-shows"
                title="Reminders that bring them in"
                body="Automatic text and email reminders with one-tap confirm, so clients show up and your day runs on time."
              >
                <ReminderMock />
              </BentoTile>
            </HomeReveal>

            {/* Get paid up front */}
            <HomeReveal className="min-w-0">
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
            <HomeReveal delay={80} className="min-w-0 lg:col-span-2">
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

          {/* App showcase */}
          <AppShowcase />
        </div>
      </section>

      {/* ── Link & break ────────────────────────────────────── */}
      <LinkBreakSection />

      {/* ── Getting started: three steps, then the video ────── */}
      <section className="bg-white py-20 sm:py-28">
        <div className="mx-auto max-w-5xl px-6">
          <HomeReveal className="text-center">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-brand-600">Getting started</p>
            <h2 className="mt-3 text-balance text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Live in three simple steps
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-slate-500">From sign-up to your first booking in an afternoon.</p>
          </HomeReveal>
          <div className="relative mt-16">
            <div className="pointer-events-none absolute left-0 right-0 top-6 hidden h-px bg-gradient-to-r from-transparent via-brand-200 to-transparent sm:block" aria-hidden />
            <ol className="grid gap-10 sm:grid-cols-3">
              {steps.map((s, i) => (
                <HomeReveal as="li" key={s.number} delay={i * 90} className="relative text-center">
                  <span className="relative z-10 mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-600 text-lg font-bold text-white shadow-lg shadow-brand-600/25 ring-4 ring-white">
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
      <section id="video" className="scroll-mt-16 bg-slate-50 py-20 sm:py-24">
        <div className="mx-auto max-w-4xl px-6">
          <HomeReveal className="text-center">
            <h2 className="text-balance text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              See ResNeo in action
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-slate-500">
              A quick look at how ResNeo helps you take bookings, cut no-shows, and get hours back every week.
            </p>
          </HomeReveal>
          <HomeReveal delay={100}>
            <div className="mt-10 overflow-hidden rounded-2xl border border-slate-200 bg-slate-900 shadow-2xl shadow-brand-900/20 ring-1 ring-slate-900/5">
              <div className="aspect-video">
                <iframe
                  className="h-full w-full"
                  src="https://www.youtube-nocookie.com/embed/o6QeXkH0q-0?rel=0&vq=hd720"
                  title="ResNeo promo video"
                  loading="lazy"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              </div>
            </div>
          </HomeReveal>
        </div>
      </section>

      {/* ── Promises behind the price ───────────────────────── */}
      <section className="border-t border-slate-200/70 bg-white py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-6">
          <HomeReveal className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-brand-600">Owner first</p>
            <h2 className="mt-3 text-balance text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              No commission. No lock-in. No surprises.
            </h2>
            <p className="mt-4 text-slate-500">
              The bookings are yours, the clients are yours, and the money is yours. Here is exactly what that means.
            </p>
          </HomeReveal>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {promises.map((p, i) => (
              <HomeReveal key={p.title} delay={i * 70}>
                <div className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-colors hover:border-brand-200">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                  </span>
                  <h3 className="mt-4 text-base font-bold tracking-tight text-slate-900">{p.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{p.body}</p>
                  {p.note ? (
                    <p className="mt-auto pt-3 text-xs text-slate-600">{p.note}</p>
                  ) : null}
                </div>
              </HomeReveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ─────────────────────────────────────────── */}
      <PricingSection />

      {/* ── Price calculator ────────────────────────────────── */}
      <section className="border-t border-slate-100 bg-slate-50/70 py-16 sm:py-20">
        <div className="mx-auto max-w-4xl px-6">
          <HomeReveal>
            <div className="overflow-hidden rounded-3xl border border-brand-100 bg-white p-8 shadow-sm sm:p-10">
              <div className="grid items-center gap-8 md:grid-cols-[1fr_auto]">
                <div>
                  <p className="text-sm font-bold uppercase tracking-[0.18em] text-accent-700">
                    Price calculator
                  </p>
                  <h2 className="mt-3 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                    See how ResNeo compares to Booksy, Fresha, Vagaro and the rest
                  </h2>
                  <p className="mt-4 text-base leading-relaxed text-slate-600">
                    Most booking platforms charge you for every team member, take a commission on new
                    clients from their marketplace, then price the marketing tools separately. Put
                    your own chairs, bookings and prices in, and see what each one would actually
                    cost you a month. Every competitor figure is sourced and dated.
                  </p>
                </div>
                <Link
                  href="/calculator"
                  className="inline-flex h-12 items-center justify-center whitespace-nowrap rounded-xl bg-brand-600 px-7 text-base font-semibold text-white shadow-lg shadow-brand-600/25 transition-all hover:-translate-y-0.5 hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                >
                  Compare the cost
                </Link>
              </div>
            </div>
          </HomeReveal>
        </div>
      </section>

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
                            i === 0 ? "bg-brand-600" : i === 1 ? "bg-accent-800" : "bg-brand-500"
                          }`}
                        >
                          {initial}
                        </span>
                      ))}
                    </div>
                    <span className="text-xs font-bold uppercase tracking-[0.18em] text-brand-600">Founder-led</span>
                  </div>
                  <h2 className="mt-5 text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                    Three founders on a mission to help your business thrive
                  </h2>
                  <p className="mt-3 text-sm leading-relaxed text-slate-600 sm:text-base">
                    We are a small, independent team who build the product, answer the phone, and genuinely care that ResNeo works for you. Meet us and see what we stand for.
                  </p>
                </div>
                <Link
                  href="/about"
                  className="group inline-flex h-12 flex-shrink-0 items-center rounded-xl bg-brand-600 px-7 text-sm font-semibold text-white shadow-lg shadow-brand-600/20 transition-all hover:bg-brand-700 hover:shadow-xl hover:shadow-brand-600/30 sm:text-base"
                >
                  About ResNeo
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
            <h2 className="text-balance text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">
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
          {/* min-w-0: grid items default to min-width:auto, so the phone field's
              country selector was forcing the column wider than the viewport. */}
          <div className="grid gap-12 lg:grid-cols-2 lg:gap-16 [&>*]:min-w-0">
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
                Pick a time that suits you and one of the team will give you a personal walkthrough of ResNeo.
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
                And here&rsquo;s the best part: the booking form on the right <em>is</em> ResNeo, the same widget your
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
                  title="Book a ResNeo demo"
                />
              </div>
            </HomeReveal>
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────── */}
      <footer className="border-t border-slate-100 bg-slate-50 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-6 text-sm text-slate-500 sm:flex-row sm:justify-between">
          <div className="flex flex-col items-center gap-3 sm:items-start">
            <p className="max-w-xl text-center leading-snug sm:text-left">
              &copy; 2026 ResNeo · JAR 26 LTD (NI740269) · 100a Main Street, Bangor, BT20 4AG, UK
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 sm:justify-end">
            <Link href="/solutions" className="transition-colors hover:text-slate-900">Solutions</Link>
            <Link href="/about" className="transition-colors hover:text-slate-900">About</Link>
            {/* FAQ is not in the desktop nav bar, so the footer is its only
                affordance at md and above. */}
            <a href="#faq" className="transition-colors hover:text-slate-900">FAQ</a>
            <a href="#pricing" className="transition-colors hover:text-slate-900">Sign up</a>
            <Link href="/login" className="transition-colors hover:text-slate-900">Login</Link>
            <a href="mailto:hello@resneo.com" className="transition-colors hover:text-slate-900">Contact</a>
            <Link href="/terms" className="transition-colors hover:text-slate-900">Website Terms of Use</Link>
            <Link href="/privacy" className="transition-colors hover:text-slate-900">Privacy Policy</Link>
            <SocialLinks />
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
    <div className="flex h-full min-w-0 flex-col rounded-3xl border border-slate-200/80 bg-gradient-to-b from-white to-slate-50/50 p-5 shadow-sm transition-all hover:border-brand-200 hover:shadow-lg hover:shadow-brand-600/5 sm:p-7">
      {/* accent-700, not accent-dark: the lighter teal is 3.2:1 at 12px. */}
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-accent-700">{eyebrow}</p>
      <h3 className="mt-2 text-xl font-bold tracking-tight text-slate-900">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-500">{body}</p>
      <div className="mt-6 flex-1">{children}</div>
    </div>
  );
}


