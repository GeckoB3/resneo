import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'About Resneo - The team behind the booking software',
  description:
    'Resneo is booking management software built by three founders. No commissions, no per-booking fees, total data ownership, and honest support straight from the people who build it.',
};

const principles = [
  {
    title: 'Simplicity & Honesty',
    description:
      'Booking software should stay out of the way and let you get on with serving your customers.',
    icon: SparkleIcon,
  },
  {
    title: 'Margin Protection',
    description:
      'Businesses should not lose hard-earned profits to global marketplace "success taxes".',
    icon: ShieldIcon,
  },
  {
    title: 'Client Experience',
    description:
      'Your customers should be able to book a slot in seconds, 24/7, without waiting for a DM reply.',
    icon: ClockIcon,
  },
  {
    title: 'Data Ownership',
    description:
      'Your clients are your clients. Full export, total portability, zero lock-in. Period.',
    icon: DatabaseIcon,
  },
];

const businessTypes = [
  'Hairdressers & Barbers',
  'Beauty & Aesthetic Clinics',
  'Gyms & Yoga Studios',
  'Physios & Chiropractors',
  'Sports Facilities & Courts',
  'Dog Groomers',
  'Photography Studios',
  'Tutors & Driving Instructors',
  'Restaurants & Cafés',
];

const fixes = [
  {
    eyebrow: 'Secured revenue',
    title: 'Wipe out no-shows with upfront payments',
    description:
      'Built-in Stripe integration lets you take deposits or full payments at the point of booking. Funds go directly to your Stripe account. Resneo never holds your money.',
  },
  {
    eyebrow: 'Predictable overheads',
    title: 'Flat-rate monthly pricing',
    description:
      'Generous SMS allowances and unlimited email confirmations are included on every plan. No commission on bookings, no booking fees for your customers, and no surprise overage bills.',
  },
  {
    eyebrow: 'The freelance fix',
    title: '"Link & Break" calendar sync for modern salons',
    description:
      'Chair-renters and independent stylists can securely link their diaries to the master salon floor and retain 100% ownership of their own client data if they ever move on. No messy data battles, total GDPR compliance.',
  },
];

