'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDismissibleLayer } from '@/lib/ui/use-dismissible-layer';
import type { AvailableSlot, ServiceGroup } from './types';
import type { CountryCode } from 'libphonenumber-js';
import { PhoneWithCountryField } from '@/components/phone/PhoneWithCountryField';
import { normalizeToE164 } from '@/lib/phone/e164';

// ── Helpers ───────────────────────────────────────────────────────────────

function localCalendarDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateLabel(dateStr: string): string {
  const todayStr = localCalendarDateStr();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = localCalendarDateStr(tomorrow);
  if (dateStr === todayStr) return 'Today';
  if (dateStr === tomorrowStr) return 'Tomorrow';
  const d = new Date(dateStr + 'T00:00');
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]}`;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const PARTY_GRID = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

function ChevronDown({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
    </svg>
  );
}

function getMergedSlots(slots: AvailableSlot[], serviceGroups?: ServiceGroup[]): AvailableSlot[] {
  if (serviceGroups && serviceGroups.length > 0) {
    const allSlots = serviceGroups
      .filter((g) => !g.large_party_redirect)
      .flatMap((g) => g.slots);
    allSlots.sort((a, b) => a.start_time.localeCompare(b.start_time));
    return allSlots;
  }
  return [...slots].sort((a, b) => a.start_time.localeCompare(b.start_time));
}

// ── Props ─────────────────────────────────────────────────────────────────

interface DateStepProps {
  minParty: number;
  maxParty: number;
  partySize: number;
  maxAdvanceBookingDays: number;
  onPartySizeChange: (n: number) => void;
  onDateSelect: (date: string) => void;
  selectedDate?: string | null;
  slots?: AvailableSlot[];
  serviceGroups?: ServiceGroup[];
  slotsLoading?: boolean;
  initialLoading?: boolean;
  largePartyRedirect?: boolean;
  largePartyMessage?: string | null;
  onSlotSelect?: (slot: AvailableSlot) => void;
  venueId?: string;
  phoneDefaultCountry?: CountryCode;
  showAreaTabs?: boolean;
  areas?: Array<{ id: string; name: string; colour: string }>;
  selectedAreaId?: string | null;
  onAreaChange?: (areaId: string) => void;
  availabilityAreaId?: string | null;
  publicBookingAreaMode?: 'auto' | 'manual';
}

// ── Component ─────────────────────────────────────────────────────────────

export function DateStep({
  minParty,
  maxParty,
  partySize,
  maxAdvanceBookingDays,
  onPartySizeChange,
  onDateSelect,
  selectedDate,
  slots = [],
  serviceGroups,
  slotsLoading,
  initialLoading,
  largePartyRedirect,
  largePartyMessage,
  onSlotSelect,
  venueId,
  phoneDefaultCountry = 'GB',
  showAreaTabs = false,
  areas = [],
  selectedAreaId = null,
  onAreaChange,
  availabilityAreaId = null,
  publicBookingAreaMode = 'auto',
}: DateStepProps) {
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const todayStr = useMemo(() => localCalendarDateStr(today), [today]);
  const cappedAdvanceDays = Math.max(1, Math.min(365, Math.floor(maxAdvanceBookingDays)));

  const maxDate = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() + cappedAdvanceDays);
    return d;
  }, [today, cappedAdvanceDays]);

  const maxDateStr = useMemo(() => localCalendarDateStr(maxDate), [maxDate]);

  // Shared dropdown state (only one open at a time — same as staff form)
  const [openPanel, setOpenPanel] = useState<'party' | 'date' | 'time' | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Calendar availability indicators — keyed by "year-month-partySize-areaId"
  const calendarAvailCache = useRef<Map<string, Set<string>>>(new Map());
  const [calendarAvailDates, setCalendarAvailDates] = useState<Set<string>>(new Set());

  // Calendar month shown inside the date popover
  const [calendarMonth, setCalendarMonth] = useState(() => {
    if (selectedDate) {
      const d = new Date(selectedDate + 'T00:00');
      return new Date(d.getFullYear(), d.getMonth(), 1);
    }
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });

  // Time grid center — set once on initial load; never auto-changed on date change
  const [gridCenter, setGridCenter] = useState<string>('');
  const hasAutoSetGridCenter = useRef(false);

  // Close any open panel when clicking outside (same hook as staff form)
  useDismissibleLayer({ open: openPanel !== null, refs: [panelRef], onDismiss: () => setOpenPanel(null) });

  // Sync calendar view to selectedDate when it changes (e.g. from initial load)
  useEffect(() => {
    if (!selectedDate) return;
    const d = new Date(selectedDate + 'T00:00');
    setCalendarMonth(new Date(d.getFullYear(), d.getMonth(), 1));
  }, [selectedDate]);

  // Fetch per-month availability indicators for the calendar date picker
  useEffect(() => {
    if (!venueId) return;
    const yr = calendarMonth.getFullYear();
    const mo = calendarMonth.getMonth() + 1; // 1-indexed
    const cacheKey = `${yr}-${mo}-${partySize}-${availabilityAreaId ?? ''}`;

    const cached = calendarAvailCache.current.get(cacheKey);
    if (cached) {
      setCalendarAvailDates(cached);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        let url = `/api/booking/table-calendar?venue_id=${encodeURIComponent(venueId)}&year=${yr}&month=${mo}&party_size=${partySize}`;
        if (publicBookingAreaMode === 'manual' && availabilityAreaId) {
          url += `&area_id=${encodeURIComponent(availabilityAreaId)}`;
        }
        const res = await fetch(url);
        if (!res.ok || cancelled) return;
        const json = await res.json() as { available_dates?: string[] };
        const dateSet = new Set<string>(json.available_dates ?? []);
        calendarAvailCache.current.set(cacheKey, dateSet);
        if (!cancelled) setCalendarAvailDates(dateSet);
      } catch {
        // Calendar availability indicators are non-critical; ignore errors silently
      }
    })();

    return () => { cancelled = true; };
  }, [venueId, calendarMonth, partySize, publicBookingAreaMode, availabilityAreaId]);

  const mergedSlots = useMemo(() => getMergedSlots(slots, serviceGroups), [slots, serviceGroups]);

  // Auto-set gridCenter to the first bookable time on initial load only.
  // After that, never change it automatically — the user's chosen time persists
  // across date changes so the slot grid stays centred on their preferred time.
  useEffect(() => {
    if (hasAutoSetGridCenter.current) return;
    if (!mergedSlots.length) return;

    // Round the first slot's start time to the nearest half-hour so it matches
    // a value in timeOptions and the dropdown highlights it correctly.
    const p = mergedSlots[0]!.start_time.slice(0, 5).split(':');
    const totalMin = parseInt(p[0]!, 10) * 60 + parseInt(p[1]!, 10);
    const rounded = Math.round(totalMin / 30) * 30;
    const h = String(Math.floor(rounded / 60)).padStart(2, '0');
    const m = String(rounded % 60).padStart(2, '0');
    setGridCenter(`${h}:${m}`);
    hasAutoSetGridCenter.current = true;
  }, [mergedSlots]);

  // Half-hour boundary options from real slot times (mirrors staff form exactly)
  const timeOptions = useMemo(() => {
    if (!mergedSlots.length) return [] as string[];
    const boundaries = new Set<number>();
    for (const s of mergedSlots) {
      const parts = s.start_time.slice(0, 5).split(':');
      const m = parseInt(parts[0]!, 10) * 60 + parseInt(parts[1]!, 10);
      boundaries.add(Math.round(m / 30) * 30);
    }
    return Array.from(boundaries)
      .sort((a, b) => a - b)
      .map((m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }, [mergedSlots]);

  // 9 closest slots to gridCenter, sorted chronologically (mirrors staff form exactly)
  const nearbySlots = useMemo(() => {
    if (!gridCenter || !mergedSlots.length) return mergedSlots.slice(0, 9);
    const cp = gridCenter.split(':');
    const centerMin = parseInt(cp[0]!, 10) * 60 + parseInt(cp[1]!, 10);
    const withDist = mergedSlots.map((s) => {
      const sp = s.start_time.slice(0, 5).split(':');
      const slotMin = parseInt(sp[0]!, 10) * 60 + parseInt(sp[1]!, 10);
      return { slot: s, dist: Math.abs(slotMin - centerMin) };
    });
    withDist.sort((a, b) => a.dist - b.dist);
    const closest = withDist.slice(0, 9).map((x) => x.slot);
    closest.sort((a, b) => a.start_time.localeCompare(b.start_time));
    return closest;
  }, [gridCenter, mergedSlots]);

  // Calendar grid for the date popover
  const calendarGrid = useMemo(() => {
    const yr = calendarMonth.getFullYear();
    const mo = calendarMonth.getMonth();
    const firstDow = new Date(yr, mo, 1).getDay();
    const offset = (firstDow + 6) % 7; // Monday-first
    const total = new Date(yr, mo + 1, 0).getDate();
    const cells: (number | null)[] = [];
    for (let i = 0; i < offset; i++) cells.push(null);
    for (let d = 1; d <= total; d++) cells.push(d);
    return { yr, mo, cells };
  }, [calendarMonth]);

  const hasLargePartyService = serviceGroups?.some((g) => g.large_party_redirect) ?? false;
  const isLoading = initialLoading || slotsLoading;
  const noAvailability =
    !isLoading &&
    !largePartyRedirect &&
    mergedSlots.length === 0 &&
    !hasLargePartyService &&
    !!selectedDate;

  const tomorrowStr = useMemo(() => {
    const t = new Date(today);
    t.setDate(t.getDate() + 1);
    return localCalendarDateStr(t);
  }, [today]);

  return (
    <div className="space-y-3 sm:space-y-4">

      {/* ── Selector row: Party · Date · Time ── */}
      <div ref={panelRef}>
        <div className="grid grid-cols-3 gap-1.5 min-[400px]:gap-2 sm:flex sm:flex-row sm:items-end sm:gap-2">

          {/* ── Party ── */}
          <div className="relative min-w-0">
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-400 sm:text-[11px]">Party</p>
            <button
              type="button"
              onClick={() => setOpenPanel(openPanel === 'party' ? null : 'party')}
              className={`flex min-h-[40px] w-full touch-manipulation items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs font-semibold tabular-nums transition-colors min-[400px]:px-3 min-[400px]:py-2 min-[400px]:text-sm ${
                openPanel === 'party'
                  ? 'border-brand-300 bg-brand-50 text-brand-700'
                  : 'border-slate-200 bg-white text-slate-900 hover:border-slate-300'
              }`}
            >
              {partySize}
              <ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition-transform duration-150 ${openPanel === 'party' ? 'rotate-180' : ''}`} />
            </button>

            {openPanel === 'party' && (
              <div className="absolute left-0 z-20 mt-1.5 w-[min(17rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-2 shadow-lg sm:w-56 sm:p-3">
                <div className="grid grid-cols-4 gap-1.5">
                  {PARTY_GRID.filter((n) => n >= minParty && n <= maxParty).map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => { onPartySizeChange(n); setOpenPanel(null); }}
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
                {maxParty > 12 && (
                  <div className="mt-2 flex items-center gap-2 border-t border-slate-100 pt-2">
                    <span className="text-xs text-slate-400">Other:</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder={`${Math.max(13, minParty)}+`}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const v = parseInt((e.target as HTMLInputElement).value, 10);
                          if (!Number.isNaN(v) && v >= minParty && v <= maxParty) { onPartySizeChange(v); setOpenPanel(null); }
                        }
                      }}
                      onBlur={(e) => {
                        const v = parseInt(e.target.value, 10);
                        if (!Number.isNaN(v) && v >= minParty && v <= maxParty) { onPartySizeChange(v); setOpenPanel(null); }
                      }}
                      className="h-7 w-14 rounded-md border border-slate-200 bg-white px-2 text-center text-sm font-semibold tabular-nums focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Date ── */}
          <div className="relative min-w-0 flex-1 sm:min-w-[140px]">
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-400 sm:text-[11px]">Date</p>
            <button
              type="button"
              onClick={() => {
                if (openPanel === 'date') {
                  setOpenPanel(null);
                } else {
                  if (selectedDate) {
                    const d = new Date(selectedDate + 'T00:00');
                    setCalendarMonth(new Date(d.getFullYear(), d.getMonth(), 1));
                  }
                  setOpenPanel('date');
                }
              }}
              className={`flex min-h-[40px] w-full touch-manipulation items-center justify-between rounded-lg border px-2 py-1.5 text-xs font-semibold transition-colors min-[400px]:px-3 min-[400px]:py-2 min-[400px]:text-sm ${
                openPanel === 'date'
                  ? 'border-brand-300 bg-brand-50 text-brand-700'
                  : 'border-slate-200 bg-white text-slate-900 hover:border-slate-300'
              }`}
            >
              {initialLoading ? (
                <span className="flex items-center gap-1.5 text-slate-400">
                  <span className="h-3 w-3 animate-spin rounded-full border border-slate-300 border-t-transparent" />
                  <span>Loading…</span>
                </span>
              ) : (
                <span className="truncate">{selectedDate ? formatDateLabel(selectedDate) : 'Select date'}</span>
              )}
              <ChevronDown className={`ml-2 h-3.5 w-3.5 flex-shrink-0 text-slate-400 transition-transform duration-150 ${openPanel === 'date' ? 'rotate-180' : ''}`} />
            </button>

            {openPanel === 'date' && (() => {
              const { yr, mo, cells } = calendarGrid;
              const canGoPrev = new Date(yr, mo - 1, 1) >= new Date(today.getFullYear(), today.getMonth(), 1);
              const canGoNext = new Date(yr, mo + 1, 1) <= maxDate;
              return (
                <div className="absolute left-1/2 z-20 mt-1.5 w-[min(18rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-slate-200 bg-white p-2 shadow-lg sm:left-0 sm:w-72 sm:translate-x-0 sm:p-3">
                  {/* Today / Tomorrow shortcuts */}
                  <div className="mb-2 flex gap-1.5 sm:mb-3">
                    {todayStr <= maxDateStr && (
                      <button
                        type="button"
                        onClick={() => { onDateSelect(todayStr); setOpenPanel(null); }}
                        className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                          selectedDate === todayStr ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-brand-50 hover:text-brand-700'
                        }`}
                      >
                        Today
                      </button>
                    )}
                    {tomorrowStr <= maxDateStr && (
                      <button
                        type="button"
                        onClick={() => { onDateSelect(tomorrowStr); setOpenPanel(null); }}
                        className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                          selectedDate === tomorrowStr ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-brand-50 hover:text-brand-700'
                        }`}
                      >
                        Tomorrow
                      </button>
                    )}
                  </div>

                  {/* Month navigation */}
                  <div className="mb-2 flex items-center justify-between">
                    <button
                      type="button"
                      disabled={!canGoPrev}
                      onClick={() => setCalendarMonth(new Date(yr, mo - 1, 1))}
                      className="rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-100 disabled:invisible"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                      </svg>
                    </button>
                    <p className="text-sm font-semibold text-slate-800">{MONTH_NAMES[mo]} {yr}</p>
                    <button
                      type="button"
                      disabled={!canGoNext}
                      onClick={() => setCalendarMonth(new Date(yr, mo + 1, 1))}
                      className="rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-100 disabled:invisible"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                      </svg>
                    </button>
                  </div>

                  {/* Day-of-week headers */}
                  <div className="grid grid-cols-7">
                    {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((dn) => (
                      <div key={dn} className="py-1 text-center text-[10px] font-semibold uppercase text-slate-400">{dn}</div>
                    ))}
                  </div>

                  {/* Day grid */}
                  <div className="grid grid-cols-7 gap-0.5">
                    {cells.map((day, i) => {
                      if (day === null) return <div key={`e${i}`} className="aspect-square" aria-hidden />;
                      const ds = `${yr}-${String(mo + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                      const isDisabled = ds < todayStr || ds > maxDateStr;
                      const isSelected = ds === selectedDate;
                      const isToday = ds === todayStr;
                      const hasAvail = calendarAvailDates.has(ds);
                      return (
                        <button
                          key={ds}
                          type="button"
                          disabled={isDisabled}
                          onClick={() => { onDateSelect(ds); setOpenPanel(null); }}
                          aria-pressed={isSelected}
                          className={`flex aspect-square items-center justify-center rounded-md text-xs font-medium transition-all ${
                            isDisabled
                              ? 'cursor-not-allowed text-slate-300'
                              : isSelected
                                ? 'bg-brand-600 text-white shadow-sm'
                                : hasAvail
                                  ? 'cursor-pointer bg-emerald-50 text-emerald-900 ring-1 ring-emerald-300 hover:bg-emerald-100'
                                  : isToday
                                    ? 'font-semibold text-brand-600 hover:bg-brand-50'
                                    : 'text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>

                  {/* Legend */}
                  <p className="mt-2.5 text-[10px] text-slate-400">
                    <span className="mr-1.5 inline-block h-2 w-2 rounded-sm bg-emerald-400 align-middle" aria-hidden />
                    Day has availability
                  </p>
                </div>
              );
            })()}
          </div>

          {/* ── Time ── */}
          <div className="relative min-w-0 flex-1 sm:min-w-[100px]">
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-400 sm:text-[11px]">Time</p>
            <button
              type="button"
              disabled={isLoading || (!mergedSlots.length && !isLoading)}
              onClick={() => setOpenPanel(openPanel === 'time' ? null : 'time')}
              className={`flex min-h-[40px] w-full touch-manipulation items-center justify-between rounded-lg border px-2 py-1.5 text-xs font-semibold tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-40 min-[400px]:px-3 min-[400px]:py-2 min-[400px]:text-sm ${
                gridCenter
                  ? 'border-brand-400 bg-brand-50 text-brand-700'
                  : openPanel === 'time'
                    ? 'border-brand-300 bg-brand-50 text-brand-700'
                    : 'border-slate-200 bg-white text-slate-400 hover:border-slate-300'
              }`}
            >
              <span>{isLoading ? '…' : (gridCenter || 'Select')}</span>
              <ChevronDown className={`ml-2 h-3.5 w-3.5 flex-shrink-0 text-slate-400 transition-transform duration-150 ${openPanel === 'time' ? 'rotate-180' : ''}`} />
            </button>

            {openPanel === 'time' && timeOptions.length > 0 && (
              <div className="absolute right-1/2 z-20 mt-1.5 w-[min(12rem,calc(100vw-2rem))] translate-x-1/2 rounded-xl border border-slate-200 bg-white py-1 shadow-lg sm:right-0 sm:w-auto sm:min-w-[180px] sm:translate-x-0">
                <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto px-1 py-1 sm:max-h-80" style={{ scrollbarWidth: 'thin' }}>
                  {timeOptions.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => { setGridCenter(t); setOpenPanel(null); }}
                      className={`w-full rounded-md px-3 py-2 text-left text-sm font-semibold tabular-nums transition-all ${
                        gridCenter === t
                          ? 'bg-brand-600 text-white shadow-sm'
                          : 'text-slate-700 hover:bg-brand-50 hover:text-brand-700'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* ── Dining area tabs (manual multi-area) ── */}
      {showAreaTabs && areas.length > 1 && onAreaChange && (
        <div className="flex flex-wrap gap-2 rounded-lg border border-slate-100 bg-slate-50/80 p-2 sm:rounded-xl">
          {areas.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onAreaChange(a.id)}
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors sm:text-sm ${
                selectedAreaId === a.id
                  ? 'border-brand-500 bg-brand-50 text-brand-900'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
              }`}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: a.colour || '#6366F1' }} />
              {a.name}
            </button>
          ))}
        </div>
      )}

      {/* ── Available Times Panel ── */}
      <div>
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-50 py-5 text-xs text-slate-400 sm:rounded-xl sm:py-6 sm:text-sm">
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Loading times&hellip;
          </div>
        ) : !selectedDate ? null
          : largePartyRedirect ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-4 text-center text-xs text-amber-700 sm:rounded-xl sm:px-4 sm:py-5 sm:text-sm">
              {largePartyMessage ?? 'Please call us to book for large parties.'}
            </div>
          ) : noAvailability ? (
            <NoAvailability
              date={selectedDate}
              venueId={venueId}
              partySize={partySize}
              phoneDefaultCountry={phoneDefaultCountry}
              publicBookingAreaMode={publicBookingAreaMode}
              availabilityAreaId={availabilityAreaId}
              onDateSelect={(d) => { onDateSelect(d); }}
            />
          ) : nearbySlots.length > 0 ? (
            <>
              <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-400 sm:mb-2 sm:text-[11px]">
                {gridCenter ? `Times around ${gridCenter}` : 'Available times'}
              </p>
              <div className="grid grid-cols-3 gap-1.5 rounded-lg border border-slate-200 bg-slate-50/50 p-1.5 sm:gap-2 sm:rounded-xl sm:p-2.5">
                {nearbySlots.map((slot) => {
                  const tight = slot.available_covers <= partySize;
                  return (
                    <button
                      key={slot.key}
                      type="button"
                      onClick={() => onSlotSelect?.(slot)}
                      className={`touch-manipulation rounded-md py-2.5 text-center text-xs font-semibold tabular-nums transition-all sm:rounded-lg sm:py-3 sm:text-sm ${
                        tight
                          ? 'border border-amber-200 bg-amber-50 text-amber-800 hover:border-amber-300 hover:bg-amber-100'
                          : 'border border-slate-200 bg-white text-slate-700 hover:border-brand-300 hover:bg-brand-50'
                      }`}
                    >
                      {slot.start_time.slice(0, 5)}
                    </button>
                  );
                })}
              </div>
              {hasLargePartyService && (
                <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm text-amber-800">
                  {serviceGroups?.find((g) => g.large_party_redirect)?.large_party_message ?? 'Some services require you to call for large party bookings.'}
                </p>
              )}
            </>
          ) : null}
      </div>

    </div>
  );
}

