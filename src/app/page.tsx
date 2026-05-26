import Link from "next/link";
import ContactForm from "@/components/ContactForm";
import HomeFaq from "@/components/home/HomeFaq";
import { PricingSection } from "@/components/home/PricingSection";
import { RESERVENI_MARKETING_PAYMENTS_AND_NO_HOLD } from "@/lib/booking-funds-copy";
import { STANDARD_PAYMENT_PROVIDER_FEES_NOTICE } from "@/lib/payment-provider-fees-notice";

/** Feature blurbs aligned with ReserveNI Unified Scheduling Engine Plan (v1.1): deposits, comms lifecycle, dashboard. */
const features = [
  {
    title: "Deposit Collection",
    description: `Per-head deposits via Stripe Connect. ${RESERVENI_MARKETING_PAYMENTS_AND_NO_HOLD}`,
    icon: CreditCardIcon,
  },
  {
    title: "Smart Communications",
    description:
      "Automated confirmations, deposit requests, reminders, and post-visit messages across email and SMS with generous included allowances.",
    icon: ChatIcon,
  },
  {
    title: "Real-time Dashboard",
    description:
      "Bookings, calendars, guest records, and reporting. Restaurants also get visual timeline and live floor plan for seating.",
    icon: DashboardIcon,
  },
  {
    title: "Easy Setup",
    description: "Embed the booking widget on your website or generate a QR code. Up and running in minutes.",
    icon: BoltIcon,
  },
  {
    title: "Any Bookable Business",
    description: "Restaurants, barbers, beauty salons, yoga studios, tennis courts, escape rooms. If it's bookable, ReserveNI handles it.",
    icon: GridIcon,
  },
  {
    title: "Built for Northern Ireland",
    description: `Local support and tailored to the NI business community. No commissions, no hidden fees. ${STANDARD_PAYMENT_PROVIDER_FEES_NOTICE}`,
    icon: MapPinIcon,
  },
];

const businessTypes = [
  "Restaurants", "Barbers", "Hairdressers", "Beauty Therapists", "Physiotherapists",
  "Yoga Studios", "Gyms", "Tennis Courts", "Escape Rooms", "Dog Groomers",
  "Photography Studios", "Meeting Rooms", "Golf Tee Times", "Driving Instructors",
];

const steps = [
  {
    number: "1",
    title: "Pick your plan",
    description:
      "Choose Appointments Light, Plus, or Pro, or the Restaurant plan, then create your account. Every paid plan includes a 14-day free trial.",
  },
  { number: "2", title: "Choose your booking models", description: "Appointments includes appointments, classes, events, and resources. Enable the ones you want to start with." },
  { number: "3", title: "Start taking bookings", description: "Share your booking page link, embed the widget, or print a QR code so your clients can book instantly." },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* Nav */}
      <nav className="sticky top-0 z-50 border-b border-slate-100 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex-shrink-0">
            <img src="/Logo.png" alt="ReserveNI" className="h-9 w-auto" />
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/login" className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700">
              Log in
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-brand-50 via-white to-emerald-50" />
        <div className="absolute inset-0 opacity-30" style={{ backgroundImage: 'radial-gradient(circle at 25% 25%, rgba(13,148,136,0.08) 0%, transparent 50%), radial-gradient(circle at 75% 75%, rgba(5,150,105,0.06) 0%, transparent 50%)' }} />
        <div className="relative mx-auto max-w-4xl px-6 py-24 text-center sm:py-32 lg:py-40">
          <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
            ReserveNI
          </h1>
          <p className="mt-4 text-lg font-medium text-brand-700 sm:text-xl">
            Booking management for every business in Northern Ireland
          </p>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-slate-500 sm:text-lg">
            Restaurants, salons, studios, courts, and more: manage bookings, reduce no-shows, and automate client communications from one platform.
          </p>
          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link href="#pricing" className="inline-flex h-12 items-center rounded-xl bg-brand-600 px-8 text-base font-semibold text-white shadow-lg shadow-brand-600/20 transition-all hover:bg-brand-700 hover:shadow-xl hover:shadow-brand-600/30">
              Get started
            </Link>
          </div>
          {/* Business type ticker */}
          <div className="mt-12 flex flex-wrap justify-center gap-2">
            {businessTypes.map((bt) => (
              <span key={bt} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500">
                {bt}
              </span>
            ))}
            <span className="rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-600">
              + 30 more
            </span>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="scroll-mt-16 bg-white py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Everything you need to manage bookings
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-slate-500">
            Purpose-built for Northern Ireland. No enterprise bloat, no commission on bookings.{' '}
            {STANDARD_PAYMENT_PROVIDER_FEES_NOTICE}
          </p>
          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div key={f.title} className="group rounded-2xl border border-slate-100 bg-white p-6 transition-all hover:border-brand-200 hover:shadow-lg hover:shadow-brand-600/5">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-600 transition-colors group-hover:bg-brand-100">
                  <f.icon />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-slate-900">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="bg-slate-50 py-20 sm:py-28">
        <div className="mx-auto max-w-4xl px-6">
          <h2 className="text-center text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">How it works</h2>
          <p className="mx-auto mt-4 max-w-xl text-center text-slate-500">Three steps to streamlined bookings.</p>
          <ol className="mt-14 grid gap-10 sm:grid-cols-3">
            {steps.map((s) => (
              <li key={s.number} className="text-center">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-600 text-lg font-bold text-white shadow-lg shadow-brand-600/20">{s.number}</span>
                <h3 className="mt-4 text-lg font-semibold text-slate-900">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">{s.description}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <PricingSection />

      <HomeFaq />

      {/* Contact */}
      <section id="contact" className="scroll-mt-16 bg-slate-50 py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Get in Touch
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-center text-slate-500">
            Whether you&rsquo;re ready to get started or just want to learn more, we&rsquo;d love to hear from you.
          </p>
          <div className="mt-10">
            <ContactForm />
            <p className="mx-auto mt-4 max-w-lg text-center text-xs leading-relaxed text-slate-500">
              We&rsquo;ll use the details you provide to respond to your enquiry. See our{' '}
              <Link href="/privacy" className="font-medium text-brand-600 underline hover:text-brand-700">
                Privacy Policy
              </Link>{' '}
              for more information.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-100 bg-slate-50 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-6 text-sm text-slate-500 sm:flex-row sm:justify-between">
          <p className="max-w-xl text-center leading-snug sm:text-left">
            &copy; 2026 ReserveNI · JAR 26 LTD (NI740269) · 100a Main Street, Bangor, BT20 4AG, UK
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 sm:justify-end">
            <Link href="/signup" className="transition-colors hover:text-slate-900">
              Sign up
            </Link>
            <Link href="/login" className="transition-colors hover:text-slate-900">
              Login
            </Link>
            <a href="mailto:hello@reserveni.com" className="transition-colors hover:text-slate-900">
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

function MapPinIcon() {
  return (
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
    </svg>
  );
}
