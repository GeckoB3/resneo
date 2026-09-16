/**
 * A host saving a service that is on the collective page (plan Appendix E contract 4; §6.4; D50).
 *
 * The three things the save owes the collective: knowing whether this service is on the page at
 * all, recording what changed so the host can undo it for 60 seconds, and bringing the members'
 * copies up to date before it answers.
 */
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb, type Responder } from '@/lib/testing/recording-supabase';
import {
  loadMasterSaveContext,
  captureMasterProjection,
  recordMasterChangeAndApply,
} from '@/lib/linked-accounts/replicas/master-save';

const HOST = 'venue-host';
const MEMBER = 'venue-member';
const SERVICE = 'service-master';
const ITEM = 'item-1';
const LINK = 'link-1';
const COLLECTIVE = 'collective-1';

const offering = (overrides: Record<string, unknown> = {}) => ({
  id: ITEM,
  collective_id: COLLECTIVE,
  venue_collectives: {
    id: COLLECTIVE,
    name: 'Northside',
    host_venue_id: HOST,
    status: 'active',
    service_model: 'replicas',
    venues: { name: 'Host Venue' },
    ...overrides,
  },
});

function db(responder: Responder = () => undefined) {
  return makeRecordingDb(responder);
}

describe('loadMasterSaveContext', () => {
  it('answers with the offering, its live links and the names for prose', async () => {
    const recording = db((call) => {
      if (call.table === 'collective_service_items') return { data: offering() };
      if (call.table === 'collective_service_replicas') return { data: [{ id: LINK }, { id: 'link-2' }] };
      return undefined;
    });
    const context = await loadMasterSaveContext(recording.db as unknown as SupabaseClient, SERVICE, HOST);
    expect(context).toEqual({
      collectiveId: COLLECTIVE,
      collectiveName: 'Northside',
      hostVenueName: 'Host Venue',
      itemId: ITEM,
      linkIds: [LINK, 'link-2'],
      probeLinkId: LINK,
    });
  });

  it('is nothing at a member, at a paused collective or on the legacy model', async () => {
    const cases = [
      { venue: MEMBER, overrides: {} },
      { venue: HOST, overrides: { status: 'paused' } },
      { venue: HOST, overrides: { service_model: 'copies' } },
    ];
    for (const c of cases) {
      const recording = db((call) =>
        call.table === 'collective_service_items' ? { data: offering(c.overrides) } : undefined,
      );
      expect(await loadMasterSaveContext(recording.db as unknown as SupabaseClient, SERVICE, c.venue)).toBeNull();
    }
  });

  it('is nothing for a service that is not on the page', async () => {
    const recording = db(() => undefined);
    expect(await loadMasterSaveContext(recording.db as unknown as SupabaseClient, SERVICE, HOST)).toBeNull();
  });
});

const context = {
  collectiveId: COLLECTIVE,
  collectiveName: 'Northside',
  hostVenueName: 'Host Venue',
  itemId: ITEM,
  linkIds: [LINK],
  probeLinkId: LINK,
};

describe('captureMasterProjection', () => {
  it('reads the master side through a live link', async () => {
    const recording = db((call) =>
      call.table === 'rpc:collective_replica_projection' ? { data: { service: { price_pence: 6000 } } } : undefined,
    );
    const before = await captureMasterProjection(recording.db as unknown as SupabaseClient, context);
    expect(before).toEqual({ service: { price_pence: 6000 } });
    expect(recording.calls[0].payload).toEqual({ p_link_id: LINK, p_side: 'master' });
  });

  it('is nothing when no member has a copy yet, so the save records nothing', async () => {
    const recording = db();
    expect(
      await captureMasterProjection(recording.db as unknown as SupabaseClient, { ...context, probeLinkId: null }),
    ).toBeNull();
    expect(recording.calls).toHaveLength(0);
  });
});

describe('recordMasterChangeAndApply', () => {
  const projection = { service: { price_pence: 6500 } };

  const world = (overrides: Responder = () => undefined): Responder => (call) => {
    const injected = overrides(call);
    if (injected) return injected;
    if (call.table === 'rpc:collective_replica_projection') return { data: projection };
    if (call.table === 'rpc:collective_record_master_change') return { data: 'audit-1' };
    if (call.table === 'collective_service_replicas') {
      return { data: [{ id: LINK, venue_id: MEMBER, applied_revision: 4, desired_revision: 5, venues: { name: 'Member Venue' } }] };
    }
    if (call.table === 'rpc:collective_apply_replica') return { data: { ok: true } };
    return undefined;
  };

  it('records the change and hands the members their update', async () => {
    const recording = db(world());
    const sync = await recordMasterChangeAndApply(recording.db as unknown as SupabaseClient, {
      context,
      serviceId: SERVICE,
      before: { service: { price_pence: 6000 } },
      actorVenueId: HOST,
      actorUserId: null,
    });
    expect(sync).toEqual({ venues: 1, applied: 1, pending: [], failed: [], audit_event_id: 'audit-1' });
    const recorded = recording.calls.find((c) => c.table === 'rpc:collective_record_master_change');
    expect(recorded?.payload).toEqual({
      p_master_service_id: SERVICE,
      p_before: { service: { price_pence: 6000 } },
      p_after: projection,
      p_actor_venue_id: HOST,
      p_actor_user_id: null,
    });
  });

  it('offers no undo when the save happened before any member had a copy', async () => {
    const recording = db(world());
    const sync = await recordMasterChangeAndApply(recording.db as unknown as SupabaseClient, {
      context,
      serviceId: SERVICE,
      before: null,
      actorVenueId: HOST,
      actorUserId: null,
    });
    expect(sync?.audit_event_id).toBeNull();
    expect(recording.calls.some((c) => c.table === 'rpc:collective_record_master_change')).toBe(false);
  });

  it('keeps the save when the audit row cannot be written', async () => {
    const recording = db(
      world((call) =>
        call.table === 'rpc:collective_record_master_change'
          ? { data: null, error: { code: 'XX000', message: 'boom' } }
          : undefined,
      ),
    );
    const sync = await recordMasterChangeAndApply(recording.db as unknown as SupabaseClient, {
      context,
      serviceId: SERVICE,
      before: { service: { price_pence: 6000 } },
      actorVenueId: HOST,
      actorUserId: null,
    });
    expect(sync?.audit_event_id).toBeNull();
    expect(sync?.applied).toBe(1);
  });

  it('does nothing at all at a venue that is not hosting', async () => {
    const recording = db(world());
    const sync = await recordMasterChangeAndApply(recording.db as unknown as SupabaseClient, {
      context: null,
      serviceId: SERVICE,
      before: null,
      actorVenueId: MEMBER,
      actorUserId: null,
    });
    expect(sync).toBeNull();
    expect(recording.calls).toHaveLength(0);
  });
});
