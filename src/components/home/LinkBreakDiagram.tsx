'use client';

import { useState } from 'react';

/* ────────────────────────────────────────────────────────────────────────
   Link & break diagram.

   The whole point of the feature is what does NOT change when you link or
   unlink, so the diagram is built to make that visible: toggling only ever
   redraws the top half (the shared public booking page) and the connector.
   The two sets of books at the bottom are deliberately identical in both
   states, so the eye sees that nothing moved.
   ──────────────────────────────────────────────────────────────────────── */

type Tone = 'brand' | 'accent';

const TONE: Record<Tone, { avatar: string; soft: string; softText: string; ring: string }> = {
  brand: {
    avatar: 'bg-brand-600',
    soft: 'bg-brand-50',
    softText: 'text-brand-700',
    ring: 'ring-brand-100',
  },
  accent: {
    // accent-800 rather than accent-600: white on accent-600 is only 3.2:1 at
    // this size, and the teal is a brand accent, not a text background.
    avatar: 'bg-accent-800',
    soft: 'bg-accent-50',
    softText: 'text-accent-700',
    ring: 'ring-accent-100',
  },
};

/**
 * Job titles only. These are illustrative personas, and labelling them
 * "self-employed" next to a link about employment status would imply the
 * product settles that question. It does not. The separation argument is
 * carried by the books below, not by the job title.
 */
const PEOPLE = [
  {
    name: 'Sophie M.',
    initial: 'S',
    trade: 'Hair stylist',
    slug: 'sophie-hair',
    clients: '312',
    tone: 'brand' as Tone,
    services: [
      { name: 'Cut & finish', price: '£38' },
      { name: 'Colour', price: '£72' },
    ],
  },
  {
    name: 'Aaron R.',
    initial: 'A',
    trade: 'Barber',
    slug: 'aaron-barber',
    clients: '208',
    tone: 'accent' as Tone,
    services: [
      { name: 'Skin fade', price: '£22' },
      { name: 'Beard trim', price: '£14' },
    ],
  },
];

function LockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75M6.75 21h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75A2.25 2.25 0 0 0 4.5 12v6.75A2.25 2.25 0 0 0 6.75 21Z" />
    </svg>
  );
}

function ChainIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.2 10.8a4.5 4.5 0 0 0-6.4 0l-2.5 2.5a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.8 13.2a4.5 4.5 0 0 0 6.4 0l2.5-2.5a4.5 4.5 0 1 0-6.4-6.4l-1.2 1.2" />
    </svg>
  );
}

function BrokenChainIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.5 14.5 6.8 17.2a4.5 4.5 0 0 1-6.1-6.6" transform="translate(3 0)" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m14.5 9.5 2.7-2.7a4.5 4.5 0 0 1 6.1 6.6" transform="translate(-3 0)" />
      <path strokeLinecap="round" d="M12 2.8v2.4M4.9 5.6 6.6 7.3M19.1 5.6 17.4 7.3" opacity="0.55" />
    </svg>
  );
}

/**
 * Fake browser chrome used by the mock booking pages. The URL is the single
 * most load-bearing detail in the diagram (one address versus two is the whole
 * argument), so it drops the domain rather than ellipsising on narrow screens.
 */
function Chrome({ url, path }: { url: string; path: string }) {
  return (
    <div className="flex items-center gap-1.5 border-b border-slate-100 bg-slate-50/80 px-3 py-2">
      <span className="h-2 w-2 rounded-full bg-slate-300" />
      <span className="h-2 w-2 rounded-full bg-slate-300" />
      <span className="h-2 w-2 rounded-full bg-slate-300" />
      <span className="ml-2 flex min-w-0 items-center gap-1 text-[10px] font-semibold text-slate-600">
        <LockIcon className="h-2.5 w-2.5 shrink-0" />
        <span className="truncate sm:hidden">{path}</span>
        <span className="hidden truncate sm:inline">{url}</span>
      </span>
    </div>
  );
}

/** A non-interactive "Book" affordance inside the mock. Deliberately not a button. */
function BookChip({ small }: { small?: boolean }) {
  return (
    <span
      className={`shrink-0 rounded-lg bg-brand-600 font-bold text-white ${
        small ? 'px-2 py-1 text-[9px]' : 'px-3 py-1.5 text-[11px]'
      }`}
    >
      Book
    </span>
  );
}

