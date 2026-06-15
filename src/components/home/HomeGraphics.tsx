import type { CSSProperties } from 'react';

/* ────────────────────────────────────────────────────────────────────────
   Marketing product mockups (server components, no client JS).
   Adapted from the ResNeo marketing reel into the app's brand tokens so the
   homepage shows the real product surfaces — calendar, booking flow, reminders,
   deposits — as polished, dimensional graphics.
   ──────────────────────────────────────────────────────────────────────── */

/** Subtle window chrome shared by the product mockups. */
function WindowChrome({ title, live }: { title: string; live?: boolean }) {
  return (
    <div className="flex items-center gap-2 border-b border-slate-200/80 bg-gradient-to-b from-white to-slate-50/80 px-4 py-3">
      <span className="h-3 w-3 rounded-full bg-slate-200" />
      <span className="h-3 w-3 rounded-full bg-slate-200" />
      <span className="h-3 w-3 rounded-full bg-slate-200" />
      <span className="ml-3 truncate text-xs font-semibold text-slate-500">{title}</span>
      {live ? (
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-700 ring-1 ring-emerald-200">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 motion-safe:animate-ping" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
          </span>
          Live
        </span>
      ) : null}
    </div>
  );
}

type EventTone = 'sky' | 'emerald' | 'indigo' | 'amber';

const EVENT_TONE: Record<EventTone, { wrap: string; stripe: string; sub: string }> = {
  sky: {
    wrap: 'bg-gradient-to-b from-sky-50 to-sky-100/90 border-sky-300 text-sky-900',
    stripe: 'bg-sky-600',
    sub: 'text-sky-700/80',
  },
  emerald: {
    wrap: 'bg-gradient-to-b from-emerald-50 to-emerald-100/90 border-emerald-300 text-emerald-900',
    stripe: 'bg-emerald-600',
    sub: 'text-emerald-700/80',
  },
  indigo: {
    wrap: 'bg-gradient-to-b from-indigo-50 to-indigo-100/90 border-indigo-300 text-indigo-900',
    stripe: 'bg-indigo-600',
    sub: 'text-indigo-700/80',
  },
  amber: {
    wrap: 'bg-gradient-to-b from-amber-50 to-amber-100/90 border-amber-300 text-amber-900',
    stripe: 'bg-amber-500',
    sub: 'text-amber-700/80',
  },
};

function CalEvent({
  tone,
  top,
  height,
  name,
  service,
  time,
  status,
  done,
}: {
  tone: EventTone;
  top: number;
  height: number;
  name: string;
  service: string;
  time: string;
  status: string;
  done?: boolean;
}) {
  const t = EVENT_TONE[tone];
  return (
    <div
      className={`absolute inset-x-1.5 overflow-hidden rounded-lg border pl-2.5 pr-2 shadow-sm ${t.wrap}`}
      style={{ top: `${top}%`, height: `${height}%` }}
    >
      <span className={`absolute inset-y-0 left-0 w-1 ${t.stripe}`} aria-hidden />
      <p className="mt-1.5 truncate text-[11px] font-bold leading-tight sm:text-xs">
        {name} <span className="font-semibold opacity-70">· {service}</span>
      </p>
      <p className={`truncate text-[10px] font-medium ${t.sub}`}>
        {time} · {status}
      </p>
      {done ? (
        <span className="absolute right-1.5 top-1.5 grid h-4 w-4 place-items-center rounded-full bg-emerald-500 text-white shadow ring-2 ring-white/80">
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
          </svg>
        </span>
      ) : null}
    </div>
  );
}

/** Big appointments-calendar product shot for the hero. */
export function CalendarMock({ className }: { className?: string }) {
  const hours = ['09', '10', '11', '12', '13', '14', '15'];
  return (
    <div
      className={`overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_30px_70px_-20px_rgba(2,32,71,0.35)] ${className ?? ''}`}
    >
      <WindowChrome title="Calendar · Today" live />
      <div className="grid grid-cols-[40px_1fr_1fr_1fr] text-slate-700">
        {/* Column headers */}
        <div className="border-b border-r border-slate-100" />
        {['Andrew', 'Dave', 'Priya'].map((n) => (
          <div key={n} className="border-b border-r border-slate-100 px-2 py-2 text-center last:border-r-0">
            <p className="truncate text-[11px] font-bold text-slate-800 sm:text-xs">{n}</p>
            <p className="text-[9px] font-medium text-slate-400">09:00 – 18:00</p>
          </div>
        ))}

        {/* Time gutter */}
        <div className="flex flex-col">
          {hours.map((h) => (
            <div
              key={h}
              className="flex-1 border-r border-slate-100 pr-1.5 pt-1 text-right text-[9px] font-semibold text-slate-300"
              style={{ minHeight: 40 }}
            >
              {h}
            </div>
          ))}
        </div>

        {/* Three day columns with appointments */}
        <div className="relative border-r border-slate-100 bg-[repeating-linear-gradient(to_bottom,transparent,transparent_39px,#f1f5f9_39px,#f1f5f9_40px)]">
          <CalEvent tone="sky" top={2} height={20} name="Maria L." service="Cut & finish" time="09:00" status="Booked" />
          <CalEvent tone="emerald" top={28} height={30} name="Andrew C." service="Colour" time="11:00" status="Confirmed" done />
          <CalEvent tone="sky" top={72} height={18} name="Sam P." service="Cut" time="14:00" status="Booked" />
        </div>
        <div className="relative border-r border-slate-100 bg-[repeating-linear-gradient(to_bottom,transparent,transparent_39px,#f1f5f9_39px,#f1f5f9_40px)]">
          <CalEvent tone="amber" top={14} height={16} name="Break" service="" time="10:00" status="Hold" />
          <CalEvent tone="indigo" top={34} height={22} name="Tom R." service="Beard trim" time="11:45" status="Seated" />
          <CalEvent tone="sky" top={64} height={20} name="Lee W." service="Cut" time="13:30" status="Booked" />
        </div>
        <div className="relative bg-[repeating-linear-gradient(to_bottom,transparent,transparent_39px,#f1f5f9_39px,#f1f5f9_40px)]">
          <CalEvent tone="sky" top={4} height={28} name="Priya S." service="Colour" time="09:20" status="Seated" />
          <CalEvent tone="emerald" top={52} height={20} name="Jo K." service="Brow tint" time="13:00" status="Confirmed" done />
        </div>
      </div>
    </div>
  );
}

