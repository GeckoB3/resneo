import Link from 'next/link';
import type { ReactNode } from 'react';
import { HomeReveal } from '@/components/home/HomeReveal';
import { LinkBreakDiagram } from '@/components/home/LinkBreakDiagram';
import { SetupConcertina } from '@/components/home/SetupConcertina';

/* ────────────────────────────────────────────────────────────────────────
   "Working together": the homepage treatment of combined booking pages for
   independent people who share a space. Server component; the interactive
   diagram and the setup concertina are its only client boundaries.

   Written for owners who have never met "linked venue" or "venue
   collective": plain words first, the dashboard's names once, and setup
   steps that match the real screens (Settings, then Linked Accounts; the
   help articles getting-started/linked-venues and venue-collectives hold
   the detail). Each person keeps their own account, so the steps say who
   does what. The feature is framed around ownership and control, and makes
   no tax or compliance promise.
   ──────────────────────────────────────────────────────────────────────── */

const GUIDE_HREF = '/help/getting-started/venue-collectives';

const KEEPS: { title: string; body: string; icon: ReactNode }[] = [
  {
    title: 'Your own clients',
    body: 'Everyone who books with you is saved in your own account, with your own notes and history. Nothing goes into a shared list.',
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
    ),
  },
  {
    title: 'Your own bookings',
    body: 'Bookings made with you go into your own calendar, and you set your own working hours and days off.',
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5a2.25 2.25 0 0 0 2.25-2.25m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5a2.25 2.25 0 0 1 2.25 2.25v7.5" />
    ),
  },
  {
    title: 'Your own money',
    body: 'Deposits and payments for your bookings go straight to your own Stripe account, never through anyone else’s.',
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z" />
    ),
  },
  {
    title: 'Free to leave',
    body: 'Leave the combined page whenever you like. You keep all your clients and bookings, and your own booking page comes straight back.',
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M18 9l3 3m0 0-3 3m3-3H9" />
    ),
  },
];

/** A label exactly as it reads on screen in the dashboard. */
function Ui({ children }: { children: ReactNode }) {
  return <strong className="font-bold text-slate-800">{children}</strong>;
}

const STEPS: { who: string; title: string; body: ReactNode }[] = [
  {
    who: 'Each of you',
    title: 'Create your own ResNeo account',
    body: (
      <>
        Sign up separately, each on your own plan with your own free trial. Set up your calendar,
        working hours and payments as usual. Linking and the combined page cost nothing extra.
      </>
    ),
  },
  {
    who: 'One of you',
    title: 'Send a link request to each of the others',
    body: (
      <>
        In your dashboard, open <Ui>Settings</Ui>, then <Ui>Linked Accounts</Ui>, and click{' '}
        <Ui>Send link request</Ui>. Find the other person by their business name, pick them from the
        list and click <Ui>Send request</Ui>. Leave the access on full, both ways: the combined page
        needs it.
      </>
    ),
  },
  {
    who: 'The others',
    title: 'Accept the request',
    body: (
      <>
        Each person opens <Ui>Settings</Ui>, then <Ui>Linked Accounts</Ui>, clicks{' '}
        <Ui>Review request</Ui>, then <Ui>Accept</Ui>.
      </>
    ),
  },
  {
    who: 'One of you, the host',
    title: 'Create the combined booking page',
    body: (
      <>
        On the same tab, under <Ui>Venue collectives</Ui>, click <Ui>Create venue collective</Ui>.
        Name the page, choose its web address, tick everyone you want to invite and send the
        invitations. Each person then clicks <Ui>Accept invitation</Ui>, then <Ui>Join</Ui>.
      </>
    ),
  },
  {
    who: 'The host, then everyone',
    title: 'Choose the services and go live',
    body: (
      <>
        The host picks which services go on the page and sets their prices. Each of you chooses
        which of your own calendars offer them. The page goes live once someone has joined and a
        calendar offers a service.
      </>
    ),
  },
];

