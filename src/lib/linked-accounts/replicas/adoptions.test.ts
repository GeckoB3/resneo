/**
 * Host-initiated adoption (plan §6.7; contracts 1 and 10; OFF-06).
 *
 * The host can pick only a member's own, active, uncopied service; the engine gets exactly what was
 * chosen; a member sees each open question once, with its options matched by name; its answer is
 * sent as given; and unanswered questions are reminded at day 7 and settled as "Keep mine separate"
 * by the system at day 14, never twice.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb, type RecordedCall, type Responder } from '@/lib/testing/recording-supabase';

const applyLinksInline = vi.fn(async () => ({ pending: [], failed: [], current: [] }));
vi.mock('@/lib/linked-accounts/replicas/inline-apply', () => ({
  applyLinksInline: (...args: unknown[]) => applyLinksInline(...(args as [])),
}));
const notifyServiceOffered = vi.fn(async () => undefined);
vi.mock('@/lib/linked-accounts/replicas/collective-notices', () => ({
  notifyServiceOffered: (...args: unknown[]) => notifyServiceOffered(...(args as [])),
}));

import {
  ADOPTION_DEFAULT_AFTER_MS,
  ADOPTION_REMIND_AFTER_MS,
  loadAdoptionReview,
  loadPendingAdoptions,
  ownServicesAt,
  runAddFromVenue,
  runAdoptionDeadlines,
  runAnswerAdoption,
  type AdoptionContext,
} from './adoptions';

const NOW = Date.parse('2026-10-20T09:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const rpcs = (calls: RecordedCall[], fn: string) => calls.filter((c) => c.table === `rpc:${fn}`).map((c) => c.payload);

function context(responder: Responder, venueId = 'host') {
  const recording = makeRecordingDb(responder);
  const ctx: AdoptionContext = {
    admin: recording.db as unknown as SupabaseClient,
    collectiveId: 'collective-1',
    collectiveName: 'Northside',
    hostVenueId: 'host',
    hostVenueName: 'Host Venue',
    venueId,
    userId: 'user-1',
  };
  return { ctx, recording };
}

beforeEach(() => {
  applyLinksInline.mockClear();
  notifyServiceOffered.mockClear();
});

const memberServices: Responder = (call) => {
  if (call.table === 'service_items' && call.columns === 'id, name, duration_minutes, price_pence') {
    return {
      data: [
        { id: 'svc-own', name: 'Balayage', duration_minutes: 90, price_pence: 12000 },
        { id: 'svc-copy', name: 'Cut', duration_minutes: 30, price_pence: 3000 },
      ],
    };
  }
  if (call.table === 'collective_service_replicas') return { data: [{ replica_service_id: 'svc-copy' }] };
  return undefined;
};

describe('ownServicesAt', () => {
  it("offers only the member's own services, not its copies", async () => {
    const { recording } = context(memberServices);
    expect(await ownServicesAt(recording.db as unknown as SupabaseClient, 'member')).toEqual([
      { id: 'svc-own', name: 'Balayage', duration_minutes: 90, price_pence: 12000 },
    ]);
  });
});

describe('runAddFromVenue', () => {
  const world =
    (options: { member?: boolean; serviceVenue?: string } = {}): Responder =>
    (call) => {
      const injected = memberServices(call);
      if (injected) return injected;
      if (call.table === 'venue_collective_members') return { data: options.member === false ? null : { id: 'm-1' } };
      if (call.table === 'service_items') {
        return { data: { id: 'svc-own', name: 'Balayage', venue_id: options.serviceVenue ?? 'member', is_active: true } };
      }
      if (call.table === 'venues') return { data: { name: 'Zen Studio' } };
      if (call.table === 'rpc:collective_add_from_venue') {
        return { data: { item_id: 'item-1', master_service_id: 'master-1', links: [{ link_id: 'l-3', venue_id: 'third' }] } };
      }
      return undefined;
    };

  it('asks the engine for exactly the chosen service, applies the other copies and tells the others', async () => {
    const { ctx, recording } = context(world());
    const added = await runAddFromVenue(ctx, { venueId: 'member', serviceId: 'svc-own' });
    expect(added).toMatchObject({
      ok: true,
      result: { item_id: 'item-1', master_service_id: 'master-1', service_name: 'Balayage', venue_name: 'Zen Studio' },
    });
    expect(rpcs(recording.calls, 'collective_add_from_venue')).toEqual([
      {
        p_collective_id: 'collective-1',
        p_source_venue_id: 'member',
        p_source_service_id: 'svc-own',
        p_actor_venue_id: 'host',
        p_actor_user_id: 'user-1',
      },
    ]);
    expect(applyLinksInline).toHaveBeenCalledWith(expect.anything(), ['l-3'], expect.anything());
    expect(notifyServiceOffered).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ memberVenueIds: ['third'] }));
  });

  it('refuses a venue that is not a member, and a service that is not its own', async () => {
    const notMember = context(world({ member: false }));
    const refused = await runAddFromVenue(notMember.ctx, { venueId: 'member', serviceId: 'svc-own' });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect((await refused.response.json()).code).toBe('COLLECTIVE_VENUE_NOT_MEMBER');

    const copy = context(world());
    const notOwn = await runAddFromVenue(copy.ctx, { venueId: 'member', serviceId: 'svc-copy' });
    expect(notOwn.ok).toBe(false);
    expect(rpcs(copy.recording.calls, 'collective_add_from_venue')).toEqual([]);
  });

  it('refuses the host itself as the source', async () => {
    const { ctx } = context(world());
    expect((await runAddFromVenue(ctx, { venueId: 'host', serviceId: 'svc-own' })).ok).toBe(false);
  });
});

/** Two requests for item-1 (the newer one open), one for item-2 (answered). */
const requests: Responder = (call) => {
  if (call.table === 'collective_audit_events') {
    return {
      data: [
        { collective_id: 'collective-1', item_id: 'item-1', service_id: 'svc-own', target_venue_id: 'member', created_at: ago(8 * 86_400_000) },
        { collective_id: 'collective-1', item_id: 'item-1', service_id: 'svc-old', target_venue_id: 'member', created_at: ago(20 * 86_400_000) },
        { collective_id: 'collective-1', item_id: 'item-2', service_id: 'svc-two', target_venue_id: 'member', created_at: ago(15 * 86_400_000) },
      ],
    };
  }
  if (call.table === 'rpc:collective_adoption_pending') {
    const item = (call.payload as { p_item_id: string }).p_item_id;
    return { data: item === 'item-1' ? 'svc-own' : null };
  }
  if (call.table === 'service_items') return { data: [{ id: 'svc-own', name: 'Balayage' }] };
  return undefined;
};

