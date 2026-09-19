/**
 * Accepting a link request that carries a collective invitation
 * (Docs/link-and-collective-setup-wizard-plan.md, L4 to L7): the link first, then the join; a refused
 * join leaves the link accepted and says so; below full access the collective part is refused before
 * anything is written; declining closes the invitation that rode on the request.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/linked-accounts/route-helpers', () => ({
  resolveLinkAdmin: vi.fn(),
  enforceLinkRateLimit: vi.fn(() => null),
}));
vi.mock('@/lib/linked-accounts/queries', () => ({
  loadLinkViewsForVenue: vi.fn(async () => [{ id: 'cccccccc-cccc-cccc-cccc-cccccccccccc' }]),
}));
vi.mock('@/lib/linked-accounts/notifications', () => ({
  notifyLinkAccepted: vi.fn(),
  notifyLinkAcceptedWithCollective: vi.fn(),
  notifyLinkRejected: vi.fn(),
  notifyLinkUnlinked: vi.fn(),
  notifyPermissionChangeAccepted: vi.fn(),
  notifyPermissionChangeDeclined: vi.fn(),
  notifyPermissionChangeProposed: vi.fn(),
  notifyProposedCollectiveClosed: vi.fn(),
}));
vi.mock('@/lib/linked-accounts/collectives', () => ({ reconcileCollectivesAfterLinkChange: vi.fn() }));
vi.mock('@/lib/linked-accounts/collective-venue', () => ({ invalidateCollectiveCatalogMemo: vi.fn() }));
vi.mock('@/lib/linked-accounts/replicas/join', () => ({ runJoin: vi.fn() }));
vi.mock('@/lib/linked-accounts/proposed-collectives', () => ({
  loadInvitationForLink: vi.fn(),
  closeInvitationForLink: vi.fn(),
}));

import { resolveLinkAdmin } from '@/lib/linked-accounts/route-helpers';
import { runJoin } from '@/lib/linked-accounts/replicas/join';
import { closeInvitationForLink, loadInvitationForLink } from '@/lib/linked-accounts/proposed-collectives';
import {
  notifyLinkAccepted,
  notifyLinkAcceptedWithCollective,
  notifyLinkRejected,
  notifyProposedCollectiveClosed,
} from '@/lib/linked-accounts/notifications';
import { PATCH } from './route';

const LOW = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const HIGH = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const LINK = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const COLLECTIVE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

/** HIGH asked LOW, offering full access both ways. */
function linkRow(over: Record<string, unknown> = {}) {
  return {
    id: LINK,
    venue_low_id: LOW,
    venue_high_id: HIGH,
    requested_by_venue_id: HIGH,
    status: 'pending',
    low_grants_calendar: 'full_details',
    low_grants_pii: true,
    low_grants_act: 'create_edit_cancel',
    low_grants_calendar_ids: null,
    high_grants_calendar: 'full_details',
    high_grants_pii: true,
    high_grants_act: 'create_edit_cancel',
    high_grants_calendar_ids: null,
    pending_change: null,
    ...over,
  };
}

const events: string[] = [];

function mockCtx(row: Record<string, unknown>) {
  const admin = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row }) }) }),
      update: (payload: Record<string, unknown>) => {
        events.push(`update:${String(payload.status)}`);
        return { eq: async () => ({ error: null }) };
      },
    }),
  };
  vi.mocked(resolveLinkAdmin).mockResolvedValue({
    ok: true,
    ctx: { admin, venueId: LOW, userId: 'user-1', venue: { name: 'Studio Low' }, eligibility: { canCreate: true } },
  } as unknown as Awaited<ReturnType<typeof resolveLinkAdmin>>);
}

const invitation = { id: COLLECTIVE, name: 'Northside', slug: 'northside', hostVenueId: HIGH, memberId: 'm-1', serviceModel: 'replicas' };
const collectiveBody = { collective_id: COLLECTIVE, consent_version: 'join-2026-09', own_service_choices: [] };