const founders = [
  {
    name: 'John',
    initials: 'J',
    role: 'Co-Founder & Head of Operations',
    accentClass: 'from-brand-500 to-brand-700',
    summary: 'The operational and strategic backbone of the company.',
    body:
      'John oversees the strategic and operational side of Resneo, ensuring our platform runs seamlessly every single day. With a strong background in business operations and compliance, he manages the behind-the-scenes structures, from payment security partnerships to long-term scaling. His focus is on building a stable, sustainable company that businesses can rely on for years to come.',
  },
  {
    name: 'Andrew',
    initials: 'A',
    role: 'Co-Founder & Chief Technology Officer',
    accentClass: 'from-brand-500 to-brand-700',
    summary: 'The technical architect behind Resneo, building from our Holywood office.',
    body:
      'A seasoned software engineer, Andrew builds and maintains our entire platform infrastructure right here in Holywood. He believes business software should be incredibly powerful on the inside but beautifully simple on the outside. Because Andrew owns the code, we don\u2019t rely on third-party developers, so we roll out updates, integrations, and features faster than global corporate alternatives.',
  },
  {
    name: 'Ryan',
    initials: 'R',
    role: 'Co-Founder & Head of Growth',
    accentClass: 'from-brand-500 to-brand-700',
    summary: 'On a mission to help independent businesses protect their margins.',
    body:
      'Having spent years working closely with independent operators, Ryan saw first-hand how global booking apps were draining salons and clinics with unfair commissions and hidden fees. He handles partnerships, onboardings, and ensures that our platform is built entirely around the practical, day-to-day needs of our users.',
  },
];

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* Nav */}
      <nav className="sticky top-0 z-50 border-b border-slate-100 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex-shrink-0">
            <Image src="/Logo.png" alt="Resneo" width={144} height={40} className="h-9 w-auto" priority />
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="/#pricing"
              className="hidden text-sm font-medium text-slate-600 transition-colors hover:text-slate-900 sm:inline"
            >
              Pricing
            </Link>
            <Link
              href="/login"
              className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
            >
              Log in
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-brand-50 via-white to-brand-50/40" />
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              'radial-gradient(circle at 25% 25%, rgba(0,59,111,0.10) 0%, transparent 50%), radial-gradient(circle at 75% 75%, rgba(0,59,111,0.08) 0%, transparent 50%)',
          }}
        />
        <div className="relative mx-auto max-w-4xl px-6 py-20 text-center sm:py-28 lg:py-32">
          <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-brand-200/60 bg-white/90 px-4 py-1.5 shadow-sm shadow-slate-200/40 backdrop-blur-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-500 shadow-sm shadow-brand-600/40" />
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-700">
              About Resneo
            </p>
          </div>
          <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
            Booking software, built for{' '}
            <span className="bg-gradient-to-r from-brand-600 to-brand-800 bg-clip-text text-transparent">
              the businesses that rely on it
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">
            Resneo was born from a simple frustration: watching hard-working salons, clinics,
            studios and independent businesses lose time to admin and margin to global software
            giants.
          </p>
          <div className="mt-10 flex justify-center">
            <Link
              href="/#contact"
              className="inline-flex h-12 items-center rounded-xl bg-brand-600 px-8 text-base font-semibold text-white shadow-lg shadow-brand-600/20 transition-all hover:bg-brand-700 hover:shadow-xl hover:shadow-brand-600/30"
            >
              Talk to a founder
            </Link>
          </div>
        </div>
      </section>

      {/* Intro narrative */}
      <section className="bg-white py-20 sm:py-24">
        <div className="mx-auto max-w-3xl px-6">
          <div className="space-y-6 text-lg leading-relaxed text-slate-700">
            <p>
              Most booking systems today are either eye-wateringly expensive, overly complicated, or
              built for corporate markets somewhere else. They hit you with enterprise features you
              don&rsquo;t need, take marketplace commissions on clients you earned, and offer
              &ldquo;support&rdquo; that doesn&rsquo;t have a clue how an independent business
              actually operates.
            </p>
            <p className="font-medium text-slate-900">
              Resneo is different. We are building booking management specifically for independent
              businesses: simple to set up, straightforward to use, and priced fairly.
            </p>
          </div>
        </div>
      </section>

      {/* Mission */}
      <section className="relative overflow-hidden border-y border-slate-100 bg-slate-50 py-20 sm:py-28">
        <div
          className="pointer-events-none absolute -left-32 top-10 h-72 w-72 rounded-full bg-brand-200/30 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -right-24 bottom-10 h-64 w-64 rounded-full bg-brand-100/40 blur-3xl"
          aria-hidden
        />
        <div className="relative mx-auto max-w-4xl px-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-700">
            Our mission
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Manage your diary with zero fuss. Eliminate no-shows. Keep 100% of what you earn.
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">
            Whether you run a hair studio, a busy clinic, a fitness studio, or a venue with a large
            team, Resneo gives you the exact tools you need to stay in control of your time and your
            money.
          </p>
          <blockquote className="mx-auto mt-10 max-w-2xl rounded-2xl border border-brand-200/60 bg-white px-6 py-6 text-left shadow-sm">
            <p className="text-base font-medium leading-relaxed text-slate-800 sm:text-lg">
              <span className="mr-1 text-2xl leading-none text-brand-500">&ldquo;</span>
              Your booking system should make your life easier, not create a second job.
              <span className="ml-1 text-2xl leading-none text-brand-500">&rdquo;</span>
            </p>
          </blockquote>
        </div>
      </section>

      {/* Why we built it / what we fixed */}
      <section className="bg-white py-20 sm:py-28">
        <div className="mx-auto max-w-5xl px-6">
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-700">
              Why we built Resneo
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              The problems we set out to fix
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-slate-600">
              Running a business here is hard enough without spending your late evenings answering
              Facebook messages, chasing text confirmations, or watching your profits get eaten by
              hidden fees. We brought everything into one clean dashboard built for day-to-day use.
            </p>
          </div>

          <div className="mt-14 grid gap-6 lg:grid-cols-3">
            {fixes.map((fix) => (
              <div
                key={fix.title}
                className="group flex flex-col rounded-2xl border border-slate-100 bg-white p-7 transition-all hover:border-brand-200 hover:shadow-lg hover:shadow-brand-600/5"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent-700">
                  {fix.eyebrow}
                </p>
                <h3 className="mt-3 text-lg font-semibold text-slate-900">{fix.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">{fix.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Local, Practical, Transparent */}
      <section className="bg-slate-50 py-20 sm:py-28">
        <div className="mx-auto grid max-w-5xl gap-12 px-6 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-700">
              How we operate
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Local, practical and transparent
            </h2>
          </div>
          <div className="space-y-5 text-base leading-relaxed text-slate-700 lg:col-span-3">
            <p>
              We believe local business owners deserve software that works on fair terms. To us
              that means <strong className="font-semibold text-slate-900">zero per-booking commissions</strong>{' '}
              and <strong className="font-semibold text-slate-900">zero customer booking fees</strong>.
            </p>
            <p>
              It means giving you total ownership of your data, with the freedom to export your
              client history whenever you want. And it means real support. We are based right here
              in Holywood, just a phone call or an email away when you need us.
            </p>
            <p>
              Resneo is designed around the way independent businesses actually work: lean teams,
              busy days, loyal customers, and absolutely no patience for software that gets in the
              way.
            </p>
          </div>
        </div>
      </section>

      {/* Who it's for */}
      <section className="bg-white py-20 sm:py-28">
        <div className="mx-auto max-w-5xl px-6">
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-700">
              Who it&rsquo;s for
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Built for any business that takes bookings
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-slate-600">
              If your business depends on people booking a time, a service, a table or a space,
              Resneo is built for you.
            </p>
          </div>

          <div className="mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {businessTypes.map((bt) => (
              <div
                key={bt}
                className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white px-5 py-4 text-sm font-medium text-slate-800 shadow-sm transition-all hover:border-brand-200 hover:shadow-md hover:shadow-brand-600/5"
              >
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                  <CheckIcon />
                </span>
                {bt}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What we stand for */}
      <section className="bg-slate-50 py-20 sm:py-28">
        <div className="mx-auto max-w-5xl px-6">
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-700">
              What we stand for
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Four principles, kept simple
            </h2>
          </div>

          <div className="mt-14 grid gap-6 sm:grid-cols-2">
            {principles.map((p) => (
              <div
                key={p.title}
                className="group flex gap-5 rounded-2xl border border-slate-100 bg-white p-6 transition-all hover:border-brand-200 hover:shadow-lg hover:shadow-brand-600/5"
              >
                <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 transition-colors group-hover:bg-brand-100">
                  <p.icon />
                </span>
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">{p.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{p.description}</p>
                </div>
              </div>
            ))}
          </div>

          <p className="mx-auto mt-12 max-w-2xl text-center text-base leading-relaxed text-slate-600">
            Resneo isn&rsquo;t trying to be a generic global directory. We&rsquo;re a practical,
            independent platform built to help businesses grow entirely on their own terms.
            We&rsquo;re proud of what we&rsquo;re building, and we&rsquo;re only getting started.
          </p>
        </div>
      </section>

      {/* Meet the Founders */}
      <section className="bg-white py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-700">
              Meet the founders
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              The team behind Resneo
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-slate-600">
              Resneo was founded by three entrepreneurs who combined their backgrounds in
              business, technology and operations to build a better alternative for independent
              businesses.
            </p>
          </div>


          <div className="mt-14 grid gap-6 lg:grid-cols-3">
            {founders.map((founder) => (
              <article
                key={founder.name}
                className="flex flex-col rounded-2xl border border-slate-100 bg-white p-7 shadow-sm transition-all hover:border-brand-200 hover:shadow-lg hover:shadow-brand-600/5"
              >
                <div className="flex items-center gap-4">
                  <span
                    className={`flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-xl font-bold text-white shadow-md ${founder.accentClass}`}
                  >
                    {founder.initials}
                  </span>
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">{founder.name}</h3>
                    <p className="text-sm font-medium text-brand-700">{founder.role}</p>
                  </div>
                </div>
                <p className="mt-5 text-sm font-medium leading-relaxed text-slate-800">
                  {founder.summary}
                </p>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">{founder.body}</p>
              </article>
            ))}
          </div>

          <div className="mx-auto mt-14 max-w-3xl rounded-2xl border border-brand-200/60 bg-gradient-to-br from-brand-50 via-white to-brand-50/40 p-8 text-center shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-700">
              Based in Holywood, Co Down
            </p>
            <p className="mt-3 text-base leading-relaxed text-slate-700">
              When something goes wrong, Ryan is on the phone, Andrew is on the code, and John is
              running the business. No offshore support centre, no faceless ticketing queue. Just
              the three of us, looking after the businesses that rely on us.
            </p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-slate-100 bg-gradient-to-br from-brand-600 to-brand-700 py-20 sm:py-24">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Ready to take back control of your bookings?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-brand-50">
            Start a 14-day free trial or get in touch. We&rsquo;d love to show you around.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/#pricing"
              className="inline-flex h-12 items-center rounded-xl bg-white px-8 text-base font-semibold text-brand-700 shadow-lg transition-all hover:bg-brand-50"
            >
              See pricing
            </Link>
            <Link
              href="/#contact"
              className="inline-flex h-12 items-center rounded-xl border border-white/30 bg-transparent px-8 text-base font-semibold text-white transition-colors hover:bg-white/10"
            >
              Get in touch
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-100 bg-slate-50 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-6 text-sm text-slate-500 sm:flex-row sm:justify-between">
          <p className="max-w-xl text-center leading-snug sm:text-left">
            &copy; 2026 Resneo &middot; JAR 26 LTD (NI740269) &middot; 100a Main Street, Bangor,
            BT20 4AG, UK
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 sm:justify-end">
            <Link href="/" className="transition-colors hover:text-slate-900">
              Home
            </Link>
            <Link href="/#pricing" className="transition-colors hover:text-slate-900">
              Sign up
            </Link>
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
    </div>
  );
}

function SparkleIcon() {
  return (
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z"
      />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75 11.25 15 15 9.75M21 12c0 1.268-.063 2.522-.187 3.76-.39 3.886-3.43 6.85-7.36 7.39a48.39 48.39 0 0 1-2.906 0c-3.93-.54-6.97-3.504-7.36-7.39A48.4 48.4 0 0 1 3 12c0-1.605.1-3.186.295-4.738.34-2.694 2.36-4.799 5.005-5.337a25.93 25.93 0 0 1 7.4 0c2.645.538 4.665 2.643 5.005 5.337.196 1.552.295 3.133.295 4.738Z"
      />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
      />
    </svg>
  );
}

function DatabaseIcon() {
  return (
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  );
}
