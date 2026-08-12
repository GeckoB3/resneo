'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StaffExpandedBookingModifySource } from '@/components/booking/StaffExpandedBookingModifyModal';
import { StaffAppointmentModifyDateTimePicker } from '@/components/booking/StaffAppointmentModifyDateTimePicker';
import {
  BookingModifyNotifyFollowUp,
  type BookingScheduleChangeSummary,
} from '@/components/booking/BookingModifyNotifyFollowUp';
import { minutesToTime, timeToMinutes } from '@/lib/availability';
import {
  MAX_APPOINTMENT_CORE_DURATION_MINUTES,
  MIN_APPOINTMENT_CORE_DURATION_MINUTES,
} from '@/lib/booking/validate-appointment-modification';
import { resolveBookingCoreDurationMinutes } from '@/lib/booking/booking-core-duration';
import {
  effectiveProcessingBlocksForTemplate,
  fitProcessingBlocksToDuration,
  parseProcessingTimeBlocksFromDb,
} from '@/lib/appointments/processing-time';
import type { ProcessingTimeBlock } from '@/types/booking-models';

interface ServiceVariantRow {
  id: string;
  name: string;
  is_active: boolean;
  duration_minutes: number;
  /** Raw catalogue JSON; parsed before use. */
  processing_time_blocks?: unknown;
}

interface ServiceRow {
  id: string;
  name: string;
  duration_minutes: number;
  /** Raw catalogue JSON; parsed before use. */
  processing_time_blocks?: unknown;
  variants?: ServiceVariantRow[];
}

/** "15 to 45 minutes" / "15 to 45 and 60 to 75 minutes" */
function describeProcessingGaps(blocks: ProcessingTimeBlock[]): string {
  const ranges = blocks.map((b) => `${b.start_minute} to ${b.start_minute + b.duration_minutes}`);
  const joined =
    ranges.length <= 1
      ? (ranges[0] ?? '')
      : `${ranges.slice(0, -1).join(', ')} and ${ranges[ranges.length - 1]}`;
  return `${joined} minutes`;
}

/**
 * What saving will do to the processing time, in words. Null when nothing about
 * it changes, so the form stays quiet on an ordinary time move.
 */
