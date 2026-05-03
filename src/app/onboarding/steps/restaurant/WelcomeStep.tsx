'use client';

interface Props {
  onContinue: () => void;
}

interface PreviewCard {
  title: string;
  summary: string;
  example: string;
}

const PREVIEW_CARDS: PreviewCard[] = [
  {
    title: 'Opening hours',
    summary: 'The outer window when guests can book at all.',
    example: 'Tue–Sat, 12:00–23:00.',
  },
  {
    title: 'Table management mode',
    summary: 'Choose Simple covers or Advanced table management.',
    example: 'Simple is great to start. You can switch any time.',
  },
  {
    title: 'Dining services',
    summary: 'Named sittings inside your opening hours.',
    example: 'Lunch 12:00–15:00, Dinner 17:30–22:00.',
  },
  {
    title: 'Capacity',
    summary: 'How many covers and bookings you can take per slot.',
    example: '30 covers / 10 bookings every 15 minutes.',
  },
  {
    title: 'Dining duration',
    summary: 'How long each party sits, by party size.',
    example: 'A 2-top stays 90 min; a 6-top stays 120 min.',
  },
  {
    title: 'Booking rules',
    summary: 'Advance notice, party size limits, deposits, cancellation.',
    example: 'Min 1 hour notice. Deposit from 6 guests.',
  },
  {
    title: 'Your dashboard',
    summary: 'A guided tour of where to work every day.',
    example: 'Day Sheet, Bookings, Floor Plan, Table Grid.',
  },
  {
    title: 'Payments (optional)',
    summary: 'Connect Stripe later if you want deposits or prepayment.',
    example: 'Skip if you only need free bookings to start.',
  },
];

export function WelcomeStep({ onContinue }: Props) {
  return (
    <div>
      <div className="mb-6 flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-100">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0Zm9-4.5v9m-4.5-4.5h9" />
          </svg>
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-slate-900">Welcome to ReserveNI</h2>
          <p className="mt-1 text-sm text-slate-500">
            Let&apos;s get your restaurant ready to take online bookings. This takes about 10 minutes and
            every step is skippable, and you can always finish later from your dashboard.
          </p>
        </div>
      </div>

      <div className="mb-6 rounded-xl border border-brand-100 bg-brand-50/60 p-4 text-sm text-slate-700">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-800">
          What we&apos;ll set up together
        </p>
        <p>
          We&apos;ll ask a few questions about how your venue runs and use your answers to pre-fill sensible
          defaults. Nothing is final: you can change every setting later from the dashboard.
        </p>
      </div>

      <ol className="mb-6 grid gap-2 sm:grid-cols-2">
        {PREVIEW_CARDS.map((card, idx) => (
          <li
            key={card.title}
            className="flex gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm"
          >
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">
              {idx + 1}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-slate-900">{card.title}</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-slate-600">{card.summary}</span>
              <span className="mt-1 block text-[11px] italic leading-relaxed text-slate-400">{card.example}</span>
            </span>
          </li>
        ))}
      </ol>

      <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-600">
        <p className="mb-1 font-medium text-slate-800">New to booking software?</p>
        <p>
          No problem. Each step explains what the setting does, why it matters, and shows an example. When in
          doubt, just use the defaults and click Continue.
        </p>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onContinue}
          className="rounded-lg bg-brand-600 px-6 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Let&apos;s get started
        </button>
      </div>
    </div>
  );
}
