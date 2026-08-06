import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({
  createRouteHandlerClientFromHeaders: vi.fn(async () => ({})),
}));

vi.mock('@/lib/venue-auth', () => ({
  getVenueStaff: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdminClient: vi.fn(),
}));

vi.mock('@/lib/linked-accounts/queries', () => ({
  resolveCallerGrantOverVenue: vi.fn(),
}));

import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { resolveCallerGrantOverVenue } from '@/lib/linked-accounts/queries';
import { GET } from './route';

const mockStaff = vi.mocked(getVenueStaff);
const mockAdmin = vi.mocked(getSupabaseAdminClient);
const mockGrant = vi.mocked(resolveCallerGrantOverVenue);

const CALLER_VENUE = '11111111-1111-4111-8111-111111111111';
const TARGET_VENUE = '22222222-2222-4222-8222-222222222222';

/** Captures what the route asked the database for, so the query itself can be asserted. */
function adminStub(rows: unknown[]) {
  const captured = { select: '', or: '', eq: [] as unknown[], limit: 0 };
  const builder: Record<string, unknown> = {};
  const chain = () => builder;

  Object.assign(builder, {
    select: (cols: string) => {
      captured.select = cols;
      return chain();
    },
    eq: (col: string, val: unknown) => {
      captured.eq.push([col, val]);
      return chain();
    },
    or: (expr: string) => {
      captured.or = expr;
      return chain();
    },
    order: () => chain(),
    limit: (n: number) => {
      captured.limit = n;
      return Promise.resolve({ data: rows, error: null });
    },
  });

  return {
    admin: { from: () => builder } as unknown as ReturnType<typeof getSupabaseAdminClient>,
    captured,
  };
}

function req(q: string, venueId = TARGET_VENUE): NextRequest {
  return new NextRequest(
    `https://resneo.test/api/venue/linked-calendar/guests?venueId=${venueId}&q=${encodeURIComponent(q)}`,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStaff.mockResolvedValue({ venue_id: CALLER_VENUE } as never);
  mockGrant.mockResolvedValue({
    grant: { act: 'create_edit_cancel', pii: true },
  } as never);
});

describe('GET /api/venue/linked-calendar/guests', () => {
  it('refuses to browse: an empty query returns nothing and never queries', async () => {
    const { admin, captured } = adminStub([{ id: 'g1', first_name: 'Ann', last_name: 'Lee', email: 'a@x.test' }]);
    mockAdmin.mockReturnValue(admin);

    const res = await GET(req(''));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ guests: [] });
    // The database was never asked, so no rows can leak from the head of the list.
    expect(captured.limit).toBe(0);
  });

  it('refuses a single character, which would still walk the alphabet', async () => {
    const { admin, captured } = adminStub([]);
    mockAdmin.mockReturnValue(admin);

    const res = await GET(req('a'));

    expect(await res.json()).toEqual({ guests: [] });
    expect(captured.limit).toBe(0);
  });

  it('matches email on prefix, not substring', async () => {
    const { admin, captured } = adminStub([]);
    mockAdmin.mockReturnValue(admin);

    await GET(req('ann'));

    expect(captured.or).toContain('email.ilike.ann%');
    // A leading wildcard on email is the enumeration primitive this route must not offer.
    expect(captured.or).not.toContain('email.ilike.%ann');
  });

  it('does not select the dropped guests.name column', async () => {
    const { admin, captured } = adminStub([]);
    mockAdmin.mockReturnValue(admin);

    await GET(req('ann'));

    expect(captured.select).toBe('id, first_name, last_name, email');
    expect(captured.select).not.toMatch(/(^|,\s*)name(\s*,|$)/);
  });

  it('scopes the search to the requested venue', async () => {
    const { admin, captured } = adminStub([]);
    mockAdmin.mockReturnValue(admin);

    await GET(req('ann'));

    expect(captured.eq).toContainEqual(['venue_id', TARGET_VENUE]);
  });

  it('composes a display name from first and last name', async () => {
    const { admin } = adminStub([
      { id: 'g1', first_name: 'Ann', last_name: 'Lee', email: 'ann@x.test' },
      { id: 'g2', first_name: null, last_name: null, email: null },
    ]);
    mockAdmin.mockReturnValue(admin);

    const res = await GET(req('ann'));

    expect(await res.json()).toEqual({
      guests: [
        { id: 'g1', name: 'Ann Lee', email: 'ann@x.test' },
        { id: 'g2', name: 'Client', email: null },
      ],
    });
  });

  it('requires a create-capable link with PII before searching at all', async () => {
    mockGrant.mockResolvedValue({ grant: { act: 'view_only', pii: true } } as never);
    const { admin, captured } = adminStub([]);
    mockAdmin.mockReturnValue(admin);

    const res = await GET(req('ann'));

    expect(res.status).toBe(403);
    expect(captured.limit).toBe(0);
  });

  it('rejects a malformed venue id', async () => {
    const res = await GET(req('ann', 'not-a-uuid'));
    expect(res.status).toBe(400);
  });
});
