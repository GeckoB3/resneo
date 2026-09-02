'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  DEFAULT_INPUTS,
  PRICING_CHECKED_ON,
  computeAll,
  type CalculatorInputs,
  type ProviderResult,
} from '@/lib/pricing/competitor-pricing';
import { SIGNUP_TRIAL_SHORT_LABEL } from '@/lib/signup-trial-copy';

const money = (n: number) =>
  `£${n.toLocaleString('en-GB', { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;

/** Whole pounds, for the big annual figures where pence are noise. */
const moneyRounded = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;

/** Per-booking costs live in pence until they pass a pound. */
const perBookingLabel = (n: number) => (n < 1 ? `${Math.round(n * 100)}p` : money(n));

/**
 * "£103 to £233 a month less", collapsing to a single figure when the cheapest and
 * dearest of the group round to the same number. "£233 to £233" reads like a bug.
 */
function savingBand(dearer: ProviderResult[], resneoTotal: number): string {
  const low = Math.round(Math.min(...dearer.map((d) => d.total)) - resneoTotal);
  const high = Math.round(Math.max(...dearer.map((d) => d.total)) - resneoTotal);
  return low === high ?
      `${moneyRounded(high)} a month less`
    : `${moneyRounded(low)} to ${moneyRounded(high)} a month less`;
}

export function PricingCalculator() {
  const [inputs, setInputs] = useState<CalculatorInputs>(DEFAULT_INPUTS);
  const [openCard, setOpenCard] = useState<string | null>('resneo');

  const set = <K extends keyof CalculatorInputs>(key: K, value: CalculatorInputs[K]) =>
    setInputs((prev) => ({ ...prev, [key]: value }));

  const { resneo, competitors, savingVsDearest, costPerBooking, monthlyRevenue } = useMemo(
    () => computeAll(inputs),
    [inputs],
  );

  const dearer = competitors.filter((c) => c.total > resneo.total);
  const cheaper = competitors.filter((c) => c.total <= resneo.total);
  const maxTotal = Math.max(resneo.total, ...competitors.map((c) => c.total));

  return (
    <div className="mx-auto max-w-6xl px-6">
      <div className="grid gap-8 lg:grid-cols-[380px_1fr] lg:items-start">
        {/* ------------------------------------------------ controls */}
        <form
          className="rounded-[24px] border border-[#EEE9E0] bg-white p-6 shadow-sm lg:sticky lg:top-24"
          onSubmit={(e) => e.preventDefault()}
          aria-label="Your business"
        >
          <h2 className="text-lg font-bold text-slate-900">Tell us about your business</h2>
          <p className="mt-1 text-sm text-slate-600">
            Everything updates as you move the sliders. Nothing is sent anywhere.
          </p>

          <div className="mt-6 space-y-6">
            <Slider
              id="calendars"
              label="Bookable calendars"
              hint="One per person, chair, or room that takes bookings."
              min={1}
              max={12}
              step={1}
              value={inputs.calendars}
              onChange={(v) => set('calendars', v)}
              format={(v) => `${v}`}
            />
            <Slider
              id="bookings"
              label="Bookings a month"
              min={20}
              max={1000}
              step={10}
              value={inputs.bookingsPerMonth}
              onChange={(v) => set('bookingsPerMonth', v)}
              format={(v) => v.toLocaleString('en-GB')}
            />
            <Slider
              id="value"
              label="Average booking value"
              min={10}
              max={200}
              step={5}
              value={inputs.averageBookingValue}
              onChange={(v) => set('averageBookingValue', v)}
              format={(v) => money(v)}
            />
            <Slider
              id="newclients"
              label="New clients a month from the marketplace"
              hint="The clients a platform's own directory sends you. This is what commission is charged on."
              min={0}
              max={60}
              step={1}
              value={inputs.marketplaceNewClientsPerMonth}
              onChange={(v) => set('marketplaceNewClientsPerMonth', v)}
              format={(v) => `${v}`}
            />
            <Slider
              id="sms"
              label="Text reminders a month"
              min={0}
              max={1200}
              step={20}
              value={inputs.smsPerMonth}
              onChange={(v) => set('smsPerMonth', v)}
              format={(v) => v.toLocaleString('en-GB')}
            />
          </div>

          <div className="mt-6 space-y-3 border-t border-[#EEE9E0] pt-5">
            <Toggle
              id="marketplace"
              label="Use each platform's marketplace"
              hint="Booksy, Fresha, Vagaro and Treatwell all charge a one-off fee on a new client's first booking. Only ResNeo does not."
              checked={inputs.useMarketplace}
              onChange={(v) => set('useMarketplace', v)}
            />
            <Toggle
              id="addons"
              label="Add published marketing and loyalty add-ons"
              hint="Fresha prices Insights and Client Loyalty separately. Booksy includes them. Vagaro includes 1,000 marketing emails but charges for UK text messaging, and does not publish those prices, so its total here is a floor."
              checked={inputs.includeAddOns}
              onChange={(v) => set('includeAddOns', v)}
            />
          </div>

          <fieldset className="mt-6 border-t border-[#EEE9E0] pt-5">
            <legend className="text-sm font-semibold text-slate-900">
              Subscriptions we cannot look up
            </legend>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Phorest publishes no prices at all, so its row is only what you type here. Treatwell
              publishes plans that start free and charges on commission instead, so it starts at
              zero: put a figure in only if you are on a paid tier. Both rows follow your number
              exactly.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <MoneyInput
                id="phorest"
                label="Phorest a month"
                value={inputs.phorestMonthlyEstimate}
                onChange={(v) => set('phorestMonthlyEstimate', v)}
              />
              <MoneyInput
                id="treatwell"
                label="Treatwell a month"
                value={inputs.treatwellMonthlyEstimate}
                onChange={(v) => set('treatwellMonthlyEstimate', v)}
              />
            </div>
          </fieldset>

          <button
            type="button"
            onClick={() => setInputs(DEFAULT_INPUTS)}
            className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-full border border-[#EEE9E0] text-sm font-extrabold text-brand-600 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            Reset to a typical salon
          </button>
        </form>

        {/* ------------------------------------------------ results */}
        <div>
          <div className="rounded-[24px] border border-brand-100 bg-gradient-to-br from-brand-50 to-white p-6 shadow-sm sm:p-8">
            <p className="text-xs font-bold uppercase tracking-widest text-accent-700">
              Your monthly cost on ResNeo
            </p>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-5xl font-extrabold tracking-tight text-brand-700">
                {money(resneo.total)}
              </span>
              <span className="text-base text-slate-600">a month on {resneo.planLabel}</span>
            </div>

            {costPerBooking ? (
              <p className="mt-2 text-sm text-slate-600">
                Works out at{' '}
                <strong className="font-semibold text-slate-800">
                  {perBookingLabel(costPerBooking.resneo)} a booking
                </strong>
                {monthlyRevenue > 0 ? (
                  <>
                    , or {((resneo.total / monthlyRevenue) * 100).toFixed(1)}% of the{' '}
                    {moneyRounded(monthlyRevenue)} those bookings are worth
                  </>
                ) : null}
                .
              </p>
            ) : null}

            {dearer.length > 0 ? (
              <p className="mt-4 text-lg leading-relaxed text-slate-800">
                That is{' '}
                <strong className="font-bold text-brand-700">{savingBand(dearer, resneo.total)}</strong>{' '}
                than{' '}
                {dearer.length === 1 ?
                  `${dearer[0].name}`
                : `${dearer.length} of the ${competitors.length} platforms we compared`}
                , or up to{' '}
                <strong className="font-bold text-brand-700">
                  {moneyRounded(savingVsDearest * 12)} a year
                </strong>
                .
              </p>
            ) : (
              <p className="mt-4 text-lg leading-relaxed text-slate-800">
                On these numbers every other platform comes out cheaper. We would rather show you
                that than hide it.
              </p>
            )}

            {cheaper.length > 0 ? (
              <div className="mt-5 rounded-xl border border-amber-200/80 bg-amber-50/70 p-4">
                <p className="text-sm font-semibold text-amber-900">
                  Where another platform comes out cheaper
                </p>
                <ul className="mt-2 space-y-1 text-sm text-amber-900/90">
                  {cheaper.map((c) => (
                    <li key={c.id}>
                      <strong className="font-semibold">{c.name}</strong> by{' '}
                      {money(resneo.total - c.total)} a month
                      {c.estimated ? ', on the estimate you entered' : ''}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-sm leading-relaxed text-amber-900/90">
                  {inputs.useMarketplace ?
                    'That is the subscription doing the work, before any separately priced add-ons. Raise the new clients slider to see what each marketplace charges once it actually sends you someone.'
                  : 'You have the marketplace switched off, so no commission is being counted anywhere. Switch it back on to see what a new client costs on each platform.'}
                </p>
              </div>
            ) : null}
          </div>

          {/* comparison bars */}
          <ol className="mt-6 space-y-3">
            <ProviderRow
              provider={resneo}
              maxTotal={maxTotal}
              isResneo
              open={openCard === resneo.id}
              onToggle={() => setOpenCard(openCard === resneo.id ? null : resneo.id)}
              difference={0}
              perBooking={costPerBooking?.[resneo.id] ?? null}
            />
            {competitors.map((c) => (
              <ProviderRow
                key={c.id}
                provider={c}
                maxTotal={maxTotal}
                open={openCard === c.id}
                onToggle={() => setOpenCard(openCard === c.id ? null : c.id)}
                difference={c.total - resneo.total}
                perBooking={costPerBooking?.[c.id] ?? null}
              />
            ))}
          </ol>

          <p className="mt-5 text-sm leading-relaxed text-slate-600">
            Figures are ex-VAT and per month. Card processing fees are left out for every platform
            here, including ResNeo, because they are paid to a payment processor rather than to the
            booking software. They differ from platform to platform and by card type, so check them
            separately if you plan to take payment online.
          </p>

          <div className="mt-6 rounded-[24px] border border-[#EEE9E0] bg-[#FDFBF7] p-5">
            <h3 className="text-sm font-bold text-slate-900">One thing we should be straight about</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-700">
              ResNeo does not run a marketplace. Booksy, Fresha and Treatwell do, and that is a real
              service: if their directory introduces you to someone who would never have found you,
              the commission on that first booking may well be worth paying. What this calculator
              shows is the cost of putting the same volume of bookings through each platform. If most
              of your clients already know your name, that commission is money you are paying to
              serve people you had anyway.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-slate-700">
              Every provider here also does things ResNeo does not, and the reverse is true too.
              Price is one line of the decision, not the whole of it.
            </p>
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/#pricing"
              className="inline-flex min-h-12 flex-1 items-center justify-center rounded-full bg-brand-600 px-6 text-sm font-extrabold text-white shadow-lg shadow-brand-600/20 transition-colors hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              Start your {SIGNUP_TRIAL_SHORT_LABEL}
            </Link>
            <Link
              href="/help/getting-started/welcome"
              className="inline-flex min-h-12 flex-1 items-center justify-center rounded-full border border-[#EEE9E0] bg-white px-6 text-sm font-extrabold text-brand-600 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              See how setup works
            </Link>
          </div>

          <p className="mt-6 text-xs leading-relaxed text-slate-500">
            Competitor prices were correct at the time of publishing ({PRICING_CHECKED_ON}) according
            to publicly available information. Full sources are listed below.
          </p>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ProviderRow({
  provider,
  maxTotal,
  isResneo = false,
  open,
  onToggle,
  difference,
  perBooking,
}: {
  provider: ProviderResult;
  maxTotal: number;
  isResneo?: boolean;
  open: boolean;
  onToggle: () => void;
  /** Positive when this provider costs more than ResNeo. */
  difference: number;
  /** Monthly total divided by bookings, or null when there are no bookings. */
  perBooking: number | null;
}) {
  const width = maxTotal > 0 ? Math.max(3, (provider.total / maxTotal) * 100) : 3;
  const panelId = `breakdown-${provider.id}`;

  return (
    <li
      className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${
        isResneo ? 'border-brand-200 ring-1 ring-brand-100' : 'border-slate-200'
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="w-full px-5 py-4 text-left transition-colors hover:bg-slate-50/70 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="flex items-center gap-2">
            <span className={`text-base font-bold ${isResneo ? 'text-brand-700' : 'text-slate-900'}`}>
              {provider.name}
            </span>
            {isResneo ? (
              <span className="rounded-full bg-accent-100 px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-wide text-accent-800">
                You
              </span>
            ) : null}
            {provider.estimated ? (
              <span className="rounded-full border border-dashed border-slate-300 bg-[#FDFBF7] px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                Your estimate
              </span>
            ) : null}
          </span>
          <span className="flex items-baseline gap-2">
            {difference > 0 ? (
              <span className="text-xs font-semibold text-slate-500">
                +{money(difference)} vs ResNeo
              </span>
            ) : null}
            <span className={`text-xl font-extrabold ${isResneo ? 'text-brand-700' : 'text-slate-900'}`}>
              {money(provider.total)}
            </span>
          </span>
        </div>

        <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full ${isResneo ? 'bg-accent-500' : 'bg-slate-300'}`}
            style={{ width: `${width}%` }}
          />
        </div>

        <p className="mt-2.5 text-xs text-slate-500">
          {provider.planLabel}
          {perBooking !== null ? (
            <span className="text-slate-400"> · {perBookingLabel(perBooking)} a booking</span>
          ) : null}
          {provider.lines.length > 0 ? (
            <span className="ml-1.5 font-medium text-brand-600">
              {open ? 'Hide the breakdown' : 'Show the breakdown'}
            </span>
          ) : null}
        </p>
      </button>

      {/* Rendered even when collapsed: aria-controls must resolve to a real
          element, or the button announces a relationship that does not exist. */}
      <div hidden={!open} id={panelId} className="border-t border-[#EEE9E0] bg-[#FDFBF7] px-5 py-4">
          <dl className="space-y-2.5">
            {provider.lines.map((line) => (
              <div key={line.label} className="flex justify-between gap-4">
                <dt className="text-sm text-slate-700">
                  {line.label}
                  {line.detail ? (
                    <span className="mt-0.5 block text-xs text-slate-500">{line.detail}</span>
                  ) : null}
                </dt>
                <dd className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">
                  {money(line.amount)}
                </dd>
              </div>
            ))}
            {provider.lines.length === 0 ? (
              <p className="text-sm text-slate-500">Nothing to pay on these numbers.</p>
            ) : null}
          </dl>
          {provider.note ? (
            <p className="mt-3 border-t border-[#EEE9E0] pt-3 text-xs leading-relaxed text-slate-600">
              {provider.note}
            </p>
          ) : null}
      </div>
    </li>
  );
}

