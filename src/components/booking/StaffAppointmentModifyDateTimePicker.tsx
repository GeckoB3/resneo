'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ResourceCalendarMonth, todayYmdLocal } from '@/components/booking/ResourceCalendarMonth';
import {
  APPOINTMENT_TIME_SLOT_LABEL_CLASS,
  APPOINTMENT_TIME_SLOTS_GRID_CLASS,
  appointmentTimeSlotClass,
} from '@/components/booking/appointment-public-ui';
import { minutesToTime, timeToMinutes } from '@/lib/availability';
import {
  appointmentCalendarUrl,
  staffAppointmentAvailabilityUrl,
} from '@/lib/booking/booking-flow-api';

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

function formatDateHuman(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
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

function resolvePractitionerSlots(
  practitioners: Array<{ id: string; slots: Array<{ start_time: string; service_id?: string }> }> | undefined,
  practitionerId: string,
  serviceId: string,
): Array<{ start_time: string; service_id?: string }> {
  if (!practitioners?.length) return [];
  const direct = practitioners.find((p) => p.id === practitionerId);
  if (direct) {
    return direct.slots.filter((s) => !s.service_id || s.service_id === serviceId);
  }
  if (practitioners.length === 1) {
    return practitioners[0]!.slots.filter((s) => !s.service_id || s.service_id === serviceId);
  }
  return [];
}

export function StaffAppointmentModifyDateTimePicker({
  ownerVenueId,
  linkedOwnerVenueId,
  bookingId,
  initialBookingDate,
  initialBookingTime,
  practitionerId,
  serviceId,
  variantId,
  durationMinutes,
  bookingDate,
  bookingTime,
  onBookingDateChange,
  onBookingTimeChange,
  validationState = 'idle',
  validationMessage = null,
  disabled = false,
}: {
  ownerVenueId: string;
  linkedOwnerVenueId?: string;
  bookingId: string;
  /** Original booking date — kept selectable even when in the past. */
  initialBookingDate: string;
  /** Original booking start time (HH:mm). */
  initialBookingTime: string;
  practitionerId: string;
  serviceId: string;
  variantId: string | null;
  durationMinutes: number;
  bookingDate: string;
  bookingTime: string;
  onBookingDateChange: (ymd: string) => void;
  onBookingTimeChange: (hhmm: string) => void;
  validationState?: 'idle' | 'loading' | 'valid' | 'invalid';
  validationMessage?: string | null;
  disabled?: boolean;
}) {
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

  const selectedTimeKey = slotStartKey(bookingTime);
  const initialTimeKey = slotStartKey(initialBookingTime);
  const scheduleChanged =
    bookingDate !== initialBookingDate || selectedTimeKey !== initialTimeKey;
  const minSelectableDate = useMemo(
    () => minYmd(todayYmdLocal(), initialBookingDate),
    [initialBookingDate],
  );

  useEffect(() => {
    if (prevTimeRef.current === bookingTime) return;
    prevTimeRef.current = bookingTime;
    if (!bookingTime) return;
    setSelectionPulse(true);
    const timer = window.setTimeout(() => setSelectionPulse(false), 700);
    return () => window.clearTimeout(timer);
  }, [bookingTime]);

  useEffect(() => {
    const [y, m] = bookingDate.split('-').map(Number);
    if (!y || !m) return;
    setCalendarMonth((prev) => (prev.year === y && prev.month === m ? prev : { year: y, month: m }));
  }, [bookingDate]);

  const loadCalendarMonth = useCallback(async () => {
    if (!practitionerId || !serviceId || disabled) return;
    setLoadingCalendar(true);
    try {
      const url = appointmentCalendarUrl(
        'staff',
        ownerVenueId,
        practitionerId,
        serviceId,
        calendarMonth.year,
        calendarMonth.month,
        variantId,
        durationMinutes,
        false,
        linkedOwnerVenueId ?? null,
        bookingId,
      );
      const res = await fetch(url);
      const data = (await res.json()) as { available_dates?: string[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Failed to load calendar');
      const next = new Set(data.available_dates ?? []);
      const monthPrefix = `${calendarMonth.year}-${String(calendarMonth.month).padStart(2, '0')}`;
      if (bookingDate.startsWith(monthPrefix)) {
        next.add(bookingDate);
      }
      if (initialBookingDate.startsWith(monthPrefix)) {
        next.add(initialBookingDate);
      }
      setAvailableDates(next);
    } catch (e) {
      console.error('Staff modify calendar month failed:', e);
      const fallback = new Set<string>();
      if (bookingDate) fallback.add(bookingDate);
      if (initialBookingDate) fallback.add(initialBookingDate);
      setAvailableDates(fallback);
    } finally {
      setLoadingCalendar(false);
    }
  }, [
    bookingDate,
    bookingId,
    calendarMonth.month,
    calendarMonth.year,
    disabled,
    durationMinutes,
    initialBookingDate,
    linkedOwnerVenueId,
    ownerVenueId,
    practitionerId,
    serviceId,
    variantId,
  ]);

  useEffect(() => {
    void loadCalendarMonth();
  }, [loadCalendarMonth]);

  const loadDaySlots = useCallback(async () => {
    if (!practitionerId || !serviceId || !bookingDate || disabled) {
      setAvailableSlots([]);
      return;
    }
    setLoadingSlots(true);
    setSlotsError(null);
    try {
      const params = new URLSearchParams({
        date: bookingDate,
        service_id: serviceId,
        practitioner_id: practitionerId,
        duration_minutes: String(durationMinutes),
        exclude_booking_id: bookingId,
      });
      if (variantId) params.set('variant_id', variantId);
      const res = await fetch(staffAppointmentAvailabilityUrl(params, linkedOwnerVenueId ?? null));
      const data = (await res.json()) as {
        practitioners?: Array<{ id: string; slots: Array<{ start_time: string; service_id?: string }> }>;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? 'Failed to load times');
      const raw = resolvePractitionerSlots(data.practitioners, practitionerId, serviceId);
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
      console.error('Staff modify day slots failed:', e);
      setSlotsError('Could not load available times.');
      setAvailableSlots(
        selectedTimeKey ? [{ start_time: `${selectedTimeKey}:00` }] : [],
      );
    } finally {
      setLoadingSlots(false);
    }
  }, [
    bookingDate,
    bookingId,
    disabled,
    durationMinutes,
    linkedOwnerVenueId,
    practitionerId,
    selectedTimeKey,
    serviceId,
    variantId,
  ]);

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
                      aria-label={
                        selected
                          ? `${key}, selected`
                          : isOriginal
                            ? `${key}, current booking time`
                            : key
                      }
                      className={`relative ${appointmentTimeSlotClass(false, false)} transition-all duration-200 ${
                        selected
                          ? 'scale-[1.03] border-brand-600 bg-brand-600 text-white shadow-md ring-2 ring-brand-500/40'
                          : isOriginal
                            ? 'border-dashed border-slate-300 bg-slate-50 text-slate-600'
                            : 'hover:border-brand-300 hover:bg-brand-50/50'
                      }`}
                    >
                      {selected ? (
                        <span
                          className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-white text-brand-600 shadow-sm"
                          aria-hidden
                        >
                          <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                          </svg>
                        </span>
                      ) : null}
                      {isOriginal ? (
                        <span className="absolute -left-0.5 -top-2 rounded bg-slate-200 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-slate-600">
                          Was
                        </span>
                      ) : null}
                      <span className={APPOINTMENT_TIME_SLOT_LABEL_CLASS}>{key}</span>
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

  const renderSelectionSummary = () => {
    if (!selectedTimeKey) return null;

    const selectedLabel = `${formatDateLong(bookingDate)} · ${formatTimeRange(selectedTimeKey, durationMinutes)}`;
    const originalLabel = `${formatDateLong(initialBookingDate)} · ${formatTimeRange(initialTimeKey, durationMinutes)}`;

    return (
      <div
        aria-live="polite"
        className={`rounded-xl border px-3 py-2.5 transition-all duration-300 ${
          selectionPulse ? 'scale-[1.01] shadow-md' : 'shadow-sm'
        } ${
          scheduleChanged
            ? 'border-brand-200 bg-brand-50/80'
            : 'border-slate-200 bg-slate-50'
        }`}
      >
        {scheduleChanged ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-brand-800">New date &amp; time selected</p>
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

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-semibold text-slate-700">Date and time</p>
        <p className="mt-0.5 text-[11px] text-slate-500">
          Green days have at least one bookable time. Select a day to see times.
        </p>
      </div>
      <ResourceCalendarMonth
        year={calendarMonth.year}
        month={calendarMonth.month}
        availableDates={availableDates}
        selectedDate={bookingDate || null}
        onSelectDate={(ymd) => {
          if (ymd !== bookingDate) onBookingTimeChange('');
          onBookingDateChange(ymd);
        }}
        onPrevMonth={goPrevMonth}
        onNextMonth={goNextMonth}
        minSelectableDate={minSelectableDate}
        loading={loadingCalendar}
        weekOffsetShortcuts
      />
      {loadingSlots ? (
        <div className="h-32 animate-pulse rounded-xl bg-slate-100" aria-label="Loading times" />
      ) : slotsError ? (
        <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-800">{slotsError}</p>
      ) : availableSlots.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center">
          <p className="text-sm font-medium text-slate-600">
            No times available on {formatDateHuman(bookingDate)}
          </p>
          <p className="mt-1 text-xs text-slate-400">Try a different date above.</p>
        </div>
      ) : (
        <>
          {renderSelectionSummary()}
          {renderTimeSlots()}
        </>
      )}
    </div>
  );
}
