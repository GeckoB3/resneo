import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/linked-accounts/route-helpers', () => ({
  resolveLinkAdmin: vi.fn(),
}));

vi.mock('@/lib/linked-accounts/queries', () => ({
  countOutgoingPendingRequests: vi.fn(),
  findLiveLinkBetween: vi.fn(),
  lastRejectedLinkBetween: vi.fn(),
  loadLinkViewsForVenue: vi.fn(),
}));

vi.mock('@/lib/linked-accounts/notifications', () => ({
  notifyLinkRequestReceived: vi.fn(),
}));

import { resolveLinkAdmin } from '@/lib/linked-accounts/route-helpers';
import {
  countOutgoingPendingRequests,
  findLiveLinkBetween,
  lastRejectedLinkBetween,
  loadLinkViewsForVenue,
} from '@/lib/linked-accounts/queries';
import { POST } from './route';

const mockResolve = vi.mocked(resolveLinkAdmin);
const mockFindLive = vi.mocked(findLiveLinkBetween);
const mockCountPending = vi.mocked(countOutgoingPendingRequests);
const mockLastRejected = vi.mocked(lastRejectedLinkBetween);
const mockLoadViews = vi.mocked(loadLinkViewsForVenue);

const VENUE_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const VENUE_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function mockCtx(overrides: Record<string, unknown> = {}) {
  const insertMock = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: { id: 'link-1' }, error: null }),
    }),
  });
  const admin = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'venues') {
        return {
          select: vi.fn().mockReturnThis(),
          ilike: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: VENUE_B,
              name: 'Partner Venue',
              slug: 'partner',
              pricing_tier: 'appointments',
              plan_status: 'active',
              booking_model: 'appointments',
            },
            error: null,
          }),
        };
      }
      if (table === 'account_links') {
        return { insert: insertMock };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };

  return {
    ok: true as const,
    ctx: {
      admin,
      venueId: VENUE_A,
      userId: 'user-1',
      venue: {
        id: VENUE_A,
        name: 'My Venue',
        slug: 'my-venue',
        pricing_tier: 'appointments',
        plan_status: 'active',
        booking_model: 'appointments',
      },
      eligibility: { feature: true, canCreate: true, reason: null },
      staff: { venue_id: VENUE_A, role: 'admin' },
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFindLive.mockResolvedValue(null);
  mockCountPending.mockResolvedValue(0);
  mockLastRejected.mockResolvedValue(null);
  mockLoadViews.mockResolvedValue([{ id: 'link-1' }] as never);
});

describe('POST /api/venue/account-links', () => {
  it('returns 400 when both directions are none', async () => {
    mockResolve.mockResolvedValue(mockCtx() as never);
    const req = new NextRequest('https://site.test/api/venue/account-links', {
      method: 'POST',
      body: JSON.stringify({
        targetSlug: 'partner',
        grants: {
          mine: { calendar: 'none', pii: false, act: 'none' },
          theirs: { calendar: 'none', pii: false, act: 'none' },
        },
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/at least one direction/i);
  });

  it('returns 409 when venues are already linked', async () => {
    mockResolve.mockResolvedValue(mockCtx() as never);
    mockFindLive.mockResolvedValue({
      id: 'existing',
      status: 'accepted',
    } as never);
    const req = new NextRequest('https://site.test/api/venue/account-links', {
      method: 'POST',
      body: JSON.stringify({
        targetSlug: 'partner',
        grants: {
          mine: { calendar: 'full_details', pii: true, act: 'edit_existing' },
          theirs: { calendar: 'time_only', pii: false, act: 'none' },
        },
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toMatch(/already linked/i);
  });

  it('creates a pending link when configuration is valid', async () => {
    mockResolve.mockResolvedValue(mockCtx() as never);
    const req = new NextRequest('https://site.test/api/venue/account-links', {
      method: 'POST',
      body: JSON.stringify({
        targetSlug: 'partner',
        requestMessage: 'Hi',
        grants: {
          mine: { calendar: 'full_details', pii: true, act: 'edit_existing' },
          theirs: { calendar: 'time_only', pii: false, act: 'none' },
        },
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.link).toBeTruthy();
  });
});
