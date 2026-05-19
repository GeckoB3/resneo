'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { DashboardStaffBookingModal } from '@/components/booking/DashboardStaffBookingModal';
import {
  buildToolbarBookBootstrap,
  guestSearchResultLabel,
  guestSearchResultSubtitle,
} from '@/components/dashboard/toolbar-guest-search/guest-search-helpers';
import { ToolbarContactDetailModal } from '@/components/dashboard/toolbar-guest-search/ToolbarContactDetailModal';
import { useDashboardToolbarVenue } from '@/components/dashboard/toolbar-guest-search/DashboardToolbarVenueProvider';
import { useGuestToolbarSearch } from '@/components/dashboard/toolbar-guest-search/useGuestToolbarSearch';
import { useDashboardDetailCache } from '@/components/providers/DashboardDetailCacheProvider';
import type { StaffRebookBootstrapPayloadV1 } from '@/lib/booking/staff-rebook-bootstrap';
import type { GuestListRow } from '@/types/contacts';

export interface OperationsToolbarGuestSearchPanelProps {
  /** Sync typed query to a parent list filter (e.g. contacts / day sheet). */
  onQueryChange?: (query: string) => void;
  /** Pre-fill staff booking modal date/time when booking from this surface. */
  initialDate?: string;
  initialTime?: string;
  preselectedPractitionerId?: string;
  onBookingCreated?: () => void;
}

function GuestSearchResultRow({
  row,
  onBook,
  viewOpen,
  onView,
  onPrefetch,
}: {
  row: GuestListRow;
  onBook: (row: GuestListRow) => void;
  viewOpen: boolean;
  onView: (row: GuestListRow) => void;
  onPrefetch: (guestId: string) => void;
}) {
  const label = guestSearchResultLabel(row);
  const subtitle = guestSearchResultSubtitle(row);
  const initial = label.charAt(0).toUpperCase();

  return (
    <li
      className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-100 bg-slate-50/50 px-2 py-1.5 transition-colors hover:border-slate-200 hover:bg-white"
      onMouseEnter={() => onPrefetch(row.id)}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-xs font-bold text-brand-700 ring-1 ring-brand-100">
        {initial}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-slate-900">{label}</p>
        <p className="truncate text-[11px] text-slate-500">{subtitle}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => onBook(row)}
          className="inline-flex h-7 items-center justify-center rounded-md border border-brand-200 bg-brand-50 px-2 text-[11px] font-semibold text-brand-800 shadow-sm hover:bg-brand-100"
        >
          Book
        </button>
        <button
          type="button"
          onClick={() => onView(row)}
          onFocus={() => onPrefetch(row.id)}
          className={`inline-flex h-7 items-center justify-center rounded-md border px-2 text-[11px] font-semibold shadow-sm ${
            viewOpen
              ? 'border-brand-300 bg-brand-50 text-brand-800 ring-1 ring-brand-200'
              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
          }`}
          aria-haspopup="dialog"
          aria-expanded={viewOpen}
        >
          View
        </button>
      </div>
    </li>
  );
}

/**
 * Live guest directory search for OperationsWorkspaceToolbar — name, phone, or email.
 */
export function OperationsToolbarGuestSearchPanel({
  onQueryChange,
  initialDate,
  initialTime,
  preselectedPractitionerId,
  onBookingCreated,
}: OperationsToolbarGuestSearchPanelProps) {
  const inputId = useId();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const venue = useDashboardToolbarVenue();
  const { warmGuestDetail } = useDashboardDetailCache();

  const [query, setQuery] = useState('');
  const { results, loading, error, showHint, showEmpty, minQueryLength } = useGuestToolbarSearch(query);

  const [bookingBootstrap, setBookingBootstrap] = useState<StaffRebookBootstrapPayloadV1 | null>(null);
  const [bookingModalEpoch, setBookingModalEpoch] = useState(0);
  const [viewingGuest, setViewingGuest] = useState<GuestListRow | null>(null);

  const handleQueryChange = useCallback(
    (value: string) => {
      setQuery(value);
      onQueryChange?.(value);
    },
    [onQueryChange],
  );

  const handleBook = useCallback(
    (row: GuestListRow) => {
      setViewingGuest(null);
      setBookingModalEpoch((e) => e + 1);
      setBookingBootstrap(buildToolbarBookBootstrap(row, venue.bookingModel, venue.enabledModels));
    },
    [venue.bookingModel, venue.enabledModels],
  );

  const handleView = useCallback((row: GuestListRow) => {
    setViewingGuest(row);
  }, []);

  const handlePrefetch = useCallback(
    (guestId: string) => {
      void warmGuestDetail(guestId);
    },
    [warmGuestDetail],
  );

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="space-y-2.5">
      <label htmlFor={inputId} className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Search {venue.clientLower}
      </label>
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
          <svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
        </div>
        <input
          ref={searchInputRef}
          id={inputId}
          type="search"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder="Name, phone, or email"
          className="w-full rounded-xl border border-slate-200 bg-slate-50/60 py-2 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-brand-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100"
          autoComplete="off"
        />
      </div>

      {query.trim() ? (
        <button
          type="button"
          onClick={() => handleQueryChange('')}
          className="text-xs font-semibold text-brand-600 hover:text-brand-700 hover:underline"
        >
          Clear search
        </button>
      ) : null}

      <div className="min-h-[2.5rem]" aria-live="polite" aria-busy={loading}>
        {showHint ? (
          <p className="text-xs text-slate-500">Type at least {minQueryLength} characters…</p>
        ) : null}
        {loading ? (
          <div className="flex items-center gap-2 py-2 text-xs text-slate-500">
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
            Searching…
          </div>
        ) : null}
        {error ? <p className="text-xs text-red-600">{error}</p> : null}
        {showEmpty ? (
          <p className="text-xs text-slate-500">No {venue.clientLower}s match that search.</p>
        ) : null}
        {results.length > 0 ? (
          <ul className="max-h-[min(50dvh,16rem)] space-y-1 overflow-y-auto overscroll-contain pr-0.5">
            {results.map((row) => (
              <GuestSearchResultRow
                key={row.id}
                row={row}
                onBook={handleBook}
                viewOpen={viewingGuest?.id === row.id}
                onView={handleView}
                onPrefetch={handlePrefetch}
              />
            ))}
          </ul>
        ) : null}
      </div>

      {viewingGuest ? (
        <ToolbarContactDetailModal
          row={viewingGuest}
          open
          onClose={() => setViewingGuest(null)}
        />
      ) : null}

      {bookingBootstrap ? (
        <DashboardStaffBookingModal
          key={bookingModalEpoch}
          open
          title={`New ${venue.bookingWord.toLowerCase()}`}
          onClose={() => setBookingBootstrap(null)}
          onCreated={() => {
            setBookingBootstrap(null);
            onBookingCreated?.();
          }}
          venueId={venue.venueId}
          currency={venue.currency}
          bookingModel={venue.bookingModel}
          enabledModels={venue.enabledModels}
          advancedMode={venue.tableManagementEnabled}
          staffRebookBootstrap={bookingBootstrap}
          initialDate={initialDate}
          initialTime={initialTime}
          preselectedPractitionerId={preselectedPractitionerId}
        />
      ) : null}
    </div>
  );
}
