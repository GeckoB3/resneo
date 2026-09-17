/**
 * Parked services (plan §6.6, D2 as revised 2026-09-14): while a venue is live in a replicas-model
 * collective, only the collective's services may take new bookings there.
 *
 * The database is the backstop: `trg_bookings_refuse_parked_service` refuses the write with RN007
 * (20270217120000). Routes check first, with this helper, so a guest or staff member gets the plain
 * message before any payment is set up, and listings and availability can leave parked services out.
 *
 * Deliberately fails open. If the lookup cannot be read, nothing is filtered here and the trigger still
 * refuses the booking: a failed read must never stop every booking on the platform.
 */
import { collectiveDbError, type CollectiveDbError, type CollectiveNames } from '@/lib/linked-accounts/replicas/db-errors';
import type { RpcClient } from '@/lib/linked-accounts/replicas/crons';

/** Null when nothing is parked at the venue (it is not live in a replicas-model collective). */
export async function loadBookableServiceIds(client: RpcClient, venueId: string): Promise<Set<string> | null> {
  const { data, error } = await client.rpc('collective_bookable_service_ids', { p_venue_id: venueId });
  if (error) {
    console.error('[parking] bookable services lookup failed; not filtering', { venueId, error: error.message });
    return null;
  }
  if (!Array.isArray(data)) return null;
  return new Set(data.filter((id): id is string => typeof id === 'string'));
}

export function isParked(bookable: Set<string> | null, serviceId: string | null | undefined): boolean {
  return Boolean(bookable && serviceId && !bookable.has(serviceId));
}

/** Keep only services that may take new bookings; a list is returned unchanged when nothing is parked. */
export function withoutParked<T>(items: T[], bookable: Set<string> | null, idOf: (item: T) => string): T[] {
  return bookable ? items.filter((item) => bookable.has(idOf(item))) : items;
}

/**
 * The coded 409 a create route answers when any requested service is parked, or null. One lookup per
 * venue. Event and class sessions are never parked, so callers pass appointment services only.
 */
export async function parkedServiceRefusal(
  client: RpcClient,
  requested: { venueId: string; serviceItemId: string | null | undefined }[],
  names: CollectiveNames = {},
): Promise<CollectiveDbError | null> {
  const byVenue = new Map<string, Set<string>>();
  for (const r of requested) {
    if (!r.serviceItemId) continue;
    const set = byVenue.get(r.venueId) ?? new Set<string>();
    set.add(r.serviceItemId);
    byVenue.set(r.venueId, set);
  }
  for (const [venueId, serviceIds] of byVenue) {
    const bookable = await loadBookableServiceIds(client, venueId);
    if (!bookable) continue;
    for (const id of serviceIds) {
      if (!bookable.has(id)) {
        return collectiveDbError({ code: 'RN007', message: 'COLLECTIVE_SERVICE_PARKED' }, names);
      }
    }
  }
  return null;
}
