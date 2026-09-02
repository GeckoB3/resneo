'use client';

/**
 * The bar under the service list once services can be ticked rather than
 * tapped through: what is chosen so far, how long the visit runs, what it
 * starts from, and the one control that moves on. Rendered even when nothing
 * is ticked, so the list reads as "choose, then continue" rather than as a
 * list that stopped responding to taps.
 */

export interface PickerServiceLine {
  id: string;
  name: string;
  durationMinutes: number;
  /** Cheapest price across the people who offer it; null when unknown or free. */
  minPricePence: number | null;
}

interface MultiServicePickerBarProps {
  services: PickerServiceLine[];
  max: number;
  isPublic: boolean;
  formatPrice: (pence: number | null) => string;
  /** The venue's word for a person, lower case ("stylist", "therapist"). */
  staffWord: string;
  onContinue: () => void;
  onClear: () => void;
}

export function MultiServicePickerBar({
  services,
  max,
  isPublic,
  formatPrice,
  staffWord,
  onContinue,
  onClear,
}: MultiServicePickerBarProps) {
  const count = services.length;
  const totalMinutes = services.reduce((sum, s) => sum + s.durationMinutes, 0);
  const priced = services.filter((s) => s.minPricePence != null);
  const fromPence = priced.length > 0 ? priced.reduce((sum, s) => sum + (s.minPricePence ?? 0), 0) : null;
  const full = count >= max;

  const shell = isPublic
    ? 'ap-picker-bar sticky bottom-0 z-10 mt-4 rounded-2xl border bg-white p-3 shadow-lg'
    : 'sticky bottom-0 z-10 mt-4 rounded-2xl border border-slate-200 bg-white p-3 shadow-lg';
  const continueClass = isPublic
    ? 'ap-btn-primary min-h-[44px] rounded-xl px-5 py-2.5 text-sm font-semibold disabled:opacity-50'
    : 'min-h-[44px] rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300';

  return (
    <div className={shell} data-testid="service-picker-bar" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          {count === 0 ? (
            <>
              <p className="text-sm font-semibold text-slate-900">Choose one or more services</p>
              <p className="mt-0.5 text-xs text-slate-500">
                Tick everything you want in one visit, up to {max}. They will be booked back to back with the same {staffWord}.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-slate-900">
                {count} {count === 1 ? 'service' : 'services'}
                <span className="font-normal text-slate-500">
                  {' '}&middot; {totalMinutes} min
                  {fromPence != null && fromPence > 0 ? <> &middot; from {formatPrice(fromPence)}</> : null}
                </span>
              </p>
              <p className="mt-0.5 truncate text-xs text-slate-500" title={services.map((s) => s.name).join(', ')}>
                {services.map((s) => s.name).join(' + ')}
              </p>
              {full ? (
                <p className="mt-0.5 text-xs text-amber-700">
                  That is the most you can book in one visit ({max}).
                </p>
              ) : null}
            </>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {count > 0 ? (
            <button
              type="button"
              onClick={onClear}
              className="rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            >
              Clear
            </button>
          ) : null}
          <button type="button" onClick={onContinue} disabled={count === 0} className={continueClass}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
