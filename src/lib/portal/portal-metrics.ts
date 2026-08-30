import { getSupabaseAdminClient } from '@/lib/supabase';
import type { PortalEntryRoute } from './portal-events';

/**
 * Reading portal metrics (P0-10, serves §5B and §5A's revert thresholds).
 *
 * These exist NOW, before Phase 1, because §5A reads revert thresholds off
 * them: they have to work under pressure rather than being composed during an
 * incident. That is the whole reason the task says "write the read queries
 * too, not just the writes".
 *
 * Unlike the emitters, these DO throw. A metric that silently returns zero
 * during an incident is worse than an error: it reads as "nothing is wrong".
 */

export interface DateRange {
  /** Inclusive ISO timestamp. */
  from: string;
  /** Exclusive ISO timestamp. */
  to: string;
}

export interface PortalCompletionRate {
  entries: number;
  completions: number;
  /** completions / entries, or null when there were no entries to divide by. */
  rate: number | null;
  /** Entry counts split by how the customer arrived (§5B). */
  entriesByRoute: Record<PortalEntryRoute | 'unknown', number>;
}

/**
 * §5B: what fraction of portal entries reached an authenticated page.
 *
 * Counted as events in the window, not as a per-user join: a customer who
 * enters near the end of the range and completes just after it would
 * otherwise make the rate exceed 1 in a later window and dip in this one.
 * Reported this way the two numbers are each honest for the window, and the
 * ratio is the operational signal §5A wants.
 */
export async function getPortalCompletionRate(range: DateRange): Promise<PortalCompletionRate> {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin
    .from('portal_events')
    .select('event_type, payload')
    .in('event_type', ['portal_entry', 'portal_signin_completed'])
    .gte('created_at', range.from)
    .lt('created_at', range.to);

  if (error) throw new Error(`[portal-metrics] completion rate failed: ${error.message}`);

  const rows = (data ?? []) as Array<{ event_type: string; payload: { route?: string } | null }>;
  const entriesByRoute: Record<string, number> = {
    one_click_token: 0,
    magic_link: 0,
    direct_sign_in: 0,
    unknown: 0,
  };
  let entries = 0;
  let completions = 0;
  for (const row of rows) {
    if (row.event_type === 'portal_entry') {
      entries += 1;
      const route = row.payload?.route;
      const key = route && route in entriesByRoute ? route : 'unknown';
      entriesByRoute[key] += 1;
    } else {
      completions += 1;
    }
  }

  return {
    entries,
    completions,
    rate: entries === 0 ? null : completions / entries,
    entriesByRoute: entriesByRoute as PortalCompletionRate['entriesByRoute'],
  };
}

export interface InPortalActionShare {
  action: 'cancelled' | 'rescheduled';
  inPortal: number;
  onTokenLink: number;
  total: number;
  /** inPortal / total, or null when nothing happened in the window. */
  share: number | null;
}

/**
 * §5B: what share of cancels (or reschedules) happened in the portal rather
 * than on the emailed token page. The number Phase 1 and 2 are judged by.
 */
export async function getInPortalActionShare(
  range: DateRange,
  action: 'cancelled' | 'rescheduled',
): Promise<InPortalActionShare> {
  const admin = getSupabaseAdminClient();
  const eventType = action === 'cancelled' ? 'portal_booking_cancelled' : 'portal_booking_rescheduled';
  const { data, error } = await admin
    .from('portal_events')
    .select('payload')
    .eq('event_type', eventType)
    .gte('created_at', range.from)
    .lt('created_at', range.to);

  if (error) throw new Error(`[portal-metrics] ${action} share failed: ${error.message}`);

  const rows = (data ?? []) as Array<{ payload: { surface?: string } | null }>;
  const inPortal = rows.filter((r) => r.payload?.surface === 'portal').length;
  const onTokenLink = rows.filter((r) => r.payload?.surface === 'token_link').length;
  const total = rows.length;

  return { action, inPortal, onTokenLink, total, share: total === 0 ? null : inPortal / total };
}

/**
 * §5A's revert threshold: how many one-click tokens failed to verify in the
 * window. Nothing emits this until P3-4a, so it returns 0 until then, which
 * is the correct answer rather than a missing one.
 */
export async function getPortalTokenVerifyFailureCount(range: DateRange): Promise<number> {
  const admin = getSupabaseAdminClient();
  const { count, error } = await admin
    .from('portal_events')
    .select('id', { count: 'exact', head: true })
    .eq('event_type', 'portal_token_verify_failed')
    .gte('created_at', range.from)
    .lt('created_at', range.to);

  if (error) throw new Error(`[portal-metrics] token failure count failed: ${error.message}`);
  return count ?? 0;
}
