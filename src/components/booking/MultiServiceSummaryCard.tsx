'use client';

import { cardHoldCatalogNoticeLine } from './card-hold-copy';

export interface MultiServiceLine {
  /** Group bookings: attendee label shown above the service line. */
  personLabel?: string;
  serviceName: string;
  /** Service variant / sub-option, when chosen separately from the base service name. */
  variantName?: string | null;
  practitionerName: string;
  startTime: string;
  durationMinutes: number;
  pricePence: number | null;
  depositPence: number;
  /** When set, refines the total line label (deposit vs full payment vs card hold). */
  chargeKind?: 'deposit' | 'full_payment' | 'card_hold';
  /** Add-ons stacked on this service, shown beneath the service line. */
  extras?: Array<{ name: string; pricePence: number; durationMinutes: number }>;
  /** When true and `onEditAddons` is provided, an "Edit extras" control is shown. */
  editableAddons?: boolean;
}

interface MultiServiceSummaryCardProps {
  lines: MultiServiceLine[];
  formatDateHuman: (dateStr: string) => string;
  bookingDate: string;
  currencySymbol: string;
  formatPrice: (pence: number | null) => string;
  /** Card heading; defaults to "Your appointment". */
  title?: string;
  onRemove?: (index: number) => void;
  onEditAddons?: (index: number) => void;
  /** Row index currently being removed (shows spinner on that Remove control). */
  removingSegmentIndex?: number | null;
}

export function MultiServiceSummaryCard({
  lines,
  formatDateHuman,
  bookingDate,
  currencySymbol,
  formatPrice,
  title = 'Your appointment',
  onRemove,
  onEditAddons,
  removingSegmentIndex = null,
}: MultiServiceSummaryCardProps) {
  const removeBusy = removingSegmentIndex != null;
  const totalDuration = lines.reduce((sum, l) => sum + l.durationMinutes, 0);
  const totalExtras = lines.reduce(
    (sum, l) => sum + (l.extras?.reduce((s, e) => s + e.pricePence, 0) ?? 0),
    0,
  );
  const totalPrice = lines.reduce((sum, l) => sum + (l.pricePence ?? 0), 0) + totalExtras;
  // Card-hold lines are not money due at booking (design doc 7.3): their fee is split out of
  // the deposit total and shown as the no-show hold notice instead.
  const totalCardHoldFee = lines.reduce(
    (sum, l) => sum + (l.chargeKind === 'card_hold' ? l.depositPence ?? 0 : 0),
    0,
  );
  const totalDeposit = lines.reduce(
    (sum, l) => sum + (l.chargeKind === 'card_hold' ? 0 : l.depositPence ?? 0),
    0,
  );
  const hasPrice = lines.some((l) => l.pricePence != null);
  const allFull =
    totalDeposit > 0 &&
    lines.every(
      (l) => l.depositPence <= 0 || l.chargeKind === 'full_payment' || l.chargeKind === 'card_hold',
    );
  const depositLineLabel = totalDeposit > 0 ? (allFull ? 'Full payment due' : 'Deposit due') : '';

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</h3>
      <p className="mb-3 text-sm text-slate-600">
        {formatDateHuman(bookingDate)}
      </p>
      <ul className="space-y-0 divide-y divide-slate-100 border border-slate-100 rounded-lg overflow-hidden">
        {lines.map((line, idx) => (
          <li key={`${line.serviceName}-${idx}-${line.startTime}`} className="flex items-start justify-between gap-3 bg-slate-50/50 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              {line.personLabel ? (
                <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  {line.personLabel}
                </div>
              ) : null}
              <div className="font-medium text-slate-900">{line.serviceName}</div>
              {line.variantName && !line.serviceName.includes(line.variantName) ? (
                <div className="mt-0.5 text-xs text-slate-600">{line.variantName}</div>
              ) : null}
              <div className="mt-0.5 text-xs text-slate-500">
                {line.startTime} · {line.durationMinutes} min · {line.practitionerName}
              </div>
              {line.pricePence != null && (
                <div className="mt-0.5 text-xs font-medium text-brand-600">{formatPrice(line.pricePence)}</div>
              )}
              {line.extras && line.extras.length > 0 ? (
                <ul className="mt-1 space-y-0.5 border-l-2 border-slate-200 pl-2 text-[11px] text-slate-500">
                  {line.extras.map((e, i) => (
                    <li key={`${e.name}-${i}`} className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate">
                        + {e.name}
                        {e.durationMinutes > 0 ? ` (+${e.durationMinutes} min)` : ''}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {e.pricePence > 0 ? `+${currencySymbol}${(e.pricePence / 100).toFixed(2)}` : 'Free'}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {line.editableAddons && onEditAddons ? (
                <button
                  type="button"
                  disabled={removeBusy}
                  onClick={() => onEditAddons(idx)}
                  className="mt-1 text-[11px] font-medium text-brand-600 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {line.extras && line.extras.length > 0 ? 'Edit extras' : 'Add extras'}
                </button>
              ) : null}
            </div>
            {onRemove ? (
              <button
                type="button"
                disabled={removeBusy}
                aria-busy={removingSegmentIndex === idx}
                onClick={() => {
                  if (removeBusy) return;
                  onRemove(idx);
                }}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  removingSegmentIndex === idx
                    ? 'text-slate-600'
                    : 'text-slate-500 hover:bg-red-50 hover:text-red-600'
                }`}
              >
                {removingSegmentIndex === idx ? (
                  <span
                    className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-400 border-t-transparent"
                    aria-hidden
                  />
                ) : null}
                {removingSegmentIndex === idx ? 'Removing…' : 'Remove'}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="mt-4 space-y-1.5 border-t border-slate-100 pt-3 text-sm">
        <div className="flex justify-between text-slate-600">
          <span>Total duration</span>
          <span className="font-medium text-slate-900">{totalDuration} min</span>
        </div>
        {hasPrice && (
          <div className="flex justify-between text-slate-600">
            <span>Combined price</span>
            <span className="font-semibold text-brand-600">
              {currencySymbol}
              {(totalPrice / 100).toFixed(2)}
            </span>
          </div>
        )}
        {totalDeposit > 0 && (
          <div className="flex justify-between text-amber-900/90">
            <span className="font-medium">{depositLineLabel}</span>
            <span className="font-semibold">
              {currencySymbol}
              {(totalDeposit / 100).toFixed(2)}
            </span>
          </div>
        )}
        {totalCardHoldFee > 0 && (
          <p className="text-xs text-slate-600">{cardHoldCatalogNoticeLine(totalCardHoldFee)}</p>
        )}
      </div>
    </div>
  );
}
