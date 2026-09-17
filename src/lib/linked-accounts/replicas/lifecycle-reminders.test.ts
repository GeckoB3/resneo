/**
 * The lifecycle's reminders and invitation expiry (DL8; N1, N20, N21, N23, N35).
 *
 * Each reminder is queued once, on its day, keyed by the moment it is about; an invitation is
 * closed by the system at 30 days; nothing is queued before its time.
 */
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb, type RecordedCall, type Responder } from '@/lib/testing/recording-supabase';
import { runLifecycleReminders } from './lifecycle-reminders';

const NOW = Date.parse('2026-11-01T09:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();
const ahead = (days: number) => new Date(NOW + days * DAY).toISOString();

interface World {
  collective?: Record<string, unknown>;
  invitations?: Record<string, unknown>[];
  askedAt?: string | null;
  alreadyQueued?: boolean;
}

function world({ collective = {}, invitations = [], askedAt = null, alreadyQueued = false }: World): Responder {
  return (call) => {
    if (call.table === 'venue_collectives') {
      return {
        data: [
          { id: 'c-1', host_venue_id: 'host', paused_at: null, pending_host_venue_id: null, host_transfer_at: null, ...collective },
        ],
      };
    }
    if (call.table === 'venue_collective_members') return { data: invitations };
    if (call.table === 'collective_audit_events') return { data: askedAt ? [{ created_at: askedAt }] : [] };
    if (call.table === 'collective_operations') return { data: alreadyQueued ? [] : [{ id: 'op' }] };
    if (call.table === 'rpc:collective_close_invitation') return { data: 'audit-1' };
    return undefined;
  };
}

const run = async (w: World) => {
  const recording = makeRecordingDb(world(w));
  const outcome = await runLifecycleReminders(recording.db as unknown as SupabaseClient, { now: () => NOW });
  return { outcome, calls: recording.calls };
};
const queued = (calls: RecordedCall[]) =>
  calls.filter((c) => c.table === 'collective_operations').map((c) => c.payload as Record<string, unknown>);

describe('runLifecycleReminders: invitations', () => {
  const invite = (days: number) => ({ id: 'm-1', collective_id: 'c-1', venue_id: 'invitee', created_at: ago(days) });

  it('does nothing in the first week', async () => {
    const { outcome, calls } = await run({ invitations: [invite(6)] });
    expect(outcome).toEqual({ reminders: 0, invitations_expired: 0, errors: 0 });
    expect(queued(calls)).toEqual([]);
  });

  it('sends the invitation again after a week, once', async () => {
    const { outcome, calls } = await run({ invitations: [invite(8)] });
    expect(outcome.reminders).toBe(1);
    expect(queued(calls)).toEqual([
      {
        collective_id: 'c-1',
        venue_id: 'invitee',
        kind: 'notice',
        idempotency_key: 'notice:invite:m-1:7',
        progress: { notice: 'N1', member_id: 'm-1', reminder: true },
      },
    ]);
    expect((await run({ invitations: [invite(9)], alreadyQueued: true })).outcome.reminders).toBe(0);
  });

  it('closes it after 30 days, as the system', async () => {
    const { outcome, calls } = await run({ invitations: [invite(31)] });
    expect(outcome.invitations_expired).toBe(1);
    expect(calls.filter((c) => c.table === 'rpc:collective_close_invitation').map((c) => c.payload)).toEqual([
      { p_member_id: 'm-1', p_reason: 'expired', p_actor_venue_id: null, p_actor_user_id: null },
    ]);
    expect(queued(calls)).toEqual([]);
  });
});

describe('runLifecycleReminders: hosting', () => {
  it('reminds a venue asked to host after 3 days (N20)', async () => {
    const { calls } = await run({ collective: { pending_host_venue_id: 'cand' }, askedAt: ago(4) });
    expect(queued(calls)).toEqual([
      expect.objectContaining({
        venue_id: 'cand',
        idempotency_key: `notice:n20:c-1:${Date.parse(ago(4))}`,
        progress: { notice: 'N20', host_venue_id: 'host', reminder: true },
      }),
    ]);
  });

  it('waits before 3 days', async () => {
    const { calls } = await run({ collective: { pending_host_venue_id: 'cand' }, askedAt: ago(2) });
    expect(queued(calls)).toEqual([]);
  });

  it('reminds every venue 2 days before the move (N21), and not sooner', async () => {
    const soon = await run({ collective: { pending_host_venue_id: 'cand', host_transfer_at: ahead(1.5) } });
    expect(queued(soon.calls)).toEqual([
      expect.objectContaining({
        venue_id: 'cand',
        progress: { notice: 'N21', host_transfer_at: ahead(1.5), reminder: true },
      }),
    ]);
    const later = await run({ collective: { pending_host_venue_id: 'cand', host_transfer_at: ahead(5) } });
    expect(queued(later.calls)).toEqual([]);
  });

  it('reminds on day 23 of a pause (N23)', async () => {
    const { calls } = await run({ collective: { paused_at: ago(24) } });
    expect(queued(calls)).toEqual([
      expect.objectContaining({
        venue_id: 'host',
        idempotency_key: `notice:n23:c-1:${Date.parse(ago(24))}`,
        progress: { notice: 'N23', paused_at: ago(24), reminder: true },
      }),
    ]);
    expect(queued((await run({ collective: { paused_at: ago(20) } })).calls)).toEqual([]);
  });

  it('only looks at live shared-services collectives', async () => {
    const { calls } = await run({});
    const list = calls.find((c) => c.table === 'venue_collectives')!;
    expect(list.filters).toEqual(
      expect.arrayContaining([
        ['eq', 'status', 'active'],
        ['eq', 'service_model', 'replicas'],
      ]),
    );
  });
});
