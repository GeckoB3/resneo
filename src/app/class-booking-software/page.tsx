import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import ContactForm from "@/components/ContactForm";
import { RESNEO_MARKETING_PAYMENTS_AND_NO_HOLD } from "@/lib/booking-funds-copy";
import { STANDARD_PAYMENT_PROVIDER_FEES_NOTICE } from "@/lib/payment-provider-fees-notice";
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
  CalendarDaysIcon,
  ChatIcon,
  ClockIcon,
  CreditCardIcon,
  LayoutGridIcon,
  LinkIcon,
  LockIcon,
  MoonIcon,
  PlusIcon,
  ShieldCheckIcon,
  ShieldPoundIcon,
  TickIcon,
  TicketIcon,
  UserCardIcon,
  UsersIcon,
} from "@/components/marketing/marketing-icons";

const PAGE_PATH = "/class-booking-software";
const SIGNUP = "/#pricing";

export const metadata: Metadata = {
  title: "Class Booking Software for Studios, Gyms & Clubs | Resneo",
  description:
    "Resneo is class and course booking software for yoga, pilates, dance, and fitness studios, gyms, and clubs. Let clients book classes 24/7, sell memberships and class packs, run waitlists and registers, and take payment online. No commission, no marketplace. Start a free 14-day trial.",
  keywords: [
    "class booking software",
    "studio booking software",
    "yoga studio booking software",
    "pilates booking software",
    "fitness class booking system",
    "gym class scheduling software",
    "dance studio booking software",
    "class timetable software",
    "membership and class pack software",
    "course booking software",
  ],
  alternates: { canonical: PAGE_PATH },
  openGraph: {
    title: "Class Booking Software for Studios, Gyms & Clubs | Resneo",
    description:
      "Online class and course booking, memberships and class packs, waitlists, and registers for studios, gyms, and clubs. Full classes, recurring revenue, less admin.",
    url: PAGE_PATH,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Class Booking Software for Studios, Gyms & Clubs | Resneo",
    description:
      "Bookings, memberships, class packs, waitlists, and registers, built for yoga, pilates, dance, and fitness studios.",
  },
};

/* ────────────────────────────────────────────────────────────────────────
   Content
   ──────────────────────────────────────────────────────────────────────── */

const outcomes = [
  {
    eyebrow: "Outcome 01",
    title: "Full classes, every time",
    promise:
      "An empty mat is revenue you cannot get back. Resneo keeps your timetable in front of clients around the clock and fills cancellations from the waitlist automatically.",
    accent: "brand" as const,
    features: [
      {
        title: "24/7 class booking page",
        description:
          "A branded timetable clients can book any time, on the web, your own site, or straight from Instagram, with no app to download.",
        icon: MoonIcon,
      },
      {
        title: "Waitlists that fill themselves",
        description:
          "When a class is full, clients join the waitlist and are promoted automatically the moment a space opens.",
        icon: UsersIcon,
      },
      {
        title: "Drop-ins and last-minute spots",
        description:
          "Surface spaces in upcoming classes so quiet sessions fill, and let drop-ins pay and book in seconds.",
        icon: ClockIcon,
      },
    ],
  },
  {
    eyebrow: "Outcome 02",
    title: "Members who keep coming back",
    promise:
      "The studios that thrive sell more than single classes. Resneo turns one-off visitors into members and pass holders, and renews them on autopilot.",
    accent: "accent" as const,
    features: [
      {
        title: "Memberships, sold on your page",
        description:
          "Offer unlimited or capped memberships that bill automatically each month, paid straight to your account.",
        icon: CreditCardIcon,
      },
      {
        title: "Class packs and credits",
        description:
          "Sell a 10-class pass or a block of credits. Clients spend them at checkout and you see the balance at a glance.",
        icon: TicketIcon,
      },
      {
        title: "Courses and series",
        description:
          "Enrol clients onto a six-week beginners' course or a recurring series in one booking, with their place held for every session.",
        icon: ArrowPathIcon,
      },
    ],
  },
  {
    eyebrow: "Outcome 03",
    title: "Run it without the spreadsheet",
    promise:
      "Your time belongs in the room, not in a paper diary and a group chat. Resneo runs the timetable, registers, and reminders so the admin takes care of itself.",
    accent: "rose" as const,
    features: [
      {
        title: "Live registers and check-in",
        description:
          "Walk into every class with the register on your phone: who is booked, who has paid, and who is on a pack or membership.",
        icon: LayoutGridIcon,
      },
      {
        title: "Automated reminders",
        description:
          "Confirmations and reminders go out by email and SMS before every class, so fewer people forget and more turn up.",
        icon: BellIcon,
      },
      {
        title: "Confirm or cancel in a tap",
        description:
          "Clients confirm or cancel from the reminder itself. An early cancel frees the space for the next person on the waitlist.",
        icon: ChatIcon,
      },
    ],
  },
];