export function LinkBreakDiagram() {
  const [linked, setLinked] = useState(true);

  return (
    <figure className="mx-auto mt-12 max-w-3xl">
      {/* ── Control ─────────────────────────────────────────── */}
      <div className="flex flex-col items-center gap-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">
          Try it
        </p>
        <div
          role="group"
          aria-label="Booking page link state"
          className="inline-flex items-center rounded-full border border-slate-200 bg-white p-1 shadow-sm"
        >
          {[
            { label: 'Linked', on: linked, next: true },
            { label: 'Unlinked', on: !linked, next: false },
          ].map((opt) => (
            <button
              key={opt.label}
              type="button"
              aria-pressed={opt.on}
              onClick={() => setLinked(opt.next)}
              className={`inline-flex min-h-11 min-w-[8rem] items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
                opt.on
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              {opt.next ? (
                <ChainIcon className="h-4 w-4" />
              ) : (
                <BrokenChainIcon className="h-4 w-4" />
              )}
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <p className="sr-only" aria-live="polite">
        {linked
          ? 'Linked. Sophie and Aaron share one public booking page. Their books stay separate.'
          : 'Unlinked. Sophie and Aaron each have their own booking page again. Their books are unchanged.'}
      </p>

      {/* The point of the control, stated where the control is. */}
      <p className="mx-auto mt-5 max-w-lg text-center text-sm leading-relaxed text-slate-600">
        Watch what does not move. Linking and unlinking only ever changes the booking page at the top.
      </p>

      {/* ── Top half: the public booking page (this is all that changes) ──
          Both layers share one grid cell, so the row is as tall as the taller
          state. justify-end pins whichever layer is shorter to the bottom of
          that row, keeping the cards flush against the connector below. */}
      <div className="mt-8 grid">
        {/* Linked: one combined page */}
        <div
          aria-hidden={!linked}
          className={`col-start-1 row-start-1 flex h-full flex-col justify-end motion-safe:transition-all motion-safe:duration-500 ${
            linked ? 'opacity-100' : 'pointer-events-none opacity-0 motion-safe:scale-[0.97]'
          }`}
        >
          <div className="mx-auto w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-brand-900/10">
            <Chrome url="resneo.com/book/c/the-chair-co" path="/book/c/the-chair-co" />
            <div className="p-5">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-brand-700">
                <ChainIcon className="h-3 w-3" />
                One shared booking page
              </span>
              {/* Not a heading: this is a label inside an illustrative mock. */}
              <p className="mt-3 text-lg font-bold tracking-tight text-slate-900">The Chair Co.</p>
              <p className="mt-0.5 text-xs text-slate-500">Two independent businesses, one place to book.</p>
              <div className="mt-4 space-y-2">
                {PEOPLE.map((p) => (
                  <div
                    key={p.name}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold text-white ${TONE[p.tone].avatar}`}
                      >
                        {p.initial}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-bold leading-tight text-slate-900">{p.name}</p>
                        <p className="truncate text-[11px] text-slate-500">{p.trade}</p>
                      </div>
                    </div>
                    <BookChip />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Broken: two separate pages */}
        <div
          aria-hidden={linked}
          className={`col-start-1 row-start-1 flex h-full flex-col justify-end motion-safe:transition-all motion-safe:duration-500 ${
            linked ? 'pointer-events-none opacity-0 motion-safe:scale-[0.97]' : 'opacity-100'
          }`}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-8">
            {PEOPLE.map((p) => (
              <div
                key={p.name}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg shadow-brand-900/5"
              >
                <Chrome url={`resneo.com/book/${p.slug}`} path={`/book/${p.slug}`} />
                <div className="p-3 sm:p-4">
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-slate-600">
                    Own booking page
                  </span>
                  <div className="mt-3 flex items-center gap-2">
                    <span
                      className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold text-white ${TONE[p.tone].avatar}`}
                    >
                      {p.initial}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-bold leading-tight text-slate-900">{p.name}</p>
                      <p className="truncate text-[11px] text-slate-500">{p.trade}</p>
                    </div>
                  </div>
                  {/* Desktop only. These rows exist to bring the broken layer
                      up to the linked layer's height so the connector stays
                      attached; on mobile the layers stack and the extra rows
                      would instead open a void above the shorter state. */}
                  <div className="mt-3 hidden space-y-1.5 sm:block">
                    {p.services.map((s) => (
                      <div
                        key={s.name}
                        className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50/70 px-2 py-1.5"
                      >
                        <span className="truncate text-[11px] font-semibold text-slate-700">{s.name}</span>
                        <span className="shrink-0 text-[11px] font-bold text-slate-500">{s.price}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="truncate text-[10px] font-medium text-slate-500">Next: today 14:00</span>
                    <BookChip small />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── The connector ───────────────────────────────────── */}
      <div className="relative">
        {/* Wide: an inverted Y when linked, two independent drops when broken */}
        <svg
          className="hidden h-[88px] w-full sm:block"
          viewBox="0 0 400 88"
          preserveAspectRatio="none"
          aria-hidden
        >
          <g
            className={`motion-safe:transition-opacity motion-safe:duration-500 ${linked ? 'opacity-100' : 'opacity-0'}`}
            fill="none"
            stroke="var(--brand-300)"
            strokeWidth={2}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          >
            {/* x=96 / x=304 track the centres of the two cards below, which sit
                either side of a fixed 2rem gap rather than at a clean 25% / 75%. */}
            <path d="M200 2 V34 q0 10 -10 10 H106 q-10 0 -10 10 V86" vectorEffect="non-scaling-stroke" />
            <path d="M200 2 V34 q0 10 10 10 H294 q10 0 10 10 V86" vectorEffect="non-scaling-stroke" />
          </g>
          <g
            className={`motion-safe:transition-opacity motion-safe:duration-500 ${linked ? 'opacity-0' : 'opacity-100'}`}
            fill="none"
            stroke="var(--color-slate-300, #cbd5e1)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeDasharray="5 7"
            vectorEffect="non-scaling-stroke"
          >
            <path d="M96 2 V86" vectorEffect="non-scaling-stroke" />
            <path d="M304 2 V86" vectorEffect="non-scaling-stroke" />
          </g>
        </svg>

        {/* Narrow: a single short rail, the branch geometry does not apply */}
        <div className="flex h-20 items-center justify-center sm:hidden" aria-hidden>
          <span
            className={`h-full w-px ${linked ? 'bg-brand-300' : 'bg-[repeating-linear-gradient(to_bottom,#cbd5e1_0_5px,transparent_5px_12px)]'}`}
          />
        </div>

        {/* State badge, sitting on the connector */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4">
          <span
            className={`inline-flex max-w-full items-center gap-2 rounded-full border px-3.5 py-2 text-center text-[11px] font-bold shadow-sm motion-safe:transition-colors sm:text-xs ${
              linked
                ? 'border-brand-200 bg-white text-brand-700'
                : 'border-slate-200 bg-white text-slate-600'
            }`}
          >
            {linked ? (
              <>
                <ChainIcon className="h-4 w-4 shrink-0 text-accent-700" />
                Linked to share one page
              </>
            ) : (
              <>
                {/* Not a danger colour: breaking the link is a safe, deliberate
                    action the owner controls, not an error state. */}
                <BrokenChainIcon className="h-4 w-4 shrink-0 text-slate-500" />
                Unlinked in one click
              </>
            )}
          </span>
        </div>
      </div>

      {/* ── Bottom half: identical in both states. That is the argument. ── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-8">
        {PEOPLE.map((p) => (
          <div
            key={p.name}
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold text-white ${TONE[p.tone].avatar}`}
                >
                  {p.initial}
                </span>
                <p className="truncate text-sm font-bold text-slate-900">{p.name}</p>
              </div>
              <span
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ring-1 ${TONE[p.tone].soft} ${TONE[p.tone].softText} ${TONE[p.tone].ring}`}
              >
                <LockIcon className="h-3.5 w-3.5" />
              </span>
            </div>
            <dl className="mt-4 space-y-2.5">
              {[
                { k: 'Clients', v: `${p.clients}, only theirs` },
                { k: 'Calendar and prices', v: 'Set by them' },
                { k: 'Payments', v: 'Straight to their account' },
              ].map((row) => (
                <div key={row.k} className="flex items-baseline justify-between gap-3 border-b border-dashed border-slate-100 pb-2 last:border-0 last:pb-0">
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{row.k}</dt>
                  <dd className="text-right text-[12px] font-semibold text-slate-700">{row.v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Unchanged either way
            </p>
          </div>
        ))}
      </div>

      <figcaption className="mx-auto mt-8 max-w-xl text-center text-sm leading-relaxed text-slate-600">
        Every client, calendar, price and payment underneath stays exactly where it was. Illustrative example.
      </figcaption>
    </figure>
  );
}
