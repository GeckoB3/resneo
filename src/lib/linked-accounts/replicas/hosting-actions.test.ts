/**
 * Moving the hosting of a shared-services collective (plan contract 8).
 *
 * Each action is one engine call, but who may make it, and with what, is checked first so a venue
 * reads a reason rather than a database refusal: only the host asks and cancels, only the venue that
 * was asked answers, accepting needs the consent it was shown, and a take-over needs a paused page.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb, type Responder } from '@/lib/testing/recording-supabase';
import {
  HOST_TRANSFER_CONSENT_VERSION,
  isHostingAction,
  legacyTransferRefused,
  runHostingAction,
  type HostingContext,
} from './hosting-actions';

const COLLECTIVE = 'collective-1';
const HOST = 'venue-host';
const MEMBER = 'venue-member';

const state = (overrides: Record<string, unknown> = {}) => ({
  service_model: 'replicas',
  paused_at: null,
  pending_host_venue_id: null,
  host_transfer_at: null,
  ...overrides,
});

function context(venueId: string, responder: Responder): { ctx: HostingContext; calls: ReturnType<typeof makeRecordingDb>['calls'] } {
  const recording = makeRecordingDb(responder);
  return {
    calls: recording.calls,
    ctx: {
      admin: recording.db as unknown as SupabaseClient,
      collectiveId: COLLECTIVE,
      collectiveName: 'Northside',
      hostVenueId: HOST,
      venueId,
      venueName: venueId === HOST ? 'Host Venue' : 'Zen Studio',
      userId: 'user-1',
    },
  };
}

const world = (lifecycle: Record<string, unknown>, extra: Responder = () => undefined): Responder => (call) => {
  const injected = extra(call);
  if (injected) return injected;
  if (call.table === 'venue_collectives') return { data: lifecycle };
  if (call.table === 'venue_collective_members') return { data: { id: 'membership-1' } };
  if (call.table === 'collective_service_replicas') return { data: [] };
  return undefined;
};

const rpc = (calls: ReturnType<typeof makeRecordingDb>['calls'], name: string) =>
  calls.filter((c) => c.table === `rpc:${name}`);

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('isHostingAction', () => {
  it('knows the five new actions and nothing else', () => {
    expect(['offer_host', 'accept_host', 'decline_host', 'cancel_host_transfer', 'take_over_hosting'].every(isHostingAction)).toBe(true);
    expect(isHostingAction('transfer_host')).toBe(false);
    expect(isHostingAction('leave')).toBe(false);
  });
});

describe('offer_host', () => {
  it('asks the chosen member, through the engine', async () => {
    const { ctx, calls } = context(HOST, world(state()));
    expect(await runHostingAction(ctx, { action: 'offer_host', venueId: MEMBER })).toBeNull();
    expect(rpc(calls, 'collective_request_host_transfer')[0]!.payload).toEqual({
      p_collective_id: COLLECTIVE,
      p_candidate_venue_id: MEMBER,
      p_actor_venue_id: HOST,
      p_actor_user_id: 'user-1',
    });
  });

  it('is only for the host', async () => {
    const { ctx, calls } = context(MEMBER, world(state()));
    const res = await runHostingAction(ctx, { action: 'offer_host', venueId: HOST });
    expect(res?.status).toBe(403);
    expect(rpc(calls, 'collective_request_host_transfer')).toHaveLength(0);
  });

  it("answers the engine's refusal in words", async () => {
    const { ctx } = context(
      HOST,
      world(state(), (call) =>
        call.table === 'rpc:collective_request_host_transfer'
          ? { data: null, error: { code: 'P0001', message: 'COLLECTIVE_TRANSFER_PENDING: already pending' } }
          : undefined,
      ),
    );
    const res = await runHostingAction(ctx, { action: 'offer_host', venueId: MEMBER });
    expect(res?.status).toBe(409);
    expect((await res!.json()).code).toBe('COLLECTIVE_TRANSFER_PENDING');
  });
});

describe('accept_host', () => {
  it('needs the consent version the dialog showed', async () => {
    const { ctx, calls } = context(MEMBER, world(state({ pending_host_venue_id: MEMBER })));
    const res = await runHostingAction(ctx, { action: 'accept_host', consent_version: 'an-old-dialog' });
    expect(res?.status).toBe(409);
    expect((await res!.json()).code).toBe('COLLECTIVE_CONSENT_REQUIRED');
    expect(rpc(calls, 'collective_accept_host_transfer')).toHaveLength(0);
  });

  it('accepts through the engine with that consent', async () => {
    const { ctx, calls } = context(MEMBER, world(state({ pending_host_venue_id: MEMBER })));
    expect(
      await runHostingAction(ctx, { action: 'accept_host', consent_version: HOST_TRANSFER_CONSENT_VERSION }),
    ).toBeNull();
    expect(rpc(calls, 'collective_accept_host_transfer')[0]!.payload).toMatchObject({
      p_actor_venue_id: MEMBER,
      p_consent_version: HOST_TRANSFER_CONSENT_VERSION,
    });
  });
});

describe('decline_host and cancel_host_transfer', () => {
  it('lets the venue that was asked say no, and tells the host', async () => {
    const { ctx, calls } = context(MEMBER, world(state({ pending_host_venue_id: MEMBER })));
    expect(await runHostingAction(ctx, { action: 'decline_host' })).toBeNull();
    expect(rpc(calls, 'collective_cancel_host_transfer')[0]!.payload).toMatchObject({
      p_reason: 'declined',
      p_actor_venue_id: MEMBER,
    });
    const bell = calls.find((c) => c.table === 'account_link_notifications');
    expect(bell?.payload).toMatchObject({ venue_id: HOST, payload: { title: 'Zen Studio will not host Northside' } });
  });

  it('refuses a no from a venue that was not asked', async () => {
    const { ctx } = context(MEMBER, world(state({ pending_host_venue_id: 'someone-else' })));
    expect((await runHostingAction(ctx, { action: 'decline_host' }))?.status).toBe(404);
  });

  it('lets the host cancel, and tells the venue it had asked', async () => {
    const { ctx, calls } = context(HOST, world(state({ pending_host_venue_id: MEMBER, host_transfer_at: '2026-10-01T09:00:00Z' })));
    expect(await runHostingAction(ctx, { action: 'cancel_host_transfer' })).toBeNull();
    expect(rpc(calls, 'collective_cancel_host_transfer')[0]!.payload).toMatchObject({ p_reason: 'host_cancelled' });
    const bell = calls.find((c) => c.table === 'account_link_notifications');
    expect(bell?.payload).toMatchObject({ venue_id: MEMBER });
  });

  it('does not let a member cancel the move', async () => {
    const { ctx } = context(MEMBER, world(state({ pending_host_venue_id: MEMBER })));
    expect((await runHostingAction(ctx, { action: 'cancel_host_transfer' }))?.status).toBe(403);
  });
});

describe('take_over_hosting', () => {
  it('moves the hosting straight away while the page is paused', async () => {
    const { ctx, calls } = context(MEMBER, world(state({ paused_at: '2026-09-10T09:00:00Z' })));
    expect(
      await runHostingAction(ctx, { action: 'take_over_hosting', consent_version: HOST_TRANSFER_CONSENT_VERSION }),
    ).toBeNull();
    expect(rpc(calls, 'collective_transfer_host')[0]!.payload).toMatchObject({
      p_new_host_venue_id: MEMBER,
      p_actor_venue_id: MEMBER,
    });
  });

  it('is refused while the collective has a host', async () => {
    const { ctx, calls } = context(MEMBER, world(state()));
    const res = await runHostingAction(ctx, { action: 'take_over_hosting', consent_version: HOST_TRANSFER_CONSENT_VERSION });
    expect(res?.status).toBe(409);
    expect(rpc(calls, 'collective_transfer_host')).toHaveLength(0);
  });

  it('is only for a venue in the collective', async () => {
    const { ctx } = context(
      'outsider',
      world(state({ paused_at: '2026-09-10T09:00:00Z' }), (call) =>
        call.table === 'venue_collective_members' ? { data: null } : undefined,
      ),
    );
    const res = await runHostingAction(ctx, { action: 'take_over_hosting', consent_version: HOST_TRANSFER_CONSENT_VERSION });
    expect(res?.status).toBe(403);
  });
});

describe('the older model', () => {
  it('refuses the new actions on a collective that has not moved to shared services', async () => {
    const { ctx } = context(HOST, world(state({ service_model: 'legacy_copies' })));
    const res = await runHostingAction(ctx, { action: 'offer_host', venueId: MEMBER });
    expect((await res!.json()).code).toBe('COLLECTIVE_LEGACY_MODEL');
  });

  it('refuses the old direct transfer on a collective that has', async () => {
    const res = legacyTransferRefused('Northside');
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('COLLECTIVE_HOST_CHANGE_REFUSED');
  });
});
