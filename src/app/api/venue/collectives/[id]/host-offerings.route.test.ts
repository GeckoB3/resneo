/**
 * The host's collective routes (plan Appendix E contracts 1, 2 and 14; W5).
 *
 * Offer, withdraw, retry and undo all: refuse anyone but the host of an active replicas-model
 * collective, call the engine, then run the members' updates inline and answer in the one
 * `collective_sync` shape the host's page reads.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/supabase/server', () => ({
  createRouteHandlerClientFromHeaders: vi.fn(async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) } })),
}));
vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: vi.fn() }));
vi.mock('@/lib/venue-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/venue-auth')>();
  return { ...actual, getVenueStaff: vi.fn() };
});

import { getVenueStaff, type VenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { makeRecordingDb, type Responder } from '@/lib/testing/recording-supabase';
import { POST as offer } from './offerings/route';
import { DELETE as withdraw } from './offerings/[itemId]/route';
import { POST as retry } from './replicas/retry/route';
import { POST as undo } from './undo/route';

const HOST = 'venue-host';
const COLLECTIVE = '11111111-1111-4111-8111-111111111111';
const SERVICE = '22222222-2222-4222-8222-222222222222';
const ITEM = '33333333-3333-4333-8333-333333333333';
const LINK = '44444444-4444-4444-8444-444444444444';
const AUDIT = '55555555-5555-4555-8555-555555555555';

/** A collective the caller hosts, with one member whose copy is behind. */
function world(over: { collective?: Record<string, unknown>; applyResult?: unknown; applyError?: unknown } = {}) {
  const responder: Responder = (call) => {
    if (call.table === 'venues') return { data: { id: HOST, name: 'Host Venue', slug: 'host' } };
    if (call.table === 'venue_collectives') {
      return {
        data: {
          id: COLLECTIVE, name: 'Northside', status: 'active', service_model: 'replicas', host_venue_id: HOST,
          ...over.collective,
        },
      };
    }
    if (call.table === 'service_items') return { data: { id: SERVICE, name: 'Peel', venue_id: HOST, is_active: true } };
    if (call.table === 'collective_service_items') return { data: { id: ITEM, collective_id: COLLECTIVE, status: 'active' } };
    if (call.table === 'collective_service_replicas') {
      if (call.op === 'update') return { data: null };
      return {
        data: [{ id: LINK, venue_id: 'venue-member', applied_revision: 1, desired_revision: 2, venues: { name: 'Light 3' } }],
      };
    }
    if (call.table === 'rpc:collective_offer_service') {
      return { data: { item_id: ITEM, reoffered: false, links: [{ link_id: LINK, venue_id: 'venue-member', venue_name: 'Light 3' }] } };
    }
    if (call.table === 'rpc:collective_withdraw_service') return { data: { item_id: ITEM } };
    if (call.table === 'rpc:collective_undo_master_change') return { data: { restored: { variants: 1 }, skipped: [] } };
    if (call.table === 'rpc:collective_apply_replica') {
      return over.applyError ? { error: over.applyError } : { data: over.applyResult ?? { ok: true } };
    }
    return undefined;
  };
  const rec = makeRecordingDb(responder);
  vi.mocked(getSupabaseAdminClient).mockReturnValue(rec.db as unknown as SupabaseClient);
  return rec;
}

const admin = (venueId = HOST): VenueStaff =>
  ({ id: 'staff-1', venue_id: venueId, email: 'a@b.test', role: 'admin', db: {} as SupabaseClient }) as VenueStaff;

