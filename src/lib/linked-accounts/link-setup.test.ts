/**
 * The one-call setup (Docs/link-and-collective-setup-wizard-plan.md §3.1, L3 and L4): a link alone
 * notifies as before; a link with a collective creates both and sends one notice; a refused
 * collective takes the link row with it; a collective is refused below full access.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/linked-accounts/link-request', () => ({ createLinkRequest: vi.fn() }));
vi.mock('@/lib/linked-accounts/collective-create', () => ({ createCollectiveWithInvites: vi.fn() }));
vi.mock('@/lib/linked-accounts/collective-standing', () => ({ collectiveStandingBetween: vi.fn() }));
vi.mock('@/lib/linked-accounts/queries', () => ({ loadLinkViewsForVenue: vi.fn(async () => [{ id: 'link-1' }]) }));
vi.mock('@/lib/linked-accounts/notifications', () => ({
  notifyLinkRequestReceived: vi.fn(),
  notifyLinkRequestWithCollective: vi.fn(),
}));

import { NextResponse } from 'next/server';
import { createLinkRequest } from '@/lib/linked-accounts/link-request';
import { createCollectiveWithInvites } from '@/lib/linked-accounts/collective-create';
import { collectiveStandingBetween } from '@/lib/linked-accounts/collective-standing';
import { notifyLinkRequestReceived, notifyLinkRequestWithCollective } from '@/lib/linked-accounts/notifications';
import { grantForLevel } from '@/lib/linked-accounts/link-levels';
import { runLinkSetup } from './link-setup';

const deleted: string[] = [];
const admin = {
  from: () => ({ delete: () => ({ eq: async (_col: string, id: string) => void deleted.push(id) }) }),
} as unknown as SupabaseClient;
const ctx = {
  admin,
  venueId: 'host',
  userId: 'u',
  venue: { id: 'host', name: 'Zen Studio', slug: 'zen' },
  eligibility: { feature: true, canCreate: true },
} as never;

const full = grantForLevel('full');
const linkOk = {
  ok: true as const,
  linkId: 'link-1',
  target: { id: 'bloom', name: 'Bloom', slug: 'bloom' },
  mine: full,
  theirs: full,
  permissionBullets: ['x'],
};

beforeEach(() => {
  deleted.length = 0;
  vi.mocked(createLinkRequest).mockReset();
  vi.mocked(createCollectiveWithInvites).mockReset();
  vi.mocked(collectiveStandingBetween).mockReset();
  vi.mocked(notifyLinkRequestReceived).mockClear();
  vi.mocked(notifyLinkRequestWithCollective).mockClear();
});

describe('runLinkSetup', () => {
  it('a link alone is sent and notified as before', async () => {
    vi.mocked(createLinkRequest).mockResolvedValue(linkOk);
    const res = await runLinkSetup(ctx, { targetSlug: 'bloom', grants: { mine: full, theirs: full } });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ link: { id: 'link-1' }, collective: null });
    expect(vi.mocked(createLinkRequest).mock.calls[0]![2]).toEqual({ notify: false });
    expect(notifyLinkRequestReceived).toHaveBeenCalledWith(admin, 'bloom', 'Zen Studio', ['x']);
    expect(createCollectiveWithInvites).not.toHaveBeenCalled();
  });

  it('a link with a collective creates both, skipping the mesh, and sends one notice', async () => {
    vi.mocked(createLinkRequest).mockResolvedValue(linkOk);
    vi.mocked(collectiveStandingBetween).mockResolvedValue({ standing: 'ok', reason: null, detail: null });
    vi.mocked(createCollectiveWithInvites).mockResolvedValue({ ok: true, collectiveId: 'c-1', name: 'Northside', slug: 'northside' });
    const res = await runLinkSetup(ctx, {
      targetSlug: 'bloom',
      grants: { mine: full, theirs: full },
      collective: { name: 'Northside', slug: 'northside' },
    });
    expect(res.status).toBe(201);
    expect((await res.json()).collective).toEqual({ id: 'c-1', name: 'Northside', slug: 'northside' });
    expect(vi.mocked(createCollectiveWithInvites).mock.calls[0]![1]).toEqual({ name: 'Northside', slug: 'northside', inviteVenueIds: ['bloom'] });
    expect(vi.mocked(createCollectiveWithInvites).mock.calls[0]![2]).toEqual({ skipMeshCheck: true, notify: false });
    expect(notifyLinkRequestWithCollective).toHaveBeenCalledWith(admin, 'bloom', 'Zen Studio', expect.objectContaining({ id: 'c-1', name: 'Northside' }), ['x']);
    expect(notifyLinkRequestReceived).not.toHaveBeenCalled();
    expect(deleted).toEqual([]);
  });

  it('a refused collective takes the link row with it, and nothing is sent', async () => {
    vi.mocked(createLinkRequest).mockResolvedValue(linkOk);
    vi.mocked(collectiveStandingBetween).mockResolvedValue({ standing: 'ok', reason: null, detail: null });
    vi.mocked(createCollectiveWithInvites).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'That address is taken.', field: 'slug' }, { status: 409 }),
    });
    const res = await runLinkSetup(ctx, {
      targetSlug: 'bloom',
      grants: { mine: full, theirs: full },
      collective: { name: 'Northside', slug: 'northside' },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'That address is taken.', field: 'slug' });
    expect(deleted).toEqual(['link-1']);
    expect(notifyLinkRequestReceived).not.toHaveBeenCalled();
    expect(notifyLinkRequestWithCollective).not.toHaveBeenCalled();
  });

  it('a venue that cannot join is refused with the reason, and the link row removed', async () => {
    vi.mocked(createLinkRequest).mockResolvedValue(linkOk);
    vi.mocked(collectiveStandingBetween).mockResolvedValue({ standing: 'blocked', reason: 'Uses EUR, not GBP', detail: null });
    const res = await runLinkSetup(ctx, {
      targetSlug: 'bloom',
      grants: { mine: full, theirs: full },
      collective: { name: 'Northside', slug: 'northside' },
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('A collective with Bloom is not possible yet: Uses EUR, not GBP');
    expect(deleted).toEqual(['link-1']);
    expect(createCollectiveWithInvites).not.toHaveBeenCalled();
  });

  it('a collective below full access is refused before anything is written', async () => {
    const res = await runLinkSetup(ctx, {
      targetSlug: 'bloom',
      grants: { mine: grantForLevel('manage'), theirs: full },
      collective: { name: 'Northside', slug: 'northside' },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe('level');
    expect(createLinkRequest).not.toHaveBeenCalled();
  });
});