describe('loadPendingAdoptions', () => {
  it('lists each open question once', async () => {
    const { recording } = context(requests);
    const pending = await loadPendingAdoptions(recording.db as unknown as SupabaseClient, 'collective-1', 'member', {
      now: () => NOW,
    });
    expect(pending).toEqual([
      { item_id: 'item-1', service_id: 'svc-own', service_name: 'Balayage', requested_at: ago(8 * 86_400_000) },
    ]);
    expect(rpcs(recording.calls, 'collective_adoption_pending')).toHaveLength(2);
  });
});

describe('loadAdoptionReview', () => {
  it("matches the member's options to the host's by name, each host option once", async () => {
    const { recording } = context((call) => {
      if (call.table === 'rpc:collective_adoption_pending') return { data: 'svc-own' };
      if (call.table === 'collective_service_items') {
        return { data: { id: 'item-1', collective_id: 'collective-1', master_service_id: 'master-1' } };
      }
      if (call.table === 'venue_collectives') return { data: { name: 'Northside', host_venue_id: 'host' } };
      if (call.table === 'service_items') return { data: { id: 'svc-own', name: 'Balayage' } };
      if (call.table === 'venues') return { data: { name: 'Host Venue' } };
      if (call.table === 'service_variants') {
        return {
          data: [
            { id: 'my-short', name: 'Short', service_item_id: 'svc-own', is_active: true },
            { id: 'my-short-2', name: ' short ', service_item_id: 'svc-own', is_active: true },
            { id: 'my-gone', name: 'Gone', service_item_id: 'svc-own', is_active: false },
            { id: 'host-short', name: 'SHORT', service_item_id: 'master-1', is_active: true },
          ],
        };
      }
      return undefined;
    });
    const review = await loadAdoptionReview(recording.db as unknown as SupabaseClient, 'collective-1', 'item-1', 'member');
    expect(review).toMatchObject({
      host_name: 'Host Venue',
      collective_name: 'Northside',
      service: { id: 'svc-own', name: 'Balayage' },
      host_options: [{ id: 'host-short', name: 'SHORT' }],
      suggested_map: [
        { my_variant_id: 'my-short', host_variant_id: 'host-short' },
        { my_variant_id: 'my-short-2', host_variant_id: null },
      ],
    });
  });

  it('is null once answered', async () => {
    const { recording } = context((call) =>
      call.table === 'rpc:collective_adoption_pending' ? { data: null } : undefined,
    );
    expect(await loadAdoptionReview(recording.db as unknown as SupabaseClient, 'collective-1', 'item-1', 'member')).toBeNull();
  });
});

