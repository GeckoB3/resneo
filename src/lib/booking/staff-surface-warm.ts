import { appointmentCatalogUrl, linkedVenueProfileUrl } from './booking-flow-api';

/**
 * The requests that stand between a "New booking" click on a staff surface and
 * a usable form: the venue profile (own venue, linked venue or collective) and
 * the appointment catalogue. The stack used to fetch the profile, mount the flow
 * once it answered, and only then let the flow fetch the catalogue, so the two
 * ran one after the other; React's strict-mode double effects fetched each
 * twice in development as well. Both now go through one short-lived, shared
 * in-flight cache, and the diary starts them as soon as its New or Walk-in
 * button is hovered, so by the time the form mounts the answers are usually
 * already on their way or in hand.
 *
 * Entries live a few seconds only: long enough to cover one form opening, short
 * enough that a service or calendar edited elsewhere is not shown stale.
 */
export interface SharedJsonResponse {
  ok: boolean;
  status: number;
  data: unknown;
}

const SHARED_TTL_MS = 8_000;
const entries = new Map<
  string,
  { at: number; promise: Promise<SharedJsonResponse>; via: typeof globalThis.fetch }
>();

/**
 * GET `url` once per TTL window; concurrent callers share the same promise. An
 * entry belongs to the `fetch` that made it: a swapped global fetch (which is
 * how tests stub the network, one stub per test) starts a fresh generation, so
 * nothing is served from a stub that has since been replaced.
 */
export function fetchJsonShared(url: string, ttlMs: number = SHARED_TTL_MS): Promise<SharedJsonResponse> {
  const now = Date.now();
  const via = globalThis.fetch;
  const hit = entries.get(url);
  if (hit && hit.via === via && now - hit.at < ttlMs) return hit.promise;
  const promise = via(url).then(async (res) => {
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { ok: res.ok, status: res.status, data };
  });
  entries.set(url, { at: now, promise, via });
  // A failure is not worth remembering: the next caller should try again.
  promise.then(
    (r) => {
      if (!r.ok && entries.get(url)?.promise === promise) entries.delete(url);
    },
    () => {
      if (entries.get(url)?.promise === promise) entries.delete(url);
    },
  );
  return promise;
}

/** Forget everything (tests, or after a write that changes what the form shows). */
export function clearSharedJsonCache(): void {
  entries.clear();
}

/**
 * Start the profile and catalogue requests for a staff booking surface. Safe to
 * call repeatedly (a hover, a focus, then the mount): the cache dedupes.
 */
export function warmStaffBookingSurface(params: { venueId: string; linkedOwnerVenueId?: string | null }): void {
  const target = params.linkedOwnerVenueId ?? params.venueId;
  void fetchJsonShared(params.linkedOwnerVenueId ? linkedVenueProfileUrl(params.linkedOwnerVenueId) : '/api/venue');
  void fetchJsonShared(appointmentCatalogUrl(target, undefined, true));
}
