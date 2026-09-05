/**
 * The booking-stack bridge for the "virtual venue" (plan §22 G3/G4). Lets the
 * STANDARD appointment endpoints serve a collective: the customer flow targets
 * the synthetic venue (its id = the collective id), and these helpers resolve
 * the merged catalogue / availability / booking routing back to the real owning
 * venues. Everything is keyed on the OFFERING id (the customer-facing service)
 * and a CONCRETE calendar id; routing to the owning venue + real source service
 * happens here, server-side.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  fetchAppointmentInput,
  attachVenueClockToAppointmentInput,
  computeAppointmentAvailability,
} from '@/lib/availability/appointment-engine';
import { computeAppointmentAvailableDatesInMonth } from '@/lib/availability/appointment-month-availability';
import { ANY_AVAILABLE_PRACTITIONER_ID } from '@/lib/availability/appointment-any-practitioner';
import type { PhantomBooking } from '@/lib/availability/appointment-engine';
import { computeChainStartsForPractitioner } from '@/lib/availability/appointment-chain';
import { prepareChainSegments, type ChainSegmentRequest, type VenueClockRow } from '@/lib/availability/appointment-chain-server';
import { loadActiveVariantForService } from '@/lib/venue/service-variants';
import { loadAddonsForBooking } from '@/lib/addons/addon-resolution';
import { validateAddonSelections } from '@/lib/addons/addon-selection-validation';
import { venueUsesUnifiedAppointmentServiceData } from '@/lib/booking/uses-unified-appointment-data';
import {
  isGuestBookingDateAllowed,
  isStaffWalkInBookingDateAllowed,
  loadServiceEntityBookingWindow,
} from '@/lib/booking/entity-booking-window';
import type { ServiceChainSegmentParam } from '@/lib/booking/service-chain';
import {
  loadCollectiveAppointmentCatalog,
  type CollectiveCatalogPractitioner,
} from './collective-venue';

/** Is this id a live (active) collective rather than a venue? */
export async function isCollectiveId(admin: SupabaseClient, id: string): Promise<boolean> {
  const { data } = await admin
    .from('venue_collectives')
    .select('id')
    .eq('id', id)
    .eq('status', 'active')
    .maybeSingle();
  return Boolean(data);
}

export interface CombinedBookingTarget {
  /** The real owning venue the booking must be written to. */
  venueId: string;
  /** The real source service id in that venue. */
  sourceServiceId: string;
  /** Effective (overridden) price/duration for the offering on this calendar. */
  pricePence: number | null;
  durationMinutes: number | null;
  /**
   * True for a combined-page offering (attributed to the collective); false for a
   * member venue's own service reached through the staff catalogue
   * (`includeMemberOwnServices`), which books as a plain booking in its venue.
   */
  offering: boolean;
}

/**
 * Resolve a chosen (offering, calendar) to its owning venue + real source
 * service + effective price/duration, using the merged catalogue (which already
 * applies eligibility, member approval and the override resolution). Returns null
 * when the pairing isn't a currently-bookable offering.
 */
export async function resolveCombinedBookingTarget(
  admin: SupabaseClient,
  params: {
    collectiveId: string;
    offeringId: string;
    calendarId: string;
    /** Staff of a member: a member venue's own service id resolves too (see `offering`). */
    includeMemberOwnServices?: boolean;
  },
): Promise<CombinedBookingTarget | null> {
  const { practitioners } = await loadCollectiveAppointmentCatalog(admin, params.collectiveId, {
    includeMemberOwnServices: params.includeMemberOwnServices,
  });
  const calendar = practitioners.find((p) => p.id === params.calendarId);
  if (!calendar) return null;
  const service = calendar.services.find((s) => s.id === params.offeringId);
  if (!service) return null;
  return {
    venueId: calendar.owning_venue_id,
    sourceServiceId: service.source_service_id,
    pricePence: service.price_pence,
    durationMinutes: service.duration_minutes,
    offering: !service.venue_only,
  };
}

/**
 * The length a single offering occupies on ONE provider calendar once the
 * customer's variant and add-ons are applied to that calendar's source service.
 * Mirrors the per-segment logic in `prepareChainSegments`, so a service booked
 * alone is sized the same way as one booked in a visit. Returns null when the
 * chosen variant or add-ons do not belong to this calendar's source service
 * (another member's calendar in the "any available" pool), meaning the calendar
 * cannot honour the request and offers no slots.
 */
