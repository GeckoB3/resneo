/**
 * The bulk lane (plan Appendix E contract 13; UX spec §2 item 15).
 *
 * The behaviour that matters is per-operation honesty: 200 changes go through the same engine the
 * single-service routes use, in order, and one venue refusing must not undo the rest. The answer
 * says which operations went through, so the grid keeps exactly the failed cells staged.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/supabase/server', () => ({
  createRouteHandlerClientFromHeaders: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
  })),
}));
vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: vi.fn() }));
vi.mock('@/lib/venue-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/venue-auth')>();
  return { ...actual, getVenueStaff: vi.fn() };
});

import { getVenueStaff, type VenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { makeRecordingDb, type Responder } from '@/lib/testing/recording-supabase';
import { POST as bulk } from './bulk/route';

const HOST = 'venue-host';
const COLLECTIVE = '11111111-1111-4111-8111-111111111111';
const SERVICE = '22222222-2222-4222-8222-222222222222';
const OTHER_SERVICE = '44444444-4444-4444-8444-444444444444';
const MEMBER = '77777777-7777-4777-8777-777777777777';
const CALENDAR = '66666666-6666-4666-8666-666666666666';

function world(extra: Responder = () => undefined) {
  const responder: Responder = (call) => {
    const injected = extra(call);
    if (injected) return injected;
    if (call.table === 'venues') return { data: { id: HOST, name: 'Host Venue', slug: 'host' } };
    if (call.table === 'venue_collectives') {
      return {
        data: {
          id: COLLECTIVE,
          name: 'Northside',
          status: 'active',
          service_model: 'replicas',
          host_venue_id: HOST,
        },
      };
    }
    if (call.table === 'collective_service_items') return { data: { id: 'item-1', status: 'active' } };
    if (call.table === 'collective_service_replicas') {
      return { data: [{ id: 'link-1', venue_id: MEMBER, applied_revision: 4, desired_revision: 5, venues: { name: 'Zen Studio' } }] };
    }
    if (call.table === 'rpc:collective_set_calendar_offering') return { data: { written: true, affected_bookings: [] } };
    if (call.table === 'rpc:collective_offer_service') {
      return { data: { item_id: 'item-9', links: [{ link_id: 'link-9', venue_id: MEMBER, venue_name: 'Zen Studio' }] } };
    }
    if (call.table === 'rpc:collective_withdraw_service') return { data: {} };
    if (call.table === 'rpc:collective_apply_replica') return { data: { ok: true } };
    return undefined;
  };
  const recording = makeRecordingDb(responder);
  vi.mocked(getSupabaseAdminClient).mockReturnValue(recording.db as unknown as SupabaseClient);
  vi.mocked(getVenueStaff).mockResolvedValue({
    id: 'staff-1',
    venue_id: HOST,
    email: 'host@example.com',
    role: 'admin',
    db: recording.db as unknown as SupabaseClient,
  } as VenueStaff);
  return recording;
}

const send = (body: unknown) =>
  bulk(
    new NextRequest('http://localhost/api/venue/collectives/x/bulk', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: COLLECTIVE }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/venue/collectives/[id]/bulk', () => {
  it('answers one row per operation, in the order they were sent', async () => {
    world();
    const res = await send({
      ops: [
        { op: 'offer', service_id: SERVICE },
        { op: 'assign', service_id: SERVICE, venue_id: MEMBER, calendar_id: CALENDAR },
      ],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: { index: number; ok: boolean }[] };
    expect(body.results).toEqual([
      { index: 0, ok: true },
      { index: 1, ok: true },
    ]);
  });

  it('keeps going when one operation is refused, and names the one that was', async () => {
    const recording = world((call) =>
      call.table === 'rpc:collective_set_calendar_offering'
        ? { data: null, error: { code: 'P0001', message: 'COLLECTIVE_CALENDAR_NOT_AT_VENUE: not there' } }
        : undefined,
    );
    const res = await send({
      ops: [
        { op: 'assign', service_id: SERVICE, venue_id: MEMBER, calendar_id: CALENDAR },
        { op: 'retry', service_id: SERVICE },
      ],
    });
    const body = (await res.json()) as { results: { index: number; ok: boolean; code?: string }[] };
    expect(body.results[0]).toMatchObject({ index: 0, ok: false, code: 'COLLECTIVE_CALENDAR_NOT_AT_VENUE' });
    expect(body.results[1]).toEqual({ index: 1, ok: true });
    // The second operation still reached the engine.
    expect(recording.calls.some((c) => c.table === 'rpc:collective_apply_replica')).toBe(true);
  });

  it('writes nothing for a removal that would leave bookings behind, and says so', async () => {
    world((call) =>
      call.table === 'rpc:collective_set_calendar_offering'
        ? { data: { written: false, affected_bookings: [{ booking_date: '2026-10-01', booking_time: '10:00', calendar_id: CALENDAR }] } }
        : undefined,
    );
    const res = await send({
      ops: [{ op: 'unassign', service_id: SERVICE, venue_id: MEMBER, calendar_id: CALENDAR }],
    });
    const body = (await res.json()) as { results: { ok: boolean; code?: string }[] };
    expect(body.results[0]).toMatchObject({ ok: false, code: 'COLLECTIVE_AFFECTED_BOOKINGS' });
  });

  it('refuses a calendar change for a service that is not on the page', async () => {
    world((call) => (call.table === 'collective_service_items' ? { data: null } : undefined));
    const res = await send({
      ops: [{ op: 'assign', service_id: OTHER_SERVICE, venue_id: MEMBER, calendar_id: CALENDAR }],
    });
    const body = (await res.json()) as { results: { ok: boolean; code?: string }[] };
    expect(body.results[0]).toMatchObject({ ok: false, code: 'COLLECTIVE_REPLICA_NOT_READY' });
  });

  it("applies the members' copies once at the end, not once per operation", async () => {
    const recording = world();
    await send({
      ops: [
        { op: 'assign', service_id: SERVICE, venue_id: MEMBER, calendar_id: CALENDAR },
        { op: 'retry', service_id: SERVICE },
      ],
    });
    expect(recording.calls.filter((c) => c.table === 'rpc:collective_apply_replica')).toHaveLength(1);
  });

  it('takes no more than 200 changes at a time', async () => {
    world();
    const res = await send({
      ops: Array.from({ length: 201 }, () => ({ op: 'retry', service_id: SERVICE })),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('200');
  });

  it('needs a venue and a calendar for a calendar change', async () => {
    world();
    const res = await send({ ops: [{ op: 'assign', service_id: SERVICE }] });
    expect(res.status).toBe(400);
  });

  it('is only for the host of a live replicas-model collective', async () => {
    world((call) =>
      call.table === 'venue_collectives'
        ? {
            data: {
              id: COLLECTIVE,
              name: 'Northside',
              status: 'active',
              service_model: 'copies',
              host_venue_id: HOST,
            },
          }
        : undefined,
    );
    const res = await send({ ops: [{ op: 'retry', service_id: SERVICE }] });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('COLLECTIVE_LEGACY_MODEL');
  });
});
