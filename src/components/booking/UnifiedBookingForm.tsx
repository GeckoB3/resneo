'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CountryCode } from 'libphonenumber-js';
import { useToast } from '@/components/ui/Toast';
import { PhoneWithCountryField } from '@/components/phone/PhoneWithCountryField';
import { normalizeToE164 } from '@/lib/phone/e164';
import { defaultPhoneCountryForVenueCurrency } from '@/lib/phone/default-country';
import MiniFloorPlanPicker, { type MiniFloorTableRow } from '@/components/floor-plan/MiniFloorPlanPicker';
import { useDashboardVenueBootstrap } from '@/components/providers/DashboardVenueBootstrapProvider';
import { useDismissibleLayer } from '@/lib/ui/use-dismissible-layer';

// ── Helpers ───────────────────────────────────────────────────────────────
/** YYYY-MM-DD in the browser's local calendar (matches guest BookingFlow / DateStep). */
function localCalendarDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDateLabel(dateStr: string): string {
  const today = localCalendarDateStr();
  const t = new Date();
  t.setDate(t.getDate() + 1);
  const tomorrow = localCalendarDateStr(t);
  if (dateStr === today) return 'Today';
  if (dateStr === tomorrow) return 'Tomorrow';
  const d = new Date(dateStr + 'T00:00');
  return `${DAY_NAMES[d.getDay()]}, ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
}

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

interface Slot {
  key: string;
  label: string;
  start_time: string;
  end_time?: string;
  available_covers: number;
  area_id?: string;
}

interface Suggestion {
  source: 'single' | 'auto' | 'manual';
  table_ids: string[];
  table_names: string[];
  combined_capacity: number;
  spare_covers: number;
}

/** Frozen when opening the modify-booking modal; drives PATCH + table assignment. */
export interface UnifiedBookingEditSnapshot {
  booking_date: string;
  booking_time: string;
  party_size: number;
  area_id: string | null;
  guest_name: string;
  guest_phone: string | null;
  guest_email: string | null;
  dietary_notes: string | null;
  special_requests: string | null;
  internal_notes: string | null;
  occasion: string | null;
  table_ids: string[];
  estimated_end_time: string | null;
  deposit_status: string | null;
}

function timeToMinutesUbf(value: string): number {
  const [h, m] = value.slice(0, 5).split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function estimatedEndToHHMMUbf(iso: string | null | undefined): string | null {
  if (iso == null || typeof iso !== 'string' || !iso.trim()) return null;
  const d = new Date(iso.trim());
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().slice(11, 16);
  }
  const afterT = iso.includes('T') ? iso.split('T')[1] : null;
  const hm = (afterT ?? iso).slice(0, 5);
  if (/^\d{2}:\d{2}$/.test(hm)) return hm;
  return null;
}

function suggestDurationFromEditSnapshot(snapshot: UnifiedBookingEditSnapshot): number {
  const start = snapshot.booking_time.slice(0, 5);
  const endHm = estimatedEndToHHMMUbf(snapshot.estimated_end_time);
  if (!endHm) return 90;
  let d = timeToMinutesUbf(endHm) - timeToMinutesUbf(start);
  if (d <= 0) d += 24 * 60;
  return Math.max(15, Math.round(d / 15) * 15);
}

export interface UnifiedBookingFormProps {
  venueId: string;
  advancedMode: boolean;
  initialDate?: string;
  initialTime?: string;
  asModal?: boolean;
  /** ISO 4217; used to default phone country (+44 for GBP, +353 for EUR). If omitted, loaded from GET /api/venue. */
  venueCurrency?: string;
  onCreated: (result?: { booking_id: string; payment_url?: string }) => void;
  onClose?: () => void;
  /** Table booking: edit existing reservation instead of POST /api/venue/bookings. */
  editBookingId?: string;
  editSnapshot?: UnifiedBookingEditSnapshot;
}

export function UnifiedBookingForm({
  venueId,
  advancedMode,
  initialDate,
  initialTime,
  asModal = false,
  venueCurrency: venueCurrencyProp,
  onCreated,
  onClose,
  editBookingId,
  editSnapshot,
}: UnifiedBookingFormProps) {
  const isEdit = Boolean(editBookingId && editSnapshot);
  const venueBootstrap = useDashboardVenueBootstrap();
  const { addToast } = useToast();
  const [venueCurrencyResolved, setVenueCurrencyResolved] = useState<string | null>(venueCurrencyProp ?? null);
  const [date, setDate] = useState(() => editSnapshot?.booking_date ?? initialDate ?? localCalendarDateStr());
  const [partySize, setPartySize] = useState(() => editSnapshot?.party_size ?? 2);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedTime, setSelectedTime] = useState(
    () => editSnapshot?.booking_time.slice(0, 5) ?? initialTime ?? '',
  );
  /** Disambiguates duplicate clock times when combined multi-area availability returns one row per area. */
  const [selectedSlotKey, setSelectedSlotKey] = useState<string | null>(null);
  const [publicBookingAreaMode, setPublicBookingAreaMode] = useState<'auto' | 'manual'>('auto');
  const [diningAreas, setDiningAreas] = useState<Array<{ id: string; name: string; colour: string }>>([]);
  const [staffAreaId, setStaffAreaId] = useState<string | null>(null);
  /** Avoid fetching `/api/booking/availability` with the wrong `area_id` before venue + areas are loaded. */
  const [tableBookingPrefsReady, setTableBookingPrefsReady] = useState(false);
  /**
   * When the parent does not pass `initialDate`, scan forward for the first bookable day so date/time
   * start at the next availability (same idea as guest BookingFlow). Gate slot fetch until this completes.
   */
  const [availabilitySeedReady, setAvailabilitySeedReady] = useState(() => initialDate != null || Boolean(editSnapshot));
  const [availabilitySeedGeneration, setAvailabilitySeedGeneration] = useState(0);
  /**
   * Bumps when the form is reset (e.g. "Create Another Booking") so we refetch slots even when
   * `date` / `party_size` / area prefs are unchanged — otherwise the availability effect skips and
   * times stay empty until the user tweaks a selector.
   */
  const [slotFetchNonce, setSlotFetchNonce] = useState(0);

  const [name, setName] = useState(() => editSnapshot?.guest_name ?? '');
  const [phone, setPhone] = useState(() => editSnapshot?.guest_phone ?? '');
  const [email, setEmail] = useState(() => editSnapshot?.guest_email ?? '');
  const [dietaryNotes, setDietaryNotes] = useState(() => editSnapshot?.dietary_notes ?? '');
  const [notes, setNotes] = useState(() => editSnapshot?.special_requests ?? '');
  const [occasion, setOccasion] = useState(() => editSnapshot?.occasion ?? '');
  const [internalNotes, setInternalNotes] = useState(() => editSnapshot?.internal_notes ?? '');

  const [coverDurationMinutes, setCoverDurationMinutes] = useState(() =>
    editSnapshot ? suggestDurationFromEditSnapshot(editSnapshot) : 90,
  );
  const [coverDurationDirty, setCoverDurationDirty] = useState(false);
  const prevUbfDurationInputKeyRef = useRef<string | null>(null);

  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selectedSuggestionKey, setSelectedSuggestionKey] = useState<string | null>(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [tableAssignMode, setTableAssignMode] = useState<'suggested' | 'floor'>(() =>
    editSnapshot && (editSnapshot.table_ids?.length ?? 0) > 0 ? 'floor' : 'suggested',
  );
  const [manualTableIds, setManualTableIds] = useState<string[]>(() => editSnapshot?.table_ids ?? []);
  const [occupiedTableIds, setOccupiedTableIds] = useState<string[]>([]);
  const [prefetchedTables, setPrefetchedTables] = useState<MiniFloorTableRow[] | null>(null);
  /** Dining area for table suggestions and floor picker (multi-area venues). */
  const [tableAssignmentAreaId, setTableAssignmentAreaId] = useState<string | null>(null);
  const assignmentSlotIdentityRef = useRef<string | null>(null);
  const editBaselineRef = useRef<UnifiedBookingEditSnapshot | null>(null);

  const ubfDurationInputKey = useMemo(() => {
    const timePart =
      selectedTime.length >= 5 ? selectedTime.slice(0, 5) : selectedTime;
    const areaPart =
      diningAreas.length > 1 && tableAssignmentAreaId ? tableAssignmentAreaId : '';
    return `${date}|${timePart}|${partySize}|${areaPart}`;
  }, [date, selectedTime, partySize, diningAreas.length, tableAssignmentAreaId]);

  const [requireDeposit, setRequireDeposit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [result, setResult] = useState<{ booking_id: string; payment_url?: string } | null>(null);

  const [openPanel, setOpenPanel] = useState<'party' | 'date' | 'time' | null>(null);
  const [gridCenter, setGridCenter] = useState('20:00');
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const base = editSnapshot?.booking_date ?? initialDate ?? localCalendarDateStr();
    const d = new Date(`${base}T00:00`);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const panelRef = useRef<HTMLDivElement>(null);

  const nameRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** Party size for the “next available day” scan only (do not re-scan when party changes mid-session). */
  const partySizeForSeedRef = useRef(partySize);
  partySizeForSeedRef.current = partySize;

  const phoneDefaultCountry: CountryCode = useMemo(
    () => defaultPhoneCountryForVenueCurrency(venueCurrencyResolved ?? undefined),
    [venueCurrencyResolved],
  );

  const showStaffAreaTabs = useMemo(
    () => diningAreas.length > 1 && publicBookingAreaMode === 'manual',
    [diningAreas.length, publicBookingAreaMode],
  );

  useLayoutEffect(() => {
    if (!isEdit || !editSnapshot) return;
    editBaselineRef.current = {
      ...editSnapshot,
      table_ids: [...editSnapshot.table_ids],
    };
  }, [isEdit, editBookingId, editSnapshot]);

  useEffect(() => {
    if (!isEdit || !editSnapshot?.area_id || !tableBookingPrefsReady) return;
    if (!diningAreas.some((a) => a.id === editSnapshot.area_id)) return;
    setTableAssignmentAreaId(editSnapshot.area_id);
    if (publicBookingAreaMode === 'manual') {
      setStaffAreaId(editSnapshot.area_id);
    }
  }, [isEdit, editSnapshot, tableBookingPrefsReady, diningAreas, publicBookingAreaMode]);

  useEffect(() => {
    if (venueCurrencyProp != null) {
      setVenueCurrencyResolved(venueCurrencyProp);
      return;
    }
    if (venueBootstrap?.currency) {
      setVenueCurrencyResolved(venueBootstrap.currency);
      return;
    }
    let cancelled = false;
    void fetch('/api/venue')
      .then((r) => r.json())
      .then((data: { currency?: string }) => {
        if (!cancelled && data?.currency) setVenueCurrencyResolved(data.currency);
      })
      .catch((e) => console.error('[UnifiedBookingForm] /api/venue preload failed:', e));
    return () => {
      cancelled = true;
    };
  }, [venueCurrencyProp, venueBootstrap?.currency]);

  useEffect(() => {
    let cancelled = false;

    const applyAreasPayload = (
      v: Record<string, unknown>,
      a: { areas?: Array<{ id: string; name: string; colour: string; is_active: boolean }> },
    ) => {
      if (cancelled) return;
      setPublicBookingAreaMode(v.public_booking_area_mode === 'manual' ? 'manual' : 'auto');
      const active = (a.areas ?? []).filter((x) => x.is_active);
      const mapped = active.map(({ id, name, colour }) => ({ id, name, colour }));
      setDiningAreas(mapped);
      if (mapped.length > 1) {
        setTableAssignmentAreaId((prev) =>
          prev && mapped.some((x) => x.id === prev) ? prev : mapped[0]!.id,
        );
        if (v.public_booking_area_mode === 'manual') {
          setStaffAreaId((prev) => {
            if (prev && mapped.some((x) => x.id === prev)) return prev;
            return mapped[0]!.id;
          });
        }
      } else {
        setTableAssignmentAreaId(null);
      }
      setTableBookingPrefsReady(true);
    };

    if (venueBootstrap) {
      void fetch('/api/venue/areas')
        .then((r) => (r.ok ? r.json() : { areas: [] }))
        .then((a) => {
          applyAreasPayload(
            { public_booking_area_mode: venueBootstrap.publicBookingAreaMode },
            a as { areas?: Array<{ id: string; name: string; colour: string; is_active: boolean }> },
          );
        })
        .catch(() => {
          if (!cancelled) setTableBookingPrefsReady(true);
        });
      return () => {
        cancelled = true;
      };
    }

    void Promise.all([
      fetch('/api/venue').then((r) => r.json()),
      fetch('/api/venue/areas').then((r) => (r.ok ? r.json() : { areas: [] })),
    ])
      .then(([v, a]: [Record<string, unknown>, { areas?: Array<{ id: string; name: string; colour: string; is_active: boolean }> }]) => {
        applyAreasPayload(v, a);
      })
      .catch(() => {
        if (!cancelled) setTableBookingPrefsReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [venueBootstrap]);

  useEffect(() => {
    if (initialDate != null) return;
    if (!tableBookingPrefsReady) return;
    if (diningAreas.length > 1 && publicBookingAreaMode === 'manual' && !staffAreaId) return;

    let cancelled = false;
    setAvailabilitySeedReady(false);

    void (async () => {
      try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const maxDays = 60;

        for (let dayOffset = 0; dayOffset <= maxDays; dayOffset++) {
          const checkDate = new Date(today);
          checkDate.setDate(checkDate.getDate() + dayOffset);
          const y = checkDate.getFullYear();
          const m = String(checkDate.getMonth() + 1).padStart(2, '0');
          const d = String(checkDate.getDate()).padStart(2, '0');
          const dateStr = `${y}-${m}-${d}`;

          let url = `/api/booking/availability?venue_id=${encodeURIComponent(venueId)}&date=${encodeURIComponent(dateStr)}&party_size=${partySizeForSeedRef.current}`;
          if (publicBookingAreaMode === 'manual' && staffAreaId) {
            url += `&area_id=${encodeURIComponent(staffAreaId)}`;
          }

          const res = await fetch(url);
          if (cancelled) return;
          if (!res.ok) break;

          const data = (await res.json()) as {
            slots?: unknown[];
            services?: Array<{ slots?: unknown[] }>;
            large_party_redirect?: boolean;
          };
          const hasSlots = (data.slots ?? []).length > 0;
          const hasServiceSlots = (data.services ?? []).some((s) => (s.slots ?? []).length > 0);
          if (hasSlots || hasServiceSlots || data.large_party_redirect) {
            if (!cancelled) {
              setDate(dateStr);
              setCalendarMonth(new Date(y, parseInt(m, 10) - 1, 1));
            }
            break;
          }
        }
      } catch {
        /* keep default date */
      } finally {
        if (!cancelled) setAvailabilitySeedReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    availabilitySeedGeneration,
    diningAreas.length,
    initialDate,
    publicBookingAreaMode,
    staffAreaId,
    tableBookingPrefsReady,
    venueId,
  ]);

  useEffect(() => {
    if (publicBookingAreaMode === 'manual' && staffAreaId && diningAreas.length > 1) {
      setTableAssignmentAreaId(staffAreaId);
    }
  }, [diningAreas.length, publicBookingAreaMode, staffAreaId]);

  useEffect(() => {
    if (diningAreas.length <= 1) return;
    if (publicBookingAreaMode === 'manual') return;
    const id = `${selectedSlotKey ?? ''}|${selectedTime}`;
    if (assignmentSlotIdentityRef.current === id && assignmentSlotIdentityRef.current !== '') return;
    assignmentSlotIdentityRef.current = id;
    const sl =
      slots.find((s) => s.key === selectedSlotKey) ??
      slots.find((s) => s.start_time.slice(0, 5) === selectedTime.slice(0, 5));
    setTableAssignmentAreaId(sl?.area_id ?? diningAreas[0]!.id);
  }, [diningAreas, publicBookingAreaMode, selectedSlotKey, selectedTime, slots]);

  const selectTableAssignmentArea = useCallback(
    (areaId: string) => {
      setTableAssignmentAreaId(areaId);
      if (publicBookingAreaMode === 'manual') {
        setStaffAreaId(areaId);
        setSelectedSlotKey(null);
      }
    },
    [publicBookingAreaMode],
  );

  // Focus guest name when form opens (create flow only; modify modal opens mid-workflow)
  useEffect(() => {
    if (isEdit) return;
    const timer = setTimeout(() => nameRef.current?.focus(), 80);
    return () => clearTimeout(timer);
  }, [isEdit]);

  useDismissibleLayer({
    open: openPanel !== null,
    refs: [panelRef],
    onDismiss: () => setOpenPanel(null),
  });

  // Fetch available time slots when date or party size changes (debounced)
  useEffect(() => {
    if (!date) {
      setSlots([]);
      return;
    }
    if (!availabilitySeedReady) {
      return;
    }
    if (!tableBookingPrefsReady) {
      return;
    }
    if (diningAreas.length > 1 && publicBookingAreaMode === 'manual' && !staffAreaId) {
      setSlots([]);
      return;
    }
    setLoadingSlots(true);

    /** Prefer keeping the guest's chosen clock time when date / party / area changes. */
    const clockFrom = (t: string | undefined | null): string | null => {
      const s = String(t ?? '').trim();
      return s.length >= 5 ? s.slice(0, 5) : null;
    };
    const preferredClock = clockFrom(selectedTime) ?? clockFrom(initialTime);
    const disambiguateKey = selectedSlotKey;
    if (preferredClock) setGridCenter(preferredClock);
    else setGridCenter('20:00');

    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (abortRef.current) abortRef.current.abort();

    debounceRef.current = setTimeout(() => {
      const controller = new AbortController();
      abortRef.current = controller;

      (async () => {
        try {
          let url = `/api/booking/availability?venue_id=${encodeURIComponent(venueId)}&date=${encodeURIComponent(date)}&party_size=${partySize}`;
          if (publicBookingAreaMode === 'manual' && staffAreaId) {
            url += `&area_id=${encodeURIComponent(staffAreaId)}`;
          }
          const res = await fetch(url, { signal: controller.signal });
          if (controller.signal.aborted) return;
          if (!res.ok) throw new Error('Failed to load times');
          const data = await res.json();
          const rawSlots: Slot[] = (data.slots ?? [])
            .map((s: Record<string, unknown>, idx: number) => ({
              key: (s.key as string) ?? `${String(s.start_time ?? '')}-${idx}`,
              label: (s.label as string) ?? (s.start_time as string)?.slice(0, 5) ?? '',
              start_time: (s.start_time as string) ?? '',
              end_time: (s.end_time as string) ?? undefined,
              available_covers: (s.available_covers as number) ?? 0,
              area_id: typeof s.area_id === 'string' ? s.area_id : undefined,
            }))
            .filter((s: Slot) => s.start_time);
          if (!controller.signal.aborted) {
            setSlots(rawSlots);
            if (rawSlots.length === 0) {
              setSelectedTime('');
              setSelectedSlotKey(null);
            } else {
              let picked: Slot | null = null;
              if (preferredClock) {
                const matches = rawSlots.filter((s) => s.start_time.slice(0, 5) === preferredClock);
                if (matches.length === 1) picked = matches[0]!;
                else if (matches.length > 1) {
                  picked =
                    (disambiguateKey ? matches.find((s) => s.key === disambiguateKey) : undefined) ??
                    matches[0]!;
                }
              }
              if (!picked) {
                picked = rawSlots.reduce((best, s) => (s.start_time < best.start_time ? s : best));
              }
              setSelectedTime(picked.start_time);
              setSelectedSlotKey(picked.key);
              setGridCenter(picked.start_time.slice(0, 5));
            }
          }
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          if (!controller.signal.aborted) {
            setSlots([]);
            addToast('Failed to load available times', 'error');
          }
        } finally {
          if (!controller.signal.aborted) setLoadingSlots(false);
        }
      })();
    }, 250);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    addToast,
    availabilitySeedReady,
    date,
    partySize,
    venueId,
    publicBookingAreaMode,
    staffAreaId,
    tableBookingPrefsReady,
    diningAreas.length,
    slotFetchNonce,
  ]);

  // Pre-fetch all tables when advanced mode is on so floor plan can switch areas without extra round-trips
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
    return () => {
      cancelled = true;
    };
  }, [advancedMode]);

  // Resolve cover time from venue defaults (GET walk-in); table suggestions use the same duration.
  useEffect(() => {
    let cancelled = false;

    if (!date || !selectedTime || partySize < 1) {
      if (advancedMode) {
        setSuggestions([]);
        setSelectedSuggestionKey(null);
        setOccupiedTableIds([]);
        if (!isEdit) setManualTableIds([]);
      }
      return;
    }
    if (!tableBookingPrefsReady) return;
    if (diningAreas.length > 1 && !tableAssignmentAreaId) {
      if (advancedMode) {
        setSuggestions([]);
        setSelectedSuggestionKey(null);
        setOccupiedTableIds([]);
      }
      return;
    }

    const prevKey = prevUbfDurationInputKeyRef.current;
    const inputKeyChanged = prevKey !== null && ubfDurationInputKey !== prevKey;
    prevUbfDurationInputKeyRef.current = ubfDurationInputKey;

    const effectiveDurationDirty = inputKeyChanged ? false : coverDurationDirty;
    if (inputKeyChanged && coverDurationDirty) {
      setCoverDurationDirty(false);
    }

    if (advancedMode && !isEdit) {
      setManualTableIds([]);
    }

    if (advancedMode) {
      setLoadingSuggestions(true);
    }

    const timeParam = selectedTime.length >= 5 ? selectedTime.slice(0, 5) : selectedTime;
    const durationParams = new URLSearchParams({
      date,
      time: timeParam,
      party_size: String(partySize),
    });
    if (diningAreas.length > 1 && tableAssignmentAreaId) {
      durationParams.set('area_id', tableAssignmentAreaId);
    }

    void (async () => {
      try {
        let durationForSuggestions = coverDurationMinutes;
        if (!effectiveDurationDirty) {
          const durationRes = await fetch(`/api/venue/bookings/walk-in?${durationParams.toString()}`);
          if (durationRes.ok && !cancelled) {
            const durationPayload = (await durationRes.json()) as { duration_minutes?: number };
            const resolved = durationPayload.duration_minutes;
            if (typeof resolved === 'number') {
              durationForSuggestions = resolved;
              setCoverDurationMinutes((m) => (m === resolved ? m : resolved));
            }
          }
        }

        if (!advancedMode) {
          return;
        }

        const suggestionParams = new URLSearchParams({
          date,
          time: timeParam,
          party_size: String(partySize),
          duration_minutes: String(
            effectiveDurationDirty ? coverDurationMinutes : durationForSuggestions,
          ),
        });
        if (diningAreas.length > 1 && tableAssignmentAreaId) {
          suggestionParams.set('area_id', tableAssignmentAreaId);
        }
        if (isEdit && editBookingId) {
          suggestionParams.set('booking_id', editBookingId);
        }
        const res = await fetch(`/api/venue/tables/combinations/suggest?${suggestionParams.toString()}`);
        if (cancelled) return;
        if (!res.ok) {
          setSuggestions([]);
          setSelectedSuggestionKey(null);
          setOccupiedTableIds([]);
          return;
        }
        const payload = await res.json();
        const next = (payload.suggestions ?? []) as Suggestion[];
        const busy = (payload.occupied_table_ids ?? []) as string[];
        setSuggestions(next);
        setOccupiedTableIds(Array.isArray(busy) ? busy : []);
        if (!(isEdit && tableAssignMode === 'floor')) {
          setSelectedSuggestionKey(
            next.length > 0 ? `${next[0]!.source}:${next[0]!.table_ids.join('|')}` : null,
          );
        }
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
    coverDurationDirty,
    coverDurationMinutes,
    date,
    diningAreas.length,
    editBookingId,
    isEdit,
    partySize,
    selectedTime,
    tableAssignMode,
    tableAssignmentAreaId,
    tableBookingPrefsReady,
    ubfDurationInputKey,
  ]);

  const selectedSuggestion = useMemo(
    () => suggestions.find((s) => `${s.source}:${s.table_ids.join('|')}` === selectedSuggestionKey) ?? null,
    [selectedSuggestionKey, suggestions],
  );

  const tableIdsToAssign = useMemo(() => {
    if (tableAssignMode === 'floor' && manualTableIds.length > 0) return manualTableIds;
    if (tableAssignMode === 'suggested' && selectedSuggestion?.table_ids?.length)
      return selectedSuggestion.table_ids;
    return null;
  }, [manualTableIds, selectedSuggestion, tableAssignMode]);

  const tablesForFloorPlanPicker = useMemo(() => {
    if (!prefetchedTables?.length) return null;
    if (diningAreas.length <= 1) return prefetchedTables;
    if (!tableAssignmentAreaId) return prefetchedTables;
    return prefetchedTables.filter((t) => t.area_id === tableAssignmentAreaId);
  }, [prefetchedTables, diningAreas.length, tableAssignmentAreaId]);

  const phoneE164 = normalizeToE164(phone, phoneDefaultCountry);
  const canSubmit = Boolean(date && selectedTime && name.trim() && phoneE164 && !saving);

  const timeOptions = useMemo(() => {
    if (!slots.length) return [] as string[];
    const slotMinutes = slots.map(s => {
      const parts = s.start_time.slice(0, 5).split(':');
      return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
    });
    const boundaries = new Set<number>();
    for (const m of slotMinutes) {
      boundaries.add(Math.round(m / 30) * 30);
    }
    return Array.from(boundaries)
      .sort((a, b) => a - b)
      .map(m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }, [slots]);

  const nearbySlots = useMemo(() => {
    if (!gridCenter || !slots.length) return slots.slice(0, 9);
    const cp = gridCenter.split(':');
    const centerMin = parseInt(cp[0], 10) * 60 + parseInt(cp[1], 10);
    const withDist = slots.map(s => {
      const sp = s.start_time.slice(0, 5).split(':');
      const slotMin = parseInt(sp[0], 10) * 60 + parseInt(sp[1], 10);
      return { slot: s, dist: Math.abs(slotMin - centerMin) };
    });
    withDist.sort((a, b) => a.dist - b.dist);
    const closest = withDist.slice(0, 9).map(x => x.slot);
    closest.sort((a, b) => a.start_time.localeCompare(b.start_time));
    return closest;
  }, [gridCenter, slots]);

  const calendarGrid = useMemo(() => {
    const yr = calendarMonth.getFullYear();
    const mo = calendarMonth.getMonth();
    const firstDow = new Date(yr, mo, 1).getDay();
    const offset = (firstDow + 6) % 7;
    const total = new Date(yr, mo + 1, 0).getDate();
    const cells: (number | null)[] = [];
    for (let i = 0; i < offset; i++) cells.push(null);
    for (let d = 1; d <= total; d++) cells.push(d);
    return { yr, mo, cells };
  }, [calendarMonth]);

  const resetForm = useCallback(() => {
    setDate(initialDate ?? localCalendarDateStr());
    setPartySize(2);
    setOpenPanel(null);
    setGridCenter('20:00');
    setCalendarMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    setSlots([]);
    setSlotFetchNonce((n) => n + 1);
    setSelectedTime(initialTime ?? '');
    setSelectedSlotKey(null);
    setName('');
    setPhone('');
    setEmail('');
    setDietaryNotes('');
    setNotes('');
    setSuggestions([]);
    setSelectedSuggestionKey(null);
    setTableAssignMode('suggested');
    setManualTableIds([]);
    setOccupiedTableIds([]);
    setRequireDeposit(false);
    setError(null);
    setResult(null);
    setCoverDurationMinutes(90);
    setCoverDurationDirty(false);
    setTableAssignmentAreaId((prev) => {
      if (diningAreas.length <= 1) return null;
      if (prev && diningAreas.some((a) => a.id === prev)) return prev;
      return diningAreas[0]!.id;
    });
    assignmentSlotIdentityRef.current = null;
    if (initialDate == null) {
      setAvailabilitySeedReady(false);
      setAvailabilitySeedGeneration((g) => g + 1);
    }
  }, [initialDate, initialTime, diningAreas]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const resolvedPhone = normalizeToE164(phone, phoneDefaultCountry);
    if (!date || !selectedTime || !name.trim() || !resolvedPhone) {
      setError('Date, time, guest name, and a valid phone number are required.');
      return;
    }

    if (isEdit && editBookingId && editBaselineRef.current) {
      const orig = editBaselineRef.current;
      const timeHm = selectedTime.slice(0, 5);
      const origTime = orig.booking_time.slice(0, 5);
      const areaChanged =
        diningAreas.length > 1 && (tableAssignmentAreaId ?? null) !== (orig.area_id ?? null);
      const scheduleChanged =
        date !== orig.booking_date ||
        timeHm !== origTime ||
        partySize !== orig.party_size ||
        areaChanged;

      setSaving(true);
      try {
        if (scheduleChanged) {
          const body: Record<string, unknown> = {
            booking_date: date,
            booking_time: timeHm,
            party_size: partySize,
            duration_minutes: Math.min(
              COVER_TIME_MAX,
              Math.max(COVER_TIME_MIN, Math.round(Number(coverDurationMinutes)) || COVER_TIME_MIN),
            ),
          };
          if (diningAreas.length > 1 && tableAssignmentAreaId) {
            body.area_id = tableAssignmentAreaId;
          }
          const res = await fetch(`/api/venue/bookings/${editBookingId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (!res.ok) {
            const payload = await res.json().catch(() => ({}));
            setError(typeof payload.error === 'string' ? payload.error : 'Failed to update booking');
            return;
          }
        } else {
          const baselineDur = suggestDurationFromEditSnapshot(orig);
          const clampedDur = Math.min(
            COVER_TIME_MAX,
            Math.max(COVER_TIME_MIN, Math.round(Number(coverDurationMinutes)) || COVER_TIME_MIN),
          );
          if (clampedDur !== baselineDur) {
            const res = await fetch(`/api/venue/bookings/${editBookingId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ duration_minutes: clampedDur }),
            });
            if (!res.ok) {
              const payload = await res.json().catch(() => ({}));
              setError(typeof payload.error === 'string' ? payload.error : 'Failed to update booking');
              return;
            }
          }
        }

        const detailsPayload: Record<string, unknown> = {};
        if (name.trim() !== (orig.guest_name ?? '').trim()) {
          detailsPayload.guest_name = name.trim();
        }
        const origPhone = orig.guest_phone ?? '';
        if (resolvedPhone !== origPhone) {
          detailsPayload.guest_phone = resolvedPhone;
        }
        const origEmail = (orig.guest_email ?? '').trim();
        if (email.trim() !== origEmail) {
          detailsPayload.guest_email = email.trim() || null;
        }

        if (Object.keys(detailsPayload).length > 0) {
          const res = await fetch(`/api/venue/bookings/${editBookingId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(detailsPayload),
          });
          if (!res.ok) {
            const payload = await res.json().catch(() => ({}));
            setError(typeof payload.error === 'string' ? payload.error : 'Failed to update guest details');
            return;
          }
        }

        const desired = tableIdsToAssign ?? [];
        const origIds = [...orig.table_ids].sort();
        const newIds = [...desired].sort();

        if (scheduleChanged && advancedMode && newIds.length > 0) {
          const assignRes = await fetch('/api/venue/tables/assignments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ booking_id: editBookingId, table_ids: desired }),
          });
          if (!assignRes.ok) {
            const assignPayload = await assignRes.json().catch(() => ({}));
            addToast(
              typeof assignPayload.error === 'string'
                ? assignPayload.error
                : 'Booking updated, but table assignment failed',
              'error',
            );
          }
        } else if (!scheduleChanged && origIds.join('|') !== newIds.join('|')) {
          const assignBody =
            newIds.length === 0
              ? { action: 'unassign', booking_id: editBookingId }
              : origIds.length > 0
                ? {
                    action: 'reassign',
                    booking_id: editBookingId,
                    old_table_ids: origIds,
                    new_table_ids: newIds,
                  }
                : { booking_id: editBookingId, table_ids: newIds };
          const assignRes = await fetch('/api/venue/tables/assignments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(assignBody),
          });
          if (!assignRes.ok) {
            const assignPayload = await assignRes.json().catch(() => ({}));
            setError(
              typeof assignPayload.error === 'string'
                ? assignPayload.error
                : 'Failed to update table assignment',
            );
            return;
          }
        }

        addToast('Booking updated', 'success');
        onCreated({ booking_id: editBookingId });
      } catch {
        setError('Failed to update booking');
      } finally {
        setSaving(false);
      }
      return;
    }

    setSaving(true);
    try {
      let resolvedAreaId: string | undefined;
      if (diningAreas.length > 1 && tableAssignmentAreaId) {
        resolvedAreaId = tableAssignmentAreaId;
      }

      const createRes = await fetch('/api/venue/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          booking_date: date,
          booking_time: selectedTime,
          party_size: partySize,
          name: name.trim(),
          phone: resolvedPhone,
          email: email.trim() || undefined,
          dietary_notes: dietaryNotes.trim() || undefined,
          special_requests: notes.trim() || undefined,
          require_deposit: requireDeposit,
          ...(resolvedAreaId ? { area_id: resolvedAreaId } : {}),
          ...(coverDurationDirty
            ? {
                duration_minutes: Math.min(
                  COVER_TIME_MAX,
                  Math.max(
                    COVER_TIME_MIN,
                    Math.round(Number(coverDurationMinutes)) || COVER_TIME_MIN,
                  ),
                ),
              }
            : {}),
        }),
      });

      if (!createRes.ok) {
        const payload = await createRes.json().catch(() => ({}));
        setError(payload.error ?? 'Failed to create booking');
        return;
      }

      const payload = await createRes.json();

      if (advancedMode && payload.booking_id && tableIdsToAssign?.length) {
        const assignRes = await fetch('/api/venue/tables/assignments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            booking_id: payload.booking_id,
            table_ids: tableIdsToAssign,
          }),
        });
        if (!assignRes.ok) {
          const assignPayload = await assignRes.json().catch(() => ({}));
          addToast(assignPayload.error ?? 'Booking created, but table assignment failed', 'error');
        }
      }

      const bookingResult = {
        booking_id: payload.booking_id as string,
        payment_url: payload.payment_url as string | undefined,
      };

      if (asModal) {
        addToast(
          requireDeposit ? 'Booking created - deposit link sent' : 'Booking confirmed',
          'success',
        );
        onCreated(bookingResult);
      } else {
        setResult(bookingResult);
      }
    } catch {
      setError('Failed to create booking');
    } finally {
      setSaving(false);
    }
  };

  // Success state (inline mode only - modals close on success)
  if (!asModal && result) {
    const hasDeposit = Boolean(result.payment_url);
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-2xl sm:p-6">
        <div className={`rounded-lg border p-4 sm:rounded-xl sm:p-5 ${hasDeposit ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
          <div className="mb-2 flex items-center gap-3">
            <div className={`flex h-9 w-9 items-center justify-center rounded-full ${hasDeposit ? 'bg-amber-100' : 'bg-emerald-100'}`}>
              <svg className={`h-5 w-5 ${hasDeposit ? 'text-amber-600' : 'text-emerald-600'}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            </div>
            <p className={`text-base font-semibold ${hasDeposit ? 'text-amber-800' : 'text-emerald-800'}`}>
              {hasDeposit ? 'Booking Created - Deposit Requested' : 'Booking Confirmed'}
            </p>
          </div>
          <p className={`text-sm ${hasDeposit ? 'text-amber-700' : 'text-emerald-700'}`}>
            {hasDeposit
              ? 'A deposit payment link has been sent to the guest.'
              : 'A confirmation has been sent to the guest.'}
          </p>
        </div>

        {result.payment_url && (
          <div className="mt-4 rounded-xl bg-slate-50 px-4 py-3">
            <p className="mb-1 text-xs font-medium text-slate-500">Payment link</p>
            <a
              href={result.payment_url}
              target="_blank"
              rel="noreferrer"
              className="break-all text-sm font-medium text-brand-600 hover:text-brand-700"
            >
              {result.payment_url}
            </a>
          </div>
        )}

        {hasDeposit && (
          <p className="mt-3 text-xs text-slate-400">
            If deposit is not paid within 24 hours, the booking will be auto-cancelled.
          </p>
        )}

        <button
          type="button"
          onClick={resetForm}
          className="mt-5 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          Create Another Booking
        </button>
      </div>
    );
  }

  const formContent = (
    <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-4">
      {/* ── Selector Row (3 separate dropdowns) ── */}
      <div ref={panelRef}>
        <div className="grid grid-cols-3 gap-1.5 min-[400px]:gap-2 sm:flex sm:flex-row sm:items-end sm:gap-2">
          {/* ── Party ── */}
          <div className="relative min-w-0">
            <p className="mb-1 text-[10px] sm:text-[11px] font-medium uppercase tracking-wide text-slate-400">Party</p>
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
                  {PARTY_GRID.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => { setPartySize(n); setOpenPanel(null); }}
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
                        if (!Number.isNaN(v) && v >= 1 && v <= 50) { setPartySize(v); setOpenPanel(null); }
                      }
                    }}
                    onBlur={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (!Number.isNaN(v) && v >= 1 && v <= 50) { setPartySize(v); setOpenPanel(null); }
                    }}
                    className="h-7 w-14 rounded-md border border-slate-200 bg-white px-2 text-center text-sm font-semibold tabular-nums focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  />
                </div>
              </div>
            )}
          </div>

          {/* ── Date ── */}
          <div className="relative min-w-0 flex-1 sm:min-w-[140px]">
            <p className="mb-1 text-[10px] sm:text-[11px] font-medium uppercase tracking-wide text-slate-400">Date</p>
            <button
              type="button"
              onClick={() => {
                if (openPanel === 'date') {
                  setOpenPanel(null);
                } else {
                  const d = new Date(date + 'T00:00');
                  setCalendarMonth(new Date(d.getFullYear(), d.getMonth(), 1));
                  setOpenPanel('date');
                }
              }}
              className={`flex min-h-[40px] w-full touch-manipulation items-center justify-between rounded-lg border px-2 py-1.5 text-xs font-semibold transition-colors min-[400px]:px-3 min-[400px]:py-2 min-[400px]:text-sm ${
                openPanel === 'date'
                  ? 'border-brand-300 bg-brand-50 text-brand-700'
                  : 'border-slate-200 bg-white text-slate-900 hover:border-slate-300'
              }`}
            >
              <span className="truncate">{formatDateLabel(date)}</span>
              <ChevronDown className={`ml-2 h-3.5 w-3.5 flex-shrink-0 text-slate-400 transition-transform duration-150 ${openPanel === 'date' ? 'rotate-180' : ''}`} />
            </button>

            {openPanel === 'date' && (() => {
              const { yr, mo, cells } = calendarGrid;
              const todayStr = localCalendarDateStr();
              const tomorrow = new Date();
              tomorrow.setDate(tomorrow.getDate() + 1);
              const tomorrowStr = localCalendarDateStr(tomorrow);
              const nowDate = new Date();
              const canGoPrev = new Date(yr, mo - 1, 1) >= new Date(nowDate.getFullYear(), nowDate.getMonth(), 1);

              return (
                <div className="absolute left-1/2 z-20 mt-1.5 w-[min(18rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-slate-200 bg-white p-2 shadow-lg sm:left-0 sm:w-72 sm:translate-x-0 sm:p-3">
                  {/* Quick shortcuts */}
                  <div className="mb-2 flex gap-1.5 sm:mb-3">
                    <button
                      type="button"
                      onClick={() => { setDate(todayStr); setOpenPanel(null); }}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                        date === todayStr ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-brand-50 hover:text-brand-700'
                      }`}
                    >
                      Today
                    </button>
                    <button
                      type="button"
                      onClick={() => { setDate(tomorrowStr); setOpenPanel(null); }}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                        date === tomorrowStr ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-brand-50 hover:text-brand-700'
                      }`}
                    >
                      Tomorrow
                    </button>
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
                      onClick={() => setCalendarMonth(new Date(yr, mo + 1, 1))}
                      className="rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-100"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                      </svg>
                    </button>
                  </div>

                  {/* Day-of-week headers */}
                  <div className="grid grid-cols-7">
                    {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(dn => (
                      <div key={dn} className="py-1 text-center text-[10px] font-semibold uppercase text-slate-400">{dn}</div>
                    ))}
                  </div>

                  {/* Day cells */}
                  <div className="grid grid-cols-7">
                    {cells.map((day, i) => {
                      if (day === null) return <div key={`e${i}`} />;
                      const ds = `${yr}-${String(mo + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                      const isPast = ds < todayStr;
                      const isSelected = ds === date;
                      const isToday = ds === todayStr;

                      return (
                        <button
                          key={ds}
                          type="button"
                          disabled={isPast}
                          onClick={() => { setDate(ds); setOpenPanel(null); }}
                          className={`mx-auto flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium transition-all ${
                            isSelected
                              ? 'bg-brand-600 text-white shadow-sm'
                              : isToday
                                ? 'font-semibold text-brand-700 ring-1 ring-brand-400'
                                : isPast
                                  ? 'cursor-not-allowed text-slate-300'
                                  : 'text-slate-700 hover:bg-brand-50 hover:text-brand-700'
                          }`}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* ── Time ── */}
          <div className="relative min-w-0 flex-1 sm:min-w-[100px]">
            <p className="mb-1 text-[10px] sm:text-[11px] font-medium uppercase tracking-wide text-slate-400">Time</p>
            <button
              type="button"
              disabled={loadingSlots || (!slots.length && !loadingSlots)}
              onClick={() => setOpenPanel(openPanel === 'time' ? null : 'time')}
              className={`flex min-h-[40px] w-full touch-manipulation items-center justify-between rounded-lg border px-2 py-1.5 text-xs font-semibold tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-40 min-[400px]:px-3 min-[400px]:py-2 min-[400px]:text-sm ${
                selectedTime
                  ? 'border-brand-400 bg-brand-50 text-brand-700'
                  : openPanel === 'time'
                    ? 'border-brand-300 bg-brand-50 text-brand-700'
                    : 'border-slate-200 bg-white text-slate-400 hover:border-slate-300'
              }`}
            >
              <span>{selectedTime ? selectedTime.slice(0, 5) : 'Select'}</span>
              <ChevronDown className={`ml-2 h-3.5 w-3.5 flex-shrink-0 text-slate-400 transition-transform duration-150 ${openPanel === 'time' ? 'rotate-180' : ''}`} />
            </button>

            {openPanel === 'time' && timeOptions.length > 0 && (
              <div className="absolute right-1/2 z-20 mt-1.5 w-[min(12rem,calc(100vw-2rem))] translate-x-1/2 rounded-xl border border-slate-200 bg-white py-1 shadow-lg sm:right-0 sm:w-auto sm:min-w-[180px] sm:translate-x-0">
                <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto px-1 py-1 sm:max-h-80" style={{ scrollbarWidth: 'thin' }}>
                  {timeOptions.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        setGridCenter(t);
                        setSelectedTime(t);
                        const match = slots.find((s) => s.start_time.slice(0, 5) === t.slice(0, 5));
                        setSelectedSlotKey(match?.key ?? null);
                        setOpenPanel(null);
                      }}
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

      {/* ── Dining area tabs (staff, multi-area manual mode) ── */}
      {showStaffAreaTabs && (
        <div className="flex min-h-11 flex-nowrap gap-2 overflow-x-auto rounded-lg border border-slate-100 bg-slate-50/80 p-2 sm:rounded-xl sm:min-h-12">
          {diningAreas.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                setStaffAreaId(a.id);
                setTableAssignmentAreaId(a.id);
                setSelectedSlotKey(null);
              }}
              className={`inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors sm:text-sm ${
                staffAreaId === a.id
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
        {loadingSlots ? (
          <div className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-50 py-5 text-xs text-slate-400 sm:rounded-xl sm:py-6 sm:text-sm">
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Loading times&hellip;
          </div>
        ) : slots.length === 0 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-4 text-center text-xs text-amber-700 sm:rounded-xl sm:px-4 sm:py-5 sm:text-sm">
            No available times for {partySize} {partySize === 1 ? 'guest' : 'guests'} on this date
          </div>
        ) : nearbySlots.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-3 py-4 text-center text-xs text-slate-500 sm:rounded-xl sm:px-4 sm:py-5 sm:text-sm">
            No slots near {gridCenter} &mdash; try a different time
          </div>
        ) : (
          <>
            <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-400 sm:mb-2 sm:text-[11px]">
              {gridCenter ? `Times around ${gridCenter}` : 'Available times'}
            </p>
            <div className="grid grid-cols-3 gap-1.5 rounded-lg border border-slate-200 bg-slate-50/50 p-1.5 sm:gap-2 sm:rounded-xl sm:p-2.5">
              {nearbySlots.map((slot) => {
                const isActive = selectedSlotKey ? selectedSlotKey === slot.key : selectedTime === slot.start_time;
                const tight = slot.available_covers <= partySize;
                return (
                  <button
                    key={slot.key}
                    type="button"
                    onClick={() => {
                      setSelectedTime(slot.start_time);
                      setSelectedSlotKey(slot.key);
                    }}
                    className={`touch-manipulation rounded-md py-2.5 text-center text-xs font-semibold tabular-nums transition-all sm:rounded-lg sm:py-3 sm:text-sm ${
                      isActive
                        ? 'bg-brand-100 text-brand-700 ring-2 ring-brand-400'
                        : tight
                          ? 'border border-amber-200 bg-amber-50 text-amber-800 hover:border-amber-300 hover:bg-amber-100'
                          : 'border border-slate-200 bg-white text-slate-700 hover:border-brand-300 hover:bg-brand-50'
                    }`}
                  >
                    {slot.start_time.slice(0, 5)}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      <div>
        <label htmlFor="ubf-cover-duration" className="mb-1 block text-xs font-medium text-slate-700 sm:text-sm">
          Cover time
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="ubf-cover-duration"
            type="number"
            min={COVER_TIME_MIN}
            max={COVER_TIME_MAX}
            step={5}
            value={coverDurationMinutes}
            onChange={(e) => {
              const raw = parseInt(e.target.value, 10);
              if (Number.isNaN(raw)) return;
              setCoverDurationDirty(true);
              setCoverDurationMinutes(
                Math.min(COVER_TIME_MAX, Math.max(COVER_TIME_MIN, raw)),
              );
            }}
            className="w-24 rounded-lg border border-slate-200 px-3 py-2 text-base tabular-nums transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 sm:rounded-xl sm:py-2.5 sm:text-sm"
          />
          <span className="text-xs text-slate-600 sm:text-sm">minutes at the table</span>
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-slate-100" />

      {/* Guest Details */}
      <div className="space-y-3 sm:space-y-3.5">
        <div>
          <label htmlFor="ubf-name" className="mb-1 block text-xs font-medium text-slate-700 sm:text-sm">
            Guest name{' '}
            <span className="text-red-600" aria-hidden="true">
              *
            </span>
            <span className="sr-only">(required)</span>
          </label>
          <input
            ref={nameRef}
            id="ubf-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
            className="min-h-[44px] w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-base transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 sm:rounded-xl sm:px-3.5 sm:py-2.5"
            required
          />
        </div>

        <div>
          <label htmlFor="ubf-phone" className="mb-1 block text-xs font-medium text-slate-700 sm:text-sm">
            Phone number{' '}
            <span className="text-red-600" aria-hidden="true">
              *
            </span>
            <span className="sr-only">(required)</span>
          </label>
          <PhoneWithCountryField
            id="ubf-phone"
            value={phone}
            onChange={setPhone}
            defaultCountry={phoneDefaultCountry}
            inputClassName="min-h-[44px] w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-base transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 sm:rounded-xl sm:px-3.5 sm:py-2.5"
          />
        </div>

        <div>
          <label htmlFor="ubf-email" className="mb-1 block text-xs font-medium text-slate-700 sm:text-sm">
            Email <span className="text-slate-400">(optional)</span>
          </label>
          <input
            id="ubf-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="guest@example.com"
            className="min-h-[44px] w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-base transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 sm:rounded-xl sm:px-3.5 sm:py-2.5"
          />
        </div>

        {!isEdit && (
          <>
            <div>
              <label htmlFor="ubf-dietary" className="mb-1 block text-xs font-medium text-slate-700 sm:text-sm">
                Dietary notes <span className="text-slate-400">(optional)</span>
              </label>
              <textarea
                id="ubf-dietary"
                value={dietaryNotes}
                onChange={(e) => setDietaryNotes(e.target.value)}
                rows={2}
                placeholder="Allergies, intolerances, dietary requirements..."
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-base transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 sm:rounded-xl sm:px-3.5 sm:py-2.5"
              />
            </div>

            <div>
              <label htmlFor="ubf-notes" className="mb-1 block text-xs font-medium text-slate-700 sm:text-sm">
                Notes <span className="text-slate-400">(optional)</span>
              </label>
              <textarea
                id="ubf-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Internal notes for staff..."
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-base transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 sm:rounded-xl sm:px-3.5 sm:py-2.5"
              />
            </div>
          </>
        )}
      </div>

      {/* Table suggestions (advanced mode only) */}
      {advancedMode && date && selectedTime && (
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
                    onClick={() => selectTableAssignmentArea(a.id)}
                    className={`inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors sm:text-sm ${
                      tableAssignmentAreaId === a.id
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
                <div className="flex min-h-[280px] flex-col justify-center">
                  <p className="text-xs text-slate-500">
                    No table suggestions available for this time and party size. Try floor plan to pick manually.
                  </p>
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
                            <span className="text-xs text-slate-500">
                              Cap {suggestion.combined_capacity}
                            </span>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                              isSelected
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-slate-100 text-slate-500'
                            }`}>
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

      {isEdit && editSnapshot?.deposit_status === 'Paid' && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 sm:rounded-xl sm:px-4 sm:py-3 sm:text-sm">
          Changing party size won&apos;t adjust the deposit already paid.
        </p>
      )}

      {/* Deposit toggle */}
      {!isEdit && (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2.5 sm:rounded-xl sm:px-4 sm:py-3">
        <div className="min-w-0 pr-1">
          <p className="text-xs font-medium text-slate-700 sm:text-sm">Require deposit</p>
          <p className="text-[11px] text-slate-500 sm:text-xs">Send a payment link to the guest</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={requireDeposit}
          aria-label="Require deposit"
          onClick={() => setRequireDeposit((prev) => !prev)}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
            requireDeposit ? 'bg-brand-600' : 'bg-slate-200'
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform duration-200 ${
              requireDeposit ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
      )}

      {/* Error */}
      {error && (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700 sm:rounded-xl sm:px-4 sm:py-3 sm:text-sm"
        >
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:gap-3">
        <button
          type="submit"
          disabled={!canSubmit}
          className="min-h-[44px] w-full touch-manipulation rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-0 sm:flex-1 sm:rounded-xl sm:py-3"
        >
          {saving ? (isEdit ? 'Saving…' : 'Creating...') : isEdit ? 'Save changes' : 'Create Booking'}
        </button>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] w-full touch-manipulation rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 sm:min-h-0 sm:w-auto sm:rounded-xl sm:py-3"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );

  if (asModal) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/20 p-0 backdrop-blur-sm sm:items-center sm:p-4"
        onClick={onClose}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Create booking"
          className={`max-h-[min(100dvh,100vh)] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl sm:my-8 sm:rounded-2xl sm:p-6 sm:pb-6 ${advancedMode ? 'sm:max-w-2xl' : ''}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-3 flex items-center justify-between gap-2 sm:mb-5">
            <h2 className="text-base font-semibold text-slate-900 sm:text-lg">New Booking</h2>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="min-h-[44px] min-w-[44px] touch-manipulation rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 sm:min-h-0 sm:min-w-0"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {formContent}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`mx-auto w-full rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-2xl sm:p-6 ${advancedMode ? 'max-w-2xl' : 'max-w-lg'}`}
    >
      {formContent}
    </div>
  );
}
