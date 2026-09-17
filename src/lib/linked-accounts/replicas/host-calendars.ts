/**
 * Every calendar in the collective that can offer a service, for the host (plan Appendix E contract
 * 5 `collective_calendars`; UX spec `CollectiveCalendarsSection` and the services grid; W5).
 *
 * One read for the whole page: each member venue in turn, its calendars, and which of the
 * collective's services each calendar offers, with that calendar's own values for them.
 *
 * Shape note (amends Appendix E): the plan wrote `assigned` as one boolean per calendar, which can
 * only answer for a single service. The grid (item 15) puts every service against every venue at
 * once, so a calendar carries the list of services it is assigned to instead; a page showing one
 * service looks for that service's `item_id` in the list, which means the same thing, and finds the
 * values and last_changed that went with it.
 *
 * Nothing here is written, and the answer is null at every venue that does not host a live
 * replicas-model collective, which is all of them today.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  applicableCalendarValues,
  type CalendarAssignmentRow,
  type ServiceCustomisationFlags,
} from '@/lib/booking/calendar-service-terms';
import type { CollectiveSync } from '@/lib/linked-accounts/replicas/inline-apply';

export interface CollectiveCalendarAssignment {
  item_id: string;
  /** The service at THIS venue: the master at the host, the venue's own copy at a member. */
  service_id: string;
  values: ReturnType<typeof applicableCalendarValues>;
  last_changed: { venue_name: string; at: string } | null;
}

export interface CollectiveCalendarEntry {
  id: string;
  name: string;
  is_active: boolean;
  assigned: CollectiveCalendarAssignment[];
}

export interface CollectiveCalendarGroup {
  venue_id: string;
  venue_name: string;
  is_host: boolean;
  /** How this venue's copies are doing, in the same shape as a save's answer. */
  sync: CollectiveSync;
  calendars: CollectiveCalendarEntry[];
}

type LinkRowShape = Record<string, unknown>;

const groupOrder = (a: CollectiveCalendarGroup, b: CollectiveCalendarGroup): number =>
  a.is_host === b.is_host ? a.venue_name.localeCompare(b.venue_name) : a.is_host ? -1 : 1;

/** A venue's own slice of the collective's state, in the shape a save answers in. */
function venueSync(venueId: string, venueName: string, links: LinkRowShape[]): CollectiveSync {
  const mine = links.filter((l) => l.venue_id === venueId);
  const behind = mine.filter((l) => Number(l.applied_revision) < Number(l.desired_revision));
  const failing = mine.filter((l) => Number(l.attempts) > 0 && l.last_error_code != null);
  return {
    venues: 1,
    applied: mine.length - behind.length,
    pending: behind.length > 0 ? [{ venue_id: venueId, venue_name: venueName }] : [],
    failed:
      failing.length > 0
        ? [
            {
              venue_id: venueId,
              venue_name: venueName,
              message: (failing[0].last_error as string | null) ?? 'An update did not go through.',
              code: (failing[0].last_error_code as string | null) ?? null,
            },
          ]
        : [],
  };
}

/**
 * The venue groups for `venueId`, when it hosts a live replicas-model collective. Null otherwise,
 * so the route leaves the key off rather than sending an empty list a page could read as "no
 * calendars anywhere".
 */
