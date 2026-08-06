import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdminClient: vi.fn(),
}));

vi.mock('@/lib/cron-auth', () => ({
  requireCronAuthorisation: vi.fn(() => null),
}));

vi.mock('@/lib/platform/cron-log', () => ({
  withCronRunLogging: (_job: string, handler: unknown) => handler,
}));

import { getSupabaseAdminClient } from '@/lib/supabase';
import { POST } from './route';

const mockAdmin = vi.mocked(getSupabaseAdminClient);

const USER = 'user-1';
const GUEST = 'guest-1';

interface Scenario {
  /** Rows returned by the batch query. */
  queue?: Array<{ id: string; deleted_at: string }>;
  /** `deleted_at` seen by the per-user recheck. null models a cancelled request. */
  recheck?: string | null;
  guests?: Array<{ id: string }>;
  guestUpdateError?: { message: string } | null;
  deleteUserError?: { message: string } | null;
}

/**
 * Stubs the admin client. Captures the guest anonymisation payload so the test can
 * assert exactly which columns are written, which is the point of this suite: the
 * cron previously wrote a dropped column and silently never deleted anyone.
 */
function makeAdmin(s: Scenario) {
  const past = new Date(Date.now() - 86_400_000).toISOString();
  const guestUpdates: Array<Record<string, unknown>> = [];
  const deleteUser = vi.fn(async () => ({ error: s.deleteUserError ?? null }));

  const from = (table: string) => {
    if (table === 'user_profiles') {
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      Object.assign(builder, {
        // The batch query chains select -> not -> lte -> limit; the per-user
        // recheck chains select -> eq -> maybeSingle. Only the terminals resolve.
        select: chain,
        not: chain,
        lte: chain,
        eq: chain,
        limit: () =>
          Promise.resolve({
            data: s.queue ?? [{ id: USER, deleted_at: past }],
            error: null,
          }),
        maybeSingle: () =>
          Promise.resolve({
            data: { deleted_at: s.recheck === undefined ? past : s.recheck },
            error: null,
          }),
      });
      return builder;
    }

    if (table === 'guests') {
      const builder: Record<string, unknown> = {};
      Object.assign(builder, {
        select: () => builder,
        update: (payload: Record<string, unknown>) => {
          guestUpdates.push(payload);
          return {
            eq: () => Promise.resolve({ error: s.guestUpdateError ?? null }),
          };
        },
        eq: () => Promise.resolve({ data: s.guests ?? [{ id: GUEST }], error: null }),
      });
      return builder;
    }

    throw new Error(`unexpected table ${table}`);
  };

  return {
    admin: {
      from,
      auth: { admin: { deleteUser } },
    } as unknown as ReturnType<typeof getSupabaseAdminClient>,
    guestUpdates,
    deleteUser,
  };
}

function req(): NextRequest {
  return new NextRequest('https://resneo.test/api/cron/account-hard-delete', { method: 'POST' });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/cron/account-hard-delete', () => {
  it('anonymises the guest and deletes the auth user when the period has elapsed', async () => {
    const { admin, guestUpdates, deleteUser } = makeAdmin({});
    mockAdmin.mockReturnValue(admin);

    const res = await POST(req());
    const body = await res.json();

    expect(body.deleted).toBe(1);
    expect(body.errors).toEqual([]);
    expect(deleteUser).toHaveBeenCalledWith(USER);
    expect(guestUpdates).toHaveLength(1);
  });

  it('does not write the dropped guests.name column', async () => {
    const { admin, guestUpdates } = makeAdmin({});
    mockAdmin.mockReturnValue(admin);

    await POST(req());

    // Writing `name` made every run fail with PGRST204 and skip deleteUser.
    expect('name' in guestUpdates[0]).toBe(false);
    expect(guestUpdates[0]).toMatchObject({ first_name: 'Deleted', last_name: 'User' });
  });

  it('clears contact details and unlinks the account', async () => {
    const { admin, guestUpdates } = makeAdmin({});
    mockAdmin.mockReturnValue(admin);

    await POST(req());

    expect(guestUpdates[0]).toMatchObject({
      phone: null,
      user_id: null,
      marketing_consent: false,
      marketing_opt_out: true,
    });
    expect(guestUpdates[0].email).toBe(`deleted-${USER}-${GUEST}@reserveni.deleted`);
  });

  it('skips a user who cancelled after the batch was loaded, without anonymising', async () => {
    const { admin, guestUpdates, deleteUser } = makeAdmin({ recheck: null });
    mockAdmin.mockReturnValue(admin);

    const res = await POST(req());
    const body = await res.json();

    expect(body.skipped_cancelled).toBe(1);
    expect(body.deleted).toBe(0);
    // Anonymisation is irreversible, so it must not run on a stale read.
    expect(guestUpdates).toHaveLength(0);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('skips a user whose deletion date has been pushed into the future', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const { admin, guestUpdates, deleteUser } = makeAdmin({ recheck: future });
    mockAdmin.mockReturnValue(admin);

    const body = await (await POST(req())).json();

    expect(body.skipped_cancelled).toBe(1);
    expect(guestUpdates).toHaveLength(0);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('does not delete the auth user when guest anonymisation fails', async () => {
    const { admin, deleteUser } = makeAdmin({ guestUpdateError: { message: 'boom' } });
    mockAdmin.mockReturnValue(admin);

    const body = await (await POST(req())).json();

    // Leaving the row queued is correct: the next run retries.
    expect(deleteUser).not.toHaveBeenCalled();
    expect(body.deleted).toBe(0);
    expect(body.errors).toEqual([{ user_id: USER, error: 'boom' }]);
  });

  it('reports a failed deleteUser without counting it as deleted', async () => {
    const { admin } = makeAdmin({ deleteUserError: { message: 'auth down' } });
    mockAdmin.mockReturnValue(admin);

    const body = await (await POST(req())).json();

    expect(body.deleted).toBe(0);
    expect(body.errors).toEqual([{ user_id: USER, error: 'auth down' }]);
  });

  it('deletes a user with no linked guest rows', async () => {
    const { admin, deleteUser } = makeAdmin({ guests: [] });
    mockAdmin.mockReturnValue(admin);

    const body = await (await POST(req())).json();

    expect(deleteUser).toHaveBeenCalledWith(USER);
    expect(body.deleted).toBe(1);
  });

  it('does nothing when the queue is empty', async () => {
    const { admin, deleteUser } = makeAdmin({ queue: [] });
    mockAdmin.mockReturnValue(admin);

    const body = await (await POST(req())).json();

    expect(body).toEqual({ deleted: 0, skipped_cancelled: 0, errors: [] });
    expect(deleteUser).not.toHaveBeenCalled();
  });
});