// ── No-availability empty state ───────────────────────────────────────────

function NoAvailability({
  date,
  venueId,
  partySize,
  phoneDefaultCountry,
  publicBookingAreaMode,
  availabilityAreaId,
  onDateSelect,
}: {
  date: string;
  venueId?: string;
  partySize: number;
  phoneDefaultCountry: CountryCode;
  publicBookingAreaMode: 'auto' | 'manual';
  availabilityAreaId: string | null;
  onDateSelect: (date: string) => void;
}) {
  const [nearbyDates, setNearbyDates] = useState<Array<{ date: string; label: string; slotCount: number }>>([]);
  const [nearbyLoading, setNearbyLoading] = useState(false);

  const fetchNearbyDates = useCallback(async () => {
    if (!venueId || !partySize) return;
    setNearbyLoading(true);
    try {
      const results: Array<{ date: string; label: string; slotCount: number }> = [];
      const baseDate = new Date(date + 'T12:00:00');
      for (const offset of [-1, 1, -2, 2, -3, 3]) {
        if (results.length >= 3) break;
        const checkDate = new Date(baseDate);
        checkDate.setDate(checkDate.getDate() + offset);
        if (checkDate < new Date()) continue;
        const checkStr = localCalendarDateStr(checkDate);
        try {
          let url = `/api/booking/availability?venue_id=${encodeURIComponent(venueId)}&date=${encodeURIComponent(checkStr)}&party_size=${partySize}`;
          if (publicBookingAreaMode === 'manual' && availabilityAreaId) {
            url += `&area_id=${encodeURIComponent(availabilityAreaId)}`;
          }
          const res = await fetch(url);
          if (res.ok) {
            const data = await res.json();
            const slotCount = (data.slots ?? []).length;
            if (slotCount > 0) {
              const label = `${WEEKDAYS[checkDate.getDay()]} ${checkDate.getDate()} ${MONTH_NAMES[checkDate.getMonth()]}`;
              results.push({ date: checkStr, label, slotCount });
            }
          }
        } catch { /* skip */ }
      }
      setNearbyDates(results);
    } finally {
      setNearbyLoading(false);
    }
  }, [venueId, partySize, date, publicBookingAreaMode, availabilityAreaId]);

  useEffect(() => { fetchNearbyDates(); }, [fetchNearbyDates]);

  return (
    <div className="flex flex-col items-center rounded-lg border border-slate-200 bg-slate-50 py-8 px-6 text-center sm:rounded-xl">
      <svg className="mb-3 h-7 w-7 text-slate-300" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
      <p className="text-sm font-medium text-slate-500">No availability on this date</p>
      <p className="mt-1 text-xs text-slate-400">Try a different date or party size</p>

      {nearbyLoading && (
        <div className="mt-4 flex items-center gap-2 text-xs text-slate-400">
          <div className="h-3.5 w-3.5 animate-spin rounded-full border border-slate-300 border-t-transparent" />
          Checking nearby dates&hellip;
        </div>
      )}

      {!nearbyLoading && nearbyDates.length > 0 && (
        <div className="mt-5 w-full space-y-2">
          <p className="text-xs font-medium text-slate-500">Available nearby</p>
          {nearbyDates.map((nd) => (
            <button
              key={nd.date}
              type="button"
              onClick={() => onDateSelect(nd.date)}
              className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm transition-all hover:border-brand-300 hover:bg-brand-50 hover:shadow-sm"
            >
              <span className="font-medium text-slate-700">{nd.label}</span>
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-600">
                {nd.slotCount} {nd.slotCount === 1 ? 'time' : 'times'}
              </span>
            </button>
          ))}
        </div>
      )}

      {venueId && partySize && (
        <WaitlistForm venueId={venueId} date={date} partySize={partySize} phoneDefaultCountry={phoneDefaultCountry} />
      )}
    </div>
  );
}

