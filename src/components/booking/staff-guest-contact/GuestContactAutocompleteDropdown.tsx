'use client';

import {
  guestSearchResultLabel,
  guestSearchResultSubtitle,
} from '@/components/dashboard/toolbar-guest-search/guest-search-helpers';
import type { GuestListRow } from '@/types/contacts';
import { collectiveCopy } from '@/lib/linked-accounts/collective-copy';

interface GuestContactAutocompleteDropdownProps {
  results: GuestListRow[];
  loading: boolean;
  error: string | null;
  showHint: boolean;
  showEmpty: boolean;
  minQueryLength: number;
  onSelect: (row: GuestListRow) => void;
}

function GuestContactResultRow({
  row,
  onSelect,
}: {
  row: GuestListRow;
  onSelect: (row: GuestListRow) => void;
}) {
  const label = guestSearchResultLabel(row);
  const subtitle = guestSearchResultSubtitle(row);
  const initial = label.charAt(0).toUpperCase();

  return (
    <li>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onSelect(row)}
        className="flex w-full min-w-0 items-center gap-2 rounded-lg border border-transparent px-2 py-2 text-left transition-colors hover:border-slate-200 hover:bg-slate-50 focus-visible:border-brand-300 focus-visible:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-100"
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-xs font-bold text-brand-700 ring-1 ring-brand-100">
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">{label}</p>
          <p className="truncate text-[11px] text-slate-500">{subtitle}</p>
          {row.owner_venue_name && row.owner_is_self === false ? (
            <p className="truncate text-[11px] font-medium text-brand-700">
              {collectiveCopy('staff.contact.ownerLine', { venue: row.owner_venue_name })}
            </p>
          ) : null}
        </div>
      </button>
    </li>
  );
}

export function GuestContactAutocompleteDropdown({
  results,
  loading,
  error,
  showHint,
  showEmpty,
  minQueryLength,
  onSelect,
}: GuestContactAutocompleteDropdownProps) {
  if (!showHint && !loading && !error && !showEmpty && results.length === 0) {
    return null;
  }

  return (
    <div
      className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
      role="listbox"
      aria-label="Matching contacts"
    >
      <div className="max-h-[min(50dvh,14rem)] overflow-y-auto overscroll-contain p-1.5" aria-live="polite" aria-busy={loading}>
        {showHint ? (
          <p className="px-2 py-2 text-xs text-slate-500">Type at least {minQueryLength} characters to search saved contacts…</p>
        ) : null}
        {loading ? (
          <div className="flex items-center gap-2 px-2 py-2 text-xs text-slate-500">
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
            Searching contacts…
          </div>
        ) : null}
        {error ? <p className="px-2 py-2 text-xs text-red-600">{error}</p> : null}
        {showEmpty ? (
          <p className="px-2 py-2 text-xs text-slate-500">No saved contacts match that search.</p>
        ) : null}
        {results.length > 0 ? (
          <ul className="space-y-0.5">
            {results.map((row) => (
              <GuestContactResultRow key={row.id} row={row} onSelect={onSelect} />
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