describe('runAnswerAdoption', () => {
  it('sends the answer as the member, and applies the new copy', async () => {
    const { ctx, recording } = context(
      (call) => (call.table === 'rpc:collective_answer_adoption' ? { data: { link_id: 'l-new' } } : undefined),
      'member',
    );
    const map = [{ my_variant_id: 'a', host_variant_id: 'b' }];
    expect(await runAnswerAdoption(ctx, 'item-1', { choice: 'use_mine', option_map: map })).toMatchObject({ ok: true });
    expect(rpcs(recording.calls, 'collective_answer_adoption')).toEqual([
      {
        p_collective_id: 'collective-1',
        p_item_id: 'item-1',
        p_venue_id: 'member',
        p_choice: 'use_mine',
        p_option_map: map,
        p_actor_venue_id: 'member',
        p_actor_user_id: 'user-1',
      },
    ]);
    expect(applyLinksInline).toHaveBeenCalledWith(expect.anything(), ['l-new'], expect.anything());
  });

  it('sends no option map when keeping its own separate', async () => {
    const { ctx, recording } = context(() => undefined, 'member');
    await runAnswerAdoption(ctx, 'item-1', { choice: 'keep_separate', option_map: [{ my_variant_id: 'a', host_variant_id: 'b' }] });
    expect(rpcs(recording.calls, 'collective_answer_adoption')[0]).toMatchObject({ p_option_map: [] });
  });

  it('says why when the question was already answered', async () => {
    const { ctx } = context(
      (call) =>
        call.table === 'rpc:collective_answer_adoption'
          ? { error: { code: 'P0001', message: 'COLLECTIVE_ADOPTION_NOT_PENDING: already answered' } }
          : undefined,
      'member',
    );
    const result = await runAnswerAdoption(ctx, 'item-1', { choice: 'keep_separate' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(409);
      expect((await result.response.json()).code).toBe('COLLECTIVE_ADOPTION_NOT_PENDING');
    }
  });
});

describe('runAdoptionDeadlines', () => {
  const world = (ageMs: number, pending = true, reminderQueued = true): Responder => (call) => {
    if (call.table === 'collective_audit_events') {
      return {
        data: [
          { collective_id: 'collective-1', item_id: 'item-1', service_id: 'svc-own', target_venue_id: 'member', created_at: ago(ageMs) },
        ],
      };
    }
    if (call.table === 'rpc:collective_adoption_pending') return { data: pending ? 'svc-own' : null };
    if (call.table === 'collective_operations') return { data: reminderQueued ? [{ id: 'op-1' }] : [] };
    return undefined;
  };
  const run = async (responder: Responder) => {
    const { recording } = context(responder);
    const outcome = await runAdoptionDeadlines(recording.db as unknown as SupabaseClient, { now: () => NOW });
    return { outcome, calls: recording.calls };
  };

  it('does nothing in the first week', async () => {
    const { outcome, calls } = await run(world(ADOPTION_REMIND_AFTER_MS - 60_000));
    expect(outcome).toEqual({ reminded: 0, defaulted: 0, errors: 0 });
    expect(rpcs(calls, 'collective_adoption_pending')).toEqual([]);
  });

  it('reminds once in the second week', async () => {
    const { outcome, calls } = await run(world(ADOPTION_REMIND_AFTER_MS + 60_000));
    expect(outcome.reminded).toBe(1);
    const queued = calls.find((c) => c.table === 'collective_operations')!;
    expect(queued.op).toBe('upsert');
    expect(queued.payload).toMatchObject({
      venue_id: 'member',
      kind: 'notice',
      progress: { notice: 'N26', item_id: 'item-1', reminder: true },
    });
    const again = await run(world(ADOPTION_REMIND_AFTER_MS + 120_000, true, false));
    expect(again.outcome.reminded).toBe(0);
  });

  it('keeps the service separate at day 14, as the system', async () => {
    const { outcome, calls } = await run(world(ADOPTION_DEFAULT_AFTER_MS + 60_000));
    expect(outcome.defaulted).toBe(1);
    expect(rpcs(calls, 'collective_answer_adoption')).toEqual([
      expect.objectContaining({ p_choice: 'keep_separate', p_actor_venue_id: null, p_actor_user_id: null }),
    ]);
  });

  it('leaves an answered question alone', async () => {
    const { outcome, calls } = await run(world(ADOPTION_DEFAULT_AFTER_MS + 60_000, false));
    expect(outcome).toEqual({ reminded: 0, defaulted: 0, errors: 0 });
    expect(rpcs(calls, 'collective_answer_adoption')).toEqual([]);
  });
});
