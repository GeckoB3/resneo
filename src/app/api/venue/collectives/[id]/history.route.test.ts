/**
 * GET /api/venue/collectives/[id]/history (plan contract 3).
 *
 * Who may read what is the point: the host reads everything, a member reads its own rows and the
 * collective's, and a venue that is not in the collective reads nothing.
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
import { GET } from './history/route';

const HOST = '11111111-1111-4111-8111-111111111111';
const MEMBER = '22222222-2222-4222-8222-222222222222';
const COLLECTIVE = '33333333-3333-4333-8333-333333333333';

const auditRow = {
  id: '44444444-4444-4444-8444-444444444444',
  created_at: '2026-09-16T09:00:00.000Z',
  event_type: 'member_joined',
  collective_name: 'Northside',
  actor_type: 'venue_user',
  actor_venue_id: MEMBER,
  actor_venue_name: 'Zen Studio',
  actor_user_id: null,
  system_job: null,
  target_venue_id: MEMBER,
  target_venue_name: 'Zen Studio',
  service_id: null,
  calendar_id: null,
  changes: null,
};

function world(viewer: string, extra: Responder = () => undefined) {
  const responder: Responder = (call) => {
    const injected = extra(call);
    if (injected) return injected;
    if (call.table === 'venues') return { data: { id: viewer, name: 'Viewer', slug: 'viewer' } };
    if (call.table === 'venue_collectives') return { data: { id: COLLECTIVE, name: 'Northside', host_venue_id: HOST } };
    if (call.table === 'venue_collective_members') return { data: { id: 'membership-1' } };
    if (call.table === 'collective_audit_events') return { data: [auditRow] };
    return undefined;
  };
  const recording = makeRecordingDb(responder);
  vi.mocked(getSupabaseAdminClient).mockReturnValue(recording.db as unknown as SupabaseClient);
  vi.mocked(getVenueStaff).mockResolvedValue({
    id: 'staff-1',
    venue_id: viewer,
    email: 'admin@example.com',
    role: 'admin',
    db: recording.db as unknown as SupabaseClient,
  } as VenueStaff);
  return recording;
}

const read = (query = '') =>
  GET(new NextRequest(`http://localhost/api/venue/collectives/x/history${query}`), {
    params: Promise.resolve({ id: COLLECTIVE }),
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/venue/collectives/[id]/history', () => {
  it('gives the host the sentences, newest first', async () => {
    world(HOST);
    const res = await read();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: { sentence: string }[]; next_cursor: string | null };
    expect(body.events.map((e) => e.sentence)).toEqual(['Zen Studio joined']);
    expect(body.next_cursor).toBeNull();
  });

  it("limits a member to its own rows and the collective's", async () => {
    const recording = world(MEMBER);
    await read();
    const audit = recording.calls.find((c) => c.table === 'collective_audit_events')!;
    expect(audit.filters).toContainEqual(['or', `target_venue_id.eq.${MEMBER},target_venue_id.is.null`]);
  });

  it('refuses a venue that is not in the collective', async () => {
    world(MEMBER, (call) => (call.table === 'venue_collective_members' ? { data: null } : undefined));
    const res = await read();
    expect(res.status).toBe(403);
  });

  it('narrows to one kind of change', async () => {
    const recording = world(HOST);
    await read('?filter=calendars');
    const audit = recording.calls.find((c) => c.table === 'collective_audit_events')!;
    expect(audit.filters).toContainEqual([
      'in',
      'event_type',
      ['calendar_assigned', 'calendar_unassigned', 'values_changed'],
    ]);
  });

  it('downloads the same rows as a spreadsheet', async () => {
    world(HOST);
    const res = await read('?format=csv');
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    expect(res.headers.get('Content-Disposition')).toContain('northside-history.csv');
    expect(await res.text()).toContain('Zen Studio joined');
  });

  it('says so when the collective does not exist', async () => {
    world(HOST, (call) => (call.table === 'venue_collectives' ? { data: null } : undefined));
    const res = await read();
    expect(res.status).toBe(404);
  });
});