const post = (body: unknown) =>
  new NextRequest('http://localhost/api', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const params = <T extends Record<string, string>>(extra?: T) =>
  ({ params: Promise.resolve({ id: COLLECTIVE, ...(extra ?? ({} as T)) }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getVenueStaff).mockResolvedValue(admin());
});

describe('POST offerings', () => {
  it('offers the service, applies the members inline and reports the sync', async () => {
    const rec = world();
    const res = await offer(post({ service_id: SERVICE }), params());
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.item_id).toBe(ITEM);
    expect(body.links).toEqual([{ venue_id: 'venue-member', venue_name: 'Light 3', status: 'current' }]);
    expect(body.collective_sync).toMatchObject({ venues: 1, applied: 1, pending: [], failed: [] });
    expect(rec.calls.find((c) => c.table === 'rpc:collective_offer_service')?.payload).toMatchObject({
      p_collective_id: COLLECTIVE, p_master_service_id: SERVICE, p_actor_venue_id: HOST, p_actor_user_id: 'user-1',
    });
  });

  it('names the venue that could not be updated, and does not claim it is done', async () => {
    world({ applyResult: { ok: false, error_code: 'unique_violation' } });
    const body = await (await offer(post({ service_id: SERVICE }), params())).json();
    expect(body.collective_sync.applied).toBe(0);
    expect(body.collective_sync.failed).toEqual([
      { venue_id: 'venue-member', venue_name: 'Light 3', message: expect.stringContaining('retried automatically'), code: 'unique_violation' },
    ]);
    expect(body.links[0].status).toBe('failing');
  });

  it('refuses a venue that does not host the collective', async () => {
    world();
    vi.mocked(getVenueStaff).mockResolvedValue(admin('venue-member'));
    const res = await offer(post({ service_id: SERVICE }), params());
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('COLLECTIVE_NOT_HOST');
  });

  it('refuses a collective still on the old model, in plain words', async () => {
    world({ collective: { service_model: 'legacy_copies' } });
    const res = await offer(post({ service_id: SERVICE }), params());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('COLLECTIVE_LEGACY_MODEL');
    expect(body.error).toContain('Northside');
  });

  it('refuses a service belonging to another venue', async () => {
    const rec = makeRecordingDb((call) => {
      if (call.table === 'venues') return { data: { id: HOST, name: 'Host Venue', slug: 'host' } };
      if (call.table === 'venue_collectives') {
        return { data: { id: COLLECTIVE, name: 'Northside', status: 'active', service_model: 'replicas', host_venue_id: HOST } };
      }
      if (call.table === 'service_items') return { data: { id: SERVICE, name: 'Theirs', venue_id: 'venue-member', is_active: true } };
      return undefined;
    });
    vi.mocked(getSupabaseAdminClient).mockReturnValue(rec.db as unknown as SupabaseClient);
    const res = await offer(post({ service_id: SERVICE }), params());
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('COLLECTIVE_OFFERING_NEEDS_HOST_SERVICE');
    expect(rec.calls.some((c) => c.table === 'rpc:collective_offer_service')).toBe(false);
  });
});

describe('DELETE offerings/[itemId]', () => {
  it('withdraws and names the venues where the service is retired', async () => {
    const rec = world();
    const res = await withdraw(new NextRequest('http://localhost/api', { method: 'DELETE' }), params({ itemId: ITEM }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.retired).toEqual([{ venue_id: 'venue-member', venue_name: 'Light 3' }]);
    expect(body.collective_sync.applied).toBe(1);
    expect(rec.calls.find((c) => c.table === 'rpc:collective_withdraw_service')?.payload).toMatchObject({ p_item_id: ITEM });
  });

  it('404s an offering from another collective', async () => {
    const rec = makeRecordingDb((call) => {
      if (call.table === 'venues') return { data: { id: HOST, name: 'Host Venue', slug: 'host' } };
      if (call.table === 'venue_collectives') {
        return { data: { id: COLLECTIVE, name: 'Northside', status: 'active', service_model: 'replicas', host_venue_id: HOST } };
      }
      if (call.table === 'collective_service_items') return { data: { id: ITEM, collective_id: 'other', status: 'active' } };
      return undefined;
    });
    vi.mocked(getSupabaseAdminClient).mockReturnValue(rec.db as unknown as SupabaseClient);
    const res = await withdraw(new NextRequest('http://localhost/api', { method: 'DELETE' }), params({ itemId: ITEM }));
    expect(res.status).toBe(404);
  });
});

describe('POST replicas/retry', () => {
  it('clears the backoff and applies what is behind', async () => {
    const rec = world();
    const res = await retry(post({}), params());
    expect(res.status).toBe(200);
    expect((await res.json()).collective_sync).toMatchObject({ applied: 1 });
    const cleared = rec.calls.find((c) => c.table === 'collective_service_replicas' && c.op === 'update');
    expect(cleared?.payload).toMatchObject({ next_attempt_at: null, lease_until: null });
  });
});

describe('POST undo', () => {
  it('undoes the change and brings the members back with it', async () => {
    const rec = world();
    const res = await undo(post({ audit_event_id: AUDIT }), params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.restored).toEqual({ variants: 1 });
    expect(body.collective_sync.applied).toBe(1);
    expect(rec.calls.find((c) => c.table === 'rpc:collective_undo_master_change')?.payload).toMatchObject({
      p_audit_event_id: AUDIT, p_actor_venue_id: HOST,
    });
  });

  it('answers 410 when the minute has passed', async () => {
    const rec = makeRecordingDb((call) => {
      if (call.table === 'venues') return { data: { id: HOST, name: 'Host Venue', slug: 'host' } };
      if (call.table === 'venue_collectives') {
        return { data: { id: COLLECTIVE, name: 'Northside', status: 'active', service_model: 'replicas', host_venue_id: HOST } };
      }
      if (call.table === 'rpc:collective_undo_master_change') {
        return { error: { code: 'P0001', message: 'COLLECTIVE_UNDO_EXPIRED: the change was made more than a minute ago' } };
      }
      return undefined;
    });
    vi.mocked(getSupabaseAdminClient).mockReturnValue(rec.db as unknown as SupabaseClient);
    const res = await undo(post({ audit_event_id: AUDIT }), params());
    expect(res.status).toBe(410);
    expect((await res.json()).code).toBe('COLLECTIVE_UNDO_EXPIRED');
  });
});
