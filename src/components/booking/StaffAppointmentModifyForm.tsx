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

/** One service row of a multi-service visit, as the booking detail already has it. */
export interface StaffVisitModifySegment {
  id: string;
  booking_time: string;
  booking_end_time: string | null;
  booking_item_name: string | null;
  /**
   * C10 — optional deliberately. Statusless fixtures exist in the visit tests,
   * and an absent status is treated as scheduled so they keep passing; the one
   * real build site populates it.
   */
  status?: string | null;
}

/**
 * C10 — the server's own list, mirrored exactly
 * (`visits/[groupBookingId]/schedule/route.ts:38`). A segment outside it is not
 * part of the schedule the save will re-plan.
 */
const VISIT_SCHEDULED_STATUSES = ['Pending', 'Booked', 'Confirmed', 'Seated'];

function isScheduledVisitSegment(segment: StaffVisitModifySegment): boolean {
  return segment.status == null || VISIT_SCHEDULED_STATUSES.includes(segment.status);
}

/** What the visit endpoints say the save will do, per service. */
interface VisitPlannedService {
  /** null for a service being added, which has no row yet. */
  id: string | null;
  name: string | null;
  service_id?: string | null;
  service_variant_id?: string | null;
  booking_time: string;
  booking_end_time: string;
  duration_minutes: number;
}

/** One line of the visit as the staff member currently wants it. */
interface VisitServiceLine {
  /** Stable across edits, so a row keeps its React identity while being swapped. */
  key: string;
  /** The booking row this line stands on, or null for a service being added. */
  bookingId: string | null;
  serviceId: string;
  variantId: string | null;
}

interface VisitPlanResponse {
  ok?: boolean;
  error?: string;
  start_time?: string;
  end_time?: string;
  total_minutes?: number;
  changed?: boolean;
  services?: VisitPlannedService[];
}

function hm(raw: string): string {
  return raw.slice(0, 5);
}

/** Wall-clock span the rows currently occupy, first start to last end. */
function visitSpanMinutes(segments: StaffVisitModifySegment[]): number | null {
  const first = segments[0];
  const last = segments[segments.length - 1];
  if (!first || !last?.booking_end_time) return null;
  const span = timeToMinutes(hm(last.booking_end_time)) - timeToMinutes(hm(first.booking_time));
  return span > 0 ? span : span + 24 * 60;
}

