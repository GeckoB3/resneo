/**
 * ensureAuthUserWithStaffMetadata (reached through deliverStaffAccessLinkEmail with SendGrid
 * configured) used to scan listUsers({ perPage: 1000 }) for the invited address. Past the
 * first 1000 logins an existing customer was missed, createUser reported the duplicate and
 * Invite failed with a 409. It now finds the login through lookup_auth_user_id_by_email.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/emails/send-email', () => ({ sendEmail: vi.fn(async () => 'msg-1') }));

import { sendEmail } from '@/lib/emails/send-email';
import { makeRecordingDb, type Responder } from '@/lib/testing/recording-supabase';
import { deliverStaffAccessLinkEmail } from './staff-invite-email';

const EMAIL = 'customer@example.test';
const EXISTING = 'customer-login-1';
const LOOKUP_RPC = 'rpc:lookup_auth_user_id_by_email';

function world({ lookup, create = 'ok' }: { lookup: 'existing' | 'none'; create?: 'ok' | 'email_exists' }) {
  const responder: Responder = (call) =>
    call.table === LOOKUP_RPC ? { data: lookup === 'existing' ? EXISTING : null } : undefined;
  const rec = makeRecordingDb(responder);

  // A project with more than 1000 logins: the invited customer is not on the first page.
  const firstThousand = Array.from({ length: 1000 }, (_, i) => ({ id: `other-${i}`, email: `other-${i}@example.test` }));
  const auth = {
    admin: {
      listUsers: vi.fn(async () => ({ data: { users: firstThousand }, error: null })),
      getUserById: vi.fn(async (id: string) => ({
        data: { user: { id, email: EMAIL, user_metadata: { full_name: 'Casey', has_set_password: true } } },
        error: null,
      })),
      updateUserById: vi.fn(async () => ({ data: {}, error: null })),
      createUser: vi.fn(async () =>
        create === 'ok'
          ? { data: { user: { id: 'new-login' } }, error: null }
          : {
              data: { user: null },
              error: { status: 422, code: 'email_exists', message: 'A user with this email address has already been registered' },
            },
      ),
      deleteUser: vi.fn(async () => ({ data: {}, error: null })),
      generateLink: vi.fn(async () => ({ data: { properties: { hashed_token: 'hashed' } }, error: null })),
      inviteUserByEmail: vi.fn(async () => ({ data: {}, error: null })),
    },
  };
  const admin = Object.assign(rec.db, { auth }) as unknown as SupabaseClient;
  return { rec, auth, admin };
}

function deliver(admin: SupabaseClient) {
  return deliverStaffAccessLinkEmail({
    admin,
    email: 'Customer@Example.test',
    baseUrl: 'http://localhost',
    userMetadata: { venue_id: 'venue-1', has_set_password: false },
    venueName: 'Studio',
  });
}

const originalKey = process.env.SENDGRID_API_KEY;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SENDGRID_API_KEY = 'test-key';
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.SENDGRID_API_KEY;
  else process.env.SENDGRID_API_KEY = originalKey;
});

describe('deliverStaffAccessLinkEmail with SendGrid configured', () => {
  it('finds an existing login beyond the first 1000 through the lookup and emails the link', async () => {
    const { auth, admin } = world({ lookup: 'existing' });

    const result = await deliver(admin);

    expect(result).toEqual({ ok: true, channel: 'sendgrid' });
    expect(auth.admin.listUsers).not.toHaveBeenCalled();
    expect(auth.admin.createUser).not.toHaveBeenCalled();
    expect(auth.admin.updateUserById).toHaveBeenCalledWith(EXISTING, {
      user_metadata: { full_name: 'Casey', venue_id: 'venue-1', has_set_password: true },
    });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('never sets a password on an existing login', async () => {
    const { auth, admin } = world({ lookup: 'existing' });

    await deliver(admin);

    for (const [, attrs] of auth.admin.updateUserById.mock.calls as unknown as Array<[string, Record<string, unknown>]>) {
      expect(attrs).not.toHaveProperty('password');
    }
  });

  it('creates a login for an address nobody uses yet', async () => {
    const { auth, admin } = world({ lookup: 'none' });

    const result = await deliver(admin);

    expect(result).toEqual({ ok: true, channel: 'sendgrid' });
    expect(auth.admin.createUser).toHaveBeenCalledWith(expect.objectContaining({ email: EMAIL }));
    expect(auth.admin.updateUserById).not.toHaveBeenCalled();
  });

  it('looks again when the first lookup fails and createUser reports the duplicate', async () => {
    const { rec, auth, admin } = world({ lookup: 'existing', create: 'email_exists' });
    rec.inject((call) => call.table === LOOKUP_RPC, { code: '57014', message: 'statement timeout' });

    const result = await deliver(admin);

    expect(result).toEqual({ ok: true, channel: 'sendgrid' });
    expect(rec.queryCount({ table: LOOKUP_RPC })).toBe(2);
    expect(auth.admin.updateUserById).toHaveBeenCalledWith(EXISTING, expect.anything());
    expect(auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it('refuses with a 409 only when the address is registered and still cannot be found', async () => {
    const { auth, admin } = world({ lookup: 'none', create: 'email_exists' });

    const result = await deliver(admin);

    expect(result).toEqual({ ok: false, error: 'This email is already registered. Try resending the invite.', status: 409 });
    expect(auth.admin.updateUserById).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