// ── Waitlist / standby form ───────────────────────────────────────────────

function WaitlistForm({
  venueId, date, partySize, phoneDefaultCountry,
}: {
  venueId: string;
  date: string;
  partySize: number;
  phoneDefaultCountry: CountryCode;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [desiredTime, setDesiredTime] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const guestPhone = normalizeToE164(phone, phoneDefaultCountry);
    if (!name.trim() || !guestPhone) return;
    setStatus('submitting');
    try {
      const res = await fetch('/api/booking/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venue_id: venueId,
          desired_date: date,
          desired_time: desiredTime || undefined,
          party_size: partySize,
          guest_name: name,
          guest_phone: guestPhone,
          guest_email: email || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) { setStatus('success'); setMessage(data.message ?? 'Added to standby list!'); }
      else { setStatus('error'); setMessage(data.error ?? 'Failed to join waitlist'); }
    } catch {
      setStatus('error');
      setMessage('Something went wrong. Please try again.');
    }
  }

  if (status === 'success') {
    return (
      <div className="mt-4 w-full rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-center text-sm text-green-700">
        {message}
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 w-full rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5 text-sm font-medium text-brand-700 transition-colors hover:bg-brand-100"
      >
        Join Standby List
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 w-full space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-left">
      <p className="text-xs font-medium text-slate-600">We&apos;ll notify you if a spot opens up.</p>
      {status === 'error' && <p className="text-xs text-red-600">{message}</p>}
      <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" required className="min-h-[44px] w-full rounded-lg border border-slate-200 px-3 py-2 text-base placeholder:text-slate-300 focus:border-brand-500 focus:ring-1 focus:ring-brand-500" />
      <PhoneWithCountryField
        value={phone}
        onChange={setPhone}
        defaultCountry={phoneDefaultCountry}
        inputClassName="min-h-[44px] w-full min-w-0 rounded-lg border border-slate-200 px-3 py-2 text-base placeholder:text-slate-300 focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
      />
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email (optional)" className="min-h-[44px] w-full rounded-lg border border-slate-200 px-3 py-2 text-base placeholder:text-slate-300 focus:border-brand-500 focus:ring-1 focus:ring-brand-500" />
      <input type="time" value={desiredTime} onChange={(e) => setDesiredTime(e.target.value)} className="min-h-[44px] w-full rounded-lg border border-slate-200 px-3 py-2 text-base focus:border-brand-500 focus:ring-1 focus:ring-brand-500" />
      <div className="flex gap-2">
        <button type="submit" disabled={status === 'submitting' || !name.trim() || !normalizeToE164(phone, phoneDefaultCountry)} className="flex-1 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
          {status === 'submitting' ? 'Adding...' : 'Join Standby'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">
          Cancel
        </button>
      </div>
    </form>
  );
}
