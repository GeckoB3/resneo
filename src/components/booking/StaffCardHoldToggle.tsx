'use client';

/**
 * "Card hold" switch shown on the five staff booking surfaces
 * (docs: CARD_HOLD_DEPOSITS_DESIGN_AND_IMPLEMENTATION §7.6, D6).
 *
 * Rendered only when the selected entity resolves to `card_hold`; never shown
 * together with the "Require deposit" toggle; hidden when editing. Default OFF
 * since 2026-09-09: staff booking for a guest more often waive the hold than
 * ask for it, and the sublabel says what each position does.
 */

import {
  STAFF_CARD_HOLD_TOGGLE_LABEL,
  staffCardHoldToggleSublabel,
} from '@/components/booking/staff-card-hold';

export function StaffCardHoldToggle({
  checked,
  onChange,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** No-show fee for the whole booking. Accepted from every surface; no longer shown here. */
  feePence?: number;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2.5 sm:rounded-xl sm:px-4 sm:py-3 ${className ?? ''}`}
    >
      <div className="min-w-0 pr-1">
        <p className="text-xs font-medium text-slate-700 sm:text-sm">
          {STAFF_CARD_HOLD_TOGGLE_LABEL}
        </p>
        <p className="text-[11px] text-slate-500 sm:text-xs">{staffCardHoldToggleSublabel(checked)}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={STAFF_CARD_HOLD_TOGGLE_LABEL}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
          checked ? 'bg-brand-600' : 'bg-slate-200'
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform duration-200 ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}
