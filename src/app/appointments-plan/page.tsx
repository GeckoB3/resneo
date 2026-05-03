import type { Metadata } from "next";
import Link from "next/link";
import ContactForm from "@/components/ContactForm";
import {
  RESERVENI_DEPOSIT_FLOWS_MARKETING_FOLLOW_ON,
  RESERVENI_MARKETING_PAYMENTS_AND_NO_HOLD,
} from "@/lib/booking-funds-copy";
import { STANDARD_PAYMENT_PROVIDER_FEES_NOTICE } from "@/lib/payment-provider-fees-notice";
import { SUBSCRIPTION_CANCELLATION_PUBLIC_NOTICE } from "@/lib/subscription-cancellation-copy";

export const metadata: Metadata = {
  title: "ReserveNI for Appointments | Online Booking for Northern Ireland Businesses",
  description:
    "Stop losing bookings. Let clients book online 24/7, collect deposits to cut no-shows, and automate every reminder. ReserveNI is the all-in-one booking platform built for Northern Ireland.",
  openGraph: {
    title: "ReserveNI for Appointments",
    description:
      "Let clients book online 24/7, cut no-shows with deposits, and automate every reminder. Built for Northern Ireland businesses.",
    type: "website",
  },
};

const problems = [
  {
    title: "Missed calls become missed revenue",
    description:
      "When someone calls and no one answers, they rarely wait. They book with the next business that lets them lock in a slot instantly.",
    icon: PhoneOffIcon,
  },
  {
    title: "No-shows leave empty gaps",
    description:
      "A cancelled or missed slot is pure lost income. Manual reminder chasing takes time and still does not stop all no-shows.",
    icon: GhostIcon,
  },
  {
    title: "Manual diaries create mistakes",
    description:
      "Paper notes, DMs, and messages across apps create confusion. One clash can cost trust, time, and repeat business.",
    icon: CalendarAlertIcon,
  },
  {
    title: "Late-night intent goes cold",
    description:
      "People decide to book at night and between meetings. If they cannot secure a time there and then, intent fades fast.",
    icon: MoonIcon,
  },
  {
    title: "Deposits are hard to chase manually",
    description:
      "Collecting deposits by bank transfer or message follow-up is messy. Delays and no payment confirmations create risk before every booking.",
    icon: InboxIcon,
  },
  {
    title: "Your online presence should feel premium",
    description:
      "Your service can be world-class, but a clunky booking journey sends the wrong signal. First impressions start before clients arrive.",
    icon: SparklesIcon,
  },
];

const ownerBenefits = [
  {
    title: "Capture bookings while you are closed",
    description:
      "Open your diary 24/7 so clients can book when intent is highest, even when your team is offline.",
    icon: MoonIcon,
  },
  {
    title: "Win back 10+ hours a week",
    description:
      "Clients book themselves online, 24/7. No phone tag, no back-and-forth, no evenings spent replying to DMs.",
    icon: ClockIcon,
  },
  {
    title: "Protect your income with deposits",
    description: `Require a deposit on any booking. ${RESERVENI_MARKETING_PAYMENTS_AND_NO_HOLD}`,
    icon: ShieldPoundIcon,
  },
  {
    title: "Cut no-shows automatically",
    description:
      "Confirmations, reminders, and confirm-or-cancel messages go out on autopilot by email and SMS. Clients show up, or cancel in time for you to refill the slot.",
    icon: BellIcon,
  },
  {
    title: "Every client, every detail",
    description:
      "Visit history, preferences, allergies, notes and spend, all in one place. Recognise regulars. Personalise every visit.",
    icon: UserCardIcon,
  },
  {
    title: "Look professional everywhere clients find you",
    description:
      "A polished booking page, branded confirmations, and a QR code on your counter. Clients feel confident. Confidence books again.",
    icon: TrendUpIcon,
  },
  {
    title: "Fair, honest pricing",
    description:
      `One flat subscription. No commission on bookings. ${STANDARD_PAYMENT_PROVIDER_FEES_NOTICE} Most plans include a monthly SMS allowance; when you go beyond it, you pay as you go at a clear, published rate. ${SUBSCRIPTION_CANCELLATION_PUBLIC_NOTICE}`,
    icon: TagIcon,
  },
];

const clientBenefits = [
  "Book in 60 seconds from any phone, no app, no sign-up.",
  "Instant confirmation in their inbox.",
  "Automatic SMS and email reminders so they don't forget.",
  "One-tap reschedule or cancel if plans change.",
  "Clear cancellation and deposit terms up front.",
  "Feels like booking with a premium brand.",
];

const howItWorks = [
  {
    step: "1",
    title: "Set up in minutes",
    description:
      "Add your services, your hours, your staff, and your prices. We're here if you need any help along the way.",
  },
  {
    step: "2",
    title: "Share your booking link",
    description:
      "Put it in your Instagram bio, on your website, on a flyer, or print a QR code for your counter and window.",
  },
  {
    step: "3",
    title: "Watch the diary fill itself",
    description:
      "New bookings appear instantly. Reminders go out automatically. You focus on the work. ReserveNI runs the rest.",
  },
];

const useCases = [
  { name: "Barbers", icon: "✂" },
  { name: "Hair salons", icon: "💇" },
  { name: "Beauty therapists", icon: "💅" },
  { name: "Nail technicians", icon: "💎" },
  { name: "Tattoo artists", icon: "🖊" },
  { name: "Aesthetics clinics", icon: "✨" },
  { name: "Physiotherapists", icon: "🧘" },
  { name: "Personal trainers", icon: "🏋" },
  { name: "Yoga & pilates studios", icon: "🧘‍♀" },
  { name: "Dog groomers", icon: "🐕" },
  { name: "Driving instructors", icon: "🚗" },
  { name: "Photography studios", icon: "📷" },
  { name: "Escape rooms", icon: "🗝" },
  { name: "Tennis & padel courts", icon: "🎾" },
  { name: "Golf tee times", icon: "⛳" },
  { name: "Private tutors", icon: "📚" },
];

