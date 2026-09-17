/**
 * staff/create sets a password the venue admin chose and emails it to the person.
 * It used to find an existing login through one unpaginated listUsers() page and
 * overwrite that login's password, so an admin who typed a customer's email got a
 * working password for their account. It now refuses any address that already has
 * a login and never calls updateUserById.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

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
vi.mock('@/lib/emails/send-email', () => ({ sendEmail: vi.fn(async () => 'msg-1') }));
vi.mock('@/lib/staff-practitioner-link', () => ({
  setStaffPractitionerLink: vi.fn(async () => ({ ok: true })),
  setStaffUnifiedCalendarAssignments: vi.fn(async () => ({ ok: true })),
}));

import { getVenueStaff, type VenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { sendEmail } from '@/lib/emails/send-email';
import { columnsMissingFromMigrations } from '@/lib/testing/migration-columns';
import { makeRecordingDb, type Responder } from '@/lib/testing/recording-supabase';
import { POST } from './route';

const VENUE = 'venue-1';
const EMAIL = 'person@example.test';
const EXISTING_USER = 'auth-user-1';
const PASSWORD = 'admin-chosen-1';
const LOOKUP_RPC = 'rpc:lookup_auth_user_id_by_email';

interface World {
  /** What the lookup RPC knows: the existing login's id, nothing, or a failure. */
  lookup: 'existing' | 'none' | 'error';
  /** Whether that login already holds a staff row at another venue (matched by auth id). */
  staffElsewhere?: boolean;
  /** How GoTrue answers createUser. */
  create?: 'ok' | 'email_exists';
  insertFails?: boolean;
}

function world({ lookup, staffElsewhere = false, create = 'ok', insertFails = false }: World) {
  const responder: Responder = (call) => {
    if (call.table === LOOKUP_RPC) {
      if (lookup === 'error') return { error: { code: '57014', message: 'canceling statement due to statement timeout' } };
      return { data: lookup === 'existing' ? EXISTING_USER : null };
    }
    if (call.table !== 'staff') return undefined;
    if (call.op === 'insert') {
      if (insertFails) return { error: { code: '23505', message: 'duplicate key value' } };
      return { data: { id: 'staff-new', email: EMAIL, name: null, role: 'staff', created_at: '2026-09-14T00:00:00Z' } };
    }
    const excludesThisVenue = call.filters.some((f) => f[0] === 'neq' && f[1] === 'venue_id' && f[2] === VENUE);
    if (!excludesThisVenue) return { data: null, count: 0 };
    const byUser = call.filters.some((f) => f[0] === 'eq' && f[1] === 'user_id' && f[2] === EXISTING_USER);
    return { data: null, count: staffElsewhere && byUser ? 1 : 0 };
  };
  const rec = makeRecordingDb(responder);

  // A real project's first listUsers() page: 50 other people, not this address.
  const firstPage = Array.from({ length: 50 }, (_, i) => ({ id: `other-${i}`, email: `other-${i}@example.test` }));
  const auth = {
    admin: {
      listUsers: vi.fn(async () => ({ data: { users: firstPage }, error: null })),
      updateUserById: vi.fn(async () => ({ data: {}, error: null })),
      deleteUser: vi.fn(async () => ({ data: {}, error: null })),
      createUser: vi.fn(async () =>
        create === 'ok'
          ? { data: { user: { id: 'new-user' } }, error: null }
          : {
              data: { user: null },
              error: {
                name: 'AuthApiError',
                status: 422,
                code: 'email_exists',
                message: 'A user with this email address has already been registered',
              },
            },
      ),
    },
  };
  const db = Object.assign(rec.db, { auth }) as unknown as SupabaseClient;
  vi.mocked(getSupabaseAdminClient).mockReturnValue(db);
  const staff: VenueStaff = { id: 'admin-1', venue_id: VENUE, email: 'owner@example.test', role: 'admin', db };
  vi.mocked(getVenueStaff).mockResolvedValue(staff);
  return { rec, auth };
}

function create(email = EMAIL) {
  return POST(
    new NextRequest('http://localhost/api/venue/staff/create', {
      method: 'POST',
      body: JSON.stringify({ email, password: PASSWORD, password_confirm: PASSWORD, role: 'staff' }),
    }),
  );
}

const EXISTING_LOGIN_BODY = {
  error: `${EMAIL} already has a ResNeo login, so we cannot set a password for it. Use Invite instead: they will get a link to join your team and keep their own password.`,
  code: 'STAFF_EMAIL_HAS_LOGIN',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/venue/staff/create', () => {
  it('creates a login with the chosen password for an address nobody uses yet', async () => {
    const { rec, auth } = world({ lookup: 'none' });

    const res = await create('Person@Example.test');

    expect(res.status).toBe(201);
    expect(auth.admin.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: EMAIL, password: PASSWORD, email_confirm: true }),
    );
    expect(auth.admin.updateUserById).not.toHaveBeenCalled();
    const insert = rec.calls.find((c) => c.table === 'staff' && c.op === 'insert');
    expect(insert?.payload).toMatchObject({ venue_id: VENUE, email: EMAIL, user_id: 'new-user' });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(columnsMissingFromMigrations(rec.calls)).toEqual([]);
  });

  it('refuses an existing customer login without touching its password', async () => {
    const { rec, auth } = world({ lookup: 'existing' });

    const res = await create();

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toEqual(EXISTING_LOGIN_BODY);
    expect(body.error).not.toContain(String.fromCharCode(0x2014));
    expect(auth.admin.updateUserById).not.toHaveBeenCalled();
    expect(auth.admin.createUser).not.toHaveBeenCalled();
    expect(rec.queryCount({ table: 'staff', op: 'insert' })).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('keeps the other-venue refusal for a login that already works elsewhere', async () => {
    const { rec, auth } = world({ lookup: 'existing', staffElsewhere: true });

    const res = await create();

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('STAFF_EMAIL_AT_OTHER_VENUE');
    expect(auth.admin.updateUserById).not.toHaveBeenCalled();
    expect(auth.admin.createUser).not.toHaveBeenCalled();
    expect(rec.queryCount({ table: 'staff', op: 'insert' })).toBe(0);
  });

  describe('an existing login beyond the first page of auth users', () => {
    it('is found by the lookup, not by scanning listUsers()', async () => {
      const { auth } = world({ lookup: 'existing' });

      const res = await create();

      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe('STAFF_EMAIL_HAS_LOGIN');
      expect(auth.admin.listUsers).not.toHaveBeenCalled();
      expect(auth.admin.updateUserById).not.toHaveBeenCalled();
    });

    it('is still refused, not a 500, when the lookup misses and createUser reports the duplicate', async () => {
      const { rec, auth } = world({ lookup: 'error', create: 'email_exists' });

      const res = await create();

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual(EXISTING_LOGIN_BODY);
      expect(auth.admin.updateUserById).not.toHaveBeenCalled();
      expect(rec.queryCount({ table: 'staff', op: 'insert' })).toBe(0);
      expect(sendEmail).not.toHaveBeenCalled();
    });
  });

  it('removes the login it just made when the staff row cannot be inserted', async () => {
    const { auth } = world({ lookup: 'none', insertFails: true });

    const res = await create();

    expect(res.status).toBe(500);
    expect(auth.admin.deleteUser).toHaveBeenCalledWith('new-user');
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
