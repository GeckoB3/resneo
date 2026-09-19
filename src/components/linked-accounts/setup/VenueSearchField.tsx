'use client';

/**
 * Finding the other venue (spec §6.1 step 2; Docs/link-and-collective-setup-wizard-plan.md §3.1).
 *
 * Search by name, or paste the booking page address. Choosing a result looks the venue up once more
 * so the field holds everything the wizard needs: whether a link can be sent, whether the two are
 * already linked, and the venue's standing for a collective hosted by the caller.
 */
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { CollectiveStandingResult } from '@/lib/linked-accounts/collective-standing';
import { collectiveCopy } from '@/lib/linked-accounts/collective-copy';

export interface VenuePick {
  name: string;
  slug: string;
  eligible: boolean;
  reason: string | null;
  /** An accepted or suspended link already exists between the two venues. */
  alreadyLinked: boolean;
  /** The venue's standing for a collective the caller would host. */
  collective: CollectiveStandingResult | null;
}

interface SearchRow {
  name: string;
  slug: string;
  eligible: boolean;
}

/** One lookup, with the collective standing, for a slug the user chose or pasted. */
export async function lookupVenue(slug: string): Promise<VenuePick | null> {
  const res = await fetch(`/api/venue/account-links/lookup?slug=${encodeURIComponent(slug)}&collective=1`);
  const json = (await res.json().catch(() => ({}))) as {
    found?: boolean;
    eligible?: boolean;
    alreadyLinked?: boolean;
    name?: string;
    slug?: string;
    reason?: string | null;
    collective?: CollectiveStandingResult;
  };
  if (!res.ok || !json.found) return null;
  return {
    name: json.name ?? slug,
    slug: json.slug ?? slug,
    eligible: Boolean(json.eligible),
    alreadyLinked: Boolean(json.alreadyLinked),
    reason: json.reason ?? null,
    collective: json.collective ?? null,
  };
}

export function VenueSearchField({
  value,
  onChange,
  disabled = false,
  initialSlug,
}: {
  value: VenuePick | null;
  onChange: (pick: VenuePick | null) => void;
  disabled?: boolean;
  /** §20: pre-select this venue, from a shareable invite link. */
  initialSlug?: string;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [resolving, setResolving] = useState(false);

  const prefilledRef = useRef(false);
  useEffect(() => {
    const slug = initialSlug?.trim().toLowerCase();
    if (!slug || prefilledRef.current) return;
    prefilledRef.current = true;
    void (async () => {
      setResolving(true);
      try {
        const pick = await lookupVenue(slug);
        if (pick) onChange(pick);
      } catch {
        /* the user can search instead */
      } finally {
        setResolving(false);
      }
    })();
  }, [initialSlug, onChange]);

  useEffect(() => {
    const term = query.trim();
    if (value || term.length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/venue/account-links/search?q=${encodeURIComponent(term)}`);
        const json = (await res.json().catch(() => ({}))) as { results?: SearchRow[]; truncated?: boolean };
        if (cancelled) return;
        setResults(res.ok ? (json.results ?? []) : []);
        setTruncated(Boolean(json.truncated));
        setActiveIndex(-1);
        setSearched(true);
      } catch {
        if (!cancelled) {
          setResults([]);
          setSearched(true);
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, value]);

  const choose = async (row: SearchRow) => {
    setResults([]);
    setSearched(false);
    setQuery('');
    setResolving(true);
    try {
      const pick = await lookupVenue(row.slug);
      onChange(pick ?? { name: row.name, slug: row.slug, eligible: row.eligible, reason: null, alreadyLinked: false, collective: null });
    } catch {
      onChange({ name: row.name, slug: row.slug, eligible: row.eligible, reason: null, alreadyLinked: false, collective: null });
    } finally {
      setResolving(false);
    }
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      void choose(results[activeIndex]!);
    }
  };

  if (value) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{value.name}</p>
            <p className="truncate text-xs text-slate-500">/book/{value.slug}</p>
          </div>
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={disabled}
            className="shrink-0 text-xs font-semibold text-brand-700 hover:text-brand-800 disabled:opacity-50"
          >
            Change
          </button>
        </div>
        {!value.eligible ? (
          <p role="alert" className="mt-2 rounded-lg bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700">
            {value.alreadyLinked
              ? collectiveCopy('setup.venue.alreadyLinked', { venue: value.name })
              : (value.reason ?? 'This venue is not available to link right now.')}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="relative">
      <label className="block">
        <span className="block text-sm font-medium text-slate-700">Find a venue</span>
        <input
          type="text"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls="venue-search-results"
          aria-autocomplete="list"
          value={query}
          disabled={disabled || resolving}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Venue name or booking page address"
          className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          autoFocus
          autoComplete="off"
        />
      </label>
      {resolving ? (
        <p className="mt-1 text-xs text-slate-500">Checking the venue...</p>
      ) : searching ? (
        <p className="mt-1 text-xs text-slate-500">Searching...</p>
      ) : searched && results.length === 0 ? (
        <p className="mt-1 text-xs text-slate-500">
          No venues found. Check the name, or ask them for their booking page address.
        </p>
      ) : null}
      {results.length > 0 ? (
        <ul
          id="venue-search-results"
          role="listbox"
          className="mt-2 max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-sm"
        >
          {results.map((r, i) => (
            <li key={r.slug} role="option" aria-selected={i === activeIndex}>
              <button
                type="button"
                onClick={() => void choose(r)}
                onMouseEnter={() => setActiveIndex(i)}
                className={`flex min-h-[44px] w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${
                  i === activeIndex ? 'bg-brand-50' : 'hover:bg-slate-50'
                } ${i > 0 ? 'border-t border-slate-100' : ''}`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-slate-900">{r.name}</span>
                  <span className="block truncate text-xs text-slate-500">/book/{r.slug}</span>
                </span>
                {r.eligible ? (
                  <span className="shrink-0 text-[11px] font-semibold text-emerald-600">Available</span>
                ) : (
                  <span className="shrink-0 text-[11px] font-medium text-slate-400">Unavailable</span>
                )}
              </button>
            </li>
          ))}
          {truncated ? (
            <li className="border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-400">
              Showing the first {results.length}. Refine your search to narrow it down.
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
