/**
 * staff/[id]/reset-password sets a password the venue admin chose. It used to find the
 * login by matching the staff row's email against one unpaginated listUsers() page, so an
 * admin who invited a customer's address (invite inserts a row with no user_id, and says
 * nothing when the address already has a login) could then reset that customer's own
 * password. It now acts only on the login bound to the row, and only when that login is
 * used nowhere beyond this venue's team.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/supabase/venue-route-client', () => ({ createVenueRouteClient: vi.fn(async () => ({})) }));
vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: vi.fn() }));
vi.mock('@/lib/venue-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/venue-auth')>();
  return {
    ...actual,
    getVenueStaff: vi.fn(),
    requireAdmin: (staff: { role?: string } | null) => staff !== null && staff.role === 'admin',
  };
});

import { getVenueStaff, type VenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { columnsMissingFromMigrations } from '@/lib/testing/migration-columns';
import { makeRecordingDb, type Responder } from '@/lib/testing/recording-supabase';
import { POST } from './route';

const VENUE = 'venue-1';
const STAFF_ID = 'staff-1';
const EMAIL = 'person@example.test';
const TEAM_LOGIN = 'team-login-1';
const CUSTOMER_LOGIN = 'customer-login-1';
const PASSWORD = 'admin-chosen-1';

type FootprintTable = 'guests' | 'venue_customer_stripe' | 'platform_superusers' | 'salespeople';

interface World {
  /** The staff row at this venue: its bound login (null for an unaccepted invite) and revocation. */
  userId?: string | null;
  revokedAt?: string | null;
  /** Rows the bound login holds beyond this venue's team. */
  footprint?: FootprintTable[];
  /** An unrevoked staff row at another venue, matched by address or by auth id. */
  elsewhere?: 'none' | 'email' | 'user';
  footprintError?: FootprintTable;
  role?: 'admin' | 'staff';
}

function world({
  userId = TEAM_LOGIN,
  revokedAt = null,
  footprint = [],
  elsewhere = 'none',
  footprintError,
  role = 'admin',
}: World = {}) {
  const responder: Responder = (call) => {
    const eq = (col: string, val: unknown) => call.filters.some((f) => f[0] === 'eq' && f[1] === col && f[2] === val);
    if (call.table === 'staff') {
      const excludesThisVenue = call.filters.some((f) => f[0] === 'neq' && f[1] === 'venue_id' && f[2] === VENUE);
      if (excludesThisVenue) {
        const byEmail = call.filters.some((f) => f[0] === 'ilike' && f[1] === 'email');
        const byUser = userId !== null && eq('user_id', userId);
        const hit = (elsewhere === 'email' && byEmail) || (elsewhere === 'user' && byUser);
        return { data: null, count: hit ? 1 : 0 };
      }
      if (eq('id', STAFF_ID) && eq('venue_id', VENUE)) {
        return { data: { id: STAFF_ID, email: EMAIL, venue_id: VENUE, user_id: userId, revoked_at: revokedAt } };
      }
      return { data: null };
    }
    if (['guests', 'venue_customer_stripe', 'platform_superusers', 'salespeople'].includes(call.table)) {
      if (call.table === footprintError) return { error: { code: '57014', message: 'statement timeout' } };
      return { data: null, count: footprint.includes(call.table as FootprintTable) ? 2 : 0 };
    }
    return undefined;
  };
  const rec = makeRecordingDb(responder);

  // The old matcher's world: the customer's own login sits on the first listUsers() page.
  const firstPage = [
    { id: CUSTOMER_LOGIN, email: EMAIL },
    ...Array.from({ length: 49 }, (_, i) => ({ id: `other-${i}`, email: `other-${i}@example.test` })),
  ];
  const auth = {
    admin: {
      listUsers: vi.fn(async () => ({ data: { users: firstPage }, error: null })),
      updateUserById: vi.fn(async () => ({ data: {}, error: null })),
    },
  };
  const db = Object.assign(rec.db, { auth }) as unknown as SupabaseClient;
  vi.mocked(getSupabaseAdminClient).mockReturnValue(db);
  const staff: VenueStaff = { id: 'admin-1', venue_id: VENUE, email: 'owner@example.test', role, db };
  vi.mocked(getVenueStaff).mockResolvedValue(staff);
  return { rec, auth };
}

