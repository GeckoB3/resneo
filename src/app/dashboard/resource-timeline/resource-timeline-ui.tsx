'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/primitives/Button';
import { cn } from '@/components/ui/primitives/cn';
import { WeeklyHoursEditor, type NormalisedWeek } from '@/components/scheduling/WeeklyHoursEditor';

/** Shared field styles — tall targets, clear focus rings */
export const fieldInputClass =
  'min-h-11 w-full rounded-xl border border-slate-200/90 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm shadow-slate-900/[0.02] outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500';

export const fieldSelectClass = fieldInputClass;

export const fieldLabelClass = 'mb-1.5 block text-xs font-semibold tracking-wide text-slate-700';

export const fieldHintClass = 'mt-1.5 text-[11px] leading-relaxed text-slate-500';

export function formatBookingsDateLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function formatBookingsDateShort(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function ResourceTimelineQuickLinks() {
  return (
    <nav
      className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-600"
      aria-label="Related pages"
    >
      <span className="text-slate-500">Bookings appear on the host calendar you assign below.</span>
      <Link
        href="/dashboard/calendar"
        className="font-semibold text-brand-600 underline-offset-2 hover:text-brand-800 hover:underline"
      >
        Team calendar
      </Link>
      <Link
        href="/dashboard/calendar-availability?tab=calendars"
        className="font-semibold text-brand-600 underline-offset-2 hover:text-brand-800 hover:underline"
      >
        Calendar hours
      </Link>
    </nav>
  );
}

/** Add / edit resource — title block; back control stacks below copy (never beside). */
export function ResourceFormHeader({
  eyebrow,
  title,
  description,
  onBack,
  showBack = true,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  onBack: () => void;
  showBack?: boolean;
}) {
  return (
    <header className="min-w-0 border-b border-slate-100 pb-4 sm:pb-5">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{eyebrow}</p>
          <h2 className="mt-0.5 text-pretty text-lg font-semibold leading-snug tracking-tight text-slate-900 sm:text-xl lg:text-2xl">
            {title}
          </h2>
          {description ? (
            <p className="mt-1.5 text-pretty text-sm leading-relaxed text-slate-600">{description}</p>
          ) : null}
        </div>
        {showBack ? (
          <Button
            type="button"
            variant="secondary"
            size="md"
            className="w-full min-w-0 sm:max-w-xs"
            onClick={onBack}
          >
            ← Back to list
          </Button>
        ) : null}
      </div>
    </header>
  );
}

export function ResourceFormSection({
  step,
  title,
  description,
  children,
  className,
}: {
  step?: number;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'rounded-2xl border border-slate-200/80 bg-gradient-to-b from-white to-slate-50/40 p-4 shadow-sm shadow-slate-900/[0.04] sm:p-5',
        className,
      )}
    >
      <div className="flex flex-col gap-3 md:flex-row md:gap-4">
        {step != null ? (
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white shadow-sm shadow-brand-900/20"
            aria-hidden
          >
            {step}
          </span>
        ) : null}
        <div className="min-w-0 flex-1 overflow-hidden">
          <h3 className="text-base font-semibold tracking-tight text-slate-900">{title}</h3>
          {description ? <p className="mt-1 text-sm leading-relaxed text-slate-600">{description}</p> : null}
          <div className={cn('min-w-0', step != null ? 'mt-4' : 'mt-3')}>{children}</div>
        </div>
      </div>
    </section>
  );
}

