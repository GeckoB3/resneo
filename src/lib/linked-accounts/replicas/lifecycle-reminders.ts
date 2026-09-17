/**
 * The lifecycle's reminders and invitation expiry (plan §6.7, DL8, Appendix C "notice holds one-off
 * reminders keyed by subject and day"; UX spec §4 N1, N20, N21, N23, N35; W7).
 *
 * Run daily by the verify cron on shared-services collectives:
 *   N1   an invitation still open after 7 days is sent again;
 *   N35  an invitation still open after 30 days closes (collective_close_invitation, 'expired');
 *   N20  a venue asked to host that has not answered in 3 days is reminded;
 *   N21  every live venue is reminded 2 days before hosting moves;
 *   N23  every live venue is reminded on day 23 of a pause, a week before the page would end.
 *
 * Each reminder is a `notice` job with a key naming its subject and the moment it is about, so a
 * daily run queues it once, and a new request, date or pause gets its own. The notice drain checks
 * that the reminder still applies before sending it.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const INVITE_REMIND_AFTER_MS = 7 * DAY_MS;
export const INVITE_EXPIRES_AFTER_MS = 30 * DAY_MS;
export const HOST_REQUEST_REMIND_AFTER_MS = 3 * DAY_MS;
export const HOST_MOVE_REMIND_BEFORE_MS = 2 * DAY_MS;
export const PAUSE_REMIND_AFTER_MS = 23 * DAY_MS;

type Row = Record<string, unknown>;

export interface LifecycleReminderOutcome {
  reminders: number;
  invitations_expired: number;
  errors: number;
}

export async function runLifecycleReminders(
  admin: SupabaseClient,
  opts: { now?: () => number } = {},
): Promise<LifecycleReminderOutcome> {
  const now = (opts.now ?? Date.now)();
  const outcome: LifecycleReminderOutcome = { reminders: 0, invitations_expired: 0, errors: 0 };

  const { data: collectives, error } = await admin
    .from('venue_collectives')
    .select('id, host_venue_id, paused_at, pending_host_venue_id, host_transfer_at')
    .eq('status', 'active')
    .eq('service_model', 'replicas');
  if (error) {
    console.error('[collective] reminders could not list collectives:', error.message);
    return { ...outcome, errors: 1 };
  }
  const list = (collectives ?? []) as Row[];
  if (list.length === 0) return outcome;

  const queue = async (row: {
    collectiveId: string;
    venueId: string | null;
    key: string;
    progress: Record<string, unknown>;
  }) => {
    const { data, error: queueError } = await admin
      .from('collective_operations')
      .upsert(
        {
          collective_id: row.collectiveId,
          venue_id: row.venueId,
          kind: 'notice',
          idempotency_key: row.key,
          progress: { ...row.progress, reminder: true },
        },
        { onConflict: 'idempotency_key', ignoreDuplicates: true },
      )
      .select('id');
    if (queueError) throw new Error(queueError.message);
    // A reminder queued on an earlier day comes back empty.
    if (Array.isArray(data) && data.length > 0) outcome.reminders += 1;
  };
  const attempt = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      outcome.errors += 1;
      console.error(`[collective] ${label} failed:`, err instanceof Error ? err.message : err);
    }
  };

  // Invitations.
  const { data: invitations } = await admin
    .from('venue_collective_members')
    .select('id, collective_id, venue_id, created_at')
    .in('collective_id', list.map((c) => c.id as string))
    .eq('status', 'invited');
  for (const invite of (invitations ?? []) as Row[]) {
    const age = now - Date.parse(invite.created_at as string);
    if (age >= INVITE_EXPIRES_AFTER_MS) {
      await attempt(`invitation expiry ${invite.id as string}`, async () => {
        const { data, error: closeError } = await admin.rpc('collective_close_invitation', {
          p_member_id: invite.id,
          p_reason: 'expired',
          p_actor_venue_id: null,
          p_actor_user_id: null,
        });
        if (closeError) throw new Error(closeError.message);
        if (data) outcome.invitations_expired += 1;
      });
    } else if (age >= INVITE_REMIND_AFTER_MS) {
      await attempt(`invitation reminder ${invite.id as string}`, () =>
        queue({
          collectiveId: invite.collective_id as string,
          venueId: invite.venue_id as string,
          key: `notice:invite:${invite.id as string}:7`,
          progress: { notice: 'N1', member_id: invite.id },
        }),
      );
    }
  }

  for (const c of list) {
    const collectiveId = c.id as string;
    const candidate = (c.pending_host_venue_id as string | null) ?? null;
    const moveAt = (c.host_transfer_at as string | null) ?? null;

    // N20: asked, not yet answered.
    if (candidate && !moveAt) {
      await attempt(`host request reminder ${collectiveId}`, async () => {
        const { data: requests } = await admin
          .from('collective_audit_events')
          .select('created_at')
          .eq('collective_id', collectiveId)
          .eq('event_type', 'host_transfer_requested')
          .order('created_at', { ascending: false })
          .limit(1);
        const askedAt = (requests ?? [])[0]?.created_at as string | undefined;
        if (!askedAt || now - Date.parse(askedAt) < HOST_REQUEST_REMIND_AFTER_MS) return;
        await queue({
          collectiveId,
          venueId: candidate,
          key: `notice:n20:${collectiveId}:${Date.parse(askedAt)}`,
          progress: { notice: 'N20', host_venue_id: c.host_venue_id },
        });
      });
    }

    // N21: two days before the move.
    if (candidate && moveAt) {
      const until = Date.parse(moveAt) - now;
      if (until > 0 && until <= HOST_MOVE_REMIND_BEFORE_MS) {
        await attempt(`host move reminder ${collectiveId}`, () =>
          queue({
            collectiveId,
            venueId: candidate,
            key: `notice:n21:${collectiveId}:${Date.parse(moveAt)}`,
            progress: { notice: 'N21', host_transfer_at: moveAt },
          }),
        );
      }
    }

    // N23: day 23 of a pause.
    const pausedAt = (c.paused_at as string | null) ?? null;
    if (pausedAt && now - Date.parse(pausedAt) >= PAUSE_REMIND_AFTER_MS) {
      await attempt(`pause reminder ${collectiveId}`, () =>
        queue({
          collectiveId,
          venueId: c.host_venue_id as string,
          key: `notice:n23:${collectiveId}:${Date.parse(pausedAt)}`,
          progress: { notice: 'N23', paused_at: pausedAt },
        }),
      );
    }
  }
  return outcome;
}