export function StaffAppointmentModifyForm({
  bookingId,
  booking,
  ownerVenueId,
  catalogOwnerVenueId,
  visit,
  onSaved,
  onClose,
}: {
  bookingId: string;
  booking: StaffExpandedBookingModifySource;
  /** Owner venue for availability calendar (always the booking's venue). */
  ownerVenueId: string;
  /** When modifying a linked-venue booking, load services/practitioners from the owner venue. */
  catalogOwnerVenueId?: string;
  /**
   * The whole visit when this booking is one service of several. The form then
   * edits the VISIT: one start, one calendar and one wall-clock duration, written
   * through the visit endpoint so the services cannot come apart. Per-service
   * duration editing is what left a 15 minute hole in the reported booking, so it
   * is not offered here (see Docs/multi-service-visit-plan.md).
   */
  visit?: { groupBookingId: string; segments: StaffVisitModifySegment[] } | null;
  onSaved: () => void;
  onClose: () => void;
}) {
  const usesServiceItem = Boolean(booking.service_item_id);
  const initialPractitionerId = (booking.calendar_id ?? booking.practitioner_id) as string;
  const initialServiceId = (booking.appointment_service_id ?? booking.service_item_id) as string;

  /**
   * C10 — cancelled segments are filtered HERE, at the point of use, and
   * deliberately not at the fetch.
   *
   * `fetchGroupVisitBookings` sends only the group id, and the list route drops
   * cancelled rows only for `view=calendar`, so cancelled segments arrive in
   * `visit.segments`. The form then planned around them while the server
   * re-plans from its own scheduled-only list, and the two disagreed: pressing
   * Save on a form nobody had touched moved the whole visit, because the
   * cancelled row was still acting as the visit's anchor.
   *
   * Filtering `fetchGroupVisitBookings` instead would be wrong. The "Services in
   * this visit" card deliberately shows cancelled segments and re-fetches after
   * every cancel, so filtering at the fetch makes the segment staff just
   * cancelled vanish from the screen.
   *
   * It has to be the memo rather than the two obvious derivations, because
   * `notifyBookingId` and both duration baselines below read this same list —
   * and anchoring the guest's notification to a cancelled row is its own bug.
   *
   * One deliberate consequence: a visit reduced to a single scheduled segment
   * now has `isVisit === false` and opens in single-booking mode, which is the
   * honest description of what it has become.
   */
  const visitSegments = useMemo(
    () =>
      [...(visit?.segments ?? [])]
        .filter(isScheduledVisitSegment)
        .sort((a, b) => a.booking_time.localeCompare(b.booking_time)),
    [visit],
  );
  const isVisit = visitSegments.length > 1 && Boolean(visit?.groupBookingId);
  /** A visit's schedule belongs to its FIRST service, whichever segment was clicked. */
  const visitStartTime = isVisit ? hm(visitSegments[0]!.booking_time) : null;
  const visitEndpoint = visit?.groupBookingId
    ? `/api/venue/visits/${encodeURIComponent(visit.groupBookingId)}/schedule`
    : null;
  const visitServicesEndpoint = visit?.groupBookingId
    ? `/api/venue/visits/${encodeURIComponent(visit.groupBookingId)}/services`
    : null;
  /** The row the guest notification is sent against, matching the endpoint. */
  const notifyBookingId = isVisit ? visitSegments[0]!.id : bookingId;

  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [serviceWarning, setServiceWarning] = useState<string | null>(null);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [links, setLinks] = useState<PractitionerLink[]>([]);
  const [practitioners, setPractitioners] = useState<PractitionerRow[]>([]);

  const [practitionerId, setPractitionerId] = useState(initialPractitionerId);
  const [serviceId, setServiceId] = useState(initialServiceId);
  const [bookingDate, setBookingDate] = useState(booking.booking_date);
  const [bookingTime, setBookingTime] = useState(
    () => visitStartTime ?? booking.booking_time.slice(0, 5),
  );
  /**
   * null until resolved: the booking's own duration when its row carries an end
   * time, otherwise the service's catalogue duration adopted once the catalogue
   * loads (see the effect below). Never a hardcoded default, which used to
   * shrink appointments whose row reached this form without an end time.
   *
   * For a visit this is the WHOLE visit's wall-clock span, gaps included. It
   * starts as what the rows occupy and is replaced by what the server would
   * actually lay out, which differs when an earlier edit left dead time behind.
   */
  const [durationMinutes, setDurationMinutes] = useState<number | null>(() =>
    isVisit ? visitSpanMinutes(visitSegments) : resolveBookingCoreDurationMinutes(booking),
  );
  /**
   * What the form OPENED with. Tracks an adopted catalogue duration so
   * adopting one is not mistaken for a staff edit (which would enable Save on
   * a form nobody has touched).
   */
  const [baselineDuration, setBaselineDuration] = useState<number | null>(() =>
    isVisit ? visitSpanMinutes(visitSegments) : resolveBookingCoreDurationMinutes(booking),
  );
  const [variantId, setVariantId] = useState<string | null>(booking.service_variant_id ?? null);
  /** Latest answer from the visit endpoint's dry run: what saving would lay out. */
  const [visitPlan, setVisitPlan] = useState<VisitPlanResponse | null>(null);
  /**
   * The visit's services as staff want them, and as they stand. Both null until
   * the visit answers on open, since the rows the booking list hands this form
   * carry service NAMES and not ids.
   */
  const [serviceLines, setServiceLines] = useState<VisitServiceLine[] | null>(null);
  const [baselineServiceLines, setBaselineServiceLines] = useState<VisitServiceLine[] | null>(null);
  /**
   * The rows are not in the shape the resolver would give them, before staff
   * have touched anything: dead time an earlier per-service edit left behind.
   * Saving closes it, so Save stays available on a form nobody has edited.
   */
  const [visitRelayNeeded, setVisitRelayNeeded] = useState(false);

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
        bookingTime: visitStartTime ?? booking.booking_time.slice(0, 5),
        // Named to match `currentKey`'s shorthand. As `duration` the two objects
        // could never stringify alike, so `hasChanges` was always true: the
        // baseline this whole dance exists for was never actually compared, and
        // Save was live on a form nobody had touched.
        durationMinutes: baselineDuration,
        variant: booking.service_variant_id ?? null,
      }),
    [booking, initialPractitionerId, initialServiceId, baselineDuration, visitStartTime],
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

  const serviceLinesKey = useMemo(
    () => JSON.stringify((serviceLines ?? []).map((l) => [l.bookingId, l.serviceId, l.variantId])),
    [serviceLines],
  );
  const baselineServiceLinesKey = useMemo(
    () =>
      JSON.stringify((baselineServiceLines ?? []).map((l) => [l.bookingId, l.serviceId, l.variantId])),
    [baselineServiceLines],
  );
  /** True once staff have added, removed or swapped a service. */
  const servicesChanged =
    baselineServiceLines != null && serviceLines != null && serviceLinesKey !== baselineServiceLinesKey;

  /** What the visit's services endpoint is asked for, schedule included. */
  const visitServicesRequestBody = useCallback(
    () => ({
      services: (serviceLines ?? []).map((l) => ({
        booking_id: l.bookingId,
        service_id: l.serviceId,
        service_variant_id: l.variantId,
      })),
      /**
       * The visit this form was opened on. Leaving a service out is how it is
       * removed, so the endpoint refuses the whole request if the visit has
       * gained or lost one since: a stale form must not cancel a service nobody
       * on this screen ever saw.
       */
      known_booking_ids: (baselineServiceLines ?? [])
        .map((l) => l.bookingId)
        .filter((id): id is string => Boolean(id)),
      booking_date: bookingDate,
      booking_time: bookingTime,
      practitioner_id: practitionerId,
    }),
    [serviceLines, baselineServiceLines, bookingDate, bookingTime, practitionerId],
  );

  /**
   * Only what this calendar actually offers can join the visit: the endpoint
   * refuses the rest, and a list that offers them anyway invites the refusal.
   * A line's own service stays listed whatever the links say, so a booking on a
   * service that has since been unlinked still shows what it is.
   */
  const visitServiceOptions = useMemo(() => {
    const offered = new Set(
      links.filter((l) => l.practitioner_id === practitionerId).map((l) => l.service_id),
    );
    const onVisit = new Set((serviceLines ?? []).map((l) => l.serviceId));
    return services.filter((s) => offered.has(s.id) || onVisit.has(s.id));
  }, [links, practitionerId, services, serviceLines]);

  const updateServiceLine = useCallback((key: string, nextServiceId: string) => {
    setServiceLines((current) => {
      if (!current) return current;
      return current.map((line) => (line.key === key ? { ...line, serviceId: nextServiceId, variantId: null } : line));
    });
  }, []);

  const removeServiceLine = useCallback((key: string) => {
    setServiceLines((current) => {
      if (!current || current.length <= 1) return current;
      return current.filter((line) => line.key !== key);
    });
  }, []);

  const addServiceLine = useCallback((serviceId: string) => {
    setServiceLines((current) => [
      ...(current ?? []),
      { key: `new-${serviceId}-${Date.now()}`, bookingId: null, serviceId, variantId: null },
    ]);
  }, []);

  const setServiceLineVariant = useCallback((key: string, variantId: string | null) => {
    setServiceLines((current) => {
      if (!current) return current;
      return current.map((line) => (line.key === key ? { ...line, variantId } : line));
    });
  }, []);

  /**
   * A line whose service has options must carry one, the same rule the
   * single-booking form applies to its own variant select.
   */
  useEffect(() => {
    if (!serviceLines || services.length === 0) return;
    let touched = false;
    const next = serviceLines.map((line) => {
      const svc = services.find((s) => s.id === line.serviceId);
      const active = (svc?.variants ?? []).filter((v) => v.is_active);
      if (active.length === 0) {
        if (line.variantId == null) return line;
        touched = true;
        return { ...line, variantId: null };
      }
      if (line.variantId && active.some((v) => v.id === line.variantId)) return line;
      touched = true;
      return { ...line, variantId: active[0]!.id };
    });
    if (touched) setServiceLines(next);
  }, [serviceLines, services]);

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

    /**
     * A visit is checked as a visit: the endpoint plans every service and checks
     * all of them, so this dry run answers the only question that matters (can
     * the WHOLE visit go there) and returns the layout the save will write.
     */
    if (isVisit && visitEndpoint) {
      try {
        /**
         * A visit whose SERVICES changed is planned by the services endpoint,
         * which lays the visit out from what it now holds. The total then follows
         * the services rather than being asked for, so it carries the schedule
         * too and the edit stays one write.
         */
        const useServices = servicesChanged && visitServicesEndpoint != null;
        const res = await fetch(useServices ? visitServicesEndpoint! : visitEndpoint, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            useServices
              ? { dry_run: true, ...visitServicesRequestBody() }
              : {
                  dry_run: true,
                  booking_date: bookingDate,
                  booking_time: bookingTime,
                  practitioner_id: practitionerId,
                  total_duration_minutes: durationMinutes,
                },
          ),
        });
        const data = (await res.json().catch(() => ({}))) as VisitPlanResponse;
        if (!res.ok || !data.ok) {
          setVisitPlan(null);
          setValidationState('invalid');
          setValidationMessage(data.error ?? 'This visit cannot go there.');
          return;
        }
        setVisitPlan(data);
        // The services drive the visit's length, so the duration field follows
        // what the plan came back with rather than the other way round.
        if (useServices && typeof data.total_minutes === 'number') {
          setDurationMinutes(data.total_minutes);
        }
        setValidationState('valid');
      } catch (e) {
        console.error('Staff visit validate failed:', e);
        setValidationState('invalid');
        setValidationMessage('Could not validate availability.');
      }
      return;
    }

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
    isVisit,
    practitionerId,
    processingBlocksToSend,
    requiresVariant,
    serviceId,
    servicesChanged,
    usesServiceItem,
    variantId,
    visitEndpoint,
    visitServicesEndpoint,
    visitServicesRequestBody,
  ]);

  /**
   * What the visit actually looks like to the resolver, asked once on open.
   *
   * The rows can carry dead time a per-service edit left behind (the reported
   * booking's 11:30 to 11:45 hole), so the span they occupy is not the span the
   * visit has. Adopting the planned total as BOTH value and baseline keeps that
   * correction from reading as a staff edit, and `visitRelayNeeded` is what
   * still lets them save it.
   */
  useEffect(() => {
    if (!isVisit || !visitEndpoint || durationMinutes == null) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(visitEndpoint, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dry_run: true,
            booking_date: booking.booking_date,
            booking_time: baselineTime,
            practitioner_id: initialPractitionerId,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as VisitPlanResponse;
        if (cancelled || !res.ok || !data.ok || typeof data.total_minutes !== 'number') return;
        setVisitPlan((current) => current ?? data);
        setDurationMinutes(data.total_minutes);
        setBaselineDuration(data.total_minutes);
        setVisitRelayNeeded(data.changed === true);
        const lines = (data.services ?? [])
          .filter((s) => s.id && s.service_id)
          .map((s) => ({
            key: s.id!,
            bookingId: s.id!,
            serviceId: s.service_id!,
            variantId: s.service_variant_id ?? null,
          }));
        if (lines.length > 0) {
          setServiceLines(lines);
          setBaselineServiceLines(lines);
        }
      } catch {
        // The form still works from the rows' own span; the save is checked anyway.
      }
    })();
    return () => {
      cancelled = true;
    };
    // Deliberately once per visit: later answers come from runValidate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisit, visitEndpoint]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!practitionerId || !serviceId || catalogError || serviceWarning) return;
    debounceRef.current = setTimeout(() => {
      void runValidate();
    }, 450);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [
    catalogError,
    practitionerId,
    serviceId,
    serviceLinesKey,
    bookingDate,
    bookingTime,
    durationMinutes,
    variantId,
    runValidate,
    serviceWarning,
  ]);

  /**
   * The services as they will stand after saving, or as the rows have them
   * until the first check answers.
   */
  const visitServiceRows = useMemo(() => {
    const planned = visitPlan?.services ?? [];
    if (planned.length > 0) {
      return planned.map((s) => ({
        id: s.id,
        name: s.name,
        start: hm(s.booking_time),
        end: hm(s.booking_end_time),
      }));
    }
    return visitSegments.map((s) => ({
      id: s.id,
      name: s.booking_item_name,
      start: hm(s.booking_time),
      end: s.booking_end_time ? hm(s.booking_end_time) : null,
    }));
  }, [visitPlan, visitSegments]);

  /**
   * What saving will actually do, in words.
   *
   * C10 — this notice is the only reason Save is enabled on a form nobody has
   * touched, so it has to name the consequence. It used to describe the dead
   * time being closed and never mentioned that the visit MOVES, which is the
   * part staff needed to see before pressing a button they had not armed.
   */
  const visitRelayNotice = useMemo(() => {
    if (!visitRelayNeeded) return null;
    const rawSpan = visitSpanMinutes(visitSegments);
    const planned = visitPlan?.total_minutes ?? baselineDuration;
    const gap = rawSpan != null && planned != null ? rawSpan - planned : 0;
    const plannedStart = visitPlan?.start_time ?? visitPlan?.services?.[0]?.booking_time ?? null;
    const currentStart = visitSegments[0]?.booking_time ?? null;
    const movesTo =
      plannedStart && currentStart && hm(plannedStart) !== hm(currentStart)
        ? ` The visit will start at ${hm(plannedStart)} instead of ${hm(currentStart)}.`
        : '';
    if (gap > 0) {
      return `This visit has ${gap} minutes of dead time in it. Saving closes it, so the services run back to back.${movesTo}`;
    }
    return `Saving will re-lay this visit so its services run back to back.${movesTo}`;
  }, [visitRelayNeeded, visitSegments, visitPlan, baselineDuration]);

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
    (!hasChanges && !visitRelayNeeded && !servicesChanged) ||
    Boolean(serviceWarning) ||
    durationMinutes == null ||
    !bookingTime ||
    validationState === 'loading' ||
    validationState === 'invalid' ||
    validationState === 'idle' ||
    !practitionerId ||
    !serviceId ||
    (requiresVariant && !variantId);

  const baselineTime = visitStartTime ?? booking.booking_time.slice(0, 5);
  const scheduleChanged = bookingDate !== booking.booking_date || bookingTime !== baselineTime;

  const handleSave = async () => {
    if (durationMinutes == null) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (isVisit && visitEndpoint) {
        const useServices = servicesChanged && visitServicesEndpoint != null;
        const visitBody: Record<string, unknown> = useServices
          ? { ...visitServicesRequestBody() }
          : {
              booking_date: bookingDate,
              booking_time: bookingTime,
              practitioner_id: practitionerId,
              total_duration_minutes: durationMinutes,
            };
        // Start moved: defer the guest notification so the follow-up panel can
        // offer notify / skip / undo, exactly as the single-booking save does.
        if (scheduleChanged) {
          visitBody.defer_modification_guest_notification = true;
        }
        const res = await fetch(useServices ? visitServicesEndpoint! : visitEndpoint, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(visitBody),
        });
        const data = (await res.json().catch(() => ({}))) as VisitPlanResponse & { code?: string };
        if (res.status === 412) {
          setSaveError(data.error ?? 'This visit was changed somewhere else. Refresh and try again.');
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
        return;
      }

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

    /**
     * A visit goes back through the same endpoint, so undo is as all-or-nothing
     * as the save was. It restores the visit the resolver would lay out at the
     * original start, which is what the form opened on: any dead time the rows
     * carried was already closed by the save, and re-opening it would be a
     * different edit rather than an undo.
     */
    if (isVisit && visitEndpoint) {
      try {
        const res = await fetch(visitEndpoint, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            booking_date: booking.booking_date,
            booking_time: baselineTime,
            practitioner_id: initialPractitionerId,
            total_duration_minutes: revertDuration,
            skip_booking_modification_guest_notification: true,
          }),
        });
        return res.ok;
      } catch {
        return false;
      }
    }

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
    isVisit,
    usesServiceItem,
    visitEndpoint,
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
        bookingId={notifyBookingId}
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

      {/*
       * A visit's refusal names a service and the time it could not take, which
       * belongs with the visit rather than under the time grid: the single
       * booking's copy lives inside the picker, and a visit can be refused for a
       * service that is not the one the staff member just moved.
       */}
      {isVisit && validationState === 'invalid' && validationMessage ? (
        <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-800">
          {validationMessage}
        </p>
      ) : null}

      {validationState === 'invalid' && validationMessage && !bookingTime ? (
        <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-800">{validationMessage}</p>
      ) : visitRelayNotice && !hasChanges ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
          {visitRelayNotice}
        </p>
      ) : !hasChanges ? (
        <p className="text-xs text-slate-500">Adjust a field to check availability and enable save.</p>
      ) : null}

      {isVisit ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-xs font-semibold text-slate-700">
            {(serviceLines ?? visitServiceRows).length} services in this visit
          </p>
          {serviceLines ? (
            <ul className="mt-1.5 space-y-2">
              {serviceLines.map((line, i) => {
                const planned = visitServiceRows[i];
                const svc = services.find((s) => s.id === line.serviceId);
                const lineVariants = (svc?.variants ?? []).filter((v) => v.is_active);
                const lineName = svc?.name ?? planned?.name ?? 'Service';
                return (
                  <li key={line.key} className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      <select
                        aria-label={`Service ${i + 1}`}
                        value={line.serviceId}
                        onChange={(e) => updateServiceLine(line.key, e.target.value)}
                        className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs"
                      >
                        {visitServiceOptions.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                      <span className="shrink-0 text-[11px] font-semibold tabular-nums text-slate-700">
                        {planned?.end ? `${planned.start} to ${planned.end}` : ''}
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove ${lineName}`}
                        disabled={serviceLines.length <= 1}
                        onClick={() => removeServiceLine(line.key)}
                        className="shrink-0 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                      >
                        Remove
                      </button>
                    </div>
                    {lineVariants.length > 0 ? (
                      <select
                        aria-label={`Option for ${lineName}`}
                        value={line.variantId ?? ''}
                        onChange={(e) => setServiceLineVariant(line.key, e.target.value || null)}
                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs"
                      >
                        {lineVariants.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name} ({v.duration_minutes} min)
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <ul className="mt-1.5 space-y-1">
              {visitServiceRows.map((s, i) => (
                <li
                  key={s.id ?? `row-${i}`}
                  className="flex items-baseline justify-between gap-3 text-xs text-slate-600"
                >
                  <span className="truncate">{s.name ?? 'Service'}</span>
                  <span className="shrink-0 font-semibold tabular-nums text-slate-800">
                    {s.end ? `${s.start} to ${s.end}` : s.start}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {serviceLines ? (
            <label className="mt-2 block text-[11px] font-semibold text-slate-600">
              Add a service
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) addServiceLine(e.target.value);
                }}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-normal"
              >
                <option value="">Choose a service to add</option>
                {visitServiceOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.duration_minutes} min)
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <p className="mt-1.5 text-[11px] text-slate-500">
            {servicesChanged
              ? 'The visit is re-laid around these services, so its total follows them.'
              : 'They move together and keep their own lengths. A service added here goes on the end.'}
          </p>
        </div>
      ) : (
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
      )}

      {!isVisit && requiresVariant && selectedService ? (
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
        // A visit's reason is shown above, with the visit. Repeating it under the
        // slots would say the same thing twice about different things.
        validationMessage={isVisit ? null : validationMessage}
        disabled={Boolean(catalogError) || Boolean(serviceWarning) || !practitionerId || !serviceId}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-semibold text-slate-700 sm:col-span-2">
          {isVisit ? 'Total duration (minutes)' : 'Duration (minutes)'}
          <input
            type="number"
            min={MIN_APPOINTMENT_CORE_DURATION_MINUTES}
            max={MAX_APPOINTMENT_CORE_DURATION_MINUTES}
            step={5}
            value={durationMinutes ?? ''}
            // The services set the length of a visit being re-serviced, so the
            // field reports it rather than competing with it.
            readOnly={servicesChanged}
            onChange={(e) => setDurationMinutes(Number(e.target.value))}
            className={`mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm ${
              servicesChanged ? 'bg-slate-100 text-slate-500' : ''
            }`}
          />
          {isVisit ? (
            <span className="mt-1 block text-[11px] font-normal text-slate-500">
              {servicesChanged
                ? 'Set by the services in this visit.'
                : 'The whole visit, start to finish. Extra time goes on the last service, and shortening takes it off the last service first.'}
            </span>
          ) : null}
        </label>
      </div>

      {!isVisit && showProcessingPanel ? (
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
