/**
 * The support console's collective panel (plan §6.16): what it shows, and its one action.
 */
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb, type Responder } from '@/lib/testing/recording-supabase';
import { listSupportCollectives, loadSupportCollective, retrySupportLink } from './collective-support';

const link = (id: string, venueId: string, desired: number, applied: number, attempts = 0, code: string | null = null) => ({
  id,
  collective_id: 'c-1',
  venue_id: venueId,
  collective_service_item_id: 'item-1',
  desired_revision: desired,
  applied_revision: applied,
  behind_since: applied < desired ? '2026-10-01T09:00:00Z' : null,
  attempts,
  last_error_code: code,
  last_error: code ? 'form missing' : null,
  released_at: null,
});

const links = [link('l-ok', 'member', 3, 3), link('l-behind', 'member', 4, 3), link('l-fail', 'third', 4, 2, 3, 'RN005')];

const world: Responder = (call) => {
  if (call.table === 'venue_collectives') {
    const row = {
      id: 'c-1',
      name: 'Northside',
      slug: 'northside',
      status: 'active',
      service_model: 'replicas',
      host_venue_id: 'host',
      paused_at: null,
      paused_reason: null,
      dissolved_at: null,
    };
    return { data: call.filters.some((f) => f[0] === 'eq' && f[1] === 'id') ? row : [row] };
  }
  if (call.table === 'venue_collective_members') {
    return {
      data: [
        { collective_id: 'c-1', venue_id: 'host', status: 'active', suspended_at: null },
        { collective_id: 'c-1', venue_id: 'member', status: 'active', suspended_at: null },
        { collective_id: 'c-1', venue_id: 'third', status: 'active', suspended_at: '2026-10-01T00:00:00Z' },
        { collective_id: 'c-1', venue_id: 'invitee', status: 'invited', suspended_at: null },
      ],
    };
  }
  if (call.table === 'collective_service_replicas') {
    const one = call.filters.find((f) => f[0] === 'eq' && f[1] === 'id');
    if (one) return { data: links.find((l) => l.id === one[2]) ?? null };
    return { data: links };
  }
  if (call.table === 'venues') {
    return {
      data: [
        { id: 'host', name: 'Host Venue' },
        { id: 'member', name: 'Zen Studio' },
        { id: 'third', name: 'Bloom' },
        { id: 'invitee', name: 'Cedar' },
      ],
    };
  }
  if (call.table === 'collective_service_items') return { data: [{ id: 'item-1', name: 'Cut' }] };
  if (call.table === 'collective_audit_events') {
    return {
      data: [
        {
          id: 'e-1',
          created_at: '2026-10-01T10:00:00Z',
          event_type: 'replica_failed',
          actor_type: 'system',
          actor_venue_name: null,
          target_venue_name: 'Bloom',
          system_job: 'collective-replicate',
        },
      ],
    };
  }
  if (call.table === 'rpc:collective_apply_replica') return { data: { ok: false, error: 'form missing' } };
  return undefined;
};
const db = () => makeRecordingDb(world);

describe('listSupportCollectives', () => {
  it('counts venues, invitations and links that are behind or failing', async () => {
    const rows = await listSupportCollectives(db().db as unknown as SupabaseClient);
    expect(rows).toEqual([
      {
        id: 'c-1',
        name: 'Northside',
        slug: 'northside',
        status: 'active',
        service_model: 'replicas',
        host_name: 'Host Venue',
        venue_count: 3,
        invited_count: 1,
        paused: false,
        links_behind: 2,
        links_failing: 1,
      },
    ]);
  });
});

describe('loadSupportCollective', () => {
  it("shows each venue's health, the links and the last events, and reads no guests or bookings", async () => {
    const recording = db();
    const detail = (await loadSupportCollective(recording.db as unknown as SupabaseClient, 'c-1'))!;
    expect(detail.venues.map((v) => [v.venue_name, v.is_host, v.suspended, v.behind, v.failing])).toEqual([
      ['Host Venue', true, false, 0, 0],
      ['Bloom', false, true, 1, 1],
      ['Cedar', false, false, 0, 0],
      ['Zen Studio', false, false, 1, 0],
    ]);
    expect(detail.links.find((l) => l.id === 'l-fail')).toMatchObject({
      venue_name: 'Bloom',
      service_name: 'Cut',
      applied_revision: 2,
      desired_revision: 4,
      attempts: 3,
      last_error_code: 'RN005',
    });
    expect(detail.events).toEqual([
      { id: 'e-1', at: '2026-10-01T10:00:00Z', type: 'replica_failed', actor: 'System', target: 'Bloom', job: 'collective-replicate' },
    ]);
    expect(recording.calls.some((c) => c.table === 'guests' || c.table === 'bookings')).toBe(false);
  });

  it('is null for an unknown collective', async () => {
    const recording = makeRecordingDb(() => undefined);
    expect(await loadSupportCollective(recording.db as unknown as SupabaseClient, 'nope')).toBeNull();
  });
});

describe('retrySupportLink', () => {
  it("runs the engine's apply as the system, and says how it went", async () => {
    const recording = db();
    expect(await retrySupportLink(recording.db as unknown as SupabaseClient, 'c-1', 'l-fail')).toEqual({
      ok: true,
      applied: false,
      error: 'form missing',
    });
    expect(recording.calls.filter((c) => c.table === 'rpc:collective_apply_replica').map((c) => c.payload)).toEqual([
      { p_link_id: 'l-fail', p_actor_venue_id: null, p_actor_user_id: null, p_job: 'support-retry' },
    ]);
  });

  it('refuses a link from another collective', async () => {
    const recording = db();
    expect(await retrySupportLink(recording.db as unknown as SupabaseClient, 'c-2', 'l-fail')).toMatchObject({
      ok: false,
      status: 404,
    });
    expect(recording.calls.some((c) => c.table === 'rpc:collective_apply_replica')).toBe(false);
  });
});
