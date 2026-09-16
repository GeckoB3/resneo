/**
 * The waitlist on the collective page (plan D43, SB-33; test WAIT-01; W19).
 *
 * A waitlist entry belongs to a venue, because that venue's cancellations are what offer the time.
 * On the collective page the guest waits for an offering, perhaps with a person in mind, so the
 * entry is filed at the venue that can actually offer it:
 *   - with a person chosen, that person's venue;
 *   - otherwise the venue with the most calendars offering the service, among the venues that run
 *     a waitlist, ties broken by name so the choice is stable.
 * A venue with its waitlist switched off never receives an entry, since nothing there would offer it.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadCollectiveAppointmentCatalog } from '@/lib/linked-accounts/collective-venue';
import { parseVenueFeatureFlags, resolveAppointmentsFeatureFlag } from '@/lib/feature-flags/resolve';
import { ANY_AVAILABLE_PRACTITIONER_ID } from '@/lib/availability/appointment-any-practitioner';

export type CollectiveWaitlistTarget =
  | { ok: true; venueId: string; serviceId: string; calendarId: string | null }
  | { ok: false; status: 400 | 409; error: string };

export async function resolveCollectiveWaitlistTarget(
  admin: SupabaseClient,
  params: { collectiveId: string; offeringId: string; calendarId: string | null },
): Promise<CollectiveWaitlistTarget> {
  const { practitioners } = await loadCollectiveAppointmentCatalog(admin, params.collectiveId);
  const offering = practitioners
    .map((p) => ({ calendar: p, service: p.services.find((s) => s.id === params.offeringId) }))
    .filter((x): x is { calendar: (typeof practitioners)[number]; service: NonNullable<typeof x.service> } =>
      Boolean(x.service),
    );
  if (offering.length === 0) return { ok: false, status: 400, error: 'That service is not on this booking page.' };

  const venueIds = [...new Set(offering.map((o) => o.calendar.owning_venue_id))];
  const { data: venues } = await admin.from('venues').select('id, name, feature_flags').in('id', venueIds);
  const waitlistOn = new Map<string, boolean>();
  const names = new Map<string, string>();
  for (const v of venues ?? []) {
    waitlistOn.set(v.id as string, resolveAppointmentsFeatureFlag('waitlist_v2', parseVenueFeatureFlags(v.feature_flags)));
    names.set(v.id as string, (v.name as string | null) ?? '');
  }

  const calendarId =
    params.calendarId && params.calendarId !== ANY_AVAILABLE_PRACTITIONER_ID ? params.calendarId : null;
  if (calendarId) {
    const chosen = offering.find((o) => o.calendar.id === calendarId);
    if (!chosen) return { ok: false, status: 400, error: 'That person does not offer this service.' };
    const venueId = chosen.calendar.owning_venue_id;
    if (!waitlistOn.get(venueId)) {
      return {
        ok: false,
        status: 409,
        error: `${names.get(venueId) || 'That venue'} does not keep a waitlist. Choose "No preference" to wait for anyone who offers it.`,
      };
    }
    return { ok: true, venueId, serviceId: chosen.service.source_service_id, calendarId };
  }

  const counts = new Map<string, number>();
  for (const o of offering) {
    if (!waitlistOn.get(o.calendar.owning_venue_id)) continue;
    counts.set(o.calendar.owning_venue_id, (counts.get(o.calendar.owning_venue_id) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || (names.get(a[0]) ?? '').localeCompare(names.get(b[0]) ?? '') || a[0].localeCompare(b[0]),
  )[0];
  if (!best) return { ok: false, status: 409, error: 'The waitlist is not open for this service.' };
  const service = offering.find((o) => o.calendar.owning_venue_id === best[0])!.service;
  return { ok: true, venueId: best[0], serviceId: service.source_service_id, calendarId: null };
}
