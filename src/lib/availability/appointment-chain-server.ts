import type { SupabaseClient } from '@supabase/supabase-js';
import {
  attachVenueClockToAppointmentInput,
  fetchAppointmentInput,
  type AppointmentAvailabilityResult,
  type AppointmentEngineInput,
  type PhantomBooking,
} from '@/lib/availability/appointment-engine';
import {
  chainStartsToSlots,
  computeChainStartsForPractitioner,
  type ChainSegmentEngineInput,
} from '@/lib/availability/appointment-chain';
import { mergeAppointmentServiceWithPractitionerLink } from '@/lib/appointments/merge-service-with-overrides';
import { resolveBookableServiceWithVariant } from '@/lib/appointments/service-variant';
import { loadActiveVariantForService } from '@/lib/venue/service-variants';
import { loadAddonsForBooking } from '@/lib/addons/addon-resolution';
import { validateAddonSelections } from '@/lib/addons/addon-selection-validation';
import { venueUsesUnifiedAppointmentServiceData } from '@/lib/booking/uses-unified-appointment-data';
import { loadServiceEntityBookingWindow } from '@/lib/booking/entity-booking-window';

/**
 * Database-backed half of chain availability: turns "these services, with
 * these options, with this person" into one engine input per segment, then
 * hands them to the pure helper in `appointment-chain.ts`.
 *
 * One base fetch per practitioner (bookings, blocks, hours) is cloned per
 * segment with just that segment's service at its effective duration, so a
 * visit that lists the same service twice with different options cannot have
 * one override clobber the other.
 */

export interface ChainSegmentRequest {
  /** Service id in the venue's OWN catalogue (a collective offering already resolved). */
  serviceId: string;
  variantId?: string | null;
  addonIds?: string[];
  /** Staff custom duration: replaces the base (or variant) duration before add-ons. */
  customDurationMinutes?: number | null;
  /** Combined page: the collective's own length for this offering, applied before the variant. */
  durationOverrideMinutes?: number | null;
}

export interface VenueClockRow {
  id?: string | null;
  timezone?: string | null;
  booking_rules?: unknown;
  opening_hours?: unknown;
  venue_opening_exceptions?: unknown;
}

export type PrepareChainResult =
  | { ok: true; segments: ChainSegmentEngineInput[] }
  /** The person does not offer one of the services: no slots, not an error. */
  | { ok: false; kind: 'not_offered' }
  /** The request named an option that does not exist: answer 400. */
  | { ok: false; kind: 'invalid'; error: string; details?: unknown };

