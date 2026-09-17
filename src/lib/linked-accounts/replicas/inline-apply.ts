/**
 * Applying members' copies inline after a host action, and saying what happened (plan §6.4 "When
 * applies run"; W5).
 *
 * Every host route that can change what members offer runs the applies itself, within a short time
 * budget, and answers in one shape: `collective_sync`. What the budget did not reach is `pending`
 * and the cron picks it up within five minutes, so a slow member never holds up the host's save.
 *
 * `{ venues, applied, pending: [{ venue_id, venue_name }], failed: [{ venue_id, venue_name, message,
 * code }], audit_event_id }`, so the host sees "Saved. {service} is up to date at {venues}" or
 * "Saved. {venue} is updating."
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface CollectiveSyncVenue {
  venue_id: string;
  venue_name: string;
}

export interface CollectiveSyncFailure extends CollectiveSyncVenue {
  message: string;
  code: string | null;
}

export interface CollectiveSync {
  /** How many venues the action reached. */
  venues: number;
  applied: number;
  pending: CollectiveSyncVenue[];
  failed: CollectiveSyncFailure[];
  /** The master_changed row this save wrote, for the 60 second undo. */
  audit_event_id?: string | null;
  /** Calendars the engine refused during this save; the rest of the save still stands. */
  calendar_failures?: { venue_id: string; calendar_id: string; message: string }[];
}

/** A host save waits this long for members to catch up before leaving the rest to the cron. */
const DEFAULT_BUDGET_MS = 4_000;

interface LinkRow {
  id: string;
  venue_id: string;
  venue_name: string;
  behind: boolean;
}

/** The live links given, with their venue names and whether they are already up to date. */
export async function loadLinksForSync(admin: SupabaseClient, linkIds: string[]): Promise<LinkRow[]> {
  const ids = [...new Set(linkIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const { data, error } = await admin
    .from('collective_service_replicas')
    .select('id, venue_id, applied_revision, desired_revision, venues:venue_id (name)')
    .in('id', ids)
    .is('released_at', null);
  if (error) {
    console.error('[collective] could not read replica links for the sync report:', error.message);
    return [];
  }
  return (data ?? []).map((row) => {
    const venue = row.venues as { name?: string } | { name?: string }[] | null;
    const name = Array.isArray(venue) ? venue[0]?.name : venue?.name;
    return {
      id: row.id as string,
      venue_id: row.venue_id as string,
      venue_name: name ?? 'Venue',
      behind: Number(row.applied_revision) < Number(row.desired_revision),
    };
  });
}

/**
 * Apply each link in its own call, oldest first, until the budget runs out. Every link that is not
 * reached, or is still behind afterwards, is `pending`.
 */
export async function applyLinksInline(
  admin: SupabaseClient,
  linkIds: string[],
  options: { budgetMs?: number; job?: string; actorVenueId?: string | null; actorUserId?: string | null; now?: () => number } = {},
): Promise<CollectiveSync> {
  const clock = options.now ?? Date.now;
  const started = clock();
  const budget = options.budgetMs ?? DEFAULT_BUDGET_MS;
  const links = await loadLinksForSync(admin, linkIds);
  const sync: CollectiveSync = { venues: new Set(links.map((l) => l.venue_id)).size, applied: 0, pending: [], failed: [] };

  for (const link of links) {
    if (!link.behind) continue;
    if (clock() - started >= budget) {
      sync.pending.push({ venue_id: link.venue_id, venue_name: link.venue_name });
      continue;
    }
    const { data, error } = await admin.rpc('collective_apply_replica', {
      p_link_id: link.id,
      p_actor_venue_id: options.actorVenueId ?? null,
      p_actor_user_id: options.actorUserId ?? null,
      p_job: options.job ?? 'inline',
    });
    if (error) {
      sync.failed.push({
        venue_id: link.venue_id,
        venue_name: link.venue_name,
        message: 'This venue could not be updated. It will be retried automatically.',
        code: error.code ?? null,
      });
      continue;
    }
    const result = (data ?? {}) as { ok?: boolean; error_code?: string | null };
    if (result.ok === true) {
      sync.applied += 1;
    } else if (result.error_code === 'membership_inactive') {
      // The venue left, or its membership stopped, between the host's action and the apply.
      continue;
    } else {
      sync.failed.push({
        venue_id: link.venue_id,
        venue_name: link.venue_name,
        message: 'This venue could not be updated. It will be retried automatically.',
        code: result.error_code ?? null,
      });
    }
  }
  return sync;
}
