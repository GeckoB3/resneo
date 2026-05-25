'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ResourceCalendarMonth, todayYmdLocal } from '@/components/booking/ResourceCalendarMonth';
import {
  APPOINTMENT_TIME_SLOT_LABEL_CLASS,
  APPOINTMENT_TIME_SLOTS_GRID_CLASS,
  appointmentTimeSlotClass,
} from '@/components/booking/appointment-public-ui';
import { minutesToTime, timeToMinutes } from '@/lib/availability';
import { resourceDurationCandidatesMinutes } from '@/lib/availability/resource-booking-engine';
import {
  resourceCalendarUrl,
  resourceOptionsUrl,
  resourceSlotsUrl,
} from '@/lib/booking/booking-flow-api';
import { Skeleton } from '@/components/ui/Skeleton';

interface ResourceOption {
  id: string;
  name: string;
  min_booking_minutes: number;
  max_booking_minutes: number;
  slot_interval_minutes: number;
}

function formatDurationSlotLabel(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatDurationLabel(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatDateLong(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function formatTimeRange(startHm: string, durationMinutes: number): string {
  const start = startHm.slice(0, 5);
  const end = minutesToTime(timeToMinutes(start) + durationMinutes);
  return `${start} – ${end}`;
}

function slotStartKey(startTime: string): string {
  return startTime.trim().slice(0, 5);
}

function minYmd(a: string, b: string): string {
  return a < b ? a : b;
}

function groupSlotsByPeriod(slots: Array<{ start_time: string }>) {
  const morning: typeof slots = [];
  const afternoon: typeof slots = [];
  const evening: typeof slots = [];
  for (const slot of slots) {
    const [h] = slot.start_time.split(':').map(Number);
    if ((h ?? 0) < 12) morning.push(slot);
    else if ((h ?? 0) < 17) afternoon.push(slot);
    else evening.push(slot);
  }
  return { morning, afternoon, evening };
}

export function StaffResourceBookingModifySlotPicker({
  venueId,
  bookingId,
  resourceId,
  initialBookingDate,
  initialBookingTime,
  initialDurationMinutes,
  bookingDate,
  bookingTime,
  durationMinutes,
  onBookingDateChange,
  onBookingTimeChange,
  onDurationChange,
  validationState = 'idle',
  validationMessage = null,
  disabled = false,
}: {
  venueId: string;
  bookingId: string;
  resourceId: string;
  initialBookingDate: string;
  initialBookingTime: string;
  initialDurationMinutes: number;
  bookingDate: string;
  bookingTime: string;
  durationMinutes: number;
  onBookingDateChange: (ymd: string) => void;
  onBookingTimeChange: (hhmm: string) => void;
  onDurationChange: (minutes: number) => void;
  validationState?: 'idle' | 'loading' | 'valid' | 'invalid';
  validationMessage?: string | null;
  disabled?: boolean;
}) {
  const [resourceMeta, setResourceMeta] = useState<ResourceOption | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const [y, m] = bookingDate.split('-').map(Number);
    return { year: y!, month: m! };
  });
  const [availableDates, setAvailableDates] = useState<Set<string>>(() => new Set());
  const [loadingCalendar, setLoadingCalendar] = useState(false);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [availableSlots, setAvailableSlots] = useState<Array<{ start_time: string }>>([]);
  const [selectionPulse, setSelectionPulse] = useState(false);
  const prevTimeRef = useRef(bookingTime);
  const prevDurationRef = useRef(durationMinutes);

  const selectedTimeKey = slotStartKey(bookingTime);
  const initialTimeKey = slotStartKey(initialBookingTime);
  const dateOrTimeChanged =
    bookingDate !== initialBookingDate || selectedTimeKey !== initialTimeKey;
  const durationChanged = durationMinutes !== initialDurationMinutes;
  const scheduleChanged = dateOrTimeChanged || durationChanged;
  const minSelectableDate = useMemo(
    () => minYmd(todayYmdLocal(), initialBookingDate),
    [initialBookingDate],
  );

  const slotModifyOptions = useMemo(
    () => ({ excludeBookingId: bookingId, skipPastSlots: true as const }),
    [bookingId],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoadingMeta(true);
      setMetaError(null);
      try {
        const res = await fetch(resourceOptionsUrl('staff', venueId));
        const data = (await res.json()) as { resources?: ResourceOption[]; error?: string };
        if (!res.ok) throw new Error(data.error ?? 'Failed to load resource');
        const row = (data.resources ?? []).find((r) => r.id === resourceId) ?? null;
        if (!row) throw new Error('Resource not found');
        if (!cancelled) setResourceMeta(row);
      } catch (e) {
        if (!cancelled) {
          setMetaError(e instanceof Error ? e.message : 'Could not load resource');
          setResourceMeta(null);
        }
      } finally {
        if (!cancelled) setLoadingMeta(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resourceId, venueId]);

  const durationOptions = useMemo(() => {
    if (!resourceMeta) return [];
    return resourceDurationCandidatesMinutes(resourceMeta);
  }, [resourceMeta]);

  useEffect(() => {
    const timeChanged = prevTimeRef.current !== bookingTime;
    const durationChangedSinceLast = prevDurationRef.current !== durationMinutes;
    prevTimeRef.current = bookingTime;
    prevDurationRef.current = durationMinutes;
    if (!bookingTime || (!timeChanged && !durationChangedSinceLast)) return;
    setSelectionPulse(true);
    const timer = window.setTimeout(() => setSelectionPulse(false), 700);
    return () => window.clearTimeout(timer);
  }, [bookingTime, durationMinutes]);

  useEffect(() => {
    const [y, m] = bookingDate.split('-').map(Number);
    if (!y || !m) return;
    setCalendarMonth((prev) => (prev.year === y && prev.month === m ? prev : { year: y, month: m }));
  }, [bookingDate]);

  const loadCalendarMonth = useCallback(async () => {
    if (!resourceId || disabled) return;
    setLoadingCalendar(true);
    try {
      const url = resourceCalendarUrl(
        'staff',
        venueId,
        resourceId,
        calendarMonth.year,
        calendarMonth.month,
        'any',
        slotModifyOptions,
      );
      const res = await fetch(url);
      const data = (await res.json()) as { available_dates?: string[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Failed to load calendar');
      const next = new Set(data.available_dates ?? []);
      const monthPrefix = `${calendarMonth.year}-${String(calendarMonth.month).padStart(2, '0')}`;
      if (bookingDate.startsWith(monthPrefix)) next.add(bookingDate);
      if (initialBookingDate.startsWith(monthPrefix)) next.add(initialBookingDate);
      setAvailableDates(next);
    } catch (e) {
      console.error('Staff resource modify calendar month failed:', e);
      const fallback = new Set<string>();
      if (bookingDate) fallback.add(bookingDate);
      if (initialBookingDate) fallback.add(initialBookingDate);
      setAvailableDates(fallback);
    } finally {
      setLoadingCalendar(false);
    }
  }, [
    bookingDate,
    calendarMonth.month,
    calendarMonth.year,
    disabled,
    initialBookingDate,
    resourceId,
    slotModifyOptions,
    venueId,
  ]);

  useEffect(() => {
    void loadCalendarMonth();
  }, [loadCalendarMonth]);

  const loadDaySlots = useCallback(async () => {
    if (!resourceId || !bookingDate || disabled) {
      setAvailableSlots([]);
      return;
    }
    setLoadingSlots(true);
    setSlotsError(null);
    try {
      const url = resourceSlotsUrl('staff', venueId, bookingDate, durationMinutes, resourceId, slotModifyOptions);
      const res = await fetch(url);
      const data = (await res.json()) as {
        resources?: Array<{ id: string; slots: Array<{ start_time: string }> }>;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? 'Failed to load times');
      const row = (data.resources ?? []).find((r) => r.id === resourceId);
      const raw = row?.slots ?? [];
      const seen = new Set<string>();
      const deduped: Array<{ start_time: string }> = [];
      for (const slot of raw) {
        const key = slotStartKey(slot.start_time);
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push({ start_time: slot.start_time });
      }
      if (selectedTimeKey && !seen.has(selectedTimeKey)) {
        deduped.push({ start_time: selectedTimeKey.length === 5 ? `${selectedTimeKey}:00` : selectedTimeKey });
        deduped.sort((a, b) => slotStartKey(a.start_time).localeCompare(slotStartKey(b.start_time)));
      }
      setAvailableSlots(deduped);
    } catch (e) {
      console.error('Staff resource modify day slots failed:', e);
      setSlotsError('Could not load available times.');
      setAvailableSlots(selectedTimeKey ? [{ start_time: `${selectedTimeKey}:00` }] : []);
    } finally {
      setLoadingSlots(false);
    }
  }, [bookingDate, disabled, durationMinutes, resourceId, selectedTimeKey, slotModifyOptions, venueId]);

  useEffect(() => {
    void loadDaySlots();
  }, [loadDaySlots]);

  const groupedSlots = useMemo(() => groupSlotsByPeriod(availableSlots), [availableSlots]);

  const goPrevMonth = () => {
    setCalendarMonth((prev) => {
      if (prev.month === 1) return { year: prev.year - 1, month: 12 };
      return { year: prev.year, month: prev.month - 1 };
    });
  };

  const goNextMonth = () => {
    setCalendarMonth((prev) => {
      if (prev.month === 12) return { year: prev.year + 1, month: 1 };
      return { year: prev.year, month: prev.month + 1 };
    });
  };

  const renderSelectionSummary = () => {
    if (!selectedTimeKey) return null;

    const selectedLabel = `${formatDateLong(bookingDate)} · ${formatTimeRange(selectedTimeKey, durationMinutes)} (${formatDurationLabel(durationMinutes)})`;
    const originalLabel = `${formatDateLong(initialBookingDate)} · ${formatTimeRange(initialTimeKey, initialDurationMinutes)} (${formatDurationLabel(initialDurationMinutes)})`;

    return (
      <div
        aria-live="polite"
        className={`rounded-xl border px-3 py-2.5 transition-all duration-300 ${
          selectionPulse ? 'scale-[1.01] shadow-md' : 'shadow-sm'
        } ${
          scheduleChanged ? 'border-brand-200 bg-brand-50/80' : 'border-slate-200 bg-slate-50'
        }`}
      >
        {scheduleChanged ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-brand-800">New slot</p>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-slate-500 line-through decoration-slate-400">
                {originalLabel}
              </span>
              <svg className="h-4 w-4 shrink-0 text-brand-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
              </svg>
              <span className="rounded-lg border border-brand-300 bg-white px-2.5 py-1 font-semibold text-brand-900">
                {selectedLabel}
              </span>
            </div>
          </div>
        ) : (
          <div>
            <p className="text-xs font-semibold text-slate-500">Current booking</p>
            <p className="mt-0.5 text-sm font-medium text-slate-800">{selectedLabel}</p>
          </div>
        )}

        {validationState === 'loading' ? (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-600">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" aria-hidden />
            Checking this slot…
          </p>
        ) : validationState === 'valid' && scheduleChanged ? (
          <p className="mt-2 text-xs font-medium text-emerald-700">This slot is available.</p>
        ) : validationState === 'invalid' && validationMessage ? (
          <p className="mt-2 rounded-md border border-red-100 bg-red-50 px-2 py-1 text-xs text-red-800">{validationMessage}</p>
        ) : null}
      </div>
    );
  };

  const renderTimeSlots = () => {
    const sections = [
      { label: 'Morning', slots: groupedSlots.morning },
      { label: 'Afternoon', slots: groupedSlots.afternoon },
      { label: 'Evening', slots: groupedSlots.evening },
    ];
    const showOriginalMarker =
      bookingDate === initialBookingDate && initialTimeKey.length === 5;
    return (
      <div className="space-y-4">
        {sections.map((section) =>
          section.slots.length > 0 ? (
            <div key={section.label}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">{section.label}</p>
              <div className={APPOINTMENT_TIME_SLOTS_GRID_CLASS}>
                {section.slots.map((slot, slotIndex) => {
                  const key = slotStartKey(slot.start_time);
                  const selected = key === selectedTimeKey;
                  const isOriginal = showOriginalMarker && key === initialTimeKey && !selected;
                  return (
                    <button
                      key={`${section.label}-${key}-${slotIndex}`}
                      type="button"
                      disabled={disabled}
                      onClick={() => onBookingTimeChange(key)}
                      aria-pressed={selected}
                      className={`relative ${appointmentTimeSlotClass(false, false)} transition-all duration-200 ${
                        selected
                          ? 'scale-[1.03] border-brand-600 bg-brand-600 text-white shadow-md ring-2 ring-brand-500/40'
                          : isOriginal
                            ? 'border-dashed border-slate-300 bg-slate-50 text-slate-600'
                            : 'hover:border-brand-300 hover:bg-brand-50/50'
                      }`}
                    >
                      <span className={APPOINTMENT_TIME_SLOT_LABEL_CLASS}>{key}</span>
                      {isOriginal ? (
                        <span className="mt-0.5 block text-[10px] font-medium uppercase tracking-wide text-slate-400">
                          Was
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null,
        )}
      </div>
    );
  };

  if (loadingMeta) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading resource">
        <Skeleton.Line className="w-1/2" />
        <Skeleton.Block className="h-48" />
        <Skeleton.Block className="h-24" />
      </div>
    );
  }

  if (metaError || !resourceMeta) {
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        {metaError ?? 'This resource cannot be rescheduled here.'}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold text-slate-800">Resource</p>
        <p className="mt-0.5 text-sm text-slate-700">{resourceMeta.name}</p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <p className="mb-2 text-xs font-semibold text-slate-800">Date</p>
        <ResourceCalendarMonth
          year={calendarMonth.year}
          month={calendarMonth.month}
          availableDates={availableDates}
          selectedDate={bookingDate || null}
          onSelectDate={(ymd) => onBookingDateChange(ymd)}
          onPrevMonth={goPrevMonth}
          onNextMonth={goNextMonth}
          minSelectableDate={minSelectableDate}
          loading={loadingCalendar}
          accentPublic={false}
          weekOffsetShortcuts
        />
      </div>

      {bookingDate ? (
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="mb-2 text-xs font-semibold text-slate-800">Duration</p>
          <div className={APPOINTMENT_TIME_SLOTS_GRID_CLASS}>
            {durationOptions.map((mins) => (
              <button
                key={mins}
                type="button"
                disabled={disabled}
                onClick={() => onDurationChange(mins)}
                aria-pressed={durationMinutes === mins}
                className={appointmentTimeSlotClass(durationMinutes === mins, false)}
              >
                <span className={APPOINTMENT_TIME_SLOT_LABEL_CLASS}>{formatDurationSlotLabel(mins)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {bookingDate && durationMinutes > 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="mb-2 text-xs font-semibold text-slate-800">Start time</p>
          {loadingSlots ? (
            <div className="space-y-2" role="status" aria-label="Loading times">
              <Skeleton.Block className="h-12" />
              <Skeleton.Block className="h-12 w-2/3" />
            </div>
          ) : slotsError ? (
            <p className="text-sm text-red-700">{slotsError}</p>
          ) : availableSlots.length === 0 ? (
            <p className="text-sm text-slate-600">No times available for this date and duration.</p>
          ) : (
            renderTimeSlots()
          )}
        </div>
      ) : null}

      {renderSelectionSummary()}
    </div>
  );
}
