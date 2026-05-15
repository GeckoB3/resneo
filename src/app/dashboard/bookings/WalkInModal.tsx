'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { PhoneWithCountryField } from '@/components/phone/PhoneWithCountryField';
import { normalizeToE164 } from '@/lib/phone/e164';
import { defaultPhoneCountryForVenueCurrency } from '@/lib/phone/default-country';
import type { CountryCode } from 'libphonenumber-js';
import type { TableForSelector, OccupancyMap } from '@/components/table-tracking/TableSelector';
import MiniFloorPlanPicker, { type MiniFloorTableRow } from '@/components/floor-plan/MiniFloorPlanPicker';
import { useDismissibleLayer } from '@/lib/ui/use-dismissible-layer';

interface Suggestion {
  source: 'single' | 'auto' | 'manual';
  table_ids: string[];
  table_names: string[];
  combined_capacity: number;
  spare_covers: number;
}

function currentTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

const WALK_IN_PARTY_MIN = 1;
const WALK_IN_PARTY_MAX = 50;
const PARTY_GRID = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

/** Matches server / availability engine bounds for sitting duration. */
const COVER_TIME_MIN = 15;
const COVER_TIME_MAX = 300;

function ChevronDown({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
    </svg>
  );
}

export function WalkInModal({
  advancedMode = false,
  initialDate,
  initialTime,
  venueCurrency,
  embedded = false,
  suppressTitle = false,
  remainingCapacity,
  onClose,
  onCreated,
}: {
  advancedMode?: boolean;
  initialDate?: string;
  initialTime?: string;
  venueCurrency?: string;
  /** When true, render only the inner card (no full-screen backdrop); parent provides the modal shell. */
  embedded?: boolean;
  /** Hide the "Add Walk-in" header when embedded inside another titled modal. */
  suppressTitle?: boolean;
  /** Optional: show remaining covers banner (e.g. day sheet). */
  remainingCapacity?: number | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const phoneDefaultCountry: CountryCode = useMemo(
    () => defaultPhoneCountryForVenueCurrency(venueCurrency),
    [venueCurrency],
  );
  const [partySize, setPartySize] = useState(2);
  const [partyPanelOpen, setPartyPanelOpen] = useState(false);
  const partyPanelRef = useRef<HTMLDivElement>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [dietaryNotes, setDietaryNotes] = useState('');
  const [occasion, setOccasion] = useState('');
  const [bookingDate, setBookingDate] = useState(initialDate ?? new Date().toISOString().slice(0, 10));
  const [bookingTime, setBookingTime] = useState(initialTime ?? currentTime());

  useEffect(() => {
    setBookingDate(initialDate ?? new Date().toISOString().slice(0, 10));
    setBookingTime(initialTime ?? currentTime());
  }, [initialDate, initialTime]);

  useDismissibleLayer({
    open: partyPanelOpen,
    refs: [partyPanelRef],
    onDismiss: () => setPartyPanelOpen(false),
  });

  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selectedSuggestionKey, setSelectedSuggestionKey] = useState<string | null>(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [tableAssignMode, setTableAssignMode] = useState<'suggested' | 'floor'>('suggested');
  const [manualTableIds, setManualTableIds] = useState<string[]>([]);
  const [occupiedTableIds, setOccupiedTableIds] = useState<string[]>([]);
  const [useTemporaryTable, setUseTemporaryTable] = useState(false);
  const [temporaryTableName, setTemporaryTableName] = useState('');

  const [prefetchedTables, setPrefetchedTables] = useState<MiniFloorTableRow[] | null>(null);
  const [diningAreas, setDiningAreas] = useState<Array<{ id: string; name: string; colour: string }>>([]);
  /** Dining area for suggestions, floor plan, and optional walk-in `area_id`. */
  const [floorPlanViewAreaId, setFloorPlanViewAreaId] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Expected minutes at the table (turn time); synced from venue defaults unless staff edits. */
  const [coverDurationMinutes, setCoverDurationMinutes] = useState(90);
  const [coverDurationDirty, setCoverDurationDirty] = useState(false);
  const prevWalkInSuggestInputKeyRef = useRef<string | null>(null);

  const walkInSuggestInputKey = useMemo(() => {
    const timePart = bookingTime.length >= 5 ? bookingTime.slice(0, 5) : bookingTime;
    const areaPart = diningAreas.length > 1 && floorPlanViewAreaId ? floorPlanViewAreaId : '';
    return `${bookingDate}|${timePart}|${partySize}|${areaPart}`;
  }, [bookingDate, bookingTime, partySize, diningAreas.length, floorPlanViewAreaId]);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/venue/areas')
      .then((r) => (r.ok ? r.json() : { areas: [] }))
      .then((a: { areas?: Array<{ id: string; name: string; colour: string; is_active: boolean }> }) => {
        if (cancelled) return;
        const active = (a.areas ?? []).filter((x) => x.is_active);
        const mapped = active.map(({ id, name, colour }) => ({ id, name, colour }));
        setDiningAreas(mapped);
      })
      .catch((e) => console.error('[WalkInModal] preload failed:', e));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (diningAreas.length === 0) return;
    setFloorPlanViewAreaId((prev) => {
      if (prev && diningAreas.some((x) => x.id === prev)) return prev;
      return diningAreas[0]!.id;
    });
  }, [diningAreas]);

  // Pre-fetch tables in advanced mode so floor plan loads instantly
  useEffect(() => {
    if (!advancedMode) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/venue/tables');
        if (cancelled || !res.ok) return;
        const payload = await res.json();
        if (!cancelled) setPrefetchedTables((payload.tables ?? []) as MiniFloorTableRow[]);
      } catch { /* non-critical */ }
    })();
    return () => { cancelled = true; };
  }, [advancedMode]);

  // Covers-mode: simple multi-select table chips
  const [coversTables, setCoversTables] = useState<TableForSelector[]>([]);
  const [coversSelectedTableIds, setCoversSelectedTableIds] = useState<string[]>([]);
  const [coversOccupancy, setCoversOccupancy] = useState<OccupancyMap>({});
  const [coversTablesLoaded, setCoversTablesLoaded] = useState(false);

  useEffect(() => {
    if (advancedMode) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/venue/tables');
        if (!res.ok || cancelled) return;
        const payload = await res.json();
        const tables: TableForSelector[] = (payload.tables ?? [])
          .filter((t: { is_active: boolean }) => t.is_active)
          .map(
            (t: {
              id: string;
              name: string;
              max_covers: number;
              sort_order: number;
              area_id?: string | null;
            }) => ({
              id: t.id,
              name: t.name,
              max_covers: t.max_covers,
              sort_order: t.sort_order,
              area_id: t.area_id ?? null,
            }),
          );
        if (!cancelled) {
          setCoversTables(tables);
          setCoversOccupancy({});
          setCoversTablesLoaded(true);
        }
      } catch { /* non-critical */ }
    })();
    return () => { cancelled = true; };
  }, [advancedMode]);

  // Resolve cover time from venue defaults and (in advanced mode) table suggestions / floor busy state
  useEffect(() => {
    if (!bookingDate || !bookingTime || partySize < 1) {
      if (advancedMode) {
        setSuggestions([]);
        setSelectedSuggestionKey(null);
        setOccupiedTableIds([]);
        setManualTableIds([]);
        setUseTemporaryTable(false);
      }
      return;
    }

    const prevKey = prevWalkInSuggestInputKeyRef.current;
    const inputKeyChanged = prevKey !== null && walkInSuggestInputKey !== prevKey;
    prevWalkInSuggestInputKeyRef.current = walkInSuggestInputKey;

    const effectiveDurationDirty = inputKeyChanged ? false : coverDurationDirty;
    if (inputKeyChanged && coverDurationDirty) {
      setCoverDurationDirty(false);
    }

    if (advancedMode) {
      setManualTableIds([]);
      setUseTemporaryTable(false);
    }

    let cancelled = false;
    if (advancedMode) {
      setLoadingSuggestions(true);
    }

    const timeParam = bookingTime.length >= 5 ? bookingTime.slice(0, 5) : bookingTime;
    const durationParams = new URLSearchParams({
      date: bookingDate,
      time: timeParam,
      party_size: String(partySize),
    });
    if (diningAreas.length > 1 && floorPlanViewAreaId) {
      durationParams.set('area_id', floorPlanViewAreaId);
    }

    void (async () => {
      try {
        let durationForSuggestions = coverDurationMinutes;
        if (!effectiveDurationDirty) {
          const durationRes = await fetch(`/api/venue/bookings/walk-in?${durationParams.toString()}`);
          if (durationRes.ok && !cancelled) {
            const durationPayload = await durationRes.json() as { duration_minutes?: number };
            const resolved = durationPayload.duration_minutes;
            if (typeof resolved === 'number') {
              durationForSuggestions = resolved;
              setCoverDurationMinutes((m) => (m === resolved ? m : resolved));
            }
          }
        }

        const suggestionParams = new URLSearchParams(durationParams);
        suggestionParams.set(
          'duration_minutes',
          String(effectiveDurationDirty ? coverDurationMinutes : durationForSuggestions),
        );
        const res = await fetch(`/api/venue/tables/combinations/suggest?${suggestionParams.toString()}`);
        if (cancelled) return;
        if (!res.ok) {
          setSuggestions([]);
          setSelectedSuggestionKey(null);
          setOccupiedTableIds([]);
          return;
        }
        const payload = await res.json() as {
          suggestions?: Suggestion[];
          occupied_table_ids?: string[];
          resolved_duration_minutes?: number;
        };
        if (cancelled) return;

        if (!advancedMode) return;

        const next = (payload.suggestions ?? []) as Suggestion[];
        const busy = payload.occupied_table_ids ?? [];
        setSuggestions(next);
        setOccupiedTableIds(Array.isArray(busy) ? busy : []);
        setSelectedSuggestionKey(
          next.length > 0 ? `${next[0].source}:${next[0].table_ids.join('|')}` : null,
        );
      } catch {
        if (!cancelled) {
          setSuggestions([]);
          setSelectedSuggestionKey(null);
          setOccupiedTableIds([]);
        }
      } finally {
        if (advancedMode && !cancelled) setLoadingSuggestions(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    advancedMode,
    bookingDate,
    bookingTime,
    coverDurationDirty,
    coverDurationMinutes,
    diningAreas.length,
    floorPlanViewAreaId,
    partySize,
    walkInSuggestInputKey,
  ]);

  const tablesForFloorPlanPicker = useMemo(() => {
    if (!prefetchedTables?.length) return null;
    if (diningAreas.length <= 1) return prefetchedTables;
    if (!floorPlanViewAreaId) return prefetchedTables;
    return prefetchedTables.filter((t) => t.area_id === floorPlanViewAreaId);
  }, [prefetchedTables, diningAreas.length, floorPlanViewAreaId]);

  const coversTablesForArea = useMemo(() => {
    if (advancedMode) return [];
    if (diningAreas.length <= 1) return coversTables;
    if (!floorPlanViewAreaId) return coversTables;
    return coversTables.filter((t) => (t.area_id ?? null) === floorPlanViewAreaId);
  }, [advancedMode, coversTables, diningAreas.length, floorPlanViewAreaId]);

  useEffect(() => {
    if (advancedMode || diningAreas.length <= 1) return;
    setCoversSelectedTableIds((prev) =>
      prev.filter((id) =>
        coversTables.some((t) => t.id === id && (t.area_id ?? null) === floorPlanViewAreaId),
      ),
    );
  }, [advancedMode, coversTables, diningAreas.length, floorPlanViewAreaId]);

  const selectedSuggestion = useMemo(
    () => suggestions.find((s) => `${s.source}:${s.table_ids.join('|')}` === selectedSuggestionKey) ?? null,
    [selectedSuggestionKey, suggestions],
  );

  const updatePartySizeFromSelector = (nextPartySize: number) => {
    setPartySize(nextPartySize);
    setCoverDurationDirty(false);
    setSelectedSuggestionKey(null);
  };

  const tableIdsToAssign = useMemo(() => {
    if (useTemporaryTable) return null;
    if (tableAssignMode === 'floor' && manualTableIds.length > 0) return manualTableIds;
    if (tableAssignMode === 'suggested' && selectedSuggestion?.table_ids?.length)
      return selectedSuggestion.table_ids;
    return null;
  }, [manualTableIds, selectedSuggestion, tableAssignMode, useTemporaryTable]);

  const temporaryTableOverrideAvailable = advancedMode && !loadingSuggestions && suggestions.length === 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const walkinPhone = normalizeToE164(phone, phoneDefaultCountry);
      if (phone.trim() && !walkinPhone) {
        setError('Enter a valid phone number or leave phone blank');
        setLoading(false);
        return;
      }
      const clampedCoverMins = Math.min(
        COVER_TIME_MAX,
        Math.max(COVER_TIME_MIN, Math.round(Number(coverDurationMinutes)) || COVER_TIME_MIN),
      );

      const walkinBody: Record<string, unknown> = {
        party_size: partySize,
        phone: walkinPhone || undefined,
        dietary_notes: dietaryNotes.trim() || undefined,
        occasion: occasion.trim() || undefined,
        booking_date: bookingDate,
        booking_time: bookingTime,
      };
      const fn = firstName.trim();
      const ln = lastName.trim();
      if (fn) walkinBody.first_name = fn;
      if (ln) walkinBody.last_name = ln;
      /** Omit unless staff overrode venue default — avoids posting a stale placeholder before suggest resolves. */
      if (coverDurationDirty) {
        walkinBody.duration_minutes = clampedCoverMins;
      }
      if (temporaryTableOverrideAvailable && useTemporaryTable) {
        const trimmedTemporaryTableName = temporaryTableName.trim();
        if (!trimmedTemporaryTableName) {
          setError('Enter a temporary table name');
          setLoading(false);
          return;
        }
        walkinBody.temporary_table_name = trimmedTemporaryTableName;
      }
      if (!advancedMode && coversSelectedTableIds.length > 0) {
        walkinBody.table_ids = coversSelectedTableIds;
      }
      if (diningAreas.length > 1 && floorPlanViewAreaId) {
        walkinBody.area_id = floorPlanViewAreaId;
      }
      const res = await fetch('/api/venue/bookings/walk-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(walkinBody),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError((j as { error?: string }).error ?? 'Failed to create walk-in');
        return;
      }
      const payload = await res.json() as { id?: string };
      if (advancedMode && payload.id && tableIdsToAssign?.length) {
        const assignRes = await fetch('/api/venue/tables/assignments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            booking_id: payload.id,
            table_ids: tableIdsToAssign,
          }),
        });
        if (!assignRes.ok) {
          const assignPayload = await assignRes.json().catch(() => ({}));
          setError((assignPayload as { error?: string }).error ?? 'Walk-in added, but table assignment failed');
          return;
        }
      }
      onCreated();
    } finally {
      setLoading(false);
    }
  };

  const capacityWarning =
    remainingCapacity != null
      ? remainingCapacity <= 0
        ? 'No capacity remaining - are you sure?'
        : partySize > remainingCapacity
          ? 'This may exceed your remaining capacity'
          : null
      : null;

  const inner = (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add walk-in booking"
        className={`w-full rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xl shadow-slate-900/15 ring-1 ring-slate-100 ${
          embedded ? 'mx-auto' : 'my-8'
        } ${advancedMode ? 'max-w-2xl' : embedded ? 'max-w-lg' : 'max-w-sm'}`}
        onClick={(e) => e.stopPropagation()}
      >
        {!suppressTitle && (
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Add Walk-in</h2>
            <p className="text-xs text-slate-500">Seat a guest immediately</p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {remainingCapacity != null && (
            <div
              className={`rounded-lg px-3 py-2 text-sm font-medium ${
                remainingCapacity <= 0
                  ? 'bg-red-50 text-red-700'
                  : remainingCapacity <= 5
                    ? 'bg-amber-50 text-amber-700'
                    : 'bg-emerald-50 text-emerald-700'
              }`}
            >
              Remaining capacity now: {remainingCapacity} covers
            </div>
          )}
          {capacityWarning && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
              ⚠ {capacityWarning}
            </div>
          )}
          {/* Date, time + party size */}
          <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)_minmax(4.5rem,0.55fr)] gap-2 sm:gap-3">
            <div className="min-w-0">
              <label htmlFor="walkin-date" className="mb-1.5 block text-sm font-medium text-slate-700">
                Date
              </label>
              <input
                id="walkin-date"
                type="date"
                value={bookingDate}
                onChange={(e) => setBookingDate(e.target.value)}
                className="w-full min-w-0 rounded-xl border border-slate-200 px-2.5 py-2.5 text-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 sm:px-3"
              />
            </div>
            <div className="min-w-0">
              <label htmlFor="walkin-time" className="mb-1.5 block text-sm font-medium text-slate-700">
                Time
              </label>
              <input
                id="walkin-time"
                type="time"
                value={bookingTime}
                onChange={(e) => setBookingTime(e.target.value)}
                className="w-full min-w-0 rounded-xl border border-slate-200 px-2.5 py-2.5 text-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 sm:px-3"
              />
            </div>

          <div ref={partyPanelRef} className="relative min-w-0">
            <p id="walkin-party-label" className="mb-1.5 block truncate text-sm font-medium text-slate-700">
              Party size
            </p>
            <button
              id="walkin-party"
              type="button"
              aria-labelledby="walkin-party-label walkin-party"
              aria-expanded={partyPanelOpen}
              onClick={() => setPartyPanelOpen((open) => !open)}
              className={`flex min-h-[40px] w-full touch-manipulation items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold tabular-nums transition-colors ${
                partyPanelOpen
                  ? 'border-brand-300 bg-brand-50 text-brand-700'
                  : 'border-slate-200 bg-white text-slate-900 hover:border-slate-300'
              }`}
            >
              {partySize}
              <ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition-transform duration-150 ${partyPanelOpen ? 'rotate-180' : ''}`} />
            </button>

            {partyPanelOpen && (
              <div className="absolute right-0 z-20 mt-1.5 w-[min(17rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-2 shadow-lg sm:w-56 sm:p-3">
                <div className="grid grid-cols-4 gap-1.5">
                  {PARTY_GRID.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => {
                        updatePartySizeFromSelector(n);
                        setPartyPanelOpen(false);
                      }}
                      className={`rounded-lg py-2 text-center text-sm font-semibold tabular-nums transition-all ${
                        partySize === n
                          ? 'bg-brand-600 text-white shadow-sm'
                          : 'bg-slate-50 text-slate-700 hover:bg-brand-50 hover:text-brand-700'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <div className="mt-2 flex items-center gap-2 border-t border-slate-100 pt-2">
                  <span className="text-xs text-slate-400">Other:</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="13+"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const v = parseInt((e.target as HTMLInputElement).value, 10);
                        if (!Number.isNaN(v) && v >= WALK_IN_PARTY_MIN && v <= WALK_IN_PARTY_MAX) {
                          updatePartySizeFromSelector(v);
                          setPartyPanelOpen(false);
                        }
                      }
                    }}
                    onBlur={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (!Number.isNaN(v) && v >= WALK_IN_PARTY_MIN && v <= WALK_IN_PARTY_MAX) {
                        updatePartySizeFromSelector(v);
                        setPartyPanelOpen(false);
                      }
                    }}
                    className="h-7 w-14 rounded-md border border-slate-200 bg-white px-2 text-center text-sm font-semibold tabular-nums focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  />
                </div>
              </div>
            )}
          </div>
          </div>

          {/* Cover time (turn) — drives suggestions, floor busy state, and saved booking end */}
          <div>
            <label htmlFor="walkin-cover-duration" className="mb-1.5 block text-sm font-medium text-slate-700">
              Cover time
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="walkin-cover-duration"
                type="number"
                min={COVER_TIME_MIN}
                max={COVER_TIME_MAX}
                step={5}
                value={coverDurationMinutes}
                onChange={(e) => {
                  const raw = parseInt(e.target.value, 10);
                  if (Number.isNaN(raw)) return;
                  setCoverDurationDirty(true);
                  setCoverDurationMinutes(Math.min(COVER_TIME_MAX, Math.max(COVER_TIME_MIN, raw)));
                }}
                className="w-24 rounded-xl border border-slate-200 px-3 py-2.5 text-sm tabular-nums transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
              <span className="text-sm text-slate-600">minutes at the table</span>
            </div>
          </div>

          {/* Guest name — first + surname */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="walkin-first-name" className="mb-1.5 block text-sm font-medium text-slate-700">
                First name <span className="text-slate-400">(optional)</span>
              </label>
              <input
                id="walkin-first-name"
                type="text"
                autoComplete="given-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Given name"
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
            <div>
              <label htmlFor="walkin-last-name" className="mb-1.5 block text-sm font-medium text-slate-700">
                Surname <span className="text-slate-400">(optional)</span>
              </label>
              <input
                id="walkin-last-name"
                type="text"
                autoComplete="family-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Family name"
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
          </div>

          {/* Phone */}
          <div>
            <label htmlFor="walkin-phone" className="mb-1.5 block text-sm font-medium text-slate-700">
              Phone <span className="text-slate-400">(optional)</span>
            </label>
            <PhoneWithCountryField
              id="walkin-phone"
              value={phone}
              onChange={setPhone}
              defaultCountry={phoneDefaultCountry}
              inputClassName="w-full min-w-0 rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </div>

          {/* Dietary notes */}
          <div>
            <label htmlFor="walkin-dietary" className="mb-1.5 block text-sm font-medium text-slate-700">
              Dietary notes <span className="text-slate-400">(optional)</span>
            </label>
            <textarea
              id="walkin-dietary"
              value={dietaryNotes}
              onChange={(e) => setDietaryNotes(e.target.value)}
              rows={2}
              placeholder="Allergies, intolerances, dietary requirements..."
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </div>

          {/* Occasion */}
          <div>
            <label htmlFor="walkin-occasion" className="mb-1.5 block text-sm font-medium text-slate-700">
              Occasion <span className="text-slate-400">(optional)</span>
            </label>
            <input
              id="walkin-occasion"
              type="text"
              value={occasion}
              onChange={(e) => setOccasion(e.target.value)}
              placeholder="Birthday, anniversary..."
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </div>

          {/* Table assignment - covers mode (simple chips) */}
          {!advancedMode && coversTablesLoaded && coversTables.length > 0 && (
            <div>
              <p className="mb-1.5 text-sm font-medium text-slate-700">
                Table <span className="text-slate-400">(optional)</span>
              </p>
              {diningAreas.length > 1 && (
                <div className="mb-2 min-h-[4.25rem]">
                  <div className="flex flex-nowrap gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1">
                    {diningAreas.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => setFloorPlanViewAreaId(a.id)}
                        className={`inline-flex shrink-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                          floorPlanViewAreaId === a.id
                            ? 'border-brand-500 bg-brand-50 text-brand-900'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                        }`}
                      >
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: a.colour || '#6366F1' }}
                          aria-hidden
                        />
                        {a.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex min-h-[5.5rem] flex-wrap content-start gap-2">
                {coversTablesForArea.map((table) => {
                  const isSelected = coversSelectedTableIds.includes(table.id);
                  const occupant = coversOccupancy[table.id] ?? null;
                  return (
                    <button
                      key={table.id}
                      type="button"
                      onClick={() =>
                        setCoversSelectedTableIds((prev) =>
                          isSelected ? prev.filter((id) => id !== table.id) : [...prev, table.id]
                        )
                      }
                      title={occupant ? `Occupied by ${occupant.guestName}` : `${table.name} (${table.max_covers} seats)`}
                      className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                        isSelected
                          ? 'border-brand-400 bg-brand-50 text-brand-800 ring-1 ring-brand-400'
                          : occupant
                            ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                            : 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                      }`}
                    >
                      {table.name}
                      <span className="ml-1 text-[10px] opacity-70">({table.max_covers})</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Table assignment — match UnifiedBookingForm (new booking) */}
          {advancedMode && (
            <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-2.5 sm:rounded-xl sm:p-3.5">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500 sm:mb-2.5 sm:text-xs">
                Table Assignment
              </p>

              {diningAreas.length > 1 && (
                <div className="mb-2 min-h-[4.25rem] rounded-lg border border-slate-100 bg-white/80 p-2 sm:mb-2.5">
                  <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">Area</p>
                  <div className="flex flex-nowrap gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1">
                    {diningAreas.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => setFloorPlanViewAreaId(a.id)}
                        className={`inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors sm:text-sm ${
                          floorPlanViewAreaId === a.id
                            ? 'border-brand-500 bg-brand-50 text-brand-900'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                        }`}
                      >
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: a.colour || '#6366F1' }}
                          aria-hidden
                        />
                        {a.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="mb-2 inline-flex w-full rounded-lg border border-slate-200 bg-white p-0.5 sm:mb-2.5 sm:w-auto">
                <button
                  type="button"
                  onClick={() => {
                    setTableAssignMode('suggested');
                    setManualTableIds([]);
                  }}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-150 ${
                    tableAssignMode === 'suggested'
                      ? 'bg-brand-600 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  Suggested
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTableAssignMode('floor');
                    setUseTemporaryTable(false);
                    if (manualTableIds.length === 0 && selectedSuggestion?.table_ids?.length) {
                      setManualTableIds(selectedSuggestion.table_ids);
                    }
                  }}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-150 ${
                    tableAssignMode === 'floor'
                      ? 'bg-brand-600 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  Floor plan
                </button>
              </div>

              {tableAssignMode === 'suggested' && (
                <div className="min-h-[280px]">
                  {loadingSuggestions ? (
                    <div className="flex min-h-[280px] flex-col items-center justify-center gap-2 text-xs text-slate-400">
                      <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
                      Loading suggestions…
                    </div>
                  ) : suggestions.length === 0 ? (
                    <div className="flex min-h-[280px] flex-col justify-center gap-3">
                      <p className="text-xs text-slate-500">
                        No table suggestions available for this time and party size. Try floor plan to pick manually.
                      </p>
                      <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2.5">
                        <p className="mb-2 text-xs text-amber-900">
                          Or seat this walk-in at a temporary table (created when you submit).
                        </p>
                        <label className="flex items-start gap-2 text-xs text-slate-700">
                          <input
                            type="checkbox"
                            checked={useTemporaryTable}
                            onChange={(event) => {
                              setUseTemporaryTable(event.target.checked);
                              if (event.target.checked) {
                                setSelectedSuggestionKey(null);
                                setManualTableIds([]);
                              }
                            }}
                            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                          />
                          <span>
                            <span className="block font-semibold text-slate-900">Seat at a temporary table</span>
                            <span className="block text-slate-500">
                              Appears on the grid and is removed when the booking is completed.
                            </span>
                          </span>
                        </label>
                        {useTemporaryTable ? (
                          <div className="mt-2">
                            <label htmlFor="temporary-table-name" className="mb-1 block text-xs font-semibold text-slate-700">
                              Temporary table name
                            </label>
                            <input
                              id="temporary-table-name"
                              type="text"
                              value={temporaryTableName}
                              onChange={(event) => setTemporaryTableName(event.target.value)}
                              placeholder="e.g. Temp 1, Bar squeeze"
                              maxLength={50}
                              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                            />
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {suggestions.slice(0, 5).map((suggestion) => {
                        const key = `${suggestion.source}:${suggestion.table_ids.join('|')}`;
                        const isSelected = selectedSuggestionKey === key;
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => setSelectedSuggestionKey(key)}
                            className={`w-full rounded-lg border px-2.5 py-2 text-left text-sm transition-all ${
                              isSelected
                                ? 'border-emerald-300 bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200'
                                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                            }`}
                          >
                            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                              <span className="break-words font-medium">{suggestion.table_names.join(' + ')}</span>
                              <div className="flex flex-shrink-0 items-center gap-2">
                                <span className="text-xs text-slate-500">Cap {suggestion.combined_capacity}</span>
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                                    isSelected ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                                  }`}
                                >
                                  {suggestion.source === 'manual' ? 'Manual' : suggestion.source === 'auto' ? 'Auto' : 'Single'}
                                </span>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {tableAssignMode === 'floor' && (
                <div className="min-h-[280px]">
                  <MiniFloorPlanPicker
                    tables={tablesForFloorPlanPicker}
                    selectedIds={manualTableIds}
                    onChange={setManualTableIds}
                    occupiedTableIds={occupiedTableIds}
                    partySize={partySize}
                    minHeight={248}
                  />
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {!embedded && (
          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Adding...' : 'Seat Walk-in'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
          )}
          {embedded && (
            <div className="flex gap-3 pt-1">
              <button
                type="submit"
                disabled={loading}
                className="flex-1 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? 'Adding...' : 'Seat Walk-in'}
              </button>
            </div>
          )}
        </form>
      </div>
  );

  if (embedded) return inner;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/30 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      {inner}
    </div>
  );
}