/** Rows shown in the timetable flagship mock. */
const timetableClasses = [
  { time: "18:00", name: "Vinyasa Flow", who: "Amara", state: "2 left", tone: "emerald" as const },
  { time: "19:00", name: "Reformer Pilates", who: "Sofia", state: "Full · waitlist", tone: "amber" as const },
  { time: "19:30", name: "Beginners' course · wk 3", who: "Jay", state: "Enrolled", tone: "accent" as const },
  { time: "20:00", name: "Spin 45", who: "Mara", state: "6 left", tone: "emerald" as const },
];

const timetablePoints = [
  {
    title: "Recurring schedules and courses",
    description:
      "Build your week once and let it repeat. Run drop-in classes, fixed-term courses, and one-off workshops side by side.",
    icon: CalendarDaysIcon,
  },
  {
    title: "Capacity and waitlists",
    description:
      "Set a cap per class. When it is reached, clients join the waitlist and are promoted automatically as spaces open.",
    icon: UsersIcon,
  },
  {
    title: "Memberships, packs and credits",
    description:
      "Sell recurring memberships, class packs, and credits, and let clients book straight against the balance they hold.",
    icon: TicketIcon,
  },
  {
    title: "Registers and attendance",
    description:
      "Take the register on any device, track attendance and no-shows, and see each client's membership or pass status at a glance.",
    icon: LayoutGridIcon,
  },
];

const bookingSteps = [
  { step: "1", title: "Pick a class", description: "Yoga, spin, reformer, kids' swim, or a six-week course. Clients browse your live timetable." },
  { step: "2", title: "Choose a time", description: "Any class in the week, a recurring series, or a full course. Spaces left shown in real time." },
  { step: "3", title: "Reserve a spot", description: "Pay as a drop-in, spend a class-pack credit, or book on an active membership." },
  { step: "4", title: "Confirmed", description: "Instant confirmation and a reminder queued. If it is full, they join the waitlist and are promoted automatically." },
];

const plansMenu = [
  {
    name: "Unlimited monthly",
    duration: "Auto-renews",
    price: "£59",
    tags: ["Best for regulars", "Cancel anytime"],
    tone: "brand" as const,
  },
  {
    name: "10-class pass",
    duration: "Valid 4 months",
    price: "£90",
    tags: ["£9 a class", "Use on any class"],
    tone: "accent" as const,
  },
  {
    name: "Beginners' course · 6 weeks",
    duration: "Mondays 18:00",
    price: "£75",
    tags: ["Place held weekly", "Limited spots"],
    tone: "brand" as const,
  },
];

const businessTypes = [
  { name: "Yoga studios", icon: "🧘" },
  { name: "Pilates & reformer", icon: "🤸" },
  { name: "Dance schools", icon: "🩰" },
  { name: "Gyms & fitness", icon: "🏋️" },
  { name: "Spin & cycle", icon: "🚴" },
  { name: "Barre & sculpt", icon: "💪" },
  { name: "Martial arts & boxing", icon: "🥋" },
  { name: "Swim schools", icon: "🏊" },
  { name: "Climbing & bouldering", icon: "🧗" },
  { name: "Kids' classes", icon: "🧒" },
  { name: "Music & performing arts", icon: "🎵" },
];

