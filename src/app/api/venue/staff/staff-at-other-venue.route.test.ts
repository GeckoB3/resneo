/**
 * MV-02 (collective plan W16, D38): a person who already works at another venue
 * cannot be added as staff. One login with staff rows at two venues cannot open
 * either dashboard, so both team-member routes refuse before they email anyone,
 * touch an auth user or insert a staff row.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/supabase/venue-route-client', () => ({ createVenueRouteClient: vi.fn(async () => ({})) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({})) }));
vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: vi.fn() }));
vi.mock('@/lib/venue-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/venue-auth')>();
  return {
    ...actual,
    getVenueStaff: vi.fn(),
    requireAdmin: (staff: { role?: string } | null) => staff !== null && staff.role === 'admin',
  };
});
vi.mock('@/lib/light-plan', () => ({ assertStaffSlotAvailable: vi.fn(async () => ({ allowed: true, limit: 10 })) }));
vi.mock('@/lib/staff-invite-email', () => ({ deliverStaffAccessLinkEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/staff-invite-redirect', () => ({ getStaffAuthBaseUrl: () => 'http://localhost' }));
vi.mock('@/lib/emails/send-email', () => ({ sendEmail: vi.fn(async () => 'msg-1') }));
vi.mock('@/lib/staff-practitioner-link', () => ({
  setStaffPractitionerLink: vi.fn(async () => ({ ok: true })),
  setStaffUnifiedCalendarAssignments: vi.fn(async () => ({ ok: true })),
}));

import { getVenueStaff, type VenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { deliverStaffAccessLinkEmail } from '@/lib/staff-invite-email';
import { columnsMissingFromMigrations } from '@/lib/testing/migration-columns';
import { makeRecordingDb, type Responder } from '@/lib/testing/recording-supabase';
import { POST as invite } from './invite/route';
import { POST as create } from './create/route';

const VENUE = 'venue-1';
const EMAIL = 'person@example.test';
const EXISTING_USER = 'auth-user-1';

/** Staff rows elsewhere: `email` for a row matched by address, `user` for one matched by auth id only. */
function world(elsewhere: 'none' | 'email' | 'user') {
  const responder: Responder = (call) => {
    if (call.table === 'rpc:lookup_auth_user_id_by_email') return { data: EXISTING_USER };
    if (call.table === 'staff' && call.op === 'insert') {
      return { data: { id: 'staff-new', email: EMAIL, name: null, role: 'staff', created_at: '2026-09-14T00:00:00Z' } };
    }
    if (call.table !== 'staff' || call.op !== 'select') return undefined;
    const excludesThisVenue = call.filters.some((f) => f[0] === 'neq' && f[1] === 'venue_id' && f[2] === VENUE);
    if (!excludesThisVenue) return { data: null, count: 0 };
    const byEmail = call.filters.some((f) => f[0] === 'ilike' && f[1] === 'email');
    const byUser = call.filters.some((f) => f[0] === 'eq' && f[1] === 'user_id' && f[2] === EXISTING_USER);
    const hit = (elsewhere === 'email' && byEmail) || (elsewhere === 'user' && byUser);
    return { data: null, count: hit ? 1 : 0 };
  };
  const rec = makeRecordingDb(responder);
  const auth = {
    admin: {
      updateUserById: vi.fn(async () => ({ data: {}, error: null })),
      createUser: vi.fn(async () => ({ data: { user: { id: 'new-user' } }, error: null })),
    },
  };
  const db = Object.assign(rec.db, { auth }) as unknown as SupabaseClient;
  vi.mocked(getSupabaseAdminClient).mockReturnValue(db);
  const staff: VenueStaff = { id: 'admin-1', venue_id: VENUE, email: 'owner@example.test', role: 'admin', db };
  vi.mocked(getVenueStaff).mockResolvedValue(staff);
  return { rec, auth };
}

function post(path: string, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost${path}`, { method: 'POST', body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/venue/staff/invite', () => {
  it('refuses an email that already works at another venue, before sending anything', async () => {
    const { rec } = world('email');

    const res = await invite(post('/api/venue/staff/invite', { email: 'Person@Example.test', role: 'staff' }));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: `${EMAIL} is already linked to another ResNeo venue, so we cannot add them here. Invite them with a different email address.`,
      code: 'STAFF_EMAIL_AT_OTHER_VENUE',
    });
    expect(deliverStaffAccessLinkEmail).not.toHaveBeenCalled();
    expect(rec.queryCount({ table: 'staff', op: 'insert' })).toBe(0);
    expect(columnsMissingFromMigrations(rec.calls)).toEqual([]);
  });

  it('still invites someone who works nowhere else', async () => {
    const { rec } = world('none');

    const res = await invite(post('/api/venue/staff/invite', { email: EMAIL, role: 'staff' }));

    expect(res.status).toBe(201);
    expect(deliverStaffAccessLinkEmail).toHaveBeenCalledTimes(1);
    expect(rec.queryCount({ table: 'staff', op: 'insert' })).toBe(1);
  });
});

describe('POST /api/venue/staff/create', () => {
  const body = { email: EMAIL, password: 'long-enough-1', password_confirm: 'long-enough-1', role: 'staff' };

  it('refuses before resetting the existing login or inserting a row', async () => {
    const { rec, auth } = world('email');

    const res = await create(post('/api/venue/staff/create', body));

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('STAFF_EMAIL_AT_OTHER_VENUE');
    expect(auth.admin.updateUserById).not.toHaveBeenCalled();
    expect(auth.admin.createUser).not.toHaveBeenCalled();
    expect(rec.queryCount({ table: 'staff', op: 'insert' })).toBe(0);
    expect(columnsMissingFromMigrations(rec.calls)).toEqual([]);
  });

  it('also refuses when the other venue knows the person only by their auth account', async () => {
    const { auth } = world('user');

    const res = await create(post('/api/venue/staff/create', body));

    expect(res.status).toBe(409);
    expect(auth.admin.updateUserById).not.toHaveBeenCalled();
  });
});
