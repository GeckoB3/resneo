import Link from 'next/link';
import { HomeReveal } from '@/components/home/HomeReveal';
import { LinkBreakDiagram } from '@/components/home/LinkBreakDiagram';
import {
  LINKED_ACCOUNTS_ONE_LINER,
  LINKED_ACCOUNTS_SEPARATE_BOOKS_NOTE,
  LINKED_ACCOUNTS_SEPARATION_NOTE,
} from '@/lib/linked-accounts-marketing-copy';

/* ────────────────────────────────────────────────────────────────────────
   "Link & break": the homepage treatment of ResNeo's differentiator for
   independent people who share a space. Server component; the interactive
   diagram is the only client boundary.

   Copy claims come from the canonical constants in
   src/lib/linked-accounts-marketing-copy.ts. The feature is framed around
   independence, ownership and control. It makes no tax or compliance promise.
   ──────────────────────────────────────────────────────────────────────── */

const PILLARS = [
  {
    title: 'Link in a click',
    body: 'Two independent accounts join one public booking page under a shared name, so clients see a single place to book.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.2 10.8a4.5 4.5 0 0 0-6.4 0l-2.5 2.5a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.8 13.2a4.5 4.5 0 0 0 6.4 0l2.5-2.5a4.5 4.5 0 1 0-6.4-6.4l-1.2 1.2" />
      </svg>
    ),
  },
  {
    title: 'Break in a click',
    body: 'Either side can unlink instantly, on their own, without asking anyone. Access ends, ownership never moves.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.5 17.5 7.8 19.2a4.5 4.5 0 0 1-6.4-6.4l1.7-1.7" transform="translate(2.5 0)" />
        <path strokeLinecap="round" strokeLinejoin="round" d="m14.5 6.5 1.7-1.7a4.5 4.5 0 0 1 6.4 6.4l-1.7 1.7" transform="translate(-2.5 0)" />
        <path strokeLinecap="round" d="M12 2.5v2.2M5.4 5.1 6.9 6.6M18.6 5.1 17.1 6.6" opacity="0.6" />
      </svg>
    ),
  },
  {
    title: 'Nothing is ever merged',
    body: LINKED_ACCOUNTS_SEPARATION_NOTE,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M11.99 3 4.5 6v5.4c0 4.2 3.2 8.1 7.49 9.1 4.3-1 7.51-4.9 7.51-9.1V6L11.99 3Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="m9.4 12.2 1.9 1.9 3.6-3.9" />
      </svg>
    ),
  },
];