function Slider({
  id,
  label,
  hint,
  min,
  max,
  step,
  value,
  onChange,
  format,
}: {
  id: string;
  label: string;
  hint?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-semibold text-slate-800">
          {label}
        </label>
        <output htmlFor={id} className="text-sm font-bold tabular-nums text-brand-700">
          {format(value)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2.5 h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      />
      {hint ? <p className="mt-1.5 text-xs leading-relaxed text-slate-500">{hint}</p> : null}
    </div>
  );
}

function Toggle({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-slate-300 accent-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      />
      <div>
        <label htmlFor={id} className="cursor-pointer text-sm font-semibold text-slate-800">
          {label}
        </label>
        {hint ? <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{hint}</p> : null}
      </div>
    </div>
  );
}

function MoneyInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-xs font-semibold text-slate-700">
        {label}
      </label>
      <div className="mt-1 flex items-center rounded-xl border border-[#EEE9E0] bg-white focus-within:ring-2 focus-within:ring-brand-600/30">
        <span className="pl-3 text-sm text-slate-500">£</span>
        <input
          id={id}
          type="number"
          min={0}
          step={5}
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
          className="min-h-11 w-full rounded-xl bg-transparent px-2 text-sm font-semibold text-slate-900 outline-none"
        />
      </div>
    </div>
  );
}