const patch = (body: unknown) =>
  PATCH(
    new NextRequest(`http://localhost/api/venue/account-links/${LINK}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
    { params: Promise.resolve({ id: LINK }) },
  );

beforeEach(() => {
  events.length = 0;
  vi.mocked(runJoin).mockReset();
  vi.mocked(loadInvitationForLink).mockReset();
  vi.mocked(closeInvitationForLink).mockReset();
  vi.mocked(notifyLinkAccepted).mockClear();
  vi.mocked(notifyLinkAcceptedWithCollective).mockClear();
  vi.mocked(notifyLinkRejected).mockClear();
  vi.mocked(notifyProposedCollectiveClosed).mockClear();
  vi.mocked(runJoin).mockImplementation(async () => {
    events.push('join');
    return null;
  });
});

describe('accepting a link request with the collective it proposes', () => {
  it('accepts the link, then joins, then sends the host one notice', async () => {
    mockCtx(linkRow());
    vi.mocked(loadInvitationForLink).mockResolvedValue(invitation);
    const res = await patch({ action: 'accept', collective: collectiveBody });
    expect(res.status).toBe(200);
    expect(events).toEqual(['update:accepted', 'join']);
    const joinCall = vi.mocked(runJoin).mock.calls[0]!;
    expect(joinCall[0]).toMatchObject({ collectiveId: COLLECTIVE, hostVenueId: HIGH, memberId: 'm-1', venueId: LOW });
    expect(joinCall[1]).toMatchObject({ consent_version: 'join-2026-09' });
    expect(joinCall[2]).toEqual({ skipHostNotice: true });
    expect((await res.json()).collective).toEqual({ id: COLLECTIVE, name: 'Northside', joined: true });
    expect(notifyLinkAcceptedWithCollective).toHaveBeenCalledWith(expect.anything(), HIGH, 'Studio Low', { id: COLLECTIVE, name: 'Northside' });
    expect(notifyLinkAccepted).not.toHaveBeenCalled();
  });

  it('a refused join leaves the link accepted and says why', async () => {
    mockCtx(linkRow());
    vi.mocked(loadInvitationForLink).mockResolvedValue(invitation);
    vi.mocked(runJoin).mockResolvedValue(NextResponse.json({ error: 'Your venue is already part of another collective.' }, { status: 409 }));
    const res = await patch({ action: 'accept', collective: collectiveBody });
    expect(res.status).toBe(200);
    expect(events).toEqual(['update:accepted']);
    expect((await res.json()).collective).toEqual({
      id: COLLECTIVE,
      name: 'Northside',
      joined: false,
      error: 'Your venue is already part of another collective.',
    });
    expect(notifyLinkAccepted).toHaveBeenCalled();
    expect(notifyLinkAcceptedWithCollective).not.toHaveBeenCalled();
  });

  it('refuses the collective part below full access, before anything is written', async () => {
    mockCtx(linkRow());
    vi.mocked(loadInvitationForLink).mockResolvedValue(invitation);
    const res = await patch({
      action: 'accept_with_changes',
      grants: {
        mine: { calendar: 'full_details', pii: true, act: 'edit_existing' },
        theirs: { calendar: 'full_details', pii: true, act: 'create_edit_cancel' },
      },
      collective: collectiveBody,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('COLLECTIVE_LINK_NOT_FULL');
    expect(events).toEqual([]);
    expect(runJoin).not.toHaveBeenCalled();
  });

  it('refuses a collective the requester did not propose', async () => {
    mockCtx(linkRow());
    vi.mocked(loadInvitationForLink).mockResolvedValue(null);
    const res = await patch({ action: 'accept', collective: collectiveBody });
    expect(res.status).toBe(404);
    expect(events).toEqual([]);
  });

  it('a plain accept still works, with no join and the usual notice', async () => {
    mockCtx(linkRow());
    const res = await patch({ action: 'accept' });
    expect(res.status).toBe(200);
    expect((await res.json()).collective).toBeNull();
    expect(loadInvitationForLink).not.toHaveBeenCalled();
    expect(notifyLinkAccepted).toHaveBeenCalled();
  });

  it('declining closes the invitation that rode on the request and tells the host once', async () => {
    mockCtx(linkRow());
    vi.mocked(closeInvitationForLink).mockResolvedValue({ closed: true, dissolved: true, collectiveName: 'Northside' });
    const res = await patch({ action: 'reject' });
    expect(res.status).toBe(200);
    expect(closeInvitationForLink).toHaveBeenCalledWith(expect.anything(), {
      hostVenueId: HIGH,
      inviteeVenueId: LOW,
      reason: 'declined',
      actorVenueId: LOW,
      actorUserId: 'user-1',
    });
    expect(notifyProposedCollectiveClosed).toHaveBeenCalledWith(expect.anything(), HIGH, 'Studio Low', 'Northside', 'declined', true);
    expect(notifyLinkRejected).not.toHaveBeenCalled();
  });

  it('declining a plain request sends the plain notice', async () => {
    mockCtx(linkRow());
    vi.mocked(closeInvitationForLink).mockResolvedValue({ closed: false, dissolved: false, collectiveName: null });
    await patch({ action: 'reject' });
    expect(notifyLinkRejected).toHaveBeenCalled();
    expect(notifyProposedCollectiveClosed).not.toHaveBeenCalled();
  });
});