const features = [
  {
    title: "Embed on your website",
    description: "Drop the ReserveNI widget into your existing site in 30 seconds. Your branding, your colours.",
  },
  {
    title: "Online booking page",
    description: "A beautiful booking page on your own link. Works on every phone, every browser.",
  },
  {
    title: "QR codes for flyers & counter",
    description: "Print a QR code so walk-ins can book a follow-up before they leave.",
  },
  {
    title: "Deposits & full pre-payment",
    description: "Charge per-booking or per-head. Funds go direct to your Stripe account, no middleman.",
  },
  {
    title: "Automated reminders",
    description: "Email and SMS reminders timed exactly how you want them. Fewer no-shows, less chasing.",
  },
  {
    title: "Two-way SMS confirmations",
    description: "Clients can confirm or cancel by replying to a text. Frees up your slot if they can't make it.",
  },
  {
    title: "Staff calendars",
    description: "One calendar per team member. Staff see their day, you see the whole business.",
  },
  {
    title: "Classes, events & resources",
    description: "Not just 1-to-1. Run group classes, sell event tickets, book meeting rooms or equipment.",
  },
  {
    title: "Client records & notes",
    description: "Every visit, every note, every preference. The kind of memory that turns customers into regulars.",
  },
  {
    title: "Reporting",
    description: "See revenue, bookings, utilisation and busiest hours at a glance.",
  },
  {
    title: "GDPR-ready & secure",
    description: "Data hosted in the UK/EU. Row-level security. Only you see your clients.",
  },
  {
    title: "Local human support",
    description: "Talk to a real person in Northern Ireland, not a chatbot, not an offshore call centre.",
  },
];

const faqs = [
  {
    q: "Is there a discount for new customers?",
    a: "Yes. New customers can use the code RESERVE50 at checkout to get 50% off any plan for the first 6 months. Just enter the code when you sign up and the discount will apply automatically.",
  },
  {
    q: "Do I need a website already?",
    a: "No. ReserveNI gives you a beautiful booking page on your own link (like reserveni.com/book/your-business). Share it on Instagram, Facebook, your Google listing or a flyer, and you're ready to take bookings without a website. If you do have a website, you can embed the widget there too.",
  },
  {
    q: "Can I add ReserveNI to my existing website?",
    a: "Yes. Add the booking widget to your current website in around 30 seconds. Clients can book without leaving your site, and every booking flows straight into your ReserveNI diary.",
  },
  {
    q: "How do deposits actually work?",
    a: `You connect your own Stripe account in a few clicks. When a client pays a deposit, ${RESERVENI_DEPOSIT_FLOWS_MARKETING_FOLLOW_ON} You control the amount and your cancellation policy. If a client no-shows, the deposit is yours.`,
  },
  {
    q: "How do SMS costs work?",
    a: "Appointments Light has no included SMS and messages are pay as you go at 8p each. Appointments Plus and Pro include a monthly SMS allowance, then additional messages are 6p each.",
  },
  {
    q: "How long does setup take?",
    a: "Most businesses are taking real bookings within 30 minutes. Add your services, your hours, your staff, and your booking policies, and you're live. If you need any help getting set up, just get in touch; we're happy to help.",
  },
  {
    q: "What happens when I'm closed and someone wants to book?",
    a: "Your available hours and lead-time rules control what clients can book. They can book any open slot 24/7, and you'll see it in your dashboard the moment they do. No more midnight DMs, no more missed opportunities.",
  },
  {
    q: "What if my clients aren't online-savvy?",
    a: "The booking page is designed to be tap-tap-done on any phone, with no app, no login, and no password. Most clients who 'hate online forms' book their first appointment in under a minute. You can still add manual bookings for anyone who prefers to call.",
  },
  {
    q: "Can I still take phone bookings?",
    a: "Absolutely. Add phone bookings manually in seconds, and keep all clients in one diary with full history. ReserveNI supports your existing relationships while moving more bookings online.",
  },
];

export default function AppointmentsPlanPage() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <Nav />
      <Hero />
      <BookingChannelsSection />
      <ProblemSection />
      <SolutionIntro />
      <OwnerBenefitsSection />
      <ProductPreview />
      <ClientBenefitsSection />
      <StatsBand />
      <HowItWorksSection />
      <UseCasesSection />
      <FeaturesSection />
      <FaqSection />
      <ClosingCta />
      <Footer />
    </div>
  );
}

