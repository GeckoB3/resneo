import type { CSSProperties } from 'react';
import Script from 'next/script';
import { Cormorant_Garamond, DM_Sans } from 'next/font/google';
import { EMBED_IFRAME_DEFAULT_HEIGHT_PX } from '@/lib/embed/widget-frame';

const display = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-salon-display',
});

const body = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-salon-body',
});

/** Deep espresso used for headings, primary buttons, and the footer. */
const INK = '#241f1c';

/**
 * A readable text colour for anything sitting ON the venue's accent.
 *
 * The accent comes from venue settings and can be any hex. Pale accents (the
 * warm taupes salons tend to pick) leave white text at roughly 1.7:1, far under
 * the 4.5:1 minimum, so the label has to flip to ink instead of assuming white.
 * Standard WCAG relative luminance.
 */
function readableInkOn(hex: string): string {
  const h = hex.replace('#', '').trim();
  if (h.length !== 6) return '#ffffff';
  const channel = (from: number): number => {
    const c = parseInt(h.slice(from, from + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return luminance > 0.45 ? INK : '#ffffff';
}

const SERVICES = [
  {
    name: 'Cut and finish',
    detail: 'Consultation, cut, and a finish that works at home.',
    duration: '45 min',
    price: 'from £42',
  },
  {
    name: 'Balayage',
    detail: 'Hand painted, grown out softly, kept low maintenance.',
    duration: '3 hrs',
    price: 'from £120',
  },
  {
    name: 'Full colour',
    detail: 'Single tone colour, gloss, and a nourishing treatment.',
    duration: '2 hrs',
    price: 'from £85',
  },
  {
    name: 'Highlights',
    detail: 'Foils placed to suit how your hair falls naturally.',
    duration: '2.5 hrs',
    price: 'from £95',
  },
  {
    name: 'Blow dry',
    detail: 'Smooth, full, or tousled. Ready for the evening.',
    duration: '30 min',
    price: 'from £28',
  },
  {
    name: 'Bridal trial',
    detail: 'An unhurried run through, with photos to take away.',
    duration: '90 min',
    price: 'from £75',
  },
] as const;

const TEAM = [
  {
    initials: 'SM',
    name: 'Sarah Mitchell',
    role: 'Director and colour specialist',
    note: 'Fifteen years behind the chair, happiest with a tricky colour correction.',
  },
  {
    initials: 'JO',
    name: 'James O’Neill',
    role: 'Senior stylist',
    note: 'Precision cutting, and the person to see about a proper fringe.',
  },
  {
    initials: 'EH',
    name: 'Emma Hughes',
    role: 'Stylist and extensions',
    note: 'Hand tied extensions and the softest lived in blondes.',
  },
] as const;

const REVIEWS = [
  {
    quote:
      'Booked at eleven at night from my sofa, picked the exact slot I wanted, and had the confirmation before I put the phone down.',
    name: 'Niamh C.',
    context: 'Balayage',
  },
  {
    quote:
      'Sarah actually listened, then talked me out of the thing I thought I wanted. She was right. Best my hair has looked in years.',
    name: 'Rachel D.',
    context: 'Colour correction',
  },
  {
    quote:
      'Lovely calm room, good coffee, and nobody trying to sell me six bottles of anything on the way out.',
    name: 'Aoife M.',
    context: 'Cut and finish',
  },
] as const;

export function EmbedTestSalonSite({
  venueName,
  venueSlug,
  embedUrl,
  resizeScriptSrc,
  bookUrl,
  snippet,
  accentHex,
  showDeveloperPanel = false,
}: {
  /** The real venue behind the widget. Shown only in the developer panel. */
  venueName: string;
  venueSlug: string;
  embedUrl: string;
  resizeScriptSrc: string;
  bookUrl: string;
  snippet: string;
  accentHex?: string | null;
  showDeveloperPanel?: boolean;
}) {
  const accent = accentHex ? `#${accentHex}` : '#d0c0b0';
  const onAccent = readableInkOn(accent);
  const year = new Date().getFullYear();

  return (
    <div
      className={`${display.variable} ${body.variable} min-h-screen bg-[#faf7f3] text-[#241f1c] antialiased`}
      style={
        {
          fontFamily: 'var(--font-salon-body), system-ui, sans-serif',
          '--accent': accent,
          '--on-accent': onAccent,
        } as CSSProperties
      }
    >
      <a
        href="#book"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:shadow-lg"
      >
        Skip to online booking
      </a>

      {/* ── Announcement ─────────────────────────────────────────────── */}
      <div
        className="px-5 py-2.5 text-center text-[11px] font-medium uppercase tracking-[0.22em] sm:px-8"
        style={{ backgroundColor: 'var(--accent)', color: 'var(--on-accent)' }}
      >
        Now booking into the new season
      </div>

      {/* ── Header ───────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-[#e9e0d5]/70 bg-[#faf7f3]/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-5 py-4 sm:px-8">
          <a href="#top" className="group flex min-w-0 items-center gap-3">
            <span
              aria-hidden
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-lg font-semibold"
              style={{
                backgroundColor: 'var(--accent)',
                color: 'var(--on-accent)',
                fontFamily: 'var(--font-salon-display), Georgia, serif',
              }}
            >
              A
            </span>
            <span className="flex min-w-0 flex-col leading-none">
              <span
                className="truncate text-xl font-semibold tracking-tight sm:text-[1.4rem]"
                style={{ fontFamily: 'var(--font-salon-display), Georgia, serif' }}
              >
                Aura Hair Studio
              </span>
              <span className="mt-1 text-[10px] font-medium uppercase tracking-[0.24em] text-[#8a7f72]">
                Belfast
              </span>
            </span>
          </a>

          <nav
            className="hidden items-center gap-8 text-sm font-medium text-[#5c554c] md:flex"
            aria-label="Main"
          >
            <a href="#services" className="transition-colors hover:text-[#241f1c]">
              Services
            </a>
            <a href="#team" className="transition-colors hover:text-[#241f1c]">
              Our team
            </a>
            <a href="#visit" className="transition-colors hover:text-[#241f1c]">
              Visit
            </a>
            <a
              href="#book"
              className="rounded-full bg-[#241f1c] px-5 py-2.5 text-white shadow-sm transition hover:bg-[#3a322d]"
            >
              Book online
            </a>
          </nav>

          <a
            href="#book"
            className="rounded-full bg-[#241f1c] px-4 py-2 text-sm font-semibold text-white md:hidden"
          >
            Book
          </a>
        </div>
      </header>

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section id="top" className="relative overflow-hidden border-b border-[#ece3d8]">
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-br from-[#f3ece2] via-[#faf7f3] to-[#efe5d8]"
        />
        <div
          aria-hidden
          className="absolute -right-32 -top-16 h-[28rem] w-[28rem] rounded-full opacity-40 blur-3xl"
          style={{ backgroundColor: 'var(--accent)' }}
        />
        <div
          aria-hidden
          className="absolute -left-24 bottom-[-6rem] h-80 w-80 rounded-full bg-[#b39176]/20 blur-3xl"
        />

        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 sm:px-8 md:grid-cols-[1.05fr_0.95fr] md:py-24">
          <div className="space-y-7">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#8a7f72]">
              Hair, colour, and styling
            </p>
            <h1
              className="text-[2.75rem] font-semibold leading-[1.05] tracking-tight sm:text-6xl lg:text-[4rem]"
              style={{ fontFamily: 'var(--font-salon-display), Georgia, serif' }}
            >
              Hair that still
              <span className="block italic text-[#6b4f3a]">looks like you</span>
            </h1>
            <p className="max-w-md text-base leading-relaxed text-[#5c554c] sm:text-lg">
              A small studio off Royal Avenue, where you get the same stylist every time and never
              feel rushed. Book the chair you want in about a minute, any hour of the day.
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <a
                href="#book"
                className="inline-flex items-center justify-center rounded-full bg-[#241f1c] px-8 py-4 text-sm font-semibold text-white shadow-lg shadow-[#241f1c]/10 transition hover:bg-[#3a322d]"
              >
                Book an appointment
              </a>
              <a
                href="#services"
                className="inline-flex items-center justify-center rounded-full border border-[#d8cbbb] bg-white/70 px-8 py-4 text-sm font-semibold text-[#4a4038] transition hover:bg-white"
              >
                See services and prices
              </a>
            </div>

            <dl className="flex flex-wrap gap-x-10 gap-y-4 pt-4 text-sm">
              {[
                { value: '4.9', label: 'from 260 reviews' },
                { value: '12 yrs', label: 'on Royal Avenue' },
                { value: '3', label: 'senior stylists' },
              ].map((stat) => (
                <div key={stat.label}>
                  <dt className="sr-only">{stat.label}</dt>
                  <dd>
                    <span
                      className="block text-2xl font-semibold text-[#241f1c]"
                      style={{ fontFamily: 'var(--font-salon-display), Georgia, serif' }}
                    >
                      {stat.value}
                    </span>
                    <span className="text-xs uppercase tracking-[0.14em] text-[#8a7f72]">
                      {stat.label}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Composed medallion rather than a stock photo: nothing to load, and
              it picks up the venue's own accent colour. */}
          <div className="relative mx-auto w-full max-w-sm md:max-w-none">
            <div className="relative aspect-[4/5] overflow-hidden rounded-[2rem] border border-[#e4d8c9] bg-gradient-to-br from-[#efe6da] to-[#dccbb7] shadow-xl shadow-[#a58f77]/20">
              <div
                aria-hidden
                className="absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-70 blur-2xl"
                style={{ backgroundColor: 'var(--accent)' }}
              />
              <div className="absolute inset-0 grid place-items-center">
                <span
                  className="select-none text-[11rem] leading-none text-[#241f1c]/15"
                  style={{ fontFamily: 'var(--font-salon-display), Georgia, serif' }}
                  aria-hidden
                >
                  A
                </span>
              </div>
              <figure className="absolute inset-x-5 bottom-5 rounded-2xl border border-white/60 bg-white/85 p-4 backdrop-blur-sm">
                <blockquote
                  className="text-sm italic leading-relaxed text-[#4a4038]"
                  style={{ fontFamily: 'var(--font-salon-display), Georgia, serif' }}
                >
                  “I have never had a colour grow out this kindly.”
                </blockquote>
                <figcaption className="mt-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#8a7f72]">
                  Niamh, balayage
                </figcaption>
              </figure>
            </div>
          </div>
        </div>
      </section>

      {/* ── Services ─────────────────────────────────────────────────── */}
      <section id="services" className="scroll-mt-24 bg-[#faf7f3] py-16 sm:py-24">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <div className="max-w-xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#8a7f72]">
              The menu
            </p>
            <h2
              className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl"
              style={{ fontFamily: 'var(--font-salon-display), Georgia, serif' }}
            >
              Services and prices
            </h2>
            <p className="mt-3 leading-relaxed text-[#5c554c]">
              Every appointment starts with a proper consultation. Prices vary with hair length and
              thickness, so we confirm the exact cost with you before we begin.
            </p>
          </div>

          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SERVICES.map((service) => (
              <li
                key={service.name}
                className="group flex flex-col rounded-2xl border border-[#eadfd2] bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-[#d8c8b4] hover:shadow-md"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h3
                    className="text-xl font-semibold text-[#241f1c]"
                    style={{ fontFamily: 'var(--font-salon-display), Georgia, serif' }}
                  >
                    {service.name}
                  </h3>
                  <span className="shrink-0 text-sm font-semibold text-[#6b4f3a]">
                    {service.price}
                  </span>
                </div>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-[#5c554c]">
                  {service.detail}
                </p>
                <p className="mt-4 text-[11px] font-medium uppercase tracking-[0.16em] text-[#8a7f72]">
                  {service.duration}
                </p>
              </li>
            ))}
          </ul>

          <p className="mt-8 text-sm text-[#5c554c]">
            Not sure which to pick?{' '}
            <a href="#book" className="font-semibold text-[#6b4f3a] underline underline-offset-4">
              Book a free consultation
            </a>{' '}
            and we will work it out together.
          </p>
        </div>
      </section>

      {/* ── Team ─────────────────────────────────────────────────────── */}
      <section id="team" className="scroll-mt-24 border-y border-[#ece3d8] bg-[#f4ece2] py-16 sm:py-24">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <div className="max-w-xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#8a7f72]">
              Who you will see
            </p>
            <h2
              className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl"
              style={{ fontFamily: 'var(--font-salon-display), Georgia, serif' }}
            >
              Our team
            </h2>
            <p className="mt-3 leading-relaxed text-[#5c554c]">
              Pick your stylist when you book, or leave it to us and we will match you with whoever
              suits what you are after.
            </p>
          </div>

          <ul className="mt-10 grid gap-6 md:grid-cols-3">
            {TEAM.map((person) => (
              <li
                key={person.name}
                className="rounded-2xl border border-[#e4d8c9] bg-[#faf7f3] p-6 text-center shadow-sm"
              >
                <span
                  aria-hidden
                  className="mx-auto grid h-20 w-20 place-items-center rounded-full text-2xl font-semibold"
                  style={{
                    backgroundColor: 'var(--accent)',
                    color: 'var(--on-accent)',
                    fontFamily: 'var(--font-salon-display), Georgia, serif',
                  }}
                >
                  {person.initials}
                </span>
                <h3
                  className="mt-4 text-xl font-semibold"
                  style={{ fontFamily: 'var(--font-salon-display), Georgia, serif' }}
                >
                  {person.name}
                </h3>
                <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.16em] text-[#8a7f72]">
                  {person.role}
                </p>
                <p className="mt-3 text-sm leading-relaxed text-[#5c554c]">{person.note}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Booking (the embed) ──────────────────────────────────────── */}
      <section id="book" className="scroll-mt-20 bg-white py-16 sm:py-24">
        <div className="mx-auto max-w-3xl px-5 sm:px-8">
          <div className="mb-10 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#8a7f72]">
              Open 24 hours a day
            </p>
            <h2
              className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl"
              style={{ fontFamily: 'var(--font-salon-display), Georgia, serif' }}
            >
              Book online
            </h2>
            <p className="mx-auto mt-3 max-w-lg leading-relaxed text-[#5c554c]">
              Choose a service, pick a stylist and a time that suits, and confirm. Your confirmation
              lands by email straight away, with a reminder before the day.
            </p>
          </div>

          {/*
            The live ResNeo widget, exactly as a venue pastes it from
            Settings, Booking page, Website widget: the iframe (id
            reserveni-widget) plus /embed/resize.js on the host page, which
            posts height changes back so the frame grows with each step.
          */}
          <div className="overflow-hidden rounded-3xl border border-[#eadfd2] bg-[#faf7f3] p-2 shadow-lg shadow-[#a58f77]/10 sm:p-3">
            <iframe
              src={embedUrl}
              width="100%"
              height={EMBED_IFRAME_DEFAULT_HEIGHT_PX}
              style={{ border: 'none', overflow: 'hidden' }}
              scrolling="no"
              id="reserveni-widget"
              title="Book an appointment at Aura Hair Studio"
            />
          </div>

          <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-[#5c554c]">
            {[
              'Instant confirmation',
              'Free to cancel up to 24 hours before',
              'Secure card payments',
            ].map((item) => (
              <li key={item} className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="grid h-5 w-5 place-items-center rounded-full text-[11px] font-bold"
                  style={{ backgroundColor: 'var(--accent)', color: 'var(--on-accent)' }}
                >
                  ✓
                </span>
                {item}
              </li>
            ))}
          </ul>

          <p className="mt-6 text-center text-sm text-[#8a7f72]">
            Prefer to talk it through? Call us on{' '}
            <a href="tel:+442890123456" className="font-semibold text-[#6b4f3a] hover:underline">
              028 9012 3456
            </a>
          </p>
        </div>
      </section>

      {/* ── Reviews ──────────────────────────────────────────────────── */}
      <section className="border-y border-[#ece3d8] bg-[#f4ece2] py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <h2
            className="text-center text-3xl font-semibold tracking-tight sm:text-4xl"
            style={{ fontFamily: 'var(--font-salon-display), Georgia, serif' }}
          >
            What people say
          </h2>
          <ul className="mt-10 grid gap-6 md:grid-cols-3">
            {REVIEWS.map((review) => (
              <li
                key={review.name}
                className="flex flex-col rounded-2xl border border-[#e4d8c9] bg-[#faf7f3] p-6 shadow-sm"
              >
                <p aria-label="Rated 5 out of 5" className="text-sm tracking-[0.2em] text-[#b8935f]">
                  ★★★★★
                </p>
                <blockquote className="mt-3 flex-1 text-[15px] leading-relaxed text-[#4a4038]">
                  {review.quote}
                </blockquote>
                <footer className="mt-5 text-[11px] font-medium uppercase tracking-[0.16em] text-[#8a7f72]">
                  {review.name}, {review.context}
                </footer>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Visit ────────────────────────────────────────────────────── */}
      <section id="visit" className="scroll-mt-24 bg-[#faf7f3] py-16 sm:py-20">
        <div className="mx-auto grid max-w-6xl gap-12 px-5 sm:px-8 md:grid-cols-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#8a7f72]">
              Find us
            </p>
            <h2
              className="mt-3 text-3xl font-semibold tracking-tight"
              style={{ fontFamily: 'var(--font-salon-display), Georgia, serif' }}
            >
              Visit the studio
            </h2>
            <address className="mt-5 not-italic leading-relaxed text-[#5c554c]">
              14 Royal Avenue
              <br />
              Belfast BT1 1FF
            </address>
            <p className="mt-4 text-sm leading-relaxed text-[#5c554c]">
              Two minutes from Castle Court, with paid parking on Berry Street. The studio is on the
              ground floor with step free access.
            </p>
            <a
              href="tel:+442890123456"
              className="mt-5 inline-flex items-center justify-center rounded-full border border-[#d8cbbb] bg-white px-6 py-3 text-sm font-semibold text-[#4a4038] transition hover:bg-[#f4ece2]"
            >
              028 9012 3456
            </a>
          </div>

          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#8a7f72]">
              Opening hours
            </h3>
            <dl className="mt-4 text-sm text-[#5c554c]">
              {[
                { days: 'Monday to Friday', hours: '9:00–18:00' },
                { days: 'Thursday late', hours: '9:00–20:00' },
                { days: 'Saturday', hours: '9:00–17:00' },
                { days: 'Sunday', hours: 'Closed' },
              ].map((row) => (
                <div
                  key={row.days}
                  className="flex justify-between gap-4 border-b border-[#e9e0d5] py-3 last:border-0"
                >
                  <dt>{row.days}</dt>
                  <dd className="font-semibold text-[#241f1c]">{row.hours}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-5 text-sm leading-relaxed text-[#5c554c]">
              Online booking stays open around the clock, including when the studio is closed.
            </p>
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <footer className="bg-[#241f1c] py-12 text-[#c9baa8]">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <div className="flex flex-col items-center gap-6 text-center sm:flex-row sm:items-end sm:justify-between sm:text-left">
            <div>
              <p
                className="text-2xl font-semibold text-[#faf7f3]"
                style={{ fontFamily: 'var(--font-salon-display), Georgia, serif' }}
              >
                Aura Hair Studio
              </p>
              <p className="mt-2 text-sm">14 Royal Avenue, Belfast BT1 1FF</p>
            </div>
            <a
              href="#book"
              className="rounded-full px-7 py-3.5 text-sm font-semibold transition hover:opacity-90"
              style={{ backgroundColor: 'var(--accent)', color: 'var(--on-accent)' }}
            >
              Book online
            </a>
          </div>

          <div className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-white/10 pt-6 text-xs text-[#9a8b7c] sm:flex-row">
            <p>
              © {year} Aura Hair Studio. A fictional salon, used to demonstrate online booking.
            </p>
            <p>
              Online booking powered by{' '}
              <a href="https://www.resneo.com" className="underline hover:text-[#e8ddd0]">
                ResNeo
              </a>
            </p>
          </div>
        </div>
      </footer>

      {/* The host-page resize script: the widget posts its height as the guest
          moves through the steps, and this grows the iframe to match. */}
      <Script src={resizeScriptSrc} strategy="afterInteractive" />

      {/* Internal only, and off unless ?debug=1 is passed, so a prospect never
          sees scaffolding on what is meant to read as a real salon site. */}
      {showDeveloperPanel ? (
        <details className="border-t border-[#e9e0d5] bg-[#f4ece2]">
          <summary className="cursor-pointer px-5 py-3 text-center text-xs font-medium text-[#8a7f72] hover:text-[#5c554c] sm:px-8">
            Developer reference
          </summary>
          <div className="mx-auto max-w-3xl space-y-4 px-5 pb-8 text-sm text-[#5c554c] sm:px-8">
            <p>
              Live venue: <span className="font-medium text-[#241f1c]">{venueName}</span>
              {' · '}
              slug <code className="rounded bg-white/80 px-1.5 py-0.5 font-mono text-xs">{venueSlug}</code>
              {' · '}
              hosted page{' '}
              <a href={bookUrl} className="font-medium text-[#6b4f3a] underline">
                {bookUrl}
              </a>
              {accentHex ? (
                <>
                  {' · '}
                  accent <code className="font-mono text-xs">#{accentHex}</code> (from venue settings)
                </>
              ) : (
                <>
                  {' · '}
                  no accent saved, using the page default
                </>
              )}
            </p>
            <pre className="overflow-x-auto rounded-lg bg-[#241f1c] p-4 text-xs leading-relaxed text-[#e8ddd0]">
              {snippet}
            </pre>
          </div>
        </details>
      ) : null}
    </div>
  );
}