const GLOSSARY = [
  { term: 'Venue', meaning: 'Your business, with its own ResNeo account.' },
  { term: 'Linked venues', meaning: 'Accounts that have agreed to share their calendars with each other.' },
  { term: 'Venue collective', meaning: 'Linked venues that share one combined booking page.' },
];

export function LinkBreakSection() {
  return (
    <section
      id="link-break"
      className="relative scroll-mt-16 overflow-hidden bg-[#FDFBF7] py-20 sm:py-28"
    >
      {/* Soft shapes on the cream ground, so the section reads as its own chapter.
          overflow-anchor none: the browser keeps the first visible element still
          when content above it changes size, and the bottom shape moves down as the
          setup concertina opens, so anchoring on it scrolled the page past the steps. */}
      <div className="pointer-events-none absolute -left-32 top-16 h-96 w-96 rounded-[48%_52%_41%_59%/55%_40%_60%_45%] bg-accent-100/60 [overflow-anchor:none]" aria-hidden />
      <div className="pointer-events-none absolute -right-40 bottom-0 h-[26rem] w-[26rem] rounded-[58%_42%_55%_45%/48%_60%_40%_52%] bg-brand-50 [overflow-anchor:none]" aria-hidden />
      <div className="relative mx-auto max-w-6xl px-6">
        {/* ── Header ────────────────────────────────────────── */}
        <HomeReveal className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-accent-100 bg-white px-3.5 py-1.5 text-xs font-extrabold uppercase tracking-[0.18em] text-accent-700 shadow-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_rgba(0,194,199,0.8)]" />
            Working together
          </span>
          <h2 className="mt-6 text-balance text-3xl font-black leading-[1.1] tracking-tight text-brand-600 sm:text-4xl lg:text-5xl">
            Your clients see one business.{' '}
            {/* accent-700, not accent-600: the lighter teal lands under 3:1 on
                the cream ground at this weight. */}
            <span className="text-accent-700">Each of you still runs your own.</span>
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-pretty text-base leading-relaxed text-slate-600 sm:text-lg">
            Run a business where several independents work together, like a salon where self-employed
            stylists rent chairs, or a clinic where each practitioner runs their own practice? Put
            everyone on one combined booking page, so your clients see one business. Behind the page,
            each of you keeps control of your own clients, your own bookings and your own money.
          </p>
          <p className="mx-auto mt-4 max-w-2xl text-pretty text-sm leading-relaxed text-slate-600">
            Each of you has your own ResNeo account, and you link them together in your dashboard,
            where the combined page is called a <span className="font-semibold text-slate-800">venue collective</span>.{' '}
            <a
              href="#link-setup"
              className="font-semibold text-brand-600 underline decoration-brand-300 underline-offset-2 transition-colors hover:text-brand-700"
            >
              See the setup steps
            </a>
          </p>
        </HomeReveal>

        {/* ── The diagram ───────────────────────────────────── */}
        <HomeReveal delay={80}>
          <LinkBreakDiagram />
        </HomeReveal>

        {/* ── What each person keeps ────────────────────────── */}
        <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {KEEPS.map((k, i) => (
            <HomeReveal key={k.title} delay={i * 70}>
              <div className="flex h-full flex-col rounded-[28px] border border-[#EEE9E0] bg-white p-6 shadow-[0_18px_40px_-24px_rgba(0,59,111,0.2)] transition-all hover:-translate-y-0.5">
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-accent-100 text-accent-800">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
                    {k.icon}
                  </svg>
                </span>
                <h3 className="mt-4 text-base font-bold tracking-tight text-slate-900">{k.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{k.body}</p>
              </div>
            </HomeReveal>
          ))}
        </div>

        {/* ── Setting it up: who does what, in the dashboard's own words.
            Closed until someone opens it or follows a link to #link-setup,
            so the section stays short for everyone else. ── */}
        <HomeReveal delay={60} className="mt-8">
          <SetupConcertina
            id="link-setup"
            eyebrow="Setting it up"
            title="How linked venues and venue collectives work"
            summary="The five setup steps, who does each one, and the words you will see in your dashboard."
          >
            {/* On wide screens the steps take the right column and the two
                short blocks stack on the left; on a phone they read in order. */}
            <div className="grid gap-10 p-7 sm:p-9 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-x-14 lg:gap-y-8">
              <div className="lg:col-start-1 lg:row-start-1 lg:self-start">
                <h4 className="home-display text-xl font-bold tracking-tight text-brand-600 sm:text-2xl">
                  Each of you needs your own ResNeo account
                </h4>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">
                  There is no single shared account. Each of you signs up, pays and gets paid
                  separately, then you link your accounts together from your dashboard. Here is
                  exactly what to do.
                </p>
                <div className="mt-6 rounded-[22px] border border-[#EEE9E0] bg-[#FDFBF7] p-5">
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
                    Words you will see in your dashboard
                  </p>
                  <dl className="mt-3 space-y-3 text-sm leading-relaxed">
                    {GLOSSARY.map((g) => (
                      <div key={g.term}>
                        <dt className="font-bold text-slate-900">{g.term}</dt>
                        <dd className="text-slate-600">{g.meaning}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>

              <ol className="space-y-7 lg:col-start-2 lg:row-span-2 lg:row-start-1">
                {STEPS.map((s, i) => (
                  <li key={s.title} className="relative flex gap-4 sm:gap-5">
                    {i < STEPS.length - 1 ? (
                      <span className="absolute -bottom-5 left-5 top-12 w-px bg-[#EEE9E0]" aria-hidden />
                    ) : null}
                    <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-600 text-base font-extrabold text-white shadow-md shadow-brand-600/25">
                      {i + 1}
                    </span>
                    <div className="min-w-0 pt-0.5">
                      <p className="inline-flex rounded-full bg-accent-50 px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-[0.12em] text-accent-800">
                        {s.who}
                      </p>
                      <h4 className="mt-1.5 text-base font-bold tracking-tight text-slate-900">{s.title}</h4>
                      <p className="mt-1 text-sm leading-relaxed text-slate-600">{s.body}</p>
                    </div>
                  </li>
                ))}
              </ol>

              <div className="rounded-[22px] border border-accent-100 bg-accent-50/60 p-5 lg:col-start-1 lg:row-start-2 lg:self-start">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-accent-800">Good to know</p>
                <ul className="mt-3 space-y-3 text-sm leading-relaxed text-slate-700">
                  <li>
                    <span className="font-bold text-slate-900">Three or more of you?</span> Everyone
                    needs a link with everyone else, so repeat steps 2 and 3 until you are all linked.
                    For three people, that is three links.
                  </li>
                  <li>
                    <span className="font-bold text-slate-900">Full access, both ways,</span> lets you
                    see each other&rsquo;s bookings and client details, and book clients in with each
                    other. Every client, booking and payment still belongs to the person the client
                    booked with.
                  </li>
                </ul>
              </div>
            </div>

            {/* ── Conversion path ──────────────────────────── */}
            <div className="border-t border-[#EEE9E0] bg-[#FDFBF7] px-7 py-6 sm:px-9">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                <p className="text-base font-bold tracking-tight text-slate-900">
                  Ready? Each of you starts with your own free trial.
                </p>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <a
                    href="#pricing"
                    className="inline-flex h-12 items-center justify-center rounded-full bg-brand-600 px-6 text-base font-extrabold text-white shadow-lg shadow-brand-600/25 transition-all hover:-translate-y-0.5 hover:bg-brand-700"
                  >
                    Start your free trial
                  </a>
                  <Link
                    href={GUIDE_HREF}
                    className="inline-flex h-12 items-center justify-center rounded-full border-2 border-brand-50 bg-white px-6 text-center text-base font-extrabold text-brand-600 transition-colors hover:border-brand-100 hover:bg-brand-50/40"
                  >
                    Read the step-by-step guide
                  </Link>
                </div>
              </div>
              <p className="mt-5 text-sm leading-relaxed text-slate-600">
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
          </SetupConcertina>
        </HomeReveal>
      </div>
    </section>
  );
}