async function resolveOfferingDurationForCalendar(
  admin: SupabaseClient,
  target: { venueId: string; sourceServiceId: string; durationMinutes: number | null },
  choice: { variantId: string | null; addonIds: string[]; customDurationMinutes: number | null },
): Promise<number | null> {
  let duration = target.durationMinutes;
  if (choice.variantId) {
    const variant = await loadActiveVariantForService({
      admin,
      venueId: target.venueId,
      serviceId: target.sourceServiceId,
      variantId: choice.variantId,
    });
    if (!variant) return null;
    const variantDuration = (variant as { duration_minutes?: number | null }).duration_minutes;
    if (variantDuration != null) duration = variantDuration;
  }
  if (choice.customDurationMinutes != null) duration = choice.customDurationMinutes;
  if (choice.addonIds.length > 0) {
    const schema = (await venueUsesUnifiedAppointmentServiceData(admin, target.venueId))
      ? 'service_item'
      : 'appointment_service';
    const { groups } = await loadAddonsForBooking({
      admin,
      venueId: target.venueId,
      schema,
      parentId: target.sourceServiceId,
      includeHidden: false,
    });
    const validation = validateAddonSelections({
      selections: choice.addonIds.map((id) => ({ addon_id: id })),
      groupsForService: groups,
      source: 'public',
    });
    if (!validation.ok) return null;
    let delta = 0;
    for (const a of validation.resolvedAddons) delta += a.additional_duration_minutes;
    if (delta > 0 && duration != null) duration += delta;
  }
  return duration;
}

interface DaySlot {
  start_time: string;
  service_id: string; // the OFFERING id (so the flow matches)
  duration_minutes: number;
  price_pence: number | null;
  practitioner_id?: string;
  practitioner_name?: string;
}

/** The calendars that provide an offering (with routing), from the merged catalogue. */
function calendarsForOffering(
  practitioners: CollectiveCatalogPractitioner[],
  offeringId: string,
): Array<{ calendarId: string; name: string; venueId: string; sourceServiceId: string; durationMinutes: number | null; pricePence: number | null }> {
  const out: Array<{ calendarId: string; name: string; venueId: string; sourceServiceId: string; durationMinutes: number | null; pricePence: number | null }> = [];
  for (const p of practitioners) {
    const svc = p.services.find((s) => s.id === offeringId);
    if (!svc) continue;
    out.push({
      calendarId: p.id,
      name: p.name,
      venueId: p.owning_venue_id,
      sourceServiceId: svc.source_service_id,
      durationMinutes: svc.duration_minutes,
      pricePence: svc.price_pence,
    });
  }
  return out;
}

/**
 * Day availability for the combined page, in the EXACT shape the standard
 * `/api/booking/availability` returns, so the flow consumes it unchanged:
 * `{ date, venue_id, practitioners: [{ id, name, slots }], any_available? }`.
 * Slots are relabelled with the offering id and carry the concrete calendar.
 */
