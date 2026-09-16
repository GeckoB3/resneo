/**
 * Membership actions (LIFE-01, LIFE-14).
 *
 * LIFE-01: a venue already in another live collective cannot be invited or accept, and an accept on
 * the shared-services model without the consent the dialog shows (an older app's one-tap accept)
 * is refused with a code and the way forward.
 *
 * LIFE-14 (D41): leaving, removal, declining and ending a collective change only the collective.
 * No path writes an account link or its audit log, on either model.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb, type RecordedCall, type Responder } from '@/lib/testing/recording-supabase';

vi.mock('@/lib/linked-accounts/route-helpers', () => ({ resolveLinkAdmin: vi.fn() }));
vi.mock('@/lib/linked-accounts/notifications', () => ({
  notifyCollectiveDissolved: vi.fn(),
  notifyCollectiveHostTransferred: vi.fn(),
  notifyCollectiveInvitation: vi.fn(),
  notifyCollectiveMemberLeft: vi.fn(),
  notifyCollectiveRemoval: vi.fn(),
  notifyVenue: vi.fn(async () => ({ emailFailures: 0 })),
}));
vi.mock('@/lib/linked-accounts/collectives', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/linked-accounts/collectives')>()),
  loadCollectiveViewsForVenue: vi.fn(async () => []),
  reconcileCollective: vi.fn(async () => ({ removedVenueIds: [], dissolved: false, hostTransferredTo: null })),
}));
vi.mock('@/lib/linked-accounts/catalogue', () => ({
  checkCombinedEligibility: vi.fn(async () => ({ ok: true, reason: null, timezone: 'Europe/London' })),
}));
vi.mock('@/lib/linked-accounts/collective-venue', () => ({ invalidateCollectiveCatalogMemo: vi.fn() }));
vi.mock('@/lib/linked-accounts/replicas/release-followups', () => ({
  drainReleaseFollowups: vi.fn(async () => ({})),
}));
const setListOnOldPage = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@/lib/linked-accounts/replicas/dissolved-page', () => ({ setListOnOldPage }));
vi.mock('@/lib/linked-accounts/replicas/release-review', () => ({
  loadReleaseReview: vi.fn(async () => null),
}));

import { resolveLinkAdmin } from '@/lib/linked-accounts/route-helpers';
import { PATCH } from './route';
import { DELETE } from '../route';

const COLLECTIVE = 'aaaaaaaa-0000-4000-8000-000000000001';
const HOST = 'aaaaaaaa-0000-4000-8000-00000000000a';
const MEMBER = 'aaaaaaaa-0000-4000-8000-00000000000b';
const OUTSIDER = 'aaaaaaaa-0000-4000-8000-00000000000c';

interface WorldOptions {
  model?: 'legacy_copies' | 'replicas';
  /** The venues already in another live collective. */
  elsewhere?: string[];
  myStatus?: 'invited' | 'active';
  collectiveStatus?: string;
}

function world({ model = 'legacy_copies', elsewhere = [], myStatus = 'active', collectiveStatus = 'active' }: WorldOptions): Responder {
  return (call) => {
    const eqValue = (column: string) => call.filters.find((f) => f[0] === 'eq' && f[1] === column)?.[2];
    if (call.table === 'venue_collectives' && call.op === 'select') {
      if (call.columns === 'service_model') return { data: { service_model: model } };
      if (eqValue('host_venue_id') !== undefined) return { data: [] };
      if (call.filters.some((f) => f[0] === 'in' && f[1] === 'id')) {
        return { data: [{ id: 'other-collective', name: 'Southside', host_venue_id: 'someone', status: 'active' }] };
      }
      return {
        data: {
          id: COLLECTIVE,
          host_venue_id: HOST,
          status: collectiveStatus,
          name: 'Northside',
          page_mode: 'unified_catalog',
          booking_page_config: {},
          branding: {},
          service_model: model,
        },
      };
    }
    if (call.table === 'venue_collective_members' && call.op === 'select') {
      const venue = eqValue('venue_id') as string | undefined;
      if (call.columns === 'collective_id') {
        return { data: venue && elsewhere.includes(venue) ? [{ collective_id: 'other-collective' }] : [] };
      }
      if (call.columns === 'id, status') {
        if (venue === MEMBER) return { data: { id: 'membership-member', status: myStatus } };
        if (venue === HOST) return { data: { id: 'membership-host', status: 'active' } };
        return { data: null };
      }
      // The "already invited or a member" lookup.
      if (call.columns === 'id') return { data: null };
      if (call.columns === 'status') return { data: [{ status: 'active' }, { status: 'active' }, { status: 'active' }] };
      return { data: [{ venue_id: HOST }, { venue_id: MEMBER }] };
    }
    if (call.table === 'venues' && call.op === 'select') return { data: { name: 'Bloom' } };
    if (call.table === 'rpc:collective_release_member') return { data: { operation_id: 'op-1' } };
    return undefined;
  };
}

