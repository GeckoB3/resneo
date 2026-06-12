import type { SupabaseClient } from '@supabase/supabase-js';
import { isUnifiedSchedulingVenue } from '@/lib/booking/unified-scheduling';
import { loadVenueCatalogueData, normaliseServiceNameForMerge } from './catalogue';

/**
 * Cross-venue service duplication for combined booking pages.
 *
 * When the host assigns a calendar from a venue that does NOT offer an offering's
 * service, the service is DUPLICATED into that venue — a real, same-named service in
 * the venue's own catalogue, linked to the chosen calendar — so both venues can
 * genuinely book and use it. Model-aware: unified venues use `service_items` +
 * `calendar_service_assignments`; legacy venues use `appointment_services` +
 * `practitioner_services`. The duplicated service is a normal venue service and
 * persists if the collective is later dissolved (non-destructive).
 */

/** Service columns shared by `service_items` and `appointment_services`, copied for fidelity. */
const RICH_COLUMNS = [
  'description',
  'buffer_minutes',
  'deposit_pence',
  'colour',
  'payment_requirement',
  'max_advance_booking_days',
  'min_booking_notice_hours',
  'cancellation_notice_hours',
  'allow_same_day_booking',
  'booking_interval_minutes',
  'booking_minute_marks',
] as const;

export interface OfferingTemplate {
  /** Canonical offering name — the duplicated service takes this name. */
  name: string;
  durationMinutes: number;
  pricePence: number | null;
  /** Rich fields copied from the offering's origin service (shared columns), if any. */
  rich: Record<string, unknown> | null;
}

async function venueIsUnified(admin: SupabaseClient, venueId: string): Promise<boolean> {
  const { data } = await admin.from('venues').select('booking_model').eq('id', venueId).maybeSingle();
  return isUnifiedSchedulingVenue((data?.booking_model as string) ?? '');
}

/**
 * Derive the template to duplicate from for an offering: the canonical name/duration/price
 * (from the offering, falling back to its origin service) plus the origin service's rich
 * fields. The origin is taken from an existing active provider of the offering — the member
 * venue that already has the real service.
 */
export async function loadOfferingTemplate(
  admin: SupabaseClient,
  itemId: string,
): Promise<OfferingTemplate | null> {
  const { data: offering } = await admin
    .from('collective_service_items')
    .select('name, default_duration_minutes, default_price_pence')
    .eq('id', itemId)
    .maybeSingle();
  if (!offering) return null;

  const name = (offering.name as string) ?? '';
  let rich: Record<string, unknown> | null = null;
  let tplDuration: number | null = null;
  let tplPrice: number | null = null;

  const { data: provider } = await admin
    .from('collective_service_providers')
    .select('venue_id, source_service_id')
    .eq('item_id', itemId)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (provider) {
    const unified = await venueIsUnified(admin, provider.venue_id as string);
    const table = unified ? 'service_items' : 'appointment_services';
    const { data: svc } = await admin
      .from(table)
      .select(
        'duration_minutes, price_pence, description, buffer_minutes, deposit_pence, colour, payment_requirement, max_advance_booking_days, min_booking_notice_hours, cancellation_notice_hours, allow_same_day_booking, booking_interval_minutes, booking_minute_marks',
      )
      .eq('id', provider.source_service_id as string)
      .maybeSingle();
    if (svc) {
      const row = svc as Record<string, unknown>;
      tplDuration = (row.duration_minutes as number | null) ?? null;
      tplPrice = (row.price_pence as number | null) ?? null;
      rich = {};
      for (const c of RICH_COLUMNS) {
        if (row[c] !== undefined && row[c] !== null) rich[c] = row[c];
      }
    }
  }

  const durationMinutes = (offering.default_duration_minutes as number | null) ?? tplDuration ?? 30;
  const pricePence = (offering.default_price_pence as number | null) ?? tplPrice ?? null;
  return { name, durationMinutes: durationMinutes || 30, pricePence, rich };
}

async function linkCalendarToService(
  admin: SupabaseClient,
  unified: boolean,
  calendarId: string,
  serviceId: string,
): Promise<boolean> {
  if (unified) {
    const { error } = await admin
      .from('calendar_service_assignments')
      .upsert(
        { calendar_id: calendarId, service_item_id: serviceId },
        { onConflict: 'calendar_id,service_item_id', ignoreDuplicates: true },
      );
    return !error;
  }
  const { error } = await admin
    .from('practitioner_services')
    .upsert(
      { practitioner_id: calendarId, service_id: serviceId },
      { onConflict: 'practitioner_id,service_id', ignoreDuplicates: true },
    );
  return !error;
}

async function createServiceInVenue(
  admin: SupabaseClient,
  unified: boolean,
  venueId: string,
  name: string,
  template: OfferingTemplate | null,
): Promise<string | null> {
  const base: Record<string, unknown> = {
    venue_id: venueId,
    name,
    duration_minutes: template?.durationMinutes ?? 30,
    price_pence: template?.pricePence ?? null,
    is_active: true,
    sort_order: 0,
    ...(template?.rich ?? {}),
  };
  if (unified) {
    Object.assign(base, {
      item_type: 'service',
      price_type: 'fixed',
      is_bookable_online: true,
      processing_time_minutes: 0,
    });
    const { data, error } = await admin.from('service_items').insert(base).select('id').single();
    return error || !data ? null : (data.id as string);
  }
  const { data, error } = await admin.from('appointment_services').insert(base).select('id').single();
  return error || !data ? null : (data.id as string);
}

/**
 * Resolve which service a calendar should book an offering as, in the calendar's OWN venue,
 * creating/linking as needed:
 *  1. the calendar already offers a same-named service → use it;
 *  2. the venue has a same-named service on another calendar → link this calendar to it;
 *  3. otherwise → duplicate the offering's service into the venue and link the calendar.
 */
export async function ensureServiceForCalendar(
  admin: SupabaseClient,
  args: {
    targetVenueId: string;
    targetCalendarId: string;
    offeringName: string;
    template: OfferingTemplate | null;
  },
): Promise<{ sourceServiceId: string; created: boolean } | { error: string }> {
  const { targetVenueId, targetCalendarId, offeringName } = args;
  const key = normaliseServiceNameForMerge(offeringName);
  const data = await loadVenueCatalogueData(admin, targetVenueId);

  if (!data.calendars.has(targetCalendarId)) {
    return { error: 'That calendar does not belong to the chosen venue.' };
  }

  // 1. Calendar already offers a same-named service.
  for (const [sid, svc] of data.services) {
    if (
      normaliseServiceNameForMerge(svc.name) === key &&
      (data.serviceCalendars.get(sid) ?? []).includes(targetCalendarId)
    ) {
      return { sourceServiceId: sid, created: false };
    }
  }

  const unified = await venueIsUnified(admin, targetVenueId);

  // 2. Venue has a same-named service elsewhere → link this calendar to it.
  for (const [sid, svc] of data.services) {
    if (normaliseServiceNameForMerge(svc.name) === key) {
      const linked = await linkCalendarToService(admin, unified, targetCalendarId, sid);
      if (!linked) return { error: 'Failed to assign the service to the calendar.' };
      return { sourceServiceId: sid, created: false };
    }
  }

  // 3. Duplicate the service into the venue, then link the calendar.
  const newId = await createServiceInVenue(admin, unified, targetVenueId, offeringName, args.template);
  if (!newId) return { error: 'Failed to create the service.' };
  const linked = await linkCalendarToService(admin, unified, targetCalendarId, newId);
  if (!linked) return { error: 'Failed to assign the new service to the calendar.' };
  return { sourceServiceId: newId, created: true };
}