function reset(id = STAFF_ID, password = PASSWORD) {
  return POST(
    new NextRequest(`http://localhost/api/venue/staff/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ new_password: password }),
    }),
    { params: Promise.resolve({ id }) },
  );
}

const EM_DASH = String.fromCharCode(0x2014);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/venue/staff/[id]/reset-password', () => {
  it('sets the password on the login bound to the row when it belongs only to this team', async () => {
    const { rec, auth } = world();

    const res = await reset();

    expect(res.status).toBe(200);
    expect(auth.admin.updateUserById).toHaveBeenCalledTimes(1);
    expect(auth.admin.updateUserById).toHaveBeenCalledWith(TEAM_LOGIN, { password: PASSWORD });
    expect(auth.admin.listUsers).not.toHaveBeenCalled();
    expect(columnsMissingFromMigrations(rec.calls)).toEqual([]);
  });

  it('never reaches a different login that happens to share the row email', async () => {
    const { auth } = world({ userId: TEAM_LOGIN });

    await reset();

    expect(auth.admin.updateUserById).not.toHaveBeenCalledWith(CUSTOMER_LOGIN, expect.anything());
  });

  it("refuses an unaccepted invite for a customer's address, leaving the customer's password alone", async () => {
    const { auth } = world({ userId: null });

    const res = await reset();

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toEqual({
      error: `${EMAIL} has not accepted their invite yet, so there is no login to set a password for. Use the envelope button to send them a new sign-in link.`,
      code: 'STAFF_LOGIN_NOT_CLAIMED',
    });
    expect(body.error).not.toContain(EM_DASH);
    expect(auth.admin.updateUserById).not.toHaveBeenCalled();
    expect(auth.admin.listUsers).not.toHaveBeenCalled();
  });

  it('refuses a revoked row', async () => {
    const { auth } = world({ revokedAt: '2026-09-01T00:00:00Z' });

    const res = await reset();

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('STAFF_LOGIN_NOT_CLAIMED');
    expect(auth.admin.updateUserById).not.toHaveBeenCalled();
  });

  it.each<FootprintTable>(['guests', 'venue_customer_stripe', 'platform_superusers', 'salespeople'])(
    'refuses a login that also has %s rows',
    async (table) => {
      const { auth } = world({ footprint: [table] });

      const res = await reset();

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body).toEqual({
        error: `${EMAIL} also uses this login outside your team, so only they can change its password. Use the envelope button to email them a sign-in link, and they can choose a new password there.`,
        code: 'STAFF_LOGIN_USED_ELSEWHERE',
      });
      expect(body.error).not.toContain(EM_DASH);
      expect(auth.admin.updateUserById).not.toHaveBeenCalled();
    },
  );

  it.each(['user', 'email'] as const)('refuses a login that works at another venue (matched by %s)', async (by) => {
    const { auth } = world({ elsewhere: by });

    const res = await reset();

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('STAFF_LOGIN_USED_ELSEWHERE');
    expect(auth.admin.updateUserById).not.toHaveBeenCalled();
  });

  it('fails closed when a footprint lookup errors', async () => {
    const { auth } = world({ footprintError: 'guests' });

    const res = await reset();

    expect(res.status).toBe(500);
    expect(auth.admin.updateUserById).not.toHaveBeenCalled();
  });

  it('does not find a staff row at another venue', async () => {
    const { auth } = world();

    const res = await reset('staff-at-another-venue');

    expect(res.status).toBe(404);
    expect(auth.admin.updateUserById).not.toHaveBeenCalled();
  });

  it('is admin only', async () => {
    const { auth } = world({ role: 'staff' });

    const res = await reset();

    expect(res.status).toBe(403);
    expect(auth.admin.updateUserById).not.toHaveBeenCalled();
  });
});