export async function loadCollectiveDayAvailability(
  admin: SupabaseClient,
  params: {
    collectiveId: string;
    offeringId: string;
    calendarId: string | null; // null/ANY → any-available pool
    anyAvailable: boolean;
    date: string;
    /** A staff-entered custom length; null for public guests. */
    durationMinutes?: number | null;
    /** The customer's chosen variant / add-ons, resolved per provider calendar. */
    variantId?: string | null;
    addonIds?: string[];
    /** Earlier members of a group booking, so their slots count as taken. */
    phantoms?: PhantomBooking[];
    /** Staff may book a slot earlier today; the public may not. Defaults to public. */
    audience?: 'public' | 'staff';
    /** A booking being rescheduled, whose own slot must not count as taken. */
    excludeBookingId?: string | null;
    /** Staff of a member: member venues' own services are offered too. */
    includeMemberOwnServices?: boolean;
  },
): Promise<{ date: string; venue_id: string; practitioners: Array<{ id: string; name: string; slots: DaySlot[] }>; any_available?: boolean }> {
  const { collectiveId, offeringId, date } = params;
  const { practitioners } = await loadCollectiveAppointmentCatalog(admin, collectiveId, {
    includeMemberOwnServices: params.includeMemberOwnServices,
  });
  const all = calendarsForOffering(practitioners, offeringId);
  const targets =
    params.anyAvailable || !params.calendarId
      ? all
      : all.filter((c) => c.calendarId === params.calendarId);

  // Owning-venue clock rows for the involved venues.
  const venueIds = [...new Set(targets.map((t) => t.venueId))];
  const clocks: Record<string, { timezone?: string | null; booking_rules?: unknown; opening_hours?: unknown; venue_opening_exceptions?: unknown }> = {};
  await Promise.all(
    venueIds.map(async (venueId) => {
      const { data } = await admin
        .from('venues')
        .select('timezone, booking_rules, opening_hours, venue_opening_exceptions')
        .eq('id', venueId)
        .maybeSingle();
      if (data) clocks[venueId] = data as typeof clocks[string];
    }),
  );

  const perCalendar = await Promise.all(
    targets.map(async (t): Promise<DaySlot[]> => {
      const clock = clocks[t.venueId];
      if (!clock) return [];
      // Size the slot for THIS calendar: the offering's length on it, plus the
      // customer's variant and add-ons (which the public flow sends as ids, never
      // as a pre-summed duration). A calendar that cannot honour them offers none.
      const dur = await resolveOfferingDurationForCalendar(
        admin,
        { venueId: t.venueId, sourceServiceId: t.sourceServiceId, durationMinutes: t.durationMinutes },
        {
          variantId: params.variantId ?? null,
          addonIds: params.addonIds ?? [],
          customDurationMinutes: params.durationMinutes ?? null,
        },
      );
      if (dur === null && (params.variantId || (params.addonIds?.length ?? 0) > 0)) return [];
      try {
        // The source service's own booking window (minimum notice, same-day rule,
        // advance limit) applies on its calendar exactly as the venue's own day
        // route and the create routes apply it, so every slot offered here is one
        // create will accept. The month loader and the visit path already did this.
        const window = await loadServiceEntityBookingWindow(admin, t.venueId, '', t.sourceServiceId);
        const tz =
          typeof clock.timezone === 'string' && clock.timezone.trim() !== '' ? clock.timezone.trim() : 'Europe/London';
        const dateAllowed =
          params.audience === 'staff'
            ? isStaffWalkInBookingDateAllowed(date, window, tz)
            : isGuestBookingDateAllowed(date, window, tz);
        if (!dateAllowed) return [];
        const input = await fetchAppointmentInput({
          supabase: admin,
          venueId: t.venueId,
          date,
          practitionerId: t.calendarId,
          serviceId: t.sourceServiceId,
        });
        if (dur != null) {
          const idx = input.services.findIndex((s) => s.id === t.sourceServiceId);
          if (idx >= 0) input.services[idx] = { ...input.services[idx]!, duration_minutes: dur };
        }
        if (params.phantoms && params.phantoms.length > 0) input.phantomBookings = params.phantoms;
        if (params.excludeBookingId) {
          const excludeLc = params.excludeBookingId.toLowerCase();
          input.existingBookings = input.existingBookings.filter((b) => b.id.toLowerCase() !== excludeLc);
        }
        attachVenueClockToAppointmentInput(input, clock, window);
        if (params.audience === 'staff') input.skipPastSlotFilter = true;
        const result = computeAppointmentAvailability(input);
        const slots: DaySlot[] = [];
        for (const prac of result.practitioners) {
          for (const slot of prac.slots) {
            if (slot.service_id !== t.sourceServiceId) continue;
            slots.push({
              start_time: slot.start_time,
              service_id: offeringId,
              duration_minutes: dur ?? slot.duration_minutes,
              price_pence: t.pricePence,
              practitioner_id: t.calendarId,
              practitioner_name: t.name,
            });
          }
        }
        return slots;
      } catch {
        return [];
      }
    }),
  );

  if (params.anyAvailable) {
    // Pool into one "any available" practitioner; dedupe by time (earliest/first calendar wins).
    const byTime = new Map<string, DaySlot>();
    for (const slot of perCalendar.flat()) {
      if (!byTime.has(slot.start_time)) byTime.set(slot.start_time, slot);
    }
    const pooled = [...byTime.values()].sort((a, b) => a.start_time.localeCompare(b.start_time));
    return {
      date,
      venue_id: collectiveId,
      any_available: true,
      practitioners: [{ id: ANY_AVAILABLE_PRACTITIONER_ID, name: 'Any available', slots: pooled }],
    };
  }

  return {
    date,
    venue_id: collectiveId,
    practitioners: targets.map((t, i) => ({
      id: t.calendarId,
      name: t.name,
      slots: (perCalendar[i] ?? []).sort((a, b) => a.start_time.localeCompare(b.start_time)),
    })),
  };
}

