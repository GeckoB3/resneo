import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The two writers of `calendar_service_assignments`, each an atomic diff with a stale check
 * (supabase/migrations/20270210120000_calendar_assignment_diff_writes.sql).
 *
 * `expected` is the set the client loaded. Pass null only for a client that sends none
 * (older app builds): its full set is still diffed, just not checked for staleness.
 */
export type AssignmentWriteResult =
  | { ok: true; added: string[]; removed: string[] }
  | { ok: false; reason: 'stale' | 'not_at_venue' | 'outside_scope' | 'error'; message?: string };

export const STALE_CALENDAR_SERVICES_MESSAGE =
  "Someone else changed this calendar's services. Refresh and try again.";
export const STALE_SERVICE_MESSAGE =
  'Someone saved a change to this service after you opened it. Reload it to see the latest version, then make your change again.';

type RpcRow = { status?: string; added?: string[] | null; removed?: string[] | null };

function toResult(data: unknown, error: { code?: string; message?: string } | null): AssignmentWriteResult {
  if (error) {
    const message = error.message ?? '';
    if (message.startsWith('ASSIGNMENT_NOT_AT_VENUE')) return { ok: false, reason: 'not_at_venue', message };
    if (message.startsWith('ASSIGNMENT_OUTSIDE_SCOPE')) return { ok: false, reason: 'outside_scope', message };
    return { ok: false, reason: 'error', message };
  }
  const row = (data ?? {}) as RpcRow;
  if (row.status === 'stale') return { ok: false, reason: 'stale' };
  if (row.status !== 'ok') return { ok: false, reason: 'error', message: `unexpected status ${String(row.status)}` };
  return { ok: true, added: row.added ?? [], removed: row.removed ?? [] };
}

export async function setCalendarServiceAssignments(
  admin: SupabaseClient,
  args: { venueId: string; calendarId: string; serviceItemIds: string[]; expectedServiceItemIds: string[] | null },
): Promise<AssignmentWriteResult> {
  const { data, error } = await admin.rpc('set_calendar_service_assignments', {
    p_venue_id: args.venueId,
    p_calendar_id: args.calendarId,
    p_service_item_ids: args.serviceItemIds,
    p_expected_service_item_ids: args.expectedServiceItemIds,
  });
  return toResult(data, error);
}

export async function setServiceCalendarAssignments(
  admin: SupabaseClient,
  args: {
    venueId: string;
    serviceItemId: string;
    calendarIds: string[];
    /** Null for an admin; a non-admin's managed calendars otherwise. */
    scopeCalendarIds: string[] | null;
    expectedCalendarIds: string[] | null;
  },
): Promise<AssignmentWriteResult> {
  const { data, error } = await admin.rpc('set_service_calendar_assignments', {
    p_venue_id: args.venueId,
    p_service_item_id: args.serviceItemId,
    p_calendar_ids: args.calendarIds,
    p_scope_calendar_ids: args.scopeCalendarIds,
    p_expected_calendar_ids: args.expectedCalendarIds,
  });
  return toResult(data, error);
}

/** Order-insensitive set equality, for the routes' early stale check before any write. */
export function sameIdSet(a: readonly string[], b: readonly string[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const id of sa) if (!sb.has(id)) return false;
  return true;
}