function signIn(venueId: string, options: WorldOptions = {}) {
  const recording = makeRecordingDb(world(options));
  vi.mocked(resolveLinkAdmin).mockResolvedValue({
    ok: true,
    ctx: {
      admin: recording.db as unknown as SupabaseClient,
      venueId,
      userId: 'user-1',
      venue: { id: venueId, name: venueId === HOST ? 'Host Venue' : 'Zen Studio' },
      eligibility: { feature: true, canCreate: true },
    },
  } as unknown as Awaited<ReturnType<typeof resolveLinkAdmin>>);
  return recording;
}

const params = { params: Promise.resolve({ id: COLLECTIVE }) };
const patch = (body: Record<string, unknown>) =>
  PATCH(new NextRequest('http://test/api', { method: 'PATCH', body: JSON.stringify(body) }), params);

const linkWrites = (calls: RecordedCall[]) =>
  calls.filter(
    (c) => (c.table === 'account_links' || c.table === 'account_link_audit_log') && c.op !== 'select',
  );

beforeEach(() => {
  vi.mocked(resolveLinkAdmin).mockReset();
});

describe('LIFE-01: one live collective per venue', () => {
  it('refuses to invite a venue in another live collective', async () => {
    signIn(HOST, { elsewhere: [OUTSIDER] });
    const response = await patch({ action: 'invite', venueId: OUTSIDER });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: 'COLLECTIVE_VENUE_IN_OTHER_COLLECTIVE',
      error: 'Bloom is already part of another collective, so it cannot be invited until it leaves.',
    });
  });

  it('refuses an accept while the venue is in another live collective, naming it', async () => {
    signIn(MEMBER, { elsewhere: [MEMBER], myStatus: 'invited' });
    const response = await patch({ action: 'accept' });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: 'COLLECTIVE_VENUE_IN_OTHER_COLLECTIVE',
      error: 'Your venue is already part of Southside. Leave it before joining another.',
    });
  });

  it("refuses an older app's one-tap accept on the shared-services model", async () => {
    const recording = signIn(MEMBER, { model: 'replicas', myStatus: 'invited' });
    const response = await patch({ action: 'accept' });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: 'COLLECTIVE_CONSENT_REQUIRED',
      error: 'Please open ResNeo on the web to read what joining means, then accept there.',
    });
    expect(recording.calls.some((c) => c.table === 'rpc:collective_join_member')).toBe(false);
  });
});

describe('LIFE-14: ending a membership never touches an account link', () => {
  for (const model of ['legacy_copies', 'replicas'] as const) {
    it(`leave (${model})`, async () => {
      const recording = signIn(MEMBER, { model });
      expect((await patch({ action: 'leave' })).status).toBe(200);
      expect(linkWrites(recording.calls)).toEqual([]);
      if (model === 'replicas') {
        expect(recording.calls.some((c) => c.table === 'rpc:collective_release_member')).toBe(true);
      }
    });

    it(`remove (${model})`, async () => {
      const recording = signIn(HOST, { model });
      expect((await patch({ action: 'remove', venueId: MEMBER })).status).toBe(200);
      expect(linkWrites(recording.calls)).toEqual([]);
    });

    it(`dissolve (${model})`, async () => {
      const recording = signIn(HOST, { model });
      const response = await DELETE(new NextRequest('http://test/api', { method: 'DELETE' }), params);
      expect(response.status).toBe(200);
      expect(linkWrites(recording.calls)).toEqual([]);
    });
  }

  it('decline', async () => {
    const recording = signIn(MEMBER, { myStatus: 'invited' });
    expect((await patch({ action: 'decline' })).status).toBe(200);
    expect(linkWrites(recording.calls)).toEqual([]);
  });
});

describe('contract 9: listing on the old page after the end', () => {
  it('lets a former member change its choice', async () => {
    signIn(MEMBER, { collectiveStatus: 'dissolved' });
    const response = await patch({ action: 'configure', list_on_old_page: false });
    expect(response.status).toBe(200);
    expect(setListOnOldPage).toHaveBeenCalledWith(expect.anything(), COLLECTIVE, MEMBER, false);
  });

  it('refuses a venue that was not part of it at the end', async () => {
    signIn(OUTSIDER, { collectiveStatus: 'dissolved' });
    setListOnOldPage.mockResolvedValueOnce(false);
    expect((await patch({ action: 'configure', list_on_old_page: true })).status).toBe(404);
  });

  it('still refuses any other change to an ended collective', async () => {
    signIn(MEMBER, { collectiveStatus: 'dissolved' });
    setListOnOldPage.mockClear();
    expect((await patch({ action: 'leave' })).status).toBe(409);
    expect(setListOnOldPage).not.toHaveBeenCalled();
  });
});