export function FormStickyActions({
  saving,
  saveLabel,
  onCancel,
  onSave,
  error,
}: {
  saving: boolean;
  saveLabel: string;
  onCancel: () => void;
  onSave: () => void;
  error: string | null;
}) {
  return (
    <div className="sticky bottom-0 z-20 -mx-4 border-t border-slate-200/90 bg-white/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md sm:-mx-5 sm:px-5 lg:static lg:mx-0 lg:mt-6 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
      {error ? (
        <p
          role="alert"
          className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800"
        >
          {error}
        </p>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" size="lg" className="w-full sm:w-auto" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          size="lg"
          className="w-full sm:w-auto"
          loading={saving}
          onClick={onSave}
        >
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}

export function ResourceIcon({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-sm font-bold shadow-sm',
        active
          ? 'border-emerald-200/80 bg-gradient-to-br from-emerald-50 to-white text-emerald-700'
          : 'border-slate-200/80 bg-gradient-to-br from-slate-50 to-white text-slate-500',
      )}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M4 8h16M6 8V6a2 2 0 012-2h8a2 2 0 012 2v2m-2 10H8a2 2 0 01-2-2v-6h12v6a2 2 0 01-2 2z"
        />
      </svg>
    </span>
  );
}

export interface ResourceListItem {
  id: string;
  name: string;
  resource_type: string | null;
  is_active: boolean;
  hostLabel: string;
  metaLine: string;
}

export function ResourceDirectoryList({
  resources,
  selectedId,
  showForm,
  onSelect,
}: {
  resources: ResourceListItem[];
  selectedId: string | null;
  showForm: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="divide-y divide-slate-100/90 p-1">
      {resources.map((r) => {
        const selected = selectedId === r.id && !showForm;
        return (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => onSelect(r.id)}
              className={cn(
                'flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-all duration-150',
                selected
                  ? 'bg-brand-50 shadow-sm ring-1 ring-brand-200/90'
                  : 'hover:bg-slate-50/90 active:scale-[0.99]',
              )}
            >
              <ResourceIcon active={r.is_active} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-slate-900">{r.name}</span>
                <span className="mt-0.5 block truncate text-xs text-slate-500">
                  {r.hostLabel}
                  {r.resource_type ? ` · ${r.resource_type}` : ''}
                </span>
                <span className="mt-0.5 hidden truncate text-[11px] text-slate-400 sm:block">{r.metaLine}</span>
              </span>
              {selected ? (
                <span className="h-2 w-2 shrink-0 rounded-full bg-brand-600" aria-hidden />
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Bookings day picker — stacks on narrow screens */
export function BookingsDateToolbar({
  dateIso,
  onPrev,
  onNext,
  onToday,
  onDateChange,
}: {
  dateIso: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onDateChange: (iso: string) => void;
}) {
  const todayIso = formatYmdToday();
  const isToday = dateIso === todayIso;
  return (
    <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Viewing</p>
        <p className="break-words text-base font-semibold text-slate-900 sm:text-lg">
          <span className="sm:hidden">{formatBookingsDateShort(dateIso)}</span>
          <span className="hidden sm:inline">{formatBookingsDateLabel(dateIso)}</span>
        </p>
        {isToday ? (
          <span className="mt-1 inline-flex rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">
            Today
          </span>
        ) : null}
      </div>
      <div className="flex w-full min-w-0 flex-wrap items-stretch gap-2 sm:w-auto sm:justify-end">
        <div className="flex min-w-0 flex-1 items-center justify-center rounded-xl border border-slate-200 bg-slate-50/80 p-0.5 shadow-sm sm:flex-initial">
          <button
            type="button"
            onClick={onPrev}
            className="flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-lg text-slate-700 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            aria-label="Previous day"
          >
            ←
          </button>
          <input
            type="date"
            value={dateIso}
            onChange={(e) => onDateChange(e.target.value)}
            className="min-h-10 min-w-0 flex-1 border-0 bg-transparent px-1 text-center text-sm font-medium text-slate-900 outline-none focus:ring-0 sm:max-w-[10rem] sm:px-2"
            aria-label="Booking date"
          />
          <button
            type="button"
            onClick={onNext}
            className="flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-lg text-slate-700 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            aria-label="Next day"
          >
            →
          </button>
        </div>
        <button
          type="button"
          onClick={onToday}
          className={`min-h-10 shrink-0 rounded-xl px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
            isToday
              ? 'border border-brand-200 bg-brand-50 text-brand-700'
              : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
          }`}
        >
          Today
        </button>
      </div>
    </div>
  );
}

/** Mobile-only horizontal resource switcher */
export function ResourceMobileStrip({
  resources,
  selectedId,
  showForm,
  onSelect,
}: {
  resources: ResourceListItem[];
  selectedId: string | null;
  showForm: boolean;
  onSelect: (id: string) => void;
}) {
  if (resources.length === 0 || showForm) return null;
  return (
    <div className="lg:hidden">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Your resources</p>
      <div className="flex snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain pb-1 [-webkit-overflow-scrolling:touch] [scrollbar-width:thin]">
        {resources.map((r) => {
          const selected = selectedId === r.id;
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => onSelect(r.id)}
              className={cn(
                'max-w-[min(100%,14rem)] shrink-0 snap-start rounded-full border px-4 py-2 text-sm font-semibold transition-colors',
                selected
                  ? 'border-brand-300 bg-brand-600 text-white shadow-sm'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300',
              )}
            >
              <span className="block truncate">{r.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function BookingsDateNavigator({
  dateIso,
  onPrev,
  onNext,
  onToday,
  onDateChange,
}: {
  dateIso: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onDateChange: (iso: string) => void;
}) {
  const isToday = dateIso === formatYmdToday();
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Schedule</p>
        <p className="text-lg font-semibold tracking-tight text-slate-900">{formatBookingsDateLabel(dateIso)}</p>
        {isToday ? (
          <span className="mt-1 inline-flex rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">
            Today
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50/80 p-0.5 shadow-sm">
          <button
            type="button"
            onClick={onPrev}
            className="flex min-h-10 min-w-10 items-center justify-center rounded-lg text-slate-700 transition hover:bg-white hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            aria-label="Previous day"
          >
            ←
          </button>
          <input
            type="date"
            value={dateIso}
            onChange={(e) => onDateChange(e.target.value)}
            className="min-h-10 max-w-[9.5rem] border-0 bg-transparent px-2 text-center text-sm font-medium text-slate-900 outline-none focus:ring-0"
            aria-label="Booking date"
          />
          <button
            type="button"
            onClick={onNext}
            className="flex min-h-10 min-w-10 items-center justify-center rounded-lg text-slate-700 transition hover:bg-white hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            aria-label="Next day"
          >
            →
          </button>
        </div>
        <Button type="button" variant={isToday ? 'secondary' : 'primary'} size="md" onClick={onToday}>
          Today
        </Button>
      </div>
    </div>
  );
}

function formatYmdToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function ResourcePaymentCards({
  value,
  onChange,
  sym,
  depositValue,
  onDepositChange,
  stripeConnected,
}: {
  value: 'none' | 'deposit' | 'full_payment' | 'card_hold';
  onChange: (v: 'none' | 'deposit' | 'full_payment' | 'card_hold') => void;
  sym: string;
  depositValue: string;
  onDepositChange: (v: string) => void;
  stripeConnected: boolean;
  children?: ReactNode;
}) {
  const options = [
    { v: 'none' as const, label: 'Pay at venue', hint: 'No card required online' },
    { v: 'deposit' as const, label: 'Deposit online', hint: 'Hold funds via Stripe' },
    { v: 'full_payment' as const, label: 'Pay in full', hint: 'Charge full amount at booking' },
    { v: 'card_hold' as const, label: 'Card hold', hint: 'Store a card, charge only no-shows' },
  ];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2 sm:grid-cols-3">
        {options.map((opt) => (
          <button
            key={opt.v}
            type="button"
            onClick={() => onChange(opt.v)}
            className={cn(
              'rounded-xl border px-4 py-3.5 text-left transition-all',
              value === opt.v
                ? 'border-brand-400 bg-brand-50/80 shadow-sm ring-2 ring-brand-500/15'
                : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/80',
            )}
          >
            <span className="block text-sm font-semibold text-slate-900">{opt.label}</span>
            <span className="mt-0.5 block text-xs text-slate-500">{opt.hint}</span>
          </button>
        ))}
      </div>
      {value === 'card_hold' ? (
        <p className="text-xs text-slate-500">
          No payment is taken when the client books. Their card is stored securely and you can charge a no-show fee
          if they do not attend.
        </p>
      ) : null}
      {value === 'deposit' ? (
        <div className="max-w-xs">
          <label className={fieldLabelClass}>Deposit amount ({sym})</label>
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={depositValue}
            onChange={(e) => onDepositChange(e.target.value)}
            placeholder="e.g. 10.00"
            className={fieldInputClass}
          />
          <p className={fieldHintClass}>Charged when the guest books. Balance may be due at the venue.</p>
        </div>
      ) : null}
      {value === 'card_hold' ? (
        <div className="max-w-xs">
          <label className={fieldLabelClass}>No-show fee (£)</label>
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={depositValue}
            onChange={(e) => onDepositChange(e.target.value)}
            placeholder="e.g. 10.00"
            className={fieldInputClass}
          />
          <p className={fieldHintClass}>At least £1. Charged only if you mark the booking as a no-show.</p>
        </div>
      ) : null}
      {!stripeConnected && (value === 'deposit' || value === 'full_payment' || value === 'card_hold') ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          Connect Stripe in settings before guests can pay online.
        </p>
      ) : null}
    </div>
  );
}


type WeekHoursRange = { start: string; end: string };
type WeekHoursDay = { enabled: boolean; ranges: WeekHoursRange[] };

export function WeekHoursEditor({
  days,
  hours,
  onChange,
  matchCalendar,
  onToggleMatchCalendar,
  matchLabel,
}: {
  days: Array<{ key: string; label: string }>;
  hours: Record<string, WeekHoursDay>;
  /** Receives the full next-day state (enabled + all ranges) for the given day. */
  onChange: (key: string, nextDay: WeekHoursDay) => void;
  matchCalendar: boolean;
  onToggleMatchCalendar: () => void;
  matchLabel: string;
}) {
  /**
   * The third weekly-hours editor, now a shell around the shared one (decision (K), step 5).
   *
   * Only the surrounding "Match selected calendar hours" control and this component's
   * per-day `onChange` contract are still local. Day rows, the copy-day rule, split periods
   * and the end-of-day guard all come from {@link WeeklyHoursEditor}, so the three editors
   * can no longer drift apart the way the six working-hours implementations Stage 5
   * collapsed had already begun to.
   *
   * This does NOT disappear in favour of `/dashboard/calendar-availability`, which is what
   * the plan originally assumed. It is step 5 of the resource CREATION wizard, so removing
   * it would mean a resource could not be given hours until after it existed. Resources are
   * now editable in both places, backed by one implementation.
   *
   * `WeekHoursDay` is a third storage shape (`{ enabled, ranges: [{ start, end }] }`), so it
   * converts at the edge like the other two rather than any format migrating.
   */
  const normalised: NormalisedWeek = {};
  for (const d of days) {
    const day = hours[d.key];
    normalised[d.key] =
      day?.enabled && day.ranges.length > 0
        ? day.ranges.map((r) => ({ open: r.start, close: r.end }))
        : null;
  }

  /**
   * The shared editor reports the whole week; callers here expect one day at a time.
   * Emitting only the days that actually changed keeps that contract, and stops a caller
   * that persists per day from writing six untouched days on every keystroke.
   */
  function handleWeekChange(next: NormalisedWeek) {
    for (const d of days) {
      const before = normalised[d.key] ?? null;
      const after = next[d.key] ?? null;
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      onChange(
        d.key,
        after
          ? { enabled: true, ranges: after.map((pd) => ({ start: pd.open, end: pd.close })) }
          : // Keep the ranges so unticking and reticking a day restores what was there,
            // which is what the previous implementation did via ensureRanges.
            { enabled: false, ranges: hours[d.key]?.ranges ?? [] },
      );
    }
  }

  return (
    <div className="space-y-3">
      <p className={fieldHintClass}>
        Set hours for each day. Add a second range for split hours (e.g. 09:00–12:00 and 14:00–18:00), copy one
        day&apos;s times to other open days, or match your venue calendar.
      </p>
      <div className="flex justify-end">
        <Button
          type="button"
          variant={matchCalendar ? 'primary' : 'secondary'}
          size="sm"
          className="w-full sm:w-auto"
          onClick={onToggleMatchCalendar}
        >
          {matchLabel}
        </Button>
      </div>
      <WeeklyHoursEditor days={days} value={normalised} onChange={handleWeekChange} />
    </div>
  );
}
