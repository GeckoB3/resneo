/**
 * P3-4d: which customers get a one-click sign-in link in their booking email.
 *
 * This function is the whole of what bounds the escalation the plan accepted.
 * Inside its window the link is a sign-in link, so the question "who gets one"
 * is the security question, and the failure that matters is issuing to somebody
 * who should have had today's link instead.
 *
 * Its other property is that it can only ever make things NO WORSE: every
 * doubt, every error, every missing piece returns the ordinary magic-link URL
 * that ships today.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRecordingDb, type RecordedCall } from '@/lib/testing/recording-supabase';
import { resolveAccountEntryLink } from './account-entry-link';

const hoisted = vi.hoisted(() => ({
  /** Tokens the function asked to have minted. */
  issued: [] as Array<Record<string, unknown>>,
  /** What `issuePortalToken` hands back; null is a mint failure. */
  token: 'tok-abc' as string | null,
}));

vi.mock('@/lib/auth/portal-token', () => ({
  issuePortalToken: async (_admin: unknown, params: Record<string, unknown>) => {
    hoisted.issued.push(params);
    return hoisted.token;
  },
}));

const BASE = 'https://book.resneo.test';
const NEW_CUSTOMER = 'new@example.test';

let db: ReturnType<typeof makeRecordingDb>;

/** @param claimed guest rows with a `user_id`, i.e. the address has an account */
function setup(claimed: boolean, opts: { readFails?: boolean } = {}) {
  db = makeRecordingDb((call: RecordedCall) => {
    if (call.table === 'guests') {
      if (opts.readFails) return { data: null, error: { message: 'connection reset' } };
      return { data: claimed ? [{ user_id: 'user-1' }] : [] };
    }
    return undefined;
  });
  return db.db;
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_BASE_URL = BASE;
  hoisted.issued = [];
  hoisted.token = 'tok-abc';
});

describe('a customer who has never been in the portal', () => {
  it('gets a one-click sign-in link', async () => {
    const url = await resolveAccountEntryLink(setup(false), { email: NEW_CUSTOMER });
    expect(url).toContain('/auth/portal');
    expect(new URL(url!).searchParams.get('t')).toBe('tok-abc');
  });

  it('lands on the booking when the email is about one', async () => {
    const url = await resolveAccountEntryLink(setup(false), {
      email: NEW_CUSTOMER,
      bookingId: 'bk-1',
    });
    expect(new URL(url!).searchParams.get('next')).toBe('/account/bookings/bk-1');
  });

  it('lands on the list when the email is not about a particular booking', async () => {
    const url = await resolveAccountEntryLink(setup(false), { email: NEW_CUSTOMER });
    expect(new URL(url!).searchParams.get('next')).toBeNull();
  });

  it('records the booking on the token, so the link can be revoked with it', async () => {
    await resolveAccountEntryLink(setup(false), { email: NEW_CUSTOMER, bookingId: 'bk-1' });
    expect(hoisted.issued[0]).toMatchObject({ email: NEW_CUSTOMER, bookingId: 'bk-1' });
  });

  it('normalises the address, so case cannot produce a second token', async () => {
    const url = await resolveAccountEntryLink(setup(false), { email: '  NEW@Example.TEST ' });
    expect(hoisted.issued[0]).toMatchObject({ email: NEW_CUSTOMER });
    expect(new URL(url!).searchParams.get('email')).toBe(NEW_CUSTOMER);
  });
});

describe('a customer who already has an account', () => {
  it('gets today’s link, not a session', async () => {
    /*
      The lever. An `auth.users` row exists precisely when somebody has signed
      in at least once, because nothing in the public booking flow creates one.
      So "has an account" is "has been in the portal", and §5.3's rule that this
      is for the very first booking and not for later ones falls out of it.
    */
    const url = await resolveAccountEntryLink(setup(true), { email: 'returning@example.test' });
    expect(url).toContain('/auth/magic');
    expect(url).not.toContain('/auth/portal');
    expect(hoisted.issued, 'a token was minted for a returning customer').toEqual([]);
  });

  it('asks the question by address, and only about CLAIMED guest rows', async () => {
    // An unclaimed guest row is a customer who has booked and never signed in,
    // which is exactly who this feature is for. Counting it would switch the
    // feature off for everybody.
    await resolveAccountEntryLink(setup(true), { email: 'returning@example.test' });
    const read = db.calls.find((c) => c.table === 'guests');
    const filters = JSON.stringify(read?.filters ?? []);
    expect(filters).toContain('returning@example.test');
    expect(filters).toContain('user_id');
  });
});

describe('it can only ever make things no worse', () => {
  it('falls back when the account lookup fails', async () => {
    // A database blip must not hand out sign-in links, and must not stop the
    // email either.
    const url = await resolveAccountEntryLink(setup(false, { readFails: true }), {
      email: NEW_CUSTOMER,
    });
    expect(url).toContain('/auth/magic');
    expect(hoisted.issued).toEqual([]);
  });

  it('falls back when the token cannot be minted', async () => {
    hoisted.token = null;
    const url = await resolveAccountEntryLink(setup(false), { email: NEW_CUSTOMER });
    expect(url).toContain('/auth/magic');
  });

  it('falls back when there is no address to sign in', async () => {
    for (const email of [null, undefined, '', '   ']) {
      const url = await resolveAccountEntryLink(setup(false), { email });
      expect(url ?? '').not.toContain('/auth/portal');
      expect(hoisted.issued).toEqual([]);
    }
  });

  it('falls back when the site has no base URL configured', async () => {
    delete process.env.NEXT_PUBLIC_BASE_URL;
    const url = await resolveAccountEntryLink(setup(false), { email: NEW_CUSTOMER });
    expect(url ?? '').not.toContain('/auth/portal');
    expect(hoisted.issued, 'a token was minted for a link that cannot be built').toEqual([]);
  });

  it('never returns a link to somewhere other than this site', async () => {
    const url = await resolveAccountEntryLink(setup(false), { email: NEW_CUSTOMER });
    expect(new URL(url!).origin).toBe(BASE);
  });
});