function describeProcessingChange(params: {
  removed: number;
  trimmed: number;
  serviceChanged: boolean;
}): string | null {
  const { removed, trimmed, serviceChanged } = params;
  const sentences: string[] = [];
  if (serviceChanged) {
    sentences.push('Changing the service swaps in that service’s processing pattern.');
  }
  if (removed > 0 && trimmed > 0) {
    sentences.push(
      'This duration cannot hold all of it, so saving will shorten one gap and drop the rest.',
    );
  } else if (removed > 0) {
    sentences.push(
      removed === 1
        ? 'This duration is too short for the processing gap, so saving will remove it.'
        : 'This duration is too short for the processing gaps, so saving will remove them.',
    );
  } else if (trimmed > 0) {
    sentences.push(
      trimmed === 1
        ? 'Saving will shorten the processing gap so it ends with the appointment.'
        : 'Saving will shorten the processing gaps so they end with the appointment.',
    );
  }
  return sentences.length > 0 ? sentences.join(' ') : null;
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

function buildPatchPayload(params: {
  bookingDate: string;
  bookingTime: string;
  practitionerId: string;
  serviceId: string;
  usesServiceItem: boolean;
  durationMinutes: number;
  serviceVariantId: string | null;
  requiresVariant: boolean;
  /**
   * Already fitted to `durationMinutes` by the caller. Sent on every save so the
   * row stops carrying blocks snapshotted against a duration, service or variant
   * it no longer has. Null when the caller could not resolve them, which omits
   * the key so the server keeps the row's snapshot rather than clearing it.
   */
  processingTimeBlocks: ProcessingTimeBlock[] | null;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    booking_date: params.bookingDate,
    booking_time: params.bookingTime.length === 5 ? `${params.bookingTime}:00` : params.bookingTime,
    practitioner_id: params.practitionerId,
    duration_minutes: params.durationMinutes,
  };
  if (params.processingTimeBlocks) {
    body.processing_time_blocks = params.processingTimeBlocks;
  }
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

function ownerVenueCatalogQuery(ownerVenueId: string | undefined): string {
  if (!ownerVenueId) return '';
  return `?owner_venue_id=${encodeURIComponent(ownerVenueId)}`;
}

export function StaffAppointmentModifyForm({
  bookingId,
  booking,
  ownerVenueId,
  catalogOwnerVenueId,
  onSaved,
  onClose,
}: {
  bookingId: string;
  booking: StaffExpandedBookingModifySource;
  /** Owner venue for availability calendar (always the booking's venue). */
  ownerVenueId: string;
  /** When modifying a linked-venue booking, load services/practitioners from the owner venue. */
  catalogOwnerVenueId?: string;
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
  /**
   * null until resolved: the booking's own duration when its row carries an end
   * time, otherwise the service's catalogue duration adopted once the catalogue
   * loads (see the effect below). Never a hardcoded default, which used to
   * shrink appointments whose row reached this form without an end time.
   */
  const [durationMinutes, setDurationMinutes] = useState<number | null>(() =>
    resolveBookingCoreDurationMinutes(booking),
  );
  /**
   * What the form OPENED with. Tracks an adopted catalogue duration so
   * adopting one is not mistaken for a staff edit (which would enable Save on
   * a form nobody has touched).
   */
  const [baselineDuration, setBaselineDuration] = useState<number | null>(() =>
    resolveBookingCoreDurationMinutes(booking),
  );
  const [variantId, setVariantId] = useState<string | null>(booking.service_variant_id ?? null);

  const [validationState, setValidationState] = useState<'idle' | 'loading' | 'valid' | 'invalid'>('idle');
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /**
   * Set after a save that moved the appointment start (plan: calendar-parity
   * notify / skip / undo). The guest notification was DEFERRED on that save;
   * this panel replaces the form and decides its fate.
   */
  const [notifyFollowUp, setNotifyFollowUp] = useState<BookingScheduleChangeSummary | null>(null);
  /** True while the follow-up is on screen and the caller has not been refreshed yet. */
  const pendingFollowUpRef = useRef(false);
  const onSavedRef = useRef(onSaved);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedService = useMemo(
    () => services.find((s) => s.id === serviceId) ?? null,
    [services, serviceId],
  );

  const requiresVariant = useMemo(() => {
    const v = selectedService?.variants ?? [];
    return v.some((x) => x.is_active);
  }, [selectedService]);

  const activeVariant = useMemo(
    () => (selectedService?.variants ?? []).find((v) => v.is_active && v.id === variantId) ?? null,
    [selectedService, variantId],
  );

  /**
   * `undefined` means the caller never loaded the column, which is not the same
   * as "this booking has none". Every current caller passes it (`?? null`), but
   * guessing `[]` for one that forgot would clear real processing time on save.
   */
  const bookingBlocksKnown = booking.processing_time_blocks !== undefined;

  /** This booking's own blocks, snapshotted from the catalogue when it was made. */
  const bookingProcessingBlocks = useMemo(
    () => parseProcessingTimeBlocksFromDb(booking.processing_time_blocks),
    [booking.processing_time_blocks],
  );

  const processingServiceChanged =
    serviceId !== initialServiceId || (variantId ?? null) !== (booking.service_variant_id ?? null);

  /**
   * Which pattern this booking should carry: its own snapshot while it stays on
   * the same service and variant, otherwise the newly chosen one's template. A
   * snapshot belongs to the service it was taken from, so keeping it across a
   * service change would leave the old service's gap on the booking.
   */
  const sourceProcessingBlocks = useMemo(() => {
    if (!processingServiceChanged) return bookingProcessingBlocks;
    if (!selectedService) return [];
    return effectiveProcessingBlocksForTemplate({
      parentBlocks: parseProcessingTimeBlocksFromDb(selectedService.processing_time_blocks),
      variantBlocks: activeVariant
        ? parseProcessingTimeBlocksFromDb(activeVariant.processing_time_blocks)
        : null,
    });
  }, [processingServiceChanged, bookingProcessingBlocks, selectedService, activeVariant]);

  /**
   * The blocks this form will actually send, clamped to the chosen duration.
   * Without this the server rejects any shortening below the last block's end
   * ("Processing blocks must lie within the service duration"), which staff had
   * no way to resolve from this form.
   */
  const processingFit = useMemo(
    () => fitProcessingBlocksToDuration(sourceProcessingBlocks, durationMinutes ?? 0),
    [sourceProcessingBlocks, durationMinutes],
  );

  /** What to send, or null to leave the row's snapshot alone. */
  const processingBlocksToSend = bookingBlocksKnown || processingServiceChanged ? processingFit.blocks : null;

  const processingNotice = useMemo(() => {
    // Still resolving the duration: every block would look unfittable.
    if (durationMinutes == null) return null;
    // Switched to a service that has no processing time at all, so there is
    // nothing left to trim or describe. Say so rather than dropping it quietly.
    if (
      processingServiceChanged &&
      bookingProcessingBlocks.length > 0 &&
      sourceProcessingBlocks.length === 0
    ) {
      return 'The service you picked has no processing time, so saving will remove this booking’s gap.';
    }
    return describeProcessingChange({
      removed: processingFit.removed.length,
      trimmed: processingFit.trimmed.length,
      serviceChanged: processingServiceChanged && sourceProcessingBlocks.length > 0,
    });
  }, [
    durationMinutes,
    processingFit,
    processingServiceChanged,
    bookingProcessingBlocks,
    sourceProcessingBlocks,
  ]);

  /** Only worth a panel when this booking has, or is losing, a processing gap. */
  const showProcessingPanel =
    durationMinutes != null &&
    (sourceProcessingBlocks.length > 0 ||
      (processingServiceChanged && bookingProcessingBlocks.length > 0));

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
        duration: baselineDuration,
        variant: booking.service_variant_id ?? null,
      }),
    [booking, initialPractitionerId, initialServiceId, baselineDuration],
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
    const ownerQ = ownerVenueCatalogQuery(catalogOwnerVenueId);
    const prParams = new URLSearchParams({ roster: '1', active_only: '1' });
    if (catalogOwnerVenueId) {
      prParams.set('owner_venue_id', catalogOwnerVenueId);
    }
    void (async () => {
      try {
        const [svcRes, prRes] = await Promise.all([
          fetch(`/api/venue/appointment-services${ownerQ}`),
          fetch(`/api/venue/practitioners?${prParams}`),
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
  }, [catalogOwnerVenueId]);

  useEffect(() => {
    if (services.length === 0) return;
    if (!services.some((s) => s.id === serviceId)) {
      setServiceWarning("This booking's service is no longer in the catalogue.");
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

  useEffect(() => {
    onSavedRef.current = onSaved;
  }, [onSaved]);

  useEffect(() => {
    pendingFollowUpRef.current = notifyFollowUp != null;
  }, [notifyFollowUp]);

  // Modal dismissed (X / Escape) while the follow-up was still on screen: the
  // change IS saved, so refresh the caller or the list keeps showing the old
  // time. The panel's own cleanup still sends the guest notification.
  useEffect(
    () => () => {
      if (pendingFollowUpRef.current) onSavedRef.current();
    },
    [],
  );

  /**
   * The booking row carried no end time, so adopt the catalogue duration (the
   * chosen variant's when there is one) as BOTH the value and the baseline:
   * it is what this appointment is scheduled for, not an edit staff made.
   */
  useEffect(() => {
    if (durationMinutes != null || !selectedService) return;
    const activeVariant = (selectedService.variants ?? []).find(
      (v) => v.is_active && v.id === variantId,
    );
    const adopted = activeVariant?.duration_minutes ?? selectedService.duration_minutes;
    if (!Number.isFinite(adopted) || adopted < MIN_APPOINTMENT_CORE_DURATION_MINUTES) return;
    setDurationMinutes(adopted);
    setBaselineDuration(adopted);
  }, [durationMinutes, selectedService, variantId]);

  const runValidate = useCallback(async () => {
    if (!practitionerId || !serviceId) {
      setValidationState('invalid');
      setValidationMessage('Select a service and staff calendar.');
      return;
    }
    if (!bookingTime) {
      setValidationState('invalid');
      setValidationMessage('Select a time.');
      return;
    }
    if (requiresVariant && !variantId) {
      setValidationState('invalid');
      setValidationMessage('Select a service variant.');
      return;
    }
    // Duration not resolved yet (catalogue still loading): stay idle rather
    // than validate a guess. The effect below re-runs once it lands.
    if (durationMinutes == null) return;
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
          // The same fitted blocks the save will send, so this dry run judges
          // exactly what the PATCH will persist.
          ...(processingBlocksToSend ? { processing_time_blocks: processingBlocksToSend } : {}),
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
    processingBlocksToSend,
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
  }, [catalogError, practitionerId, serviceId, bookingDate, bookingTime, durationMinutes, variantId, runValidate, serviceWarning]);

  const endPreview = useMemo(() => {
    if (durationMinutes == null) return null;
    const start = bookingTime.slice(0, 5);
    return minutesToTime(timeToMinutes(start) + durationMinutes);
  }, [bookingTime, durationMinutes]);

  const quickDurations = useMemo(() => {
    const set = new Set<number>();
    if (durationMinutes != null) set.add(durationMinutes);
    if (selectedService) set.add(selectedService.duration_minutes);
    if (baselineDuration != null) set.add(baselineDuration);
    // Short presets first so a 5 or 10 minute appointment is a click, not typing.
    for (const m of [5, 10]) set.add(m);
    for (let m = 15; m <= Math.min(180, MAX_APPOINTMENT_CORE_DURATION_MINUTES); m += 15) {
      set.add(m);
    }
    return Array.from(set)
      .filter(
        (m) =>
          m >= MIN_APPOINTMENT_CORE_DURATION_MINUTES &&
          m <= MAX_APPOINTMENT_CORE_DURATION_MINUTES,
      )
      .sort((a, b) => a - b);
  }, [baselineDuration, durationMinutes, selectedService]);

  const saveDisabled =
    saving ||
    !hasChanges ||
    Boolean(serviceWarning) ||
    durationMinutes == null ||
    !bookingTime ||
    validationState === 'loading' ||
    validationState === 'invalid' ||
    validationState === 'idle' ||
    !practitionerId ||
    !serviceId ||
    (requiresVariant && !variantId);

  const baselineTime = booking.booking_time.slice(0, 5);
  const scheduleChanged = bookingDate !== booking.booking_date || bookingTime !== baselineTime;

  const handleSave = async () => {
    if (durationMinutes == null) return;
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
        processingTimeBlocks: processingBlocksToSend,
      });
      // Start moved: defer the guest notification so the follow-up panel can
      // offer notify / skip / undo, exactly like the calendar drag (the server
      // would otherwise send it immediately in the background).
      if (scheduleChanged) {
        payload.defer_modification_guest_notification = true;
      }
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
      if (scheduleChanged) {
        // Deliberately NOT onSaved() here: every caller closes the modal in
        // that callback, which would tear this form down before the follow-up
        // renders. finishFollowUp() calls it once the staff member has chosen
        // notify / skip / undo.
        setNotifyFollowUp({
          fromDate: booking.booking_date,
          fromTime: baselineTime,
          toDate: bookingDate,
          toTime: bookingTime,
        });
        return;
      }
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  /** Follow-up Undo: restore the original schedule, sending no notification. */
  const undoScheduleChange = useCallback(async (): Promise<boolean> => {
    // The duration the form opened with (the booking's own, or the catalogue
    // duration adopted for a row that carried no end time).
    const revertDuration = baselineDuration;
    if (revertDuration == null) return false;
    try {
      const payload = buildPatchPayload({
        bookingDate: booking.booking_date,
        bookingTime: baselineTime,
        practitionerId: initialPractitionerId,
        serviceId: initialServiceId,
        usesServiceItem,
        durationMinutes: revertDuration,
        serviceVariantId: booking.service_variant_id ?? null,
        requiresVariant: Boolean(booking.service_variant_id),
        // Undo restores the row's own snapshot, not whatever the save fitted.
        processingTimeBlocks: bookingBlocksKnown ? bookingProcessingBlocks : null,
      });
      payload.skip_booking_modification_guest_notification = true;
      const res = await fetch(`/api/venue/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) return false;
      // The caller is refreshed by finishFollowUp, which the panel calls right
      // after a successful undo (calling onSaved here would close the modal
      // first and double-refresh).
      return true;
    } catch {
      return false;
    }
  }, [
    booking,
    bookingId,
    bookingBlocksKnown,
    bookingProcessingBlocks,
    baselineTime,
    baselineDuration,
    initialPractitionerId,
    initialServiceId,
    usesServiceItem,
  ]);

  /**
   * The staff member finished with the follow-up (notified, skipped, or
   * undone). onSaved refreshes the caller and, in every caller, closes the
   * modal; onClose covers any caller whose onSaved does not.
   */
  const finishFollowUp = useCallback(() => {
    pendingFollowUpRef.current = false;
    onSaved();
    onClose();
  }, [onSaved, onClose]);

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

  // Also waits for the duration to resolve: a row with no end time adopts the
  // catalogue duration in an effect above, so every field below has a number.
  // Not when the service is missing from the catalogue though: nothing will
  // ever resolve it, and that case must reach the warning below rather than
  // spin forever.
  if (services.length === 0 || (durationMinutes == null && !serviceWarning)) {
    return (
      <div className="flex items-center justify-center py-10">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  if (notifyFollowUp) {
    return (
      <BookingModifyNotifyFollowUp
        bookingId={bookingId}
        change={notifyFollowUp}
        onUndo={undoScheduleChange}
        onClose={finishFollowUp}
      />
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

      {validationState === 'invalid' && validationMessage && !bookingTime ? (
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

      <StaffAppointmentModifyDateTimePicker
        ownerVenueId={ownerVenueId}
        linkedOwnerVenueId={catalogOwnerVenueId}
        bookingId={bookingId}
        initialBookingDate={booking.booking_date}
        initialBookingTime={booking.booking_time.slice(0, 5)}
        practitionerId={practitionerId}
        serviceId={serviceId}
        variantId={requiresVariant ? variantId : null}
        durationMinutes={durationMinutes}
        bookingDate={bookingDate}
        bookingTime={bookingTime}
        onBookingDateChange={setBookingDate}
        onBookingTimeChange={setBookingTime}
        validationState={validationState}
        validationMessage={validationMessage}
        disabled={Boolean(catalogError) || Boolean(serviceWarning) || !practitionerId || !serviceId}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-semibold text-slate-700 sm:col-span-2">
          Duration (minutes)
          <input
            type="number"
            min={MIN_APPOINTMENT_CORE_DURATION_MINUTES}
            max={MAX_APPOINTMENT_CORE_DURATION_MINUTES}
            step={5}
            value={durationMinutes ?? ''}
            onChange={(e) => setDurationMinutes(Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </label>
      </div>

      {showProcessingPanel ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-xs font-semibold text-slate-700">Processing time</p>
          <p className="mt-1 text-xs text-slate-600">
            {processingFit.blocks.length > 0 ? (
              <>
                The calendar stays free for another client{' '}
                <span className="font-semibold text-slate-800">
                  {describeProcessingGaps(processingFit.blocks)}
                </span>{' '}
                after this appointment starts.
              </>
            ) : (
              'This appointment will have no processing gap, so the calendar stays busy all the way through.'
            )}
          </p>
          {processingNotice ? (
            <p className="mt-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900">
              {processingNotice}
            </p>
          ) : null}
        </div>
      ) : null}

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

      {endPreview ? (
        <p className="text-xs text-slate-600">
          Ends at <span className="font-semibold text-slate-800">{endPreview}</span> (same day)
        </p>
      ) : null}

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