export async function loadHostCollectiveCalendars(
  admin: SupabaseClient,
  venueId: string,
): Promise<CollectiveCalendarGroup[] | null> {
  const { data: stateRaw } = await admin.rpc('collective_venue_live_state', { p_venue_id: venueId });
  const state = (stateRaw ?? null) as { collective_id?: string; role?: 'host' | 'member' } | null;
  if (!state?.collective_id || state.role !== 'host') return null;
  const collectiveId = state.collective_id;

  const [{ data: memberRows }, { data: itemRows }, { data: linkRows }] = await Promise.all([
    admin
      .from('venue_collective_members')
      .select('venue_id, venues!venue_id (name)')
      .eq('collective_id', collectiveId)
      .eq('status', 'active'),
    admin
      .from('collective_service_items')
      .select('id, master_service_id')
      .eq('collective_id', collectiveId)
      .eq('status', 'active'),
    admin
      .from('collective_service_replicas')
      .select('id, collective_service_item_id, venue_id, replica_service_id, applied_revision, desired_revision, attempts, last_error_code, last_error')
      .eq('collective_id', collectiveId)
      .is('released_at', null),
  ]);

  const venueNames = new Map<string, string>();
  for (const row of memberRows ?? []) {
    const joined = row.venues as { name?: string } | { name?: string }[] | null;
    const name = (Array.isArray(joined) ? joined[0]?.name : joined?.name) ?? 'Venue';
    venueNames.set(row.venue_id as string, name);
  }
  const memberVenueIds = [...venueNames.keys()];
  if (memberVenueIds.length === 0) return [];
  const links = (linkRows ?? []) as LinkRowShape[];

  const items = (itemRows ?? [])
    .map((i) => ({ id: i.id as string, masterServiceId: (i.master_service_id as string | null) ?? null }))
    .filter((i): i is { id: string; masterServiceId: string } => i.masterServiceId !== null);

  // (venue, service) -> the offering it belongs to: the host's master, or a member's own copy.
  const itemByVenueService = new Map<string, string>();
  const key = (v: string, s: string) => `${v}:${s}`;
  for (const item of items) itemByVenueService.set(key(venueId, item.masterServiceId), item.id);
  for (const link of links) {
    const serviceId = link.replica_service_id as string | null;
    if (serviceId) {
      itemByVenueService.set(key(link.venue_id as string, serviceId), link.collective_service_item_id as string);
    }
  }

  const serviceIds = [
    ...new Set([
      ...items.map((i) => i.masterServiceId),
      ...links.map((l) => l.replica_service_id as string | null).filter((s): s is string => Boolean(s)),
    ]),
  ];

  const { data: calendarRows } = await admin
    .from('unified_calendars')
    .select('id, venue_id, name, is_active')
    .in('venue_id', memberVenueIds)
    // People only: a bookable room is a resource, never a calendar that offers a service.
    .or('calendar_type.eq.practitioner,calendar_type.is.null');
  const calendarIds = (calendarRows ?? []).map((c) => c.id as string);

  const [assignmentsRes, servicesRes] = await Promise.all([
    calendarIds.length > 0 && serviceIds.length > 0
      ? admin.from('calendar_service_assignments').select('*').in('calendar_id', calendarIds).in('service_item_id', serviceIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    serviceIds.length > 0
      ? admin.from('service_items').select('*').in('id', serviceIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);

  // The master's flags decide what a calendar may hold (TERMS-14, D29). A copy carries the same
  // flags, so its own row answers for it and no cross-venue lookup is needed.
  const flagsByService = new Map<string, ServiceCustomisationFlags>(
    ((servicesRes.data ?? []) as Record<string, unknown>[]).map((s) => [s.id as string, s as ServiceCustomisationFlags]),
  );
  const assignmentsByCalendar = new Map<string, Record<string, unknown>[]>();
  for (const row of (assignmentsRes.data ?? []) as Record<string, unknown>[]) {
    const cid = row.calendar_id as string;
    assignmentsByCalendar.set(cid, [...(assignmentsByCalendar.get(cid) ?? []), row]);
  }

  const groups: CollectiveCalendarGroup[] = memberVenueIds.map((memberVenueId) => ({
    venue_id: memberVenueId,
    venue_name: venueNames.get(memberVenueId) ?? 'Venue',
    is_host: memberVenueId === venueId,
    sync: venueSync(memberVenueId, venueNames.get(memberVenueId) ?? 'Venue', links),
    calendars: (calendarRows ?? [])
      .filter((c) => c.venue_id === memberVenueId)
      .map((c) => ({
        id: c.id as string,
        name: (c.name as string) ?? 'Calendar',
        is_active: c.is_active !== false,
        assigned: (assignmentsByCalendar.get(c.id as string) ?? [])
          .map((row) => {
            const serviceId = row.service_item_id as string;
            const itemId = itemByVenueService.get(key(memberVenueId, serviceId));
            if (!itemId) return null;
            const changedBy = (row.updated_by_venue_id as string | null) ?? null;
            const changedAt = (row.updated_at as string | null) ?? null;
            const assignment: CollectiveCalendarAssignment = {
              item_id: itemId,
              service_id: serviceId,
              values: applicableCalendarValues(row as CalendarAssignmentRow, flagsByService.get(serviceId)),
              last_changed:
                changedBy && changedAt ? { venue_name: venueNames.get(changedBy) ?? 'A venue', at: changedAt } : null,
            };
            return assignment;
          })
          .filter((a): a is CollectiveCalendarAssignment => a !== null),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }));

  // The host first, then members A to Z, which is the order the section renders in.
  return groups.sort(groupOrder);
}