export async function prepareChainSegments(params: {
  supabase: SupabaseClient;
  venueId: string;
  date: string;
  practitionerId: string;
  segments: ChainSegmentRequest[];
  clock: VenueClockRow;
  /** Null skips the per-service booking window (the combined page's existing behaviour). */
  bookingModel: string | null;
  phantoms?: PhantomBooking[];
  excludeBookingId?: string;
  skipPastSlotFilter?: boolean;
}): Promise<PrepareChainResult> {
  const { supabase, venueId, date, practitionerId } = params;
  const base = await fetchAppointmentInput({ supabase, venueId, date, practitionerId });
  if (params.excludeBookingId) {
    const excludeLc = params.excludeBookingId.toLowerCase();
    base.existingBookings = base.existingBookings.filter((b) => b.id.toLowerCase() !== excludeLc);
  }

  const needsAddons = params.segments.some((s) => (s.addonIds?.length ?? 0) > 0);
  const addonSchema = needsAddons
    ? (await venueUsesUnifiedAppointmentServiceData(supabase, venueId))
      ? 'service_item'
      : 'appointment_service'
    : null;

  const prepared: ChainSegmentEngineInput[] = [];
  for (const seg of params.segments) {
    const baseSvc = base.services.find((s) => s.id === seg.serviceId);
    const link = base.practitionerServices.find(
      (ps) => ps.practitioner_id === practitionerId && ps.service_id === seg.serviceId,
    );
    if (!baseSvc || !baseSvc.is_active || !link) return { ok: false, kind: 'not_offered' };

    let svc = mergeAppointmentServiceWithPractitionerLink(baseSvc, link);
    if (seg.durationOverrideMinutes != null) {
      svc = { ...svc, duration_minutes: seg.durationOverrideMinutes };
    }
    if (seg.variantId) {
      const variant = await loadActiveVariantForService({
        admin: supabase,
        venueId,
        serviceId: seg.serviceId,
        variantId: seg.variantId,
      });
      if (!variant) return { ok: false, kind: 'invalid', error: 'Invalid variant_id for this service' };
      svc = resolveBookableServiceWithVariant(svc, variant);
    }
    if (seg.customDurationMinutes != null) {
      svc = { ...svc, duration_minutes: seg.customDurationMinutes };
    }
    if (seg.addonIds && seg.addonIds.length > 0 && addonSchema) {
      const { groups } = await loadAddonsForBooking({
        admin: supabase,
        venueId,
        schema: addonSchema,
        parentId: seg.serviceId,
        includeHidden: false,
      });
      const validation = validateAddonSelections({
        selections: seg.addonIds.map((id) => ({ addon_id: id })),
        groupsForService: groups,
        source: 'public',
      });
      if (!validation.ok) {
        return { ok: false, kind: 'invalid', error: 'INVALID_ADDON_SELECTION', details: validation.errors };
      }
      let delta = 0;
      for (const a of validation.resolvedAddons) delta += a.additional_duration_minutes;
      if (delta > 0) svc = { ...svc, duration_minutes: svc.duration_minutes + delta };
    }

    const window = params.bookingModel
      ? await loadServiceEntityBookingWindow(supabase, venueId, params.bookingModel, seg.serviceId)
      : null;

    const input: AppointmentEngineInput = {
      ...base,
      services: [svc],
      // The merged duration is final; the link must not re-apply its own on top.
      practitionerServices: base.practitionerServices.map((ps) =>
        ps.practitioner_id === practitionerId && ps.service_id === seg.serviceId
          ? { ...ps, custom_duration_minutes: null, custom_buffer_minutes: null }
          : ps,
      ),
      phantomBookings: params.phantoms ?? [],
    };
    attachVenueClockToAppointmentInput(input, params.clock, window);
    if (params.skipPastSlotFilter) input.skipPastSlotFilter = true;

    prepared.push({
      input,
      serviceId: seg.serviceId,
      durationMinutes: svc.duration_minutes,
      bufferMinutes: svc.buffer_minutes ?? 0,
    });
  }
  return { ok: true, segments: prepared };
}

export type ChainAvailabilityResult =
  | { ok: true; practitioners: AppointmentAvailabilityResult['practitioners'] }
  | { ok: false; error: string; details?: unknown };

/**
 * Chain availability for one venue across the given practitioners, in the
 * ordinary `AppointmentAvailabilityResult` shape: every slot is labelled with
 * the first service and carries the visit's whole span.
 */
export async function computeChainAvailabilityForVenue(params: {
  supabase: SupabaseClient;
  venueId: string;
  date: string;
  practitionerIds: string[];
  segments: ChainSegmentRequest[];
  clock: VenueClockRow;
  bookingModel: string | null;
  phantoms?: PhantomBooking[];
  excludeBookingId?: string;
  skipPastSlotFilter?: boolean;
}): Promise<ChainAvailabilityResult> {
  const results = await Promise.all(
    params.practitionerIds.map(async (practitionerId) => {
      const prepared = await prepareChainSegments({ ...params, practitionerId });
      return { practitionerId, prepared };
    }),
  );

  const practitioners: AppointmentAvailabilityResult['practitioners'] = [];
  for (const { practitionerId, prepared } of results) {
    if (!prepared.ok) {
      if (prepared.kind === 'invalid') return { ok: false, error: prepared.error, details: prepared.details };
      continue;
    }
    const { practitioner, starts } = computeChainStartsForPractitioner(practitionerId, prepared.segments);
    if (!practitioner) continue;
    const firstId = prepared.segments[0]!.serviceId;
    const firstMeta = practitioner.services.find((s) => s.id === firstId);
    practitioners.push({
      id: practitioner.id,
      name: practitioner.name,
      services: firstMeta ? [firstMeta] : [],
      slots: chainStartsToSlots(
        practitioner,
        { id: firstId, name: firstMeta?.name ?? '', price_pence: firstMeta?.price_pence ?? null },
        starts,
      ),
    });
  }
  return { ok: true, practitioners };
}