function Nav() {
  return (
    <nav className="sticky top-0 z-50 border-b border-slate-100 bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex-shrink-0">
          <img src="/Logo.png" alt="ReserveNI" className="h-9 w-auto" />
        </Link>
        <div className="flex items-center gap-2 sm:gap-4">
          <a
            href="#contact"
            className="hidden rounded-xl px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900 sm:inline-flex"
          >
            Talk to us
          </a>
          <Link
            href="/#pricing"
            className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
          >
            Get Started Now
          </Link>
        </div>
      </div>
    </nav>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* Layered backgrounds for depth */}
      <div className="absolute inset-0 bg-gradient-to-br from-brand-50 via-white to-emerald-50" />
      <div
        className="absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            "radial-gradient(circle at 15% 20%, rgba(78,107,120,0.12) 0%, transparent 45%), radial-gradient(circle at 85% 80%, rgba(5,150,105,0.10) 0%, transparent 50%)",
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
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-brand-700 backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Built in Northern Ireland, for Northern Ireland
          </span>
          <h1 className="mt-6 text-4xl font-extrabold leading-[1.05] tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
            Stop losing bookings.
            <br />
            <span className="bg-gradient-to-r from-brand-700 via-brand-600 to-emerald-600 bg-clip-text text-transparent">
              Start growing your business.
            </span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-600 sm:text-xl">
            Every empty slot is money you will not get back. ReserveNI takes bookings 24/7, collects a
            deposit when clients book, and sends the reminders that make them show up. Fewer no-shows.
            More revenue where it belongs.
          </p>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/#pricing"
              className="inline-flex h-12 items-center justify-center rounded-xl bg-brand-600 px-7 text-base font-semibold text-white shadow-lg shadow-brand-600/25 transition-all hover:-translate-y-0.5 hover:bg-brand-700 hover:shadow-xl hover:shadow-brand-600/30"
            >
              Get Started Now
              <ArrowRightIcon />
            </Link>
            <a
              href="#how"
              className="inline-flex h-12 items-center justify-center rounded-xl border border-slate-200 bg-white px-6 text-base font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:text-slate-900"
            >
              See how bookings work
            </a>
          </div>

          <div className="mt-8 inline-flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
              <TagIcon small />
            </span>
            <div className="text-sm">
              <span className="font-semibold text-emerald-800">Founding Partner Offer: </span>
              <span className="text-emerald-700">Use code </span>
              <span className="rounded bg-emerald-700 px-1.5 py-0.5 font-mono text-xs font-bold tracking-wider text-white">
                RESERVE50
              </span>
              <span className="text-emerald-700"> at checkout for 50% off for our first 50 Northern Ireland businesses.</span>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-slate-500">
            <span className="inline-flex items-center gap-2">
              <TickIcon />
              Take bookings 24/7
            </span>
            <span className="inline-flex items-center gap-2">
              <TickIcon />
              Deposits protect your income
            </span>
            <span className="inline-flex items-center gap-2">
              <TickIcon />
              Confirm-or-cancel reduces no-shows
            </span>
            <span className="inline-flex items-center gap-2">
              <TickIcon />
              Website embed included
            </span>
            <span className="inline-flex basis-full max-w-2xl items-start gap-2">
              <TickIcon />
              <span>{SUBSCRIPTION_CANCELLATION_PUBLIC_NOTICE}</span>
            </span>
          </div>
        </div>

        {/* Hero visual: stylised booking confirmation */}
        <div className="relative lg:col-span-2">
          <HeroVisual />
        </div>
      </div>
    </section>
  );
}

function HeroVisual() {
  return (
    <div className="relative mx-auto w-full max-w-sm">
      {/* Glow */}
      <div className="absolute -inset-4 rounded-[2.5rem] bg-gradient-to-tr from-brand-200/60 via-white/0 to-emerald-200/60 blur-2xl" />

      {/* Phone mock */}
      <div className="relative rounded-[2.25rem] border border-slate-200 bg-slate-900 p-2 shadow-2xl shadow-brand-900/20">
        <div className="relative overflow-hidden rounded-[1.85rem] bg-white">
          {/* Status bar */}
          <div className="flex items-center justify-between px-5 pt-3 text-[10px] font-semibold text-slate-600">
            <span>9:41</span>
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
            </span>
          </div>

          {/* Booking card */}
          <div className="px-5 pb-6 pt-4">
            <div className="flex items-center gap-2 text-[11px] font-medium text-brand-700">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
              Booking confirmed
            </div>
            <h3 className="mt-2 text-lg font-bold text-slate-900">
              Men&apos;s cut &amp; beard trim
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">with Aaron at Grove Street Barber</p>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <InfoTile label="Date" value="Thu 25 Apr" />
              <InfoTile label="Time" value="3:30 PM" />
              <InfoTile label="Duration" value="45 min" />
              <InfoTile label="Deposit" value="£5 paid" accent />
            </div>

            <div className="mt-5 rounded-xl border border-slate-100 bg-slate-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Reminder scheduled
              </p>
              <p className="mt-1 text-xs text-slate-700">SMS + email, 24 hours before</p>
            </div>

            <div className="mt-5 flex gap-2">
              <div className="h-9 flex-1 rounded-lg bg-brand-600" />
              <div className="h-9 flex-1 rounded-lg border border-slate-200 bg-white" />
            </div>
          </div>
        </div>
      </div>

      {/* Floating receipt card, positioned above the phone so it doesn't obscure the booking details */}
      <div className="absolute -top-6 -left-6 hidden rotate-[-6deg] rounded-xl border border-slate-100 bg-white p-3 shadow-xl shadow-slate-900/10 sm:block">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
            <TickIcon />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-slate-900">Deposit received</p>
            <p className="text-[10px] text-slate-500">£5.00 to your Stripe</p>
          </div>
        </div>
      </div>

      {/* Floating reminder card, positioned below the phone so it doesn't obscure the booking details */}
      <div className="absolute -bottom-6 -right-4 hidden rotate-[4deg] rounded-xl border border-slate-100 bg-white p-3 shadow-xl shadow-slate-900/10 sm:block">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
            <BellIcon />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-slate-900">Reminder sent</p>
            <p className="text-[10px] text-slate-500">Sarah, Thu 3:30 PM</p>
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
        accent ? "border-emerald-200 bg-emerald-50" : "border-slate-100 bg-slate-50"
      }`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-1 text-sm font-bold ${accent ? "text-emerald-700" : "text-slate-900"}`}>
        {value}
      </p>
    </div>
  );
}