/**
 * Month available-dates for the combined page, in the standard
 * `/api/booking/appointment-calendar` shape. Unions each provider calendar's
 * real month availability (honouring the effective duration).
 */
export async function loadCollectiveMonthAvailableDates(
  admin: SupabaseClient,
  params: {
    collectiveId: string;
    offeringId: string;
    calendarId: string | null;
    anyAvailable: boolean;
    year: number;
    month: number;
    /** A staff-entered custom length; null for public guests. */
    durationMinutes?: number | null;
    /** The customer's chosen variant / add-ons, resolved per provider calendar. */
    variantId?: string | null;
    addonIds?: string[];
    /**
     * Staff see the dates staff see on their own venue (same-day allowed); the
     * public gets the guest booking window. Defaults to public.
     */
    audience?: 'public' | 'staff';
    /** A booking being rescheduled, whose own slot must not count as taken. */
    excludeBookingId?: string | null;
    /** Staff of a member: member venues' own services are offered too. */
    includeMemberOwnServices?: boolean;
  },
): Promise<{ venue_id: string; practitioner_id: string; service_id: string; year: number; month: number; available_dates: string[]; any_available?: boolean }> {
  const { collectiveId, offeringId, year, month } = params;
  const { practitioners } = await loadCollectiveAppointmentCatalog(admin, collectiveId, {
    includeMemberOwnServices: params.includeMemberOwnServices,
  });
  const all = calendarsForOffering(practitioners, offeringId);
  const targets =
    params.anyAvailable || !params.calendarId
      ? all
      : all.filter((c) => c.calendarId === params.calendarId);

  const perCalendar = await Promise.all(
    targets.map(async (t) => {
      try {
        const dur = await resolveOfferingDurationForCalendar(
          admin,
          { venueId: t.venueId, sourceServiceId: t.sourceServiceId, durationMinutes: t.durationMinutes },
          {
            variantId: params.variantId ?? null,
            addonIds: params.addonIds ?? [],
            customDurationMinutes: params.durationMinutes ?? null,
          },
        );
        if (dur === null && (params.variantId || (params.addonIds?.length ?? 0) > 0)) return [] as string[];
        return await computeAppointmentAvailableDatesInMonth(admin, t.venueId, t.calendarId, t.sourceServiceId, year, month, {
          audience: params.audience ?? 'public',
          customDurationMinutes: dur ?? undefined,
          excludeBookingId: params.excludeBookingId ?? null,
        });
      } catch {
        return [] as string[];
      }
    }),
  );
  const available_dates = [...new Set(perCalendar.flat())].sort();
  return {
    venue_id: collectiveId,
    practitioner_id: params.anyAvailable ? ANY_AVAILABLE_PRACTITIONER_ID : params.calendarId ?? ANY_AVAILABLE_PRACTITIONER_ID,
    service_id: offeringId,
    year,
    month,
    available_dates,
    any_available: params.anyAvailable || undefined,
  };
}

/**
 * Chain day availability for the combined page: starts at which SEVERAL
 * offerings fit back to back on one calendar. Each offering resolves per
 * calendar to its owning venue and source service, carrying the collective's
 * own length, exactly as the single-offering path above does; the slots are
 * labelled with the FIRST offering so the flow reads them unchanged.
 */
export async function loadCollectiveChainDayAvailability(
  admin: SupabaseClient,
  params: {
    collectiveId: string;
    chain: ServiceChainSegmentParam[];
    calendarId: string | null;
    anyAvailable: boolean;
    date: string;
    phantoms?: PhantomBooking[];
    /** Staff of a member: member venues' own services are offered too. */
    includeMemberOwnServices?: boolean;
  },
): Promise<
  | { ok: true; payload: { date: string; venue_id: string; practitioners: Array<{ id: string; name: string; slots: DaySlot[] }>; any_available?: boolean } }
  | { ok: false; error: string; details?: unknown }