export function LinkBreakSection() {
  return (
    <section
      id="link-break"
      className="relative scroll-mt-16 overflow-hidden border-y border-slate-200/70 py-20 sm:py-28"
    >
      {/* Tinted wash so the section reads as its own chapter */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-brand-50 via-white to-accent-50/50" aria-hidden />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            'linear-gradient(to right, #0f172a 1px, transparent 1px), linear-gradient(to bottom, #0f172a 1px, transparent 1px)',
          backgroundSize: '44px 44px',
        }}
        aria-hidden
      />
      <div className="pointer-events-none absolute -left-24 top-24 h-80 w-80 rounded-full bg-accent/10 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -right-24 bottom-10 h-80 w-80 rounded-full bg-brand-200/25 blur-3xl" aria-hidden />

      <div className="relative mx-auto max-w-6xl px-6">
        {/* ── Header ────────────────────────────────────────── */}
        <HomeReveal className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-200/70 bg-white/85 px-3.5 py-1.5 text-xs font-bold uppercase tracking-[0.18em] text-brand-700 shadow-sm backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_rgba(0,194,199,0.8)]" />
            Link &amp; break
          </span>
          <h2 className="mt-6 text-balance text-3xl font-bold leading-[1.1] tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
            Link up. Break away.{' '}
            {/* Ends on accent-700, not accent-600: the lighter teal lands under
                3:1 on white at the tail of the gradient. */}
            <span className="bg-gradient-to-r from-brand-600 to-accent-700 bg-clip-text text-transparent">
              Nothing ever moves.
            </span>
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-pretty text-base leading-relaxed text-slate-600 sm:text-lg">
            {LINKED_ACCOUNTS_ONE_LINER}
          </p>
          <p className="mx-auto mt-4 max-w-2xl text-sm text-slate-500">
            Built for rent-a-chair salons, co-located clinics and multi-practitioner studios, anywhere
            independent people share a space but run their own business.
          </p>
        </HomeReveal>

        {/* ── The diagram ───────────────────────────────────── */}
        <HomeReveal delay={80}>
          <LinkBreakDiagram />
        </HomeReveal>

        {/* ── Three pillars ─────────────────────────────────── */}
        <div className="mt-16 grid gap-4 md:grid-cols-3">
          {PILLARS.map((p, i) => (
            <HomeReveal key={p.title} delay={i * 80}>
              <div className="flex h-full flex-col rounded-2xl border border-slate-200/80 bg-white/85 p-6 shadow-sm backdrop-blur transition-colors hover:border-brand-200">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-100">
                  <span className="block h-5 w-5 [&>svg]:h-5 [&>svg]:w-5">{p.icon}</span>
                </span>
                <h3 className="mt-4 text-base font-bold tracking-tight text-slate-900">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{p.body}</p>
              </div>
            </HomeReveal>
          ))}
        </div>

        {/* ── Separate books callout + conversion path ──────── */}
        <HomeReveal delay={60}>
          <div className="mt-8 overflow-hidden rounded-3xl border border-brand-100 bg-white shadow-sm">
            <div className="h-1.5 w-full bg-gradient-to-r from-brand-500 via-brand-400 to-accent-400" aria-hidden />
            <div className="grid gap-8 p-7 sm:p-9 lg:grid-cols-[1.6fr_1fr] lg:items-center lg:gap-12">
              <div>
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-600 text-white shadow-md shadow-brand-600/25">
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11.99 3 4.5 6v5.4c0 4.2 3.2 8.1 7.49 9.1 4.3-1 7.51-4.9 7.51-9.1V6L11.99 3Z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="m9.4 12.2 1.9 1.9 3.6-3.9" />
                    </svg>
                  </span>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-accent-700">Built for independents</p>
                    <h3 className="text-xl font-bold tracking-tight text-slate-900">Clean, separate books for everyone</h3>
                  </div>
                </div>
                <p className="mt-4 text-sm leading-relaxed text-slate-600">{LINKED_ACCOUNTS_SEPARATE_BOOKS_NOTE}</p>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">
                  Renting chairs to self-employed stylists? Read our guide to{' '}
                  <Link
                    href="/solutions/salon-chair-rental-hmrc-employment-status"
                    className="font-semibold text-brand-600 underline decoration-brand-300 underline-offset-2 transition-colors hover:text-brand-700"
                  >
                    chair rental and HMRC employment status
                  </Link>
                  , or see the feature across{' '}
                  <Link
                    href="/solutions"
                    className="font-semibold text-brand-600 underline decoration-brand-300 underline-offset-2 transition-colors hover:text-brand-700"
                  >
                    every kind of business we serve
                  </Link>
                  .
                </p>
              </div>
              <div className="flex flex-col gap-3">
                <a
                  href="#pricing"
                  className="inline-flex h-12 items-center justify-center rounded-xl bg-brand-600 px-6 text-base font-semibold text-white shadow-lg shadow-brand-600/25 transition-all hover:-translate-y-0.5 hover:bg-brand-700"
                >
                  Start your free trial
                </a>
                <Link
                  href="/salon-booking-software#linked-accounts"
                  className="inline-flex h-12 items-center justify-center rounded-xl border border-slate-200 bg-white px-6 text-center text-base font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
                >
                  See how linking works
                </Link>
              </div>
            </div>
          </div>
        </HomeReveal>
      </div>
    </section>
  );
}