/** Floating "new booking confirmed" pill for the hero. */
export function BookingConfirmedCard({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <div
      className={`flex items-center gap-3 rounded-2xl border border-slate-100 bg-white/95 p-3 shadow-[0_20px_45px_-18px_rgba(2,32,71,0.5)] backdrop-blur ${className ?? ''}`}
      style={style}
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-500 text-white shadow-lg shadow-emerald-500/30">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
        </svg>
      </span>
      <div className="min-w-0">
        <p className="text-sm font-bold text-slate-900">New booking confirmed</p>
        <p className="truncate text-xs text-slate-500">Maria · Colour · Tomorrow 11:30</p>
      </div>
    </div>
  );
}

/** Floating deposit pill for the hero. */
export function DepositCard({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <div
      className={`flex items-center gap-3 rounded-2xl border border-slate-100 bg-white/95 p-3 shadow-[0_20px_45px_-18px_rgba(2,32,71,0.5)] backdrop-blur ${className ?? ''}`}
      style={style}
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-600 text-white shadow-lg shadow-brand-600/30">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z" />
        </svg>
      </span>
      <div className="min-w-0">
        <p className="text-sm font-bold text-slate-900">Deposit collected</p>
        <p className="truncate text-xs text-slate-500">£10.00 secured at booking</p>
      </div>
    </div>
  );
}

/** Three-step booking flow card for the bento grid. */
export function BookingFlowMock({ className }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className ?? ''}`}>
      {/* Step 1 */}
      <div className="flex-1 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="grid h-5 w-5 place-items-center rounded-full bg-brand-600 text-[10px] font-bold text-white">1</span>
          <p className="text-[11px] font-bold text-slate-800">Choose service</p>
        </div>
        <div className="mt-2 space-y-1">
          <p className="rounded-md bg-brand-50 px-2 py-1 text-[10px] font-semibold text-brand-700 ring-1 ring-brand-200">Colour · 2 hr</p>
          <p className="rounded-md bg-slate-50 px-2 py-1 text-[10px] font-medium text-slate-400">Cut &amp; finish</p>
        </div>
      </div>
      <Arrow />
      {/* Step 2 */}
      <div className="flex-1 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="grid h-5 w-5 place-items-center rounded-full bg-brand-600 text-[10px] font-bold text-white">2</span>
          <p className="text-[11px] font-bold text-slate-800">Pick a time</p>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1">
          <span className="rounded-md bg-slate-50 py-1 text-center text-[10px] font-medium text-slate-400">10:00</span>
          <span className="rounded-md bg-brand-600 py-1 text-center text-[10px] font-bold text-white">11:30</span>
          <span className="rounded-md bg-slate-50 py-1 text-center text-[10px] font-medium text-slate-400">14:00</span>
          <span className="rounded-md bg-slate-50 py-1 text-center text-[10px] font-medium text-slate-400">15:30</span>
        </div>
      </div>
      <Arrow />
      {/* Step 3 */}
      <div className="flex-1 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-center shadow-sm">
        <span className="mx-auto grid h-8 w-8 place-items-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-500/30">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
          </svg>
        </span>
        <p className="mt-1.5 text-[11px] font-bold text-emerald-800">Booked!</p>
        <p className="text-[9px] font-medium text-emerald-700/70">Confirmation sent</p>
      </div>
    </div>
  );
}

function Arrow() {
  return (
    <svg className="h-4 w-4 shrink-0 text-accent-dark" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
    </svg>
  );
}

/** Automated reminder conversation card for the bento grid. */
export function ReminderMock({ className }: { className?: string }) {
  return (
    <div className={`space-y-2 ${className ?? ''}`}>
      <div className="max-w-[88%] rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3.5 py-2.5 shadow-sm">
        <p className="text-[11px] leading-snug text-slate-700 sm:text-xs">
          Hi Maria, a reminder for your <span className="font-semibold text-slate-900">Colour</span> with ResNeo Salon tomorrow at <span className="font-semibold text-slate-900">11:30</span>. Reply <span className="font-semibold">Y</span> to confirm or <span className="font-semibold">N</span> to cancel.
        </p>
        <p className="mt-1 text-[9px] font-semibold uppercase tracking-wide text-slate-400">Sent automatically · 24h before</p>
      </div>
      <div className="ml-auto flex max-w-[55%] items-center justify-end gap-1.5 rounded-2xl rounded-br-md bg-gradient-to-br from-brand-600 to-brand-700 px-3.5 py-2.5 text-white shadow-sm">
        <span className="text-xs font-bold">Y</span>
        <span className="text-[11px] font-medium text-brand-100">Confirmed</span>
        <svg className="h-3.5 w-3.5 text-accent-light" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
        </svg>
      </div>
    </div>
  );
}