> {
  const { collectiveId, chain, date } = params;
  const { practitioners } = await loadCollectiveAppointmentCatalog(admin, collectiveId, {
    includeMemberOwnServices: params.includeMemberOwnServices,
  });
  const firstOfferingId = chain[0]!.service_id;

  type ChainTarget = {
    calendarId: string;
    name: string;
    venueId: string;
    firstPricePence: number | null;
    segments: ChainSegmentRequest[];
  };
  const all: ChainTarget[] = [];
  for (const p of practitioners) {
    const segments: ChainSegmentRequest[] = [];
    let firstPricePence: number | null = null;
    let offersAll = true;
    for (const c of chain) {
      const svc = p.services.find((s) => s.id === c.service_id);
      if (!svc) {
        offersAll = false;
        break;
      }
      if (c.service_id === firstOfferingId && segments.length === 0) firstPricePence = svc.price_pence;
      segments.push({
        serviceId: svc.source_service_id,
        variantId: c.variant_id ?? null,
        addonIds: c.addon_ids ?? [],
        customDurationMinutes: c.duration_minutes ?? null,
        durationOverrideMinutes: svc.duration_minutes,
      });
    }
    if (!offersAll) continue;
    all.push({ calendarId: p.id, name: p.name, venueId: p.owning_venue_id, firstPricePence, segments });
  }
  const targets =
    params.anyAvailable || !params.calendarId ? all : all.filter((t) => t.calendarId === params.calendarId);

  const venueIds = [...new Set(targets.map((t) => t.venueId))];
  const clocks: Record<string, VenueClockRow> = {};
  await Promise.all(
    venueIds.map(async (venueId) => {
      const { data } = await admin
        .from('venues')
        .select('id, timezone, booking_rules, opening_hours, venue_opening_exceptions')
        .eq('id', venueId)
        .maybeSingle();
      if (data) clocks[venueId] = data as VenueClockRow;
    }),
  );

  let invalid: { error: string; details?: unknown } | null = null;
  const perCalendar = await Promise.all(
    targets.map(async (t): Promise<DaySlot[]> => {
      const clock = clocks[t.venueId];
      if (!clock) return [];
      try {
        const prepared = await prepareChainSegments({
          supabase: admin,
          venueId: t.venueId,
          date,
          practitionerId: t.calendarId,
          segments: t.segments,
          clock,
          bookingModel: null,
          phantoms: params.phantoms,
        });
        if (!prepared.ok) {
          if (prepared.kind === 'invalid') invalid = { error: prepared.error, details: prepared.details };
          return [];
        }
        const { starts } = computeChainStartsForPractitioner(t.calendarId, prepared.segments);
        return starts.map((s) => ({
          start_time: s.start_time,
          service_id: firstOfferingId,
          duration_minutes: s.span_minutes,
          price_pence: t.firstPricePence,
          practitioner_id: t.calendarId,
          practitioner_name: t.name,
        }));
      } catch {
        return [];
      }
    }),
  );
  if (invalid) return { ok: false, ...(invalid as { error: string; details?: unknown }) };

  if (params.anyAvailable) {
    const byTime = new Map<string, DaySlot>();
    for (const slot of perCalendar.flat()) {
      if (!byTime.has(slot.start_time)) byTime.set(slot.start_time, slot);
    }
    const pooled = [...byTime.values()].sort((a, b) => a.start_time.localeCompare(b.start_time));
    return {
      ok: true,
      payload: {
        date,
        venue_id: collectiveId,
        any_available: true,
        practitioners: [{ id: ANY_AVAILABLE_PRACTITIONER_ID, name: 'Any available', slots: pooled }],
      },
    };
  }

  return {
    ok: true,
    payload: {
      date,
      venue_id: collectiveId,
      practitioners: targets.map((t, i) => ({
        id: t.calendarId,
        name: t.name,
        slots: (perCalendar[i] ?? []).sort((a, b) => a.start_time.localeCompare(b.start_time)),
      })),
    },
  };
}
