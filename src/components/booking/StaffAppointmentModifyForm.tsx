'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StaffExpandedBookingModifySource } from '@/components/booking/StaffExpandedBookingModifyModal';
import { minutesToTime, timeToMinutes } from '@/lib/availability';
import {
  MAX_APPOINTMENT_CORE_DURATION_MINUTES,
  minutesBetweenStartAndEndHM,
} from '@/lib/booking/validate-appointment-modification';

interface ServiceRow {
  id: string;
  name: string;
  duration_minutes: number;
  variants?: Array<{ id: string; name: string; is_active: boolean; duration_minutes: number }>;
}

interface PractitionerLink {
  practitioner_id: string;
  service_id: string;
}

interface PractitionerRow {
  id: string;
  name: string;
  is_active?: boolean;
}

function initialCoreDurationMinutes(booking: StaffExpandedBookingModifySource): number {
  const start = booking.booking_time.slice(0, 5);
  if (booking.booking_end_time && booking.booking_end_time.length >= 5) {
    return Math.max(15, minutesBetweenStartAndEndHM(start, booking.booking_end_time.slice(0, 5)));
  }
  if (booking.estimated_end_time) {
    const iso = booking.estimated_end_time.trim();
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) {
      const hm = d.toISOString().slice(11, 16);
      return Math.max(15, minutesBetweenStartAndEndHM(start, hm));
    }
  }
  return 30;
}

function buildPatchPayload(params: {
  bookingDate: string;
  bookingTime: string;
  practitionerId: string;
  serviceId: string;
  usesServiceItem: boolean;
  durationMinutes: number;
  serviceVariantId: string | null;
  requiresVariant: boolean;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    booking_date: params.bookingDate,
    booking_time: params.bookingTime.length === 5 ? `${params.bookingTime}:00` : params.bookingTime,
    practitioner_id: params.practitionerId,
    duration_minutes: params.durationMinutes,
  };
  if (params.usesServiceItem) {
    body.service_item_id = params.serviceId;
  } else {
    body.appointment_service_id = params.serviceId;
  }
  if (params.requiresVariant && params.serviceVariantId) {
    body.service_variant_id = params.serviceVariantId;
  }
  return body;
}

