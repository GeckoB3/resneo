import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/linked-accounts/route-helpers', () => ({
  resolveLinkAdmin: vi.fn(),
  enforceLinkRateLimit: vi.fn(() => null),
}));
vi.mock('@/lib/linked-accounts/queries', () => ({
  loadLinkViewsForVenue: vi.fn(async () => []),
}));
vi.mock('@/lib/linked-accounts/notifications', () => ({
  notifyLinkAccepted: vi.fn(),
  notifyLinkRejected: vi.fn(),
  notifyLinkUnlinked: vi.fn(),
  notifyPermissionChangeAccepted: vi.fn(),
  notifyPermissionChangeDeclined: vi.fn(),
  notifyPermissionChangeProposed: vi.fn(),
}));
vi.mock('@/lib/linked-accounts/collectives', () => ({
  reconcileCollectivesAfterLinkChange: vi.fn(),
}));

import { resolveLinkAdmin } from '@/lib/linked-accounts/route-helpers';
import { notifyPermissionChangeProposed } from '@/lib/linked-accounts/notifications';
import { PATCH } from './route';

const LOW = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const HIGH = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const LINK = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

/** The requester (HIGH) asked, offering `time_only` and asking for `time_only`. */
function linkRow(over: Record<string, unknown> = {}) {
  return {
    id: LINK,
    venue_low_id: LOW,
    venue_high_id: HIGH,
    requested_by_venue_id: HIGH,
    status: 'pending',
    low_grants_calendar: 'time_only',
    low_grants_pii: false,
    low_grants_act: 'none',
    low_grants_calendar_ids: null,
    high_grants_calendar: 'time_only',
    high_grants_pii: false,
    high_grants_act: 'none',
    high_grants_calendar_ids: null,
    pending_change: null,
    ...over,
  };
}

let updatePayload: Record<string, unknown> | null = null;

/** The accepter is LOW, so `mine` maps to low_* and `theirs` to high_*. */
function mockCtx(row: Record<string, unknown>) {
  updatePayload = null;
  const admin = {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: row }) }),
      }),
      update: (payload: Record<string, unknown>) => {
        updatePayload = payload;
        return { eq: async () => ({ error: null }) };
      },
    }),
  };
  vi.mocked(resolveLinkAdmin).mockResolvedValue({
    ok: true,
    ctx: {
      admin,
      venueId: LOW,
      userId: 'user-1',
      venue: { name: 'Studio Low' },
      eligibility: { canCreate: true },
    },
  } as unknown as Awaited<ReturnType<typeof resolveLinkAdmin>>);
}

const patch = (grants: unknown) =>
  PATCH(
    new NextRequest(`http://localhost/api/venue/account-links/${LINK}`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'accept_with_changes', grants }),
      headers: { 'content-type': 'application/json' },
    }),
    { params: Promise.resolve({ id: LINK }) },
  );

const grant = (over: Record<string, unknown> = {}) => ({
  calendar: 'time_only',
  pii: false,
  act: 'none',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PATCH accept_with_changes (C7)', () => {
  it('does not raise what the REQUESTER exposes without their consent', async () => {
    // The seizure: the accepter accepts, and in the same update rewrites the
    // requester's own grant up to full_details + PII + full write access.
    mockCtx(linkRow());
    const res = await patch({
      mine: grant(),
      theirs: grant({ calendar: 'full_details', pii: true, act: 'create_edit_cancel' }),
    });

    expect(res.status).toBe(200);
    // The link goes live, but on the requester's ORIGINAL terms.
    expect(updatePayload!.status).toBe('accepted');
    expect(updatePayload!.high_grants_calendar).toBeUndefined();
    expect(updatePayload!.high_grants_pii).toBeUndefined();
    expect(updatePayload!.high_grants_act).toBeUndefined();
    // The raise is deferred to the requester's own accept_change.
    const pc = updatePayload!.pending_change as Record<string, unknown>;
    expect(pc).toBeTruthy();
    expect(pc.by_venue_id).toBe(LOW);
    expect(pc.high_grants_calendar).toBe('full_details');
    expect(pc.high_grants_act).toBe('create_edit_cancel');
  });

  it('tells the requester a change is waiting on them', async () => {
    mockCtx(linkRow());
    await patch({
      mine: grant(),
      theirs: grant({ calendar: 'full_details', pii: true, act: 'create_edit_cancel' }),
    });
    expect(notifyPermissionChangeProposed).toHaveBeenCalledTimes(1);
  });

  it('applies the accepter’s own side immediately', async () => {
    mockCtx(linkRow());
    const res = await patch({
      mine: grant({ calendar: 'full_details', pii: true }),
      theirs: grant(),
    });

    expect(res.status).toBe(200);
    expect(updatePayload!.low_grants_calendar).toBe('full_details');
    expect(updatePayload!.low_grants_pii).toBe(true);
    // Nothing was asked of the requester, so nothing is pending.
    expect(updatePayload!.pending_change).toBeUndefined();
    expect(notifyPermissionChangeProposed).not.toHaveBeenCalled();
  });

  it('refuses to activate a link that would grant nothing either way', async () => {
    // The round-three guard: lowering `mine` to none while deferring a rise in
    // `theirs` would leave the LIVE link none/none, permanently so if the
    // requester later rejects the pending change.
    mockCtx(linkRow({ high_grants_calendar: 'none', high_grants_act: 'none' }));
    const res = await patch({
      mine: grant({ calendar: 'none' }),
      theirs: grant({ calendar: 'full_details', act: 'create_edit_cancel' }),
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/nothing in either direction/i);
    expect(updatePayload).toBeNull();
  });
});
