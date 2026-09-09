/**
 * The staff "override availability" booking (Docs/staff-availability-override-plan.md).
 *
 * A tick box on the staff booking flow books any service with any calendar at
 * any time, over anything, and the engine's refusals come back as warnings the
 * staff member sees before saving. This module holds the pieces the three
 * routes share (`validate-appointment-slot`, `POST /api/venue/bookings`,
 * `create-multi-service`) and the catalogue route:
 *
 *  - who may use it (a staff session for the target venue: its own staff, a
 *    member of the live collective the booking goes through, or a partner
 *    holding a `create_edit_cancel` link over it);
 *  - the collective routing when the chosen calendar is not a provider of the
 *    chosen offering (any provider copy at that calendar's venue will do);
 *  - the one rule that still refuses: a date in the past;
 *  - the engine call in "collect reasons" mode;
 *  - the timeline event that records the override and its warnings.
 */
import type { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff, type VenueStaff } from '@/lib/venue-auth';
import { resolveStaffCollectiveScope } from '@/lib/linked-accounts/collective-staff-scope';
import { resolveLinkedStaffCreateScope } from '@/lib/booking/staff-booking-access';
import {
  resolveCombinedBookingTarget,
  type CombinedBookingTarget,
} from '@/lib/linked-accounts/collective-booking-bridge';
import { loadCollectiveAppointmentCatalog } from '@/lib/linked-accounts/collective-venue';
import {
  ensureServiceInAppointmentInput,
  loadServiceItemForEngine,
  validateAppointmentCustomInterval,
  type AppointmentEngineInput,
} from '@/lib/availability/appointment-engine';
import { formatYmdInTimezone } from '@/lib/venue/venue-local-clock';
import type { ProcessingTimeBlock } from '@/types/booking-models';

export type StaffOverrideActor =
  | { ok: true; staff: VenueStaff; via: 'own' | 'collective' | 'linked' }
  | { ok: false; status: 401 | 403; error: string };

/**
 * Who is asking, and whether they may override availability at `venueId`.
 * `collectiveId` is the collective the booking is routed through, when it is.
 */
export async function resolveStaffOverrideActor(
  admin: SupabaseClient,
  request: NextRequest,
  target: { venueId: string; collectiveId?: string | null },
): Promise<StaffOverrideActor> {
  let staff: VenueStaff | null = null;
  let userId: string | null = null;
  try {
    const authClient = await createVenueRouteClient(request);
    staff = await getVenueStaff(authClient);
    if (staff) {
      const { data } = await authClient.auth.getUser();
      userId = data.user?.id ?? null;
    }
  } catch {
    staff = null;
  }
  if (!staff) {
    return { ok: false, status: 401, error: 'Override availability is for signed-in staff only.' };
  }
  if (staff.venue_id === target.venueId) return { ok: true, staff, via: 'own' };
  if (target.collectiveId) {
    const scope = await resolveStaffCollectiveScope(admin, staff.venue_id, target.collectiveId);
    if (scope && scope.memberVenueIds.includes(target.venueId)) {
      return { ok: true, staff, via: 'collective' };
    }
  }
  const linked = await resolveLinkedStaffCreateScope(admin, staff.venue_id, target.venueId, userId);
  if (linked.ok) return { ok: true, staff, via: 'linked' };
  return { ok: false, status: 403, error: 'You cannot override availability for that venue.' };
}

/**
 * The venue and source service an offering books to on a calendar, for the
 * override: the calendar's own provider row when it has one, otherwise any
 * provider copy at the calendar's venue. Null when that venue has no copy of the
 * offering at all, which cannot be booked there by anyone.
 */
export async function resolveOverrideCollectiveTarget(
  admin: SupabaseClient,
  params: { collectiveId: string; offeringId: string; calendarId: string },
): Promise<CombinedBookingTarget | null> {
  const direct = await resolveCombinedBookingTarget(admin, params);
  if (direct) return direct;
  const { practitioners } = await loadCollectiveAppointmentCatalog(admin, params.collectiveId, {
    includeHiddenAddons: true,
    everyCalendar: true,
  });
  const calendar = practitioners.find((p) => p.id === params.calendarId);
  const service = calendar?.services.find((s) => s.id === params.offeringId);
  if (!calendar || !service) return null;
  return {
    venueId: calendar.owning_venue_id,
    sourceServiceId: service.source_service_id,
    pricePence: service.price_pence,
    durationMinutes: service.duration_minutes,
  };
}

/** The one date rule the override keeps: nothing is booked into the past. */
export function isBookingDateInPast(bookingDateYmd: string, venueTimezone: string): boolean {
  const today = formatYmdInTimezone(Date.now(), venueTimezone.trim() || 'Europe/London');
  return bookingDateYmd < today;
}

export const PAST_DATE_OVERRIDE_ERROR = 'Choose today or a later date.';

/**
 * Put the chosen service in front of the engine when the calendar is not
 * assigned to it (the loaders only read assigned services). Legacy venues have
 * no `service_items` and are not served by the override.
 */
export async function ensureOverrideServiceInInput(
  admin: SupabaseClient,
  input: AppointmentEngineInput,
  venueId: string,
  serviceId: string,
): Promise<boolean> {
  if (input.services.some((s) => s.id === serviceId)) return true;
  const svc = await loadServiceItemForEngine(admin, venueId, serviceId);
  if (!svc) return false;
  ensureServiceInAppointmentInput(input, svc);
  return true;
}

/**
 * The engine in "collect reasons" mode: every gate a staff member may book
 * through becomes a warning, and only the impossible still refuses.
 */
export function overrideWarningsForInterval(
  input: AppointmentEngineInput,
  practitionerId: string,
  serviceId: string,
  startHm: string,
  endHm: string,
  processingTimeBlocks?: ProcessingTimeBlock[] | null,
): { ok: true; warnings: string[] } | { ok: false; reason: string } {
  const result = validateAppointmentCustomInterval(input, practitionerId, serviceId, startHm, endHm, undefined, {
    allowUnassignedService: true,
    collectReasons: true,
    ...(processingTimeBlocks ? { processingTimeBlocks } : {}),
  });
  if (!result.ok) return { ok: false, reason: result.reason ?? 'This booking cannot be made.' };
  return { ok: true, warnings: result.warnings ?? [] };
}

/** "Balayage: outside working hours" lines for a visit, so each warning names its service. */
export function prefixWarnings(serviceName: string, warnings: readonly string[]): string[] {
  return warnings.map((w) => `${serviceName}: ${w}`);
}

/**
 * The booking's timeline says it was squeezed in, and what it overrode. The
 * `booking_created` event itself is written by a database trigger, so this is a
 * separate row beside it.
 */
export async function recordAvailabilityOverrideEvent(
  admin: SupabaseClient,
  params: { venueId: string; bookingId: string; warnings: readonly string[] },
): Promise<void> {
  const { error } = await admin.from('events').insert({
    venue_id: params.venueId,
    booking_id: params.bookingId,
    event_type: 'booking_availability_override',
    payload: { warnings: [...params.warnings] },
  });
  if (error) {
    console.error('[availability override] event insert failed:', error.message, params.bookingId);
  }
}