export function StaffAppointmentModifyForm({
  bookingId,
  booking,
  onSaved,
  onClose,
}: {
  bookingId: string;
  booking: StaffExpandedBookingModifySource;
  onSaved: () => void;
  onClose: () => void;
}) {
  const usesServiceItem = Boolean(booking.service_item_id);
  const initialPractitionerId = (booking.calendar_id ?? booking.practitioner_id) as string;
  const initialServiceId = (booking.appointment_service_id ?? booking.service_item_id) as string;

  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [serviceWarning, setServiceWarning] = useState<string | null>(null);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [links, setLinks] = useState<PractitionerLink[]>([]);
  const [practitioners, setPractitioners] = useState<PractitionerRow[]>([]);

  const [practitionerId, setPractitionerId] = useState(initialPractitionerId);
  const [serviceId, setServiceId] = useState(initialServiceId);
  const [bookingDate, setBookingDate] = useState(booking.booking_date);
  const [bookingTime, setBookingTime] = useState(booking.booking_time.slice(0, 5));
  const [durationMinutes, setDurationMinutes] = useState(() => initialCoreDurationMinutes(booking));
  const [variantId, setVariantId] = useState<string | null>(booking.service_variant_id ?? null);

  const [validationState, setValidationState] = useState<'idle' | 'loading' | 'valid' | 'invalid'>('idle');
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedService = useMemo(
    () => services.find((s) => s.id === serviceId) ?? null,
    [services, serviceId],
  );

  const requiresVariant = useMemo(() => {
    const v = selectedService?.variants ?? [];
    return v.some((x) => x.is_active);
  }, [selectedService]);

  const practitionerOptions = useMemo(() => {
    const svcLinks = new Set(
      links.filter((l) => l.service_id === serviceId).map((l) => l.practitioner_id),
    );
    return practitioners.filter((p) => p.is_active !== false && svcLinks.has(p.id));
  }, [links, practitioners, serviceId]);

  const baselineKey = useMemo(
    () =>
      JSON.stringify({
        practitionerId: initialPractitionerId,
        serviceId: initialServiceId,
        bookingDate: booking.booking_date,
        bookingTime: booking.booking_time.slice(0, 5),
        duration: initialCoreDurationMinutes(booking),
        variant: booking.service_variant_id ?? null,
      }),
    [booking, initialPractitionerId, initialServiceId],
  );

  const currentKey = useMemo(
    () =>
      JSON.stringify({
        practitionerId,
        serviceId,
        bookingDate,
        bookingTime,
        durationMinutes,
        variant: variantId,
      }),
    [practitionerId, serviceId, bookingDate, bookingTime, durationMinutes, variantId],
  );

  const hasChanges = currentKey !== baselineKey;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [svcRes, prRes] = await Promise.all([
          fetch('/api/venue/appointment-services'),
          fetch('/api/venue/practitioners?roster=1&active_only=1'),
        ]);
        const svcJson = (await svcRes.json().catch(() => ({}))) as {
          services?: ServiceRow[];
          practitioner_services?: PractitionerLink[];
          error?: string;
        };
        const prJson = (await prRes.json().catch(() => ({}))) as {
          practitioners?: PractitionerRow[];
          error?: string;
        };
        if (!svcRes.ok) {
          setCatalogError(svcJson.error ?? 'Could not load services');
          return;
        }
        if (!prRes.ok) {
          setCatalogError(prJson.error ?? 'Could not load calendars');
          return;
        }
        if (cancelled) return;
        setServices(svcJson.services ?? []);
        setLinks(svcJson.practitioner_services ?? []);
        setPractitioners(prJson.practitioners ?? []);
        setCatalogError(null);
      } catch {
        if (!cancelled) setCatalogError('Could not load appointment catalog');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (services.length === 0) return;
    if (!services.some((s) => s.id === serviceId)) {
      setServiceWarning("This booking's service is no longer in your catalogue.");
    } else {
      setServiceWarning(null);
    }
  }, [services, serviceId]);

  useEffect(() => {
    if (!selectedService) return;
    if (!requiresVariant) {
      if (variantId !== null) setVariantId(null);
      return;
    }
    const active = (selectedService.variants ?? []).filter((v) => v.is_active);
    if (active.length === 0) return;
    const stillValid = active.some((v) => v.id === variantId);
    if (!stillValid) {
      setVariantId(active[0]!.id);
    }
  }, [selectedService, requiresVariant, variantId]);

  useEffect(() => {
    if (practitionerOptions.length === 0) return;
    if (!practitionerOptions.some((p) => p.id === practitionerId)) {
      setPractitionerId(practitionerOptions[0]!.id);
    }
  }, [practitionerOptions, practitionerId]);

  const runValidate = useCallback(async () => {
    if (!practitionerId || !serviceId) {
      setValidationState('invalid');
      setValidationMessage('Select a service and staff calendar.');
      return;
    }
    if (requiresVariant && !variantId) {
      setValidationState('invalid');
      setValidationMessage('Select a service variant.');
      return;
    }
    setValidationState('loading');
    setValidationMessage(null);
    try {
      const res = await fetch(`/api/venue/bookings/${bookingId}/validate-appointment-modification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          booking_date: bookingDate,
          booking_time: bookingTime,
          practitioner_id: practitionerId,
          ...(usesServiceItem ? { service_item_id: serviceId } : { appointment_service_id: serviceId }),
          duration_minutes: durationMinutes,
          service_variant_id: requiresVariant ? variantId : null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setValidationState('invalid');
        setValidationMessage(data.error ?? 'This slot is not valid.');
        return;
      }
      setValidationState('valid');
    } catch (e) {
      console.error('Staff appointment validate failed:', e);
      setValidationState('invalid');
      setValidationMessage('Could not validate availability.');
    }
  }, [
    bookingDate,
    bookingId,
    bookingTime,
    durationMinutes,
    practitionerId,
    requiresVariant,
    serviceId,
    usesServiceItem,
    variantId,
  ]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!practitionerId || !serviceId || catalogError || serviceWarning) return;
    debounceRef.current = setTimeout(() => {
      void runValidate();
    }, 450);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [catalogError, practitionerId, serviceId, bookingDate, bookingTime, durationMinutes, variantId, runValidate]);

  const endPreview = useMemo(() => {
    const start = bookingTime.slice(0, 5);
    return minutesToTime(timeToMinutes(start) + durationMinutes);
  }, [bookingTime, durationMinutes]);

  const quickDurations = useMemo(() => {
    const set = new Set<number>();
    set.add(durationMinutes);
    if (selectedService) set.add(selectedService.duration_minutes);
    set.add(initialCoreDurationMinutes(booking));
    for (let m = 15; m <= Math.min(180, MAX_APPOINTMENT_CORE_DURATION_MINUTES); m += 15) {
      set.add(m);
    }
    return Array.from(set)
      .filter((m) => m >= 15 && m <= MAX_APPOINTMENT_CORE_DURATION_MINUTES)
      .sort((a, b) => a - b);
  }, [booking, durationMinutes, selectedService]);

  const saveDisabled =
    saving ||
    !hasChanges ||
    Boolean(serviceWarning) ||
    validationState === 'loading' ||
    validationState === 'invalid' ||
    validationState === 'idle' ||
    !practitionerId ||
    !serviceId ||
    (requiresVariant && !variantId);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const payload = buildPatchPayload({
        bookingDate,
        bookingTime,
        practitionerId,
        serviceId,
        usesServiceItem,
        durationMinutes,
        serviceVariantId: variantId,
        requiresVariant,
      });
      const res = await fetch(`/api/venue/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      if (res.status === 412) {
        setSaveError(data.error ?? 'Booking was modified elsewhere. Refresh and try again.');
        return;
      }
      if (res.status === 409) {
        setSaveError(data.error ?? 'This time is no longer available.');
        void runValidate();
        return;
      }
      if (!res.ok) {
        setSaveError(data.error ?? 'Could not save changes.');
        return;
      }
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  if (catalogError) {
    return (
      <div className="space-y-3">
        <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">{catalogError}</p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Close
        </button>
      </div>
    );
  }

  if (services.length === 0 && !catalogError) {
    return (
      <div className="flex items-center justify-center py-10">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {saveError ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
          {saveError}
        </p>
      ) : null}

      {serviceWarning ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{serviceWarning}</p>
      ) : null}

      {validationState === 'loading' ? (
        <p className="text-xs text-slate-500">Checking availability…</p>
      ) : validationState === 'valid' && hasChanges ? (
        <p className="text-xs font-medium text-emerald-700">Available for this staff and time.</p>
      ) : validationState === 'invalid' && validationMessage ? (
        <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-800">{validationMessage}</p>
      ) : !hasChanges ? (
        <p className="text-xs text-slate-500">Adjust a field to check availability and enable save.</p>
      ) : null}

      <label className="block text-xs font-semibold text-slate-700">
        Service
        <select
          value={serviceId}
          onChange={(e) => {
            const next = e.target.value;
            setServiceId(next);
            const svc = services.find((s) => s.id === next);
            if (svc) setDurationMinutes(svc.duration_minutes);
          }}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        >
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      {requiresVariant && selectedService ? (
        <label className="block text-xs font-semibold text-slate-700">
          Variant
          <select
            value={variantId ?? ''}
            onChange={(e) => setVariantId(e.target.value || null)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="" disabled>
              Select variant
            </option>
            {(selectedService.variants ?? [])
              .filter((v) => v.is_active)
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.duration_minutes} min)
                </option>
              ))}
          </select>
        </label>
      ) : null}

      <label className="block text-xs font-semibold text-slate-700">
        Staff / calendar
        <select
          value={practitionerId}
          onChange={(e) => setPractitionerId(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        >
          {practitionerOptions.length === 0 ? (
            <option value="">No staff offers this service</option>
          ) : (
            practitionerOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))
          )}
        </select>
      </label>

      <label className="block text-xs font-semibold text-slate-700">
        Date
        <input
          type="date"
          value={bookingDate}
          onChange={(e) => setBookingDate(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-semibold text-slate-700">
          Start time
          <input
            type="time"
            value={bookingTime}
            onChange={(e) => setBookingTime(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-xs font-semibold text-slate-700">
          Duration (minutes)
          <input
            type="number"
            min={15}
            max={MAX_APPOINTMENT_CORE_DURATION_MINUTES}
            step={5}
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </label>
      </div>

      <div>
        <p className="text-xs font-semibold text-slate-700">Quick durations</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {quickDurations.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setDurationMinutes(m)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                m === durationMinutes
                  ? 'bg-brand-600 text-white'
                  : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {m}m
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-slate-600">
        Ends at <span className="font-semibold text-slate-800">{endPreview}</span> (same day)
      </p>

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          disabled={saveDisabled}
          onClick={() => void handleSave()}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