function ProblemSection() {
  return (
    <section className="bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <span className="text-xs font-semibold uppercase tracking-widest text-brand-600">
            If this sounds familiar
          </span>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
            Your office is closed.
            <br className="hidden sm:block" />
            <span className="text-slate-500">Your customers aren&apos;t.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-600">
            People want to book at 10pm, on a Sunday, or in the five minutes between meetings. If they
            can&apos;t lock in a time in that moment, the booking and the revenue go to whoever is
            open online. ReserveNI turns after-hours interest into real slots, without you manning the
            phone.
          </p>
        </div>

        <div className="mt-16 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {problems.map((p) => (
            <div
              key={p.title}
              className="group relative overflow-hidden rounded-2xl border border-slate-100 bg-slate-50/60 p-6 transition-all hover:border-slate-200 hover:bg-white hover:shadow-md"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-brand-700 shadow-sm ring-1 ring-slate-100">
                <p.icon />
              </div>
              <h3 className="mt-4 text-base font-semibold text-slate-900">{p.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{p.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SolutionIntro() {
  return (
    <section className="relative overflow-hidden bg-slate-900 py-20 text-white sm:py-28">
      <div
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "radial-gradient(circle at 25% 30%, rgba(78,107,120,0.6) 0%, transparent 50%), radial-gradient(circle at 80% 70%, rgba(5,150,105,0.35) 0%, transparent 50%)",
        }}
      />
      <div className="relative mx-auto max-w-4xl px-6 text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-white/80 backdrop-blur">
          Meet ReserveNI
        </span>
        <h2 className="mt-6 text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
          One platform. Every booking. Zero chaos.
        </h2>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-white/80">
          ReserveNI replaces the paper diary, the missed calls, the WhatsApp booking threads, the
          spreadsheet of clients, and the evenings spent sending reminders. It&apos;s the booking
          system you&apos;d build yourself, if you had six months and a software team.
        </p>
        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/#pricing"
            className="inline-flex h-12 items-center justify-center rounded-xl bg-white px-7 text-base font-semibold text-slate-900 shadow-lg transition-all hover:-translate-y-0.5 hover:bg-brand-50"
          >
            Get Started Now
            <ArrowRightIcon />
          </Link>
          <a
            href="#contact"
            className="inline-flex h-12 items-center justify-center rounded-xl border border-white/20 bg-white/5 px-6 text-base font-semibold text-white backdrop-blur transition-colors hover:bg-white/10"
          >
            Book a 15-min demo
          </a>
        </div>
      </div>
    </section>
  );
}

function OwnerBenefitsSection() {
  return (
    <section className="bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <span className="text-xs font-semibold uppercase tracking-widest text-brand-600">
            For the business owner
          </span>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
            No-shows cost real money. ReserveNI helps you keep it.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-600">
            Deposits, reminders, and confirm-or-cancel messages work together to protect your diary and
            reduce empty gaps. The result is steadier days and stronger revenue.
          </p>
        </div>

        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {ownerBenefits.map((b) => (
            <div
              key={b.title}
              className="group relative rounded-2xl border border-slate-100 bg-gradient-to-br from-white to-slate-50 p-7 transition-all hover:-translate-y-1 hover:border-brand-200 hover:shadow-xl hover:shadow-brand-600/5"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-100 transition-colors group-hover:bg-brand-100">
                <b.icon />
              </div>
              <h3 className="mt-5 text-lg font-semibold text-slate-900">{b.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{b.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ProductPreview() {
  return (
    <section className="relative overflow-hidden bg-slate-50 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <span className="text-xs font-semibold uppercase tracking-widest text-brand-600">
            Your dashboard
          </span>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Your business, beautifully organised.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-slate-600">
            One screen for today&apos;s diary, tomorrow&apos;s prep, and this month&apos;s numbers. On
            your laptop at home, or your phone at the counter.
          </p>
        </div>

        <div className="relative mt-16">
          {/* Decorative glow */}
          <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-r from-brand-200/40 via-white/0 to-emerald-200/40 blur-3xl" />

          <DashboardMock />
        </div>
      </div>
    </section>
  );
}

function DashboardMock() {
  const slots = [
    { time: "9:00", name: "James M.", service: "Skin fade", color: "bg-brand-600" },
    { time: "9:45", name: "Conor B.", service: "Cut & beard", color: "bg-brand-500" },
    { time: "10:30", name: "Open slot", service: "Available to book", color: "bg-slate-200", empty: true },
    { time: "11:15", name: "Daniel K.", service: "Hot towel shave", color: "bg-emerald-600" },
    { time: "12:00", name: "Lunch", service: "", color: "bg-amber-200/70", empty: true },
    { time: "13:00", name: "Sarah L.", service: "Consultation", color: "bg-brand-600" },
    { time: "13:45", name: "Open slot", service: "Available to book", color: "bg-slate-200", empty: true },
    { time: "14:30", name: "Mark D.", service: "Cut", color: "bg-brand-500" },
  ];

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/10">
      {/* Window chrome */}
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
        <div className="ml-4 hidden h-5 w-72 rounded-md bg-white text-[10px] text-slate-400 sm:flex sm:items-center sm:justify-center sm:gap-1">
          <LockIcon /> reserveni.com/dashboard
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[220px_1fr_280px]">
        {/* Sidebar */}
        <aside className="hidden border-r border-slate-100 bg-slate-50/60 p-4 lg:block">
          <div className="flex items-center gap-2 px-2 pb-4">
            <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-brand-600 to-brand-800" />
            <span className="text-sm font-bold text-slate-900">Grove Street</span>
          </div>
          <nav className="space-y-1 text-sm">
            <SidebarItem label="Today" active />
            <SidebarItem label="Calendar" />
            <SidebarItem label="Clients" />
            <SidebarItem label="Services" />
            <SidebarItem label="Messages" />
            <SidebarItem label="Reporting" />
            <SidebarItem label="Settings" />
          </nav>
        </aside>

        {/* Main */}
        <div className="p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Thursday 25 April
              </p>
              <h3 className="mt-0.5 text-xl font-bold text-slate-900">Today&apos;s diary</h3>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                6 booked
              </span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                2 open
              </span>
            </div>
          </div>

          <div className="mt-5 space-y-2">
            {slots.map((s, i) => (
              <div
                key={i}
                className={`flex items-center gap-3 rounded-xl border p-3 transition-colors ${
                  s.empty
                    ? "border-dashed border-slate-200 bg-slate-50/60"
                    : "border-slate-100 bg-white hover:border-brand-200"
                }`}
              >
                <span className={`h-10 w-1.5 rounded-full ${s.color}`} />
                <span className="w-14 text-xs font-bold text-slate-900">{s.time}</span>
                <div className="flex-1">
                  <p
                    className={`text-sm font-semibold ${
                      s.empty ? "text-slate-400" : "text-slate-900"
                    }`}
                  >
                    {s.name}
                  </p>
                  <p className="text-xs text-slate-500">{s.service}</p>
                </div>
                {!s.empty && (
                  <span className="hidden rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-700 sm:inline">
                    Deposit paid
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Right panel */}
        <aside className="border-t border-slate-100 bg-slate-50/50 p-5 lg:border-l lg:border-t-0 lg:p-6">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">This week</h4>
          <div className="mt-3 grid grid-cols-3 gap-3 lg:grid-cols-1">
            <StatCard label="Bookings" value="47" trend="+18%" />
            <StatCard label="Revenue" value="£1,284" trend="+22%" />
            <StatCard label="No-shows" value="0.9%" trend="−63%" good />
          </div>

          <h4 className="mt-6 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Messages sent today
          </h4>
          <div className="mt-3 space-y-2">
            <MessageRow type="SMS" text="Reminder: Mark, 2:30 PM" />
            <MessageRow type="Email" text="Thank you: James M." />
            <MessageRow type="SMS" text="Confirm or cancel: Daniel" />
          </div>
        </aside>
      </div>
    </div>
  );
}

function SidebarItem({ label, active = false }: { label: string; active?: boolean }) {
  return (
    <div
      className={`flex items-center rounded-lg px-3 py-2 font-medium ${
        active ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-100" : "text-slate-600"
      }`}
    >
      <span className={`mr-2 h-1.5 w-1.5 rounded-full ${active ? "bg-brand-600" : "bg-slate-300"}`} />
      {label}
    </div>
  );
}

function StatCard({
  label,
  value,
  trend,
  good = false,
}: {
  label: string;
  value: string;
  trend: string;
  good?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-100 bg-white p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-extrabold text-slate-900">{value}</p>
      <p className={`text-[11px] font-semibold ${good ? "text-emerald-600" : "text-emerald-600"}`}>
        {trend}
      </p>
    </div>
  );
}

function MessageRow({ type, text }: { type: string; text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-100 bg-white px-3 py-2">
      <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-brand-700">
        {type}
      </span>
      <span className="text-xs text-slate-600">{text}</span>
    </div>
  );
}

function ClientBenefitsSection() {
  return (
    <section className="bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
          <div>
            <span className="text-xs font-semibold uppercase tracking-widest text-brand-600">
              For your clients
            </span>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
              An experience that makes them come back.
            </h2>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-600">
              The way a client books shapes how they feel about your business before they even walk in.
              ReserveNI gives them a fast, confident experience. No phone tag, no forms, no friction.
            </p>
            <ul className="mt-8 space-y-3">
              {clientBenefits.map((c) => (
                <li key={c} className="flex items-start gap-3 text-sm text-slate-700">
                  <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                    <TickIcon small />
                  </span>
                  {c}
                </li>
              ))}
            </ul>
          </div>

          {/* Booking flow visual */}
          <BookingFlowVisual />
        </div>
      </div>
    </section>
  );
}

function BookingFlowVisual() {
  return (
    <div className="relative">
      <div className="absolute -inset-6 rounded-[2rem] bg-gradient-to-br from-emerald-100 via-brand-50 to-white blur-2xl" />

      <div className="relative grid gap-3 sm:grid-cols-3">
        <MiniCard step="1" title="Pick a service">
          <div className="mt-2 space-y-1.5">
            <Row text="Men's cut" price="£18" active />
            <Row text="Cut & beard" price="£26" />
            <Row text="Hot towel shave" price="£22" />
          </div>
        </MiniCard>
        <MiniCard step="2" title="Pick a time">
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {["10:00", "10:30", "11:00", "11:30", "12:00", "12:30"].map((t, i) => (
              <span
                key={t}
                className={`rounded-md px-1.5 py-1 text-center text-[10px] font-semibold ${
                  i === 3 ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"
                }`}
              >
                {t}
              </span>
            ))}
          </div>
        </MiniCard>
        <MiniCard step="3" title="Confirm & pay">
          <div className="mt-2 space-y-1.5">
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-500">Total</span>
              <span className="font-semibold text-slate-900">£26</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-500">Deposit</span>
              <span className="font-semibold text-slate-900">£5</span>
            </div>
            <div className="mt-2 rounded-md bg-brand-600 py-1.5 text-center text-[11px] font-bold text-white">
              Pay deposit
            </div>
          </div>
        </MiniCard>
      </div>
    </div>
  );
}

function MiniCard({
  step,
  title,
  children,
}: {
  step: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
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

function Row({ text, price, active = false }: { text: string; price: string; active?: boolean }) {
  return (
    <div
      className={`flex items-center justify-between rounded-md px-2 py-1.5 text-[11px] ${
        active ? "bg-brand-50 ring-1 ring-brand-200" : "bg-slate-50"
      }`}
    >
      <span className={active ? "font-semibold text-brand-800" : "text-slate-700"}>{text}</span>
      <span className={active ? "font-bold text-brand-800" : "text-slate-500"}>{price}</span>
    </div>
  );
}

function StatsBand() {
  return (
    <section className="bg-gradient-to-br from-brand-600 via-brand-700 to-brand-800 py-16 text-white">
      <div className="mx-auto grid max-w-6xl gap-8 px-6 text-center sm:grid-cols-3">
        <Stat value="24/7" label="online booking captures demand while you are closed" />
        <Stat value="-80%" label="fewer no-shows when you take a deposit*" />
        <Stat value="10+ hrs" label="saved weekly with automated reminders and confirmations" />
      </div>
      <p className="mx-auto mt-6 max-w-3xl px-6 text-center text-xs text-white/60">
        *Typical reduction reported by service businesses that introduce per-booking deposits.
      </p>
    </section>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="text-4xl font-extrabold tracking-tight sm:text-5xl">{value}</p>
      <p className="mx-auto mt-2 max-w-xs text-sm text-white/80">{label}</p>
    </div>
  );
}

function HowItWorksSection() {
  return (
    <section id="how" className="scroll-mt-16 bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <span className="text-xs font-semibold uppercase tracking-widest text-brand-600">
            How it works
          </span>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
            Up and running before your next coffee.
          </h2>
        </div>

        <div className="mt-16 grid gap-8 md:grid-cols-3">
          {howItWorks.map((s, i) => (
            <div key={s.step} className="relative">
              {i < howItWorks.length - 1 && (
                <div className="absolute left-14 top-7 hidden h-0.5 w-full bg-gradient-to-r from-brand-200 to-transparent md:block" />
              )}
              <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 text-xl font-extrabold text-white shadow-lg shadow-brand-600/25">
                {s.step}
              </div>
              <h3 className="mt-5 text-xl font-bold text-slate-900">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{s.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function BookingChannelsSection() {
  return (
    <section className="relative overflow-hidden bg-white py-16 sm:py-24">
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(to right, #0f172a 1px, transparent 1px), linear-gradient(to bottom, #0f172a 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      <div className="relative mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <span className="text-xs font-semibold uppercase tracking-widest text-brand-600">
            Be easy to book, everywhere
          </span>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
            One booking system your clients can reach from any channel.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-600">
            Website, social links, and QR codes all feed the same live diary. No double entry, no missed
            messages, and no lost bookings between channels.
          </p>
        </div>

        <div className="mt-16 grid gap-6 lg:grid-cols-3">
          <ChannelCard
            label="Embed on your website"
            title="Add booking to your existing website"
            description="Drop the ReserveNI widget into your existing website in 30 seconds. Clients book without ever leaving your site, with your branding all the way through."
            visual={<EmbedVisual />}
            featured
          />
          <ChannelCard
            label="Your own booking site"
            title="reserveni.com/book/your-business"
            description="A stunning, mobile-first booking site dedicated to your business. No website required. Use it as your main online home, or alongside your existing one."
            visual={<YourSiteVisual />}
          />
          <ChannelCard
            label="Share your link anywhere"
            title="One link for everything you do."
            description="Paste your booking link into your Instagram bio, send it in a WhatsApp reply, print it on a business card, or turn it into a QR code for your counter and flyers."
            visual={<ShareLinkVisual />}
          />
        </div>
      </div>
    </section>
  );
}

function ChannelCard({
  label,
  title,
  description,
  visual,
  featured = false,
}: {
  label: string;
  title: string;
  description: string;
  visual: React.ReactNode;
  featured?: boolean;
}) {
  return (
    <div
      className={`group relative flex flex-col overflow-hidden rounded-2xl border bg-gradient-to-br from-white to-slate-50 p-6 transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-brand-600/5 ${
        featured ? "border-brand-200 ring-2 ring-brand-100/70" : "border-slate-100 hover:border-brand-200"
      }`}
    >
      <div className="relative flex h-44 items-center justify-center overflow-hidden rounded-xl border border-slate-100 bg-white p-4">
        {visual}
      </div>
      <div className="mt-6">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-brand-600">
          {label}
        </span>
        <h3 className="mt-2 text-lg font-semibold text-slate-900">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">{description}</p>
      </div>
    </div>
  );
}

function YourSiteVisual() {
  return (
    <div className="relative flex w-full max-w-[200px] flex-col items-center">
      <div className="flex h-4 w-full items-center gap-1 rounded-t-md border border-b-0 border-slate-200 bg-slate-50 px-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
        <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
        <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
        <div className="ml-1 flex h-2.5 flex-1 items-center justify-center rounded bg-white px-1 text-[7px] font-semibold text-slate-500">
          reserveni.com/book/you
        </div>
      </div>
      <div className="w-full rounded-b-md border border-slate-200 bg-white p-2.5">
        <div className="h-2 w-16 rounded bg-slate-200" />
        <div className="mt-1 h-1.5 w-24 rounded bg-slate-100" />
        <div className="mt-3 grid grid-cols-3 gap-1">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span
              key={i}
              className={`h-4 rounded text-center text-[7px] font-bold ${
                i === 2
                  ? "bg-brand-600 text-white"
                  : "bg-slate-100 text-transparent"
              }`}
            >
              11:00
            </span>
          ))}
        </div>
        <div className="mt-2 h-4 rounded bg-brand-600" />
      </div>
    </div>
  );
}

function EmbedVisual() {
  return (
    <div className="relative w-full max-w-[220px] rounded-md border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-1 border-b border-slate-100 px-2 py-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
        <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
        <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
        <span className="ml-1 text-[7px] font-semibold text-slate-500">yourbusiness.co.uk</span>
      </div>
      <div className="p-2.5">
        <div className="h-2 w-20 rounded bg-slate-800" />
        <div className="mt-1 h-1.5 w-28 rounded bg-slate-200" />
        <div className="relative mt-2 rounded-md border-2 border-dashed border-brand-300 bg-brand-50/40 p-2">
          <span className="absolute -top-1.5 left-2 rounded bg-brand-600 px-1 py-0.5 text-[6px] font-bold uppercase tracking-wider text-white">
            Booking widget
          </span>
          <div className="mt-1 grid grid-cols-3 gap-1">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <span
                key={i}
                className={`h-3.5 rounded ${
                  i === 1 ? "bg-brand-600" : "bg-white ring-1 ring-slate-200"
                }`}
              />
            ))}
          </div>
          <div className="mt-1.5 h-3 rounded bg-brand-600" />
        </div>
      </div>
    </div>
  );
}

function ShareLinkVisual() {
  return (
    <div className="flex w-full max-w-[220px] flex-col items-center gap-2">
      <div className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 shadow-sm">
        <svg
          className="h-3.5 w-3.5 flex-shrink-0 text-brand-600"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"
          />
        </svg>
        <span className="truncate text-[9px] font-semibold text-slate-800">
          reserveni.com/book/you
        </span>
        <span className="ml-auto rounded bg-brand-600 px-1.5 py-0.5 text-[7px] font-bold text-white">
          Copy
        </span>
      </div>
      <div className="grid w-full grid-cols-3 gap-1.5">
        <ChannelChip label="Instagram bio" />
        <ChannelChip label="WhatsApp" />
        <ChannelChip label="QR code" svg={<QrMiniIcon />} />
        <ChannelChip label="Facebook" />
        <ChannelChip label="Google" />
        <ChannelChip label="Flyers" />
      </div>
    </div>
  );
}

function ChannelChip({ label, svg }: { label: string; svg?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-md border border-slate-100 bg-slate-50 px-1 py-1.5">
      {svg ?? <span className="h-3 w-3 rounded-sm bg-brand-200" />}
      <span className="text-[7px] font-semibold text-slate-600">{label}</span>
    </div>
  );
}

function QrMiniIcon() {
  return (
    <svg className="h-3 w-3 text-brand-700" fill="currentColor" viewBox="0 0 24 24">
      <path d="M3 3h7v7H3V3Zm2 2v3h3V5H5Zm9-2h7v7h-7V3Zm2 2v3h3V5h-3ZM3 14h7v7H3v-7Zm2 2v3h3v-3H5Zm9-2h3v3h-3v-3Zm4 0h3v3h-3v-3Zm-4 4h3v3h-3v-3Zm4 0h3v3h-3v-3Z" />
    </svg>
  );
}

function UseCasesSection() {
  return (
    <section className="bg-slate-50 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <span className="text-xs font-semibold uppercase tracking-widest text-brand-600">
            Built for
          </span>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
            If it&apos;s bookable, we handle it.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-600">
            One-to-ones, group classes, multi-day courses, resources, shared equipment. ReserveNI
            flexes to fit the way your business actually works.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {useCases.map((u) => (
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
          <div className="flex items-center justify-center rounded-xl border border-dashed border-brand-200 bg-brand-50/60 p-4 text-sm font-semibold text-brand-700">
            + anything else you book
          </div>
        </div>
      </div>
    </section>
  );
}

function FeaturesSection() {
  return (
    <section className="bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <span className="text-xs font-semibold uppercase tracking-widest text-brand-600">
            What&apos;s inside
          </span>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
            Everything you need. Nothing you don&apos;t.
          </h2>
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
      </div>
    </section>
  );
}

function FaqSection() {
  return (
    <section className="bg-slate-50 py-20 sm:py-28">
      <div className="mx-auto max-w-4xl px-6">
        <div className="text-center">
          <span className="text-xs font-semibold uppercase tracking-widest text-brand-600">
            Questions?
          </span>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Everything you want to know.
          </h2>
        </div>

        <div className="mt-12 space-y-3">
          {faqs.map((f) => (
            <details
              key={f.q}
              className="group rounded-2xl border border-slate-200 bg-white p-6 open:shadow-md"
            >
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

function ClosingCta() {
  return (
    <section id="contact" className="scroll-mt-16 bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-brand-800 to-brand-900 px-4 py-12 text-white shadow-2xl sm:px-8 sm:py-14 md:px-12 md:py-16">
          <div
            className="absolute inset-0 opacity-30"
            style={{
              backgroundImage:
                "radial-gradient(circle at 20% 30%, rgba(78,107,120,0.8) 0%, transparent 40%), radial-gradient(circle at 85% 70%, rgba(5,150,105,0.5) 0%, transparent 45%)",
            }}
          />
          <div className="relative grid grid-cols-1 gap-8 sm:gap-10 lg:grid-cols-2 lg:items-stretch lg:gap-12">
            <div className="min-w-0">
              <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-5xl">
                Ready to take your diary back?
              </h2>
              <p className="mt-5 max-w-lg text-base leading-relaxed text-white/80">
                Set up in under 30 minutes. We&apos;re here to help if you need any more information or
                assistance signing up; just send us a note and we&apos;ll get back to you.
              </p>

              <div className="mt-6 flex w-full max-w-full flex-col gap-3 rounded-xl border border-white/20 bg-white/10 px-4 py-3 backdrop-blur sm:flex-row sm:items-start">
                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-white/20 text-white">
                  <TagIcon small />
                </span>
                <div className="min-w-0 flex-1 text-sm">
                  <span className="font-semibold text-white">Founding Partner Offer: </span>
                  <span className="text-white/80">Use code </span>
                  <span className="rounded bg-white/20 px-1.5 py-0.5 font-mono text-xs font-bold tracking-wider text-white">
                    RESERVE50
                  </span>
                  <span className="text-white/80"> at checkout for 50% off for our first 50 Northern Ireland businesses.</span>
                </div>
              </div>

              <div className="mt-6 grid max-w-xl grid-cols-1 gap-3 text-xs text-white/85 sm:grid-cols-2">
                <div className="rounded-lg border border-white/15 bg-white/10 px-3 py-2">Set up in under 30 minutes</div>
                <div className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 leading-snug">
                  No commission or booking fees on ReserveNI.
                  <span className="mt-1 block text-white/75">{STANDARD_PAYMENT_PROVIDER_FEES_NOTICE}</span>
                </div>
                <div className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 sm:col-span-2">
                  {SUBSCRIPTION_CANCELLATION_PUBLIC_NOTICE}
                </div>
                <div className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 sm:col-span-2">
                  Local NI support
                </div>
              </div>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/#pricing"
                  className="inline-flex h-12 items-center justify-center rounded-xl bg-white px-7 text-base font-semibold text-slate-900 shadow-lg transition-all hover:-translate-y-0.5 hover:bg-brand-50"
                >
                  Get Started Now
                  <ArrowRightIcon />
                </Link>
                <a
                  href="mailto:hello@reserveni.com"
                  className="inline-flex h-12 items-center justify-center rounded-xl border border-white/20 bg-white/5 px-6 text-base font-semibold text-white backdrop-blur transition-colors hover:bg-white/10"
                >
                  hello@reserveni.com
                </a>
              </div>

              <div className="mt-10 grid grid-cols-2 gap-6 border-t border-white/10 pt-8 text-sm text-white/70">
                <div>
                  <p className="text-2xl font-bold text-white">0%</p>
                  <p className="text-xs">ReserveNI commission on bookings</p>
                  <p className="mt-1 text-[10px] leading-snug text-white/60">{STANDARD_PAYMENT_PROVIDER_FEES_NOTICE}</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-white">Local</p>
                  <p className="text-xs">data, local support</p>
                </div>
              </div>
            </div>

            <div className="min-w-0 w-full max-w-full rounded-2xl bg-white p-5 text-slate-900 shadow-xl sm:p-8">
              <h3 className="text-lg font-bold">Or, tell us about your business.</h3>
              <p className="mt-1 text-sm text-slate-500">
                We&apos;ll get back to you within one working day.
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

function Footer() {
  return (
    <footer className="border-t border-slate-100 bg-slate-50 py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-6 text-sm text-slate-500 sm:flex-row sm:justify-between">
        <p className="max-w-xl text-center leading-snug sm:text-left">
          &copy; 2026 ReserveNI · JAR 26 LTD (NI740269) · 100a Main Street, Bangor, BT20 4AG, UK
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 sm:justify-end">
          <Link href="/" className="transition-colors hover:text-slate-900">
            Home
          </Link>
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
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Icons
 * ──────────────────────────────────────────────────────────────────────────── */

function TickIcon({ small = false }: { small?: boolean }) {
  return (
    <svg
      className={small ? "h-3 w-3" : "h-4 w-4"}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2.5}
      stroke="currentColor"
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
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2.5}
      stroke="currentColor"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      className="h-3 w-3"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
      />
    </svg>
  );
}

function PhoneOffIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14.25 9.75 21 3m0 0h-6.75M21 3v6.75M9 5.25h-.75A2.25 2.25 0 0 0 6 7.5v9a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 16.5v-5.25"
      />
    </svg>
  );
}

function GhostIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4.5 19.5V12a7.5 7.5 0 1 1 15 0v7.5l-2.25-1.5-2.25 1.5-2.25-1.5-2.25 1.5-2.25-1.5L4.5 19.5Z"
      />
      <circle cx="9.5" cy="11" r="0.75" fill="currentColor" />
      <circle cx="14.5" cy="11" r="0.75" fill="currentColor" />
    </svg>
  );
}

function CalendarAlertIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75M3 18.75V10.5A2.25 2.25 0 0 1 5.25 8.25h13.5A2.25 2.25 0 0 1 21 10.5v8.25M12 12.75v3m0 2.25h.007v.008H12v-.008Z"
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

function InboxIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 13.5h3.86a2.25 2.25 0 0 1 2.012 1.244l.256.512a2.25 2.25 0 0 0 2.013 1.244h3.218a2.25 2.25 0 0 0 2.013-1.244l.256-.512a2.25 2.25 0 0 1 2.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 0 0-2.15-1.588H6.911a2.25 2.25 0 0 0-2.15 1.588L2.35 13.177a2.25 2.25 0 0 0-.1.661Z"
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
        d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.898 20.624 16.5 21.75l-.398-1.126a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.179-.398a2.25 2.25 0 0 0 1.423-1.423l.398-1.126.398 1.126a2.25 2.25 0 0 0 1.423 1.423L19.5 18.75l-1.179.398a2.25 2.25 0 0 0-1.423 1.423Z"
      />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}

function ShieldPoundIcon() {
  return (
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75 11.25 15 15 9.75M21 12c0 5.25-4 9.75-9 9.75S3 17.25 3 12V6.75l9-3 9 3V12Z"
      />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
      />
    </svg>
  );
}

function UserCardIcon() {
  return (
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Zm6-10.125a1.875 1.875 0 1 1-3.75 0 1.875 1.875 0 0 1 3.75 0Zm1.294 6.336a6.721 6.721 0 0 1-3.17.789 6.721 6.721 0 0 1-3.168-.789 3.376 3.376 0 0 1 6.338 0Z"
      />
    </svg>
  );
}

function TrendUpIcon() {
  return (
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941"
      />
    </svg>
  );
}

function TagIcon({ small = false }: { small?: boolean }) {
  return (
    <svg className={small ? "h-4 w-4" : "h-6 w-6"} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6Z" />
    </svg>
  );
}