const compareRows: { label: string; resneo: string; other: string }[] = [
  { label: "Commission on bookings", resneo: "None, ever", other: "Often a % of every class" },
  { label: "Who owns your members", resneo: "You do", other: "Pooled in a shared marketplace" },
  { label: "Memberships & class packs", resneo: "Built in, sold on your page", other: "Their wallet, their rules" },
  { label: "Payouts", resneo: "Direct to your account", other: "Held and paid on their schedule" },
  { label: "Your branding", resneo: "Your page, your name", other: "Their brand up front" },
];

const faqs = [
  {
    q: "Is Resneo good booking software for a yoga or fitness studio?",
    a: "Yes. Resneo is built for class-based businesses, from yoga, pilates, and dance studios to gyms, clubs, and swim schools. Publish a 24/7 timetable, sell memberships and class packs, run waitlists and registers, and take payment online, with no booking commission.",
  },
  {
    q: "Can clients buy memberships and class packs?",
    a: "Yes. Sell recurring memberships (unlimited or capped), class packs and credits, and multi-week courses. Memberships renew automatically, clients book straight against their balance, and every payment goes directly to your account.",
  },
  {
    q: "Does Resneo handle recurring class schedules and courses?",
    a: "Yes. Build your weekly timetable once and let it repeat, run fixed-term courses where a client enrols once and keeps their place for every session, and add one-off workshops alongside. Changes update the live timetable instantly.",
  },
  {
    q: "What happens when a class is full?",
    a: "You set a capacity for each class. Once it is reached, clients join a waitlist and are promoted automatically the moment a space opens, so cancellations refill themselves instead of leaving an empty spot.",
  },
  {
    q: "Do my clients need to download an app?",
    a: "No. Clients browse the timetable, book, and pay on a fast mobile-friendly web page, with no app and no account wall. You run the register and check people in from your phone or a tablet at the door.",
  },
  {
    q: "I have self-employed instructors. Can each keep separate books?",
    a: `Yes. Each instructor can run their own Resneo with their own clients, timetable, and payouts, then link accounts to share one combined timetable and booking page. Either side can break the link in a click. ${LINKED_ACCOUNTS_HMRC_NOTE}`,
  },
  {
    q: "Does Resneo take commission on class bookings?",
    a: `No. Resneo is one flat subscription with no commission on your bookings, ever. Connect Stripe and ${STANDARD_PAYMENT_PROVIDER_FEES_NOTICE.toLowerCase()} ${RESNEO_MARKETING_PAYMENTS_AND_NO_HOLD}`,
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
      name: "Resneo: Class & Studio Booking Software",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description:
        "Class and course booking software for studios, gyms, and clubs: 24/7 online booking, memberships, class packs and credits, recurring schedules and courses, waitlists with automatic promotion, registers, and online payment.",
      offers: { "@type": "Offer", price: String(APPOINTMENTS_LIGHT_PRICE), priceCurrency: "GBP" },
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "/" },
        { "@type": "ListItem", position: 2, name: "Solutions", item: "/solutions" },
        { "@type": "ListItem", position: 3, name: "Studios & classes", item: PAGE_PATH },
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

export default function ClassBookingSoftwarePage() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Nav />
      <Hero />
      <TrustStrip />
      <TimetableSection />
      <OutcomesSection />
      <BookingFlowSection />
      <PlansSection />
      <RostersSection />
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
            Built for studios &amp; classes
          </span>
          <h1 className="mt-6 text-4xl font-extrabold leading-[1.05] tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
            Class booking software for studios, gyms &amp; clubs
          </h1>
          <p className="mt-5 text-xl font-semibold sm:text-2xl">
            <span className="bg-gradient-to-r from-brand-700 via-brand-600 to-accent-dark bg-clip-text text-transparent">
              Full classes. Recurring revenue. Less admin.
            </span>
          </p>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-600">
            Let clients book classes and courses 24/7, sell memberships and class packs that renew on autopilot,
            and run waitlists and registers without the spreadsheet. Resneo is the all-in-one booking platform for
            studios, gyms, and clubs, with no booking commission and no marketplace renting out your members.
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
              href="#timetable"
              className="inline-flex h-12 items-center justify-center rounded-xl border border-slate-200 bg-white px-6 text-base font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:text-slate-900"
            >
              See the timetable
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
              <TickIcon /> Memberships &amp; class packs built in
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
        <li className="text-slate-700">Studios &amp; classes</li>
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
              Class confirmed
            </div>
            <h3 className="mt-2 text-lg font-bold text-slate-900">Vinyasa Flow · Studio One</h3>
            <p className="mt-0.5 text-xs text-slate-500">Amara Hughes · Thu 18:00</p>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <InfoTile label="When" value="Thu · 18:00" />
              <InfoTile label="Booked on" value="Class pass" accent />
            </div>

            <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Your plan</p>
              <ul className="mt-2 space-y-1.5">
                <ChecklistRow label="Class pass" state="6 of 10 left" done />
                <ChecklistRow label="Reminder" state="2h before" done />
                <ChecklistRow label="Add to calendar" state="Synced" done />
              </ul>
            </div>

            <div className="mt-4 rounded-xl border border-brand-100 bg-brand-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-600">Studio note</p>
              <p className="mt-1 text-xs text-brand-800">Bring a mat and water. Arrive 5 minutes early to settle in.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute -top-6 -left-6 hidden rotate-[-6deg] rounded-xl border border-slate-100 bg-white p-3 shadow-xl shadow-slate-900/10 sm:block">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-50 text-accent-700">
            <TicketIcon className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-slate-900">Class pass</p>
            <p className="text-[10px] text-slate-500">6 classes left</p>
          </div>
        </div>
      </div>

      <div className="absolute -bottom-6 -right-4 hidden rotate-[4deg] rounded-xl border border-slate-100 bg-white p-3 shadow-xl shadow-slate-900/10 sm:block">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
            <UsersIcon className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-slate-900">Waitlist promoted</p>
            <p className="text-[10px] text-slate-500">You&rsquo;re in for 18:00</p>
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
    { value: "24/7", label: "Online timetable" },
    { value: "0%", label: "Commission on bookings" },
    { value: "Auto", label: "Waitlist re-fills" },
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

/* ── Timetable flagship ───────────────────────────────────────────────── */

const recordTone: Record<string, string> = {
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  accent: "border-accent-200 bg-accent-50 text-accent-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
};

function TimetableSection() {
  return (
    <section id="timetable" className="relative scroll-mt-16 overflow-hidden bg-white py-20 sm:py-28">
      <div className="absolute inset-0 bg-gradient-to-br from-brand-50 via-white to-accent-50/40" />
      <div className="relative mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-brand-700 backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            Timetable, memberships &amp; packs
          </span>
          <h2 className="mt-5 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
            Your whole timetable, booked out.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-600">
            Resneo runs your weekly schedule, recurring series, and multi-week courses, sells the memberships and
            class packs that pay for them, and fills cancellations from the waitlist automatically. One timetable,
            always up to date.
          </p>
        </div>

        <div className="mt-14 grid items-start gap-10 lg:grid-cols-2 lg:gap-14">
          {/* Mock: live timetable */}
          <div className="relative">
            <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-r from-brand-100/50 via-white/0 to-accent-200/50 blur-3xl" />
            <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-brand-900/5">
              <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
                <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
                <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
                <span className="ml-3 inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400">
                  <LockIcon /> resneo.com/timetable
                </span>
              </div>
              <div className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">This week</p>
                    <h3 className="mt-0.5 text-lg font-bold text-slate-900">Studio One</h3>
                  </div>
                  <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                    32 booked
                  </span>
                </div>

                <div className="mt-4 space-y-2">
                  {timetableClasses.map((c) => (
                    <div
                      key={c.time + c.name}
                      className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex-shrink-0 rounded-lg bg-white px-2 py-1 text-[11px] font-bold text-slate-700 ring-1 ring-slate-200">
                          {c.time}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-bold text-slate-900">{c.name}</p>
                          <p className="text-[11px] text-slate-500">{c.who}</p>
                        </div>
                      </div>
                      <span className={`flex-shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${recordTone[c.tone]}`}>
                        {c.state}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
                  <p className="text-[12px] font-medium text-amber-800">Reformer 19:00 is full</p>
                  <span className="rounded-lg bg-amber-500 px-2.5 py-1 text-[11px] font-bold text-white">3 on waitlist</span>
                </div>

                <div className="mt-3 rounded-xl border border-brand-100 bg-brand-50 px-3 py-2.5">
                  <p className="text-[11px] font-semibold text-brand-700">Membership</p>
                  <p className="mt-0.5 text-[12px] text-brand-800">Unlimited monthly · renews 1 Jul · paid direct to you.</p>
                </div>
              </div>
            </div>
          </div>

          {/* Points */}
          <div className="grid gap-4 sm:grid-cols-2">
            {timetablePoints.map((p) => (
              <div key={p.title} className="rounded-2xl border border-slate-100 bg-white/80 p-5 shadow-sm backdrop-blur">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-100">
                  <p.icon />
                </div>
                <h3 className="mt-4 text-sm font-bold text-slate-900">{p.title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600">{p.description}</p>
              </div>
            ))}
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
            What every studio owner wants, and how Resneo delivers it.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-600">
            Each promise below maps to the exact Resneo features that make it happen. No buzzwords, just the tools
            doing the work.
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
            From &ldquo;I fancy a class&rdquo; to a confirmed spot: class, time, payment by pass or membership, and a
            reminder queued. No app, no account wall.
          </p>
        </div>

        <div className="relative mt-16">
          <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-r from-brand-100/40 via-white/0 to-accent-200/40 blur-3xl" />
          <div className="relative grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FlowStep step="1" title="Pick a class">
              <div className="mt-3 space-y-1.5">
                <FlowRow text="Vinyasa Flow" meta="18:00" />
                <FlowRow text="Reformer Pilates" meta="Full" />
                <FlowRow text="Spin 45" meta="20:00" active />
              </div>
            </FlowStep>
            <FlowStep step="2" title="Choose a time">
              <div className="mt-3 grid grid-cols-3 gap-1.5">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => (
                  <span key={d} className={`rounded-md px-1 py-1.5 text-center text-[10px] font-semibold ${i === 3 ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}>
                    {d}
                  </span>
                ))}
              </div>
            </FlowStep>
            <FlowStep step="3" title="Reserve a spot">
              <div className="mt-3 space-y-1.5">
                <FlowRow text="Use class pass" meta="6 left" active />
                <FlowRow text="On membership" meta="Active" />
                <FlowRow text="Drop-in" meta="£12" />
              </div>
            </FlowStep>
            <FlowStep step="4" title="Confirmed">
              <div className="mt-3 space-y-1.5">
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-500">Spot</span>
                  <span className="font-semibold text-slate-900">Reserved</span>
                </div>
                <div className="rounded-md bg-slate-50 px-2 py-1 text-[10px] leading-snug text-slate-600">
                  Reminder queued. If full, you&rsquo;re added to the waitlist and promoted automatically.
                </div>
                <div className="mt-1 rounded-md bg-brand-600 py-1.5 text-center text-[11px] font-bold text-white">Book class</div>
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

/* ── Plans (memberships & packs) ──────────────────────────────────────── */

function PlansSection() {
  return (
    <section className="bg-slate-50 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
          <div>
            <span className="text-xs font-semibold uppercase tracking-widest text-accent-700">Memberships &amp; packs</span>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Sell time the way your studio works.
            </h2>
            <p className="mt-5 text-base leading-relaxed text-slate-600">
              Single classes are just the start. Build the memberships, class packs, and courses that turn first
              visits into regulars, and let clients book straight against what they hold.
            </p>
            <ul className="mt-7 space-y-4">
              {[
                { t: "Memberships that auto-renew", d: "Unlimited or capped monthly plans that bill automatically, paid direct to you." },
                { t: "Class packs and credits", d: "A 10-class pass or a block of credits, spent at checkout with the balance always visible." },
                { t: "Courses and series", d: "Enrol once onto a multi-week course and hold the place for every session." },
                { t: "Intro offers and free trials", d: "Win first-timers with a free taster or a discounted intro pack, then convert them to members." },
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
              {plansMenu.map((t) => (
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

/* ── Rosters & registers ──────────────────────────────────────────────── */

function RostersSection() {
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
              Registers &amp; check-in
            </span>
            <h2 className="mt-6 text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">
              Walk in knowing exactly who&rsquo;s coming.
            </h2>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-white/80">
              Every class has a live register with each client&rsquo;s membership or pass status, so check-in is a
              tap and your numbers are never a guess.
            </p>
            <ul className="mt-7 space-y-3">
              {[
                "Live register for every class, on any device",
                "Membership and class-pack status against each name",
                "Attendance and no-show history at a glance",
                "Capacity, waitlist, and check-in in one view",
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
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-brand-600 to-brand-800 text-white">
                <UserCardIcon />
              </span>
              <div>
                <p className="text-base font-bold text-slate-900">Vinyasa Flow</p>
                <p className="text-xs text-slate-500">Thu 18:00 · with Amara</p>
              </div>
              <span className="ml-auto rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">12 of 14</span>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-2 text-center">
              <Stat label="Booked" value="12" />
              <Stat label="Waitlist" value="3" />
              <Stat label="Checked in" value="9" />
            </div>

            <div className="mt-4 space-y-2">
              <RegisterLine name="Maya Reilly" meta="Unlimited member" tone="emerald" />
              <RegisterLine name="Tom Okafor" meta="10-pass · 6 left" tone="accent" />
              <RegisterLine name="Priya Shah" meta="Drop-in · paid" tone="brand" />
              <RegisterLine name="Leo Martin" meta="Waitlist · promoted" tone="amber" />
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

function RegisterLine({ name, meta, tone }: { name: string; meta: string; tone: "accent" | "emerald" | "brand" | "amber" }) {
  const toneClass: Record<string, string> = {
    accent: "bg-accent-100 text-accent-700",
    emerald: "bg-emerald-100 text-emerald-700",
    brand: "bg-brand-100 text-brand-700",
    amber: "bg-amber-100 text-amber-700",
  };
  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2">
      <span className="text-[13px] font-semibold text-slate-800">{name}</span>
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${toneClass[tone]}`}>{meta}</span>
    </div>
  );
}

/* ── Linked accounts (rent a space / freelance instructors) ───────────── */

function LinkedAccountsSection() {
  const benefits = [
    { title: "Separate books per instructor", icon: UserCardIcon },
    { title: "One combined timetable", icon: LayoutGridIcon },
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
                <LinkIcon className="h-3.5 w-3.5" /> Freelance instructors &amp; rent-a-space
              </span>
              <h2 className="mt-5 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                Share a studio. Keep separate books.
              </h2>
              <p className="mt-4 text-base leading-relaxed text-slate-600">
                Freelance instructors teaching across your studios, or renting your space for their own classes? Each
                runs their own Resneo with their own clients, timetable, and payouts. Link accounts to share one
                timetable and a combined booking page, and break the link in a click. Nothing is ever merged.
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
            Made for every kind of class.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-600">
            A solo instructor or a multi-room studio, a weekly drop-in or a multi-week course. If you teach groups
            and sell memberships or passes, Resneo fits.
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
            Keep your members. Keep your margin.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-600">
            Marketplace class apps list you next to every other studio and take a cut. Generic schedulers cannot sell
            a membership or run a waitlist. Resneo does both, under your brand.
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
          Comparison reflects how marketplace and general-purpose booking apps commonly operate. Specifics vary by
          provider.
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
                Fill your timetable. Start free today.
              </h2>
              <p className="mt-5 max-w-lg text-base leading-relaxed text-white/80">
                Take class bookings 24/7, sell memberships and packs that renew themselves, and run waitlists and
                registers without the admin. Set up in an afternoon and start your free 14-day trial. No card needed
                to look around, no booking commission, cancel anytime.
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
              <p className="mt-1 text-sm text-slate-500">Tell us about your studio and we&rsquo;ll reply within one working day.</p>
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
          <Link href="/facility-booking-software" className="transition-colors hover:text-slate-900">Courts &amp; venues</Link>
          <a href={SIGNUP} className="transition-colors hover:text-slate-900">Sign up</a>
          <Link href="/login" className="transition-colors hover:text-slate-900">Login</Link>
          <Link href="/privacy" className="transition-colors hover:text-slate-900">Privacy Policy</Link>
        </div>
      </div>
    </footer>
  );
}
