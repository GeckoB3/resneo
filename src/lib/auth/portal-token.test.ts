/**
 * P3-4a acceptance (AD7).
 *
 * Three properties are named in the plan and each is a security property
 * rather than a nicety:
 *
 *   1. a token verified 20 times in a row still works,
 *   2. verifying issues no writes,
 *   3. an expired or revoked token fails closed.
 *
 * (1) and (2) are the same requirement seen from two sides, and it is the one
 * most likely to be "optimised" away by someone who reasonably assumes an
 * entry token should be single-use. It must not be: corporate link scanners
 * fetch every URL in inbound mail, so a single-use token is consumed before
 * the customer clicks and they are handed a dead link by their own IT
 * department.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { makeRecordingDb, PG_ERRORS, type RecordedCall } from '@/lib/testing/recording-supabase';
import { hashConfirmToken } from '@/lib/confirm-token';
import {
  issuePortalToken,
  revokePortalTokensForBooking,
  verifyPortalToken,
  PORTAL_TOKEN_TTL_HOURS,
} from './portal-token';

const NOW = new Date('2026-09-01T12:00:00.000Z');
const USER = '11111111-1111-4111-8111-111111111111';
const BOOKING = '22222222-2222-4222-8222-222222222222';
const EMAIL = 'guest@example.test';

/** The row the table returns for `token`, unless a test says otherwise. */
function storedRow(token: string, overrides: Record<string, unknown> = {}) {
  return {
    token_hash: hashConfirmToken(token),
    email: EMAIL,
    user_id: USER,
    expires_at: '2026-09-30T12:00:00.000Z',
    revoked_at: null,
    ...overrides,
  };
}

let db: ReturnType<typeof makeRecordingDb>;
function setup(row: Record<string, unknown> | null) {
  db = makeRecordingDb((call: RecordedCall) => {
    if (call.table === 'account_portal_tokens' && call.op === 'select') return { data: row };
    return undefined;
  });
  return db.db;
}

/** Everything that is not a read of the token table. */
function writes() {
  return db.calls.filter((c) => c.op !== 'select');
}

beforeEach(() => {
  db = makeRecordingDb();
});

describe('issuePortalToken', () => {
  it('returns the plaintext and stores only its hash', async () => {
    // A dump of the table must grant nothing. The plaintext exists in the
    // return value and in the email; nowhere else.
    const admin = setup(null);
    const token = await issuePortalToken(admin, { email: EMAIL, userId: USER, bookingId: BOOKING, now: NOW });
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const insert = db.calls.find((c) => c.op === 'insert');
    const payload = insert?.payload as Record<string, unknown>;
    expect(payload.token_hash).toBe(hashConfirmToken(token!));
    expect(JSON.stringify(payload)).not.toContain(token);
  });

  it('sets a window measured in HOURS, matching a magic link', async () => {
    /*
      P3-4c cut this from 30 days. The token now establishes a FULL session, so
      the window is the whole of what bounds it, and a booking confirmation is
      forwarded and kept in a way a requested sign-in link is not. Asserted as
      a literal 24 as well as against the constant, so raising the constant
      fails here rather than passing by tautology.
    */
    const admin = setup(null);
    await issuePortalToken(admin, { email: EMAIL, userId: USER, now: NOW });
    const payload = db.calls.find((c) => c.op === 'insert')?.payload as Record<string, string>;
    const hours = (Date.parse(payload.expires_at) - NOW.getTime()) / 3_600_000;
    expect(hours).toBe(PORTAL_TOKEN_TTL_HOURS);
    expect(hours).toBe(24);
  });

  it('records the booking it was issued for, so it can be revoked later', async () => {
    const admin = setup(null);
    await issuePortalToken(admin, { email: EMAIL, userId: USER, bookingId: BOOKING, now: NOW });
    const payload = db.calls.find((c) => c.op === 'insert')?.payload as Record<string, unknown>;
    expect(payload.issued_for_booking_id).toBe(BOOKING);
    expect(payload.scope).toBe('limited');
  });

  it('allows a token with no booking, which the column is nullable for', async () => {
    const admin = setup(null);
    await issuePortalToken(admin, { email: EMAIL, userId: USER, now: NOW });
    const payload = db.calls.find((c) => c.op === 'insert')?.payload as Record<string, unknown>;
    expect(payload.issued_for_booking_id).toBeNull();
  });

  it('returns null rather than throwing when the insert fails', async () => {
    // The callers are comms paths. An email that goes out carrying the
    // ordinary sign-in link is a far better outcome than one that does not go
    // out because a token could not be minted.
    const admin = setup(null);
    db.inject((c) => c.op === 'insert', PG_ERRORS.uniqueViolation);
    await expect(issuePortalToken(admin, { email: EMAIL, userId: USER, now: NOW })).resolves.toBeNull();
  });
});

describe('verifyPortalToken', () => {
  it('accepts a live token and names its user', async () => {
    const token = 'tok-live';
    const result = await verifyPortalToken(setup(storedRow(token)), token, NOW);
    expect(result).toEqual({ ok: true, email: EMAIL, userId: USER, reason: 'valid' });
  });

  it('STILL WORKS ON THE TWENTIETH CALL, and writes nothing on any of them', async () => {
    /*
      The stated acceptance, and the property a link scanner would otherwise
      destroy. Both halves in one row on purpose: an implementation that
      consumed the token would fail the first assertion, and one that merely
      counted uses would pass it while still failing the second.
    */
    const token = 'tok-reused';
    const admin = setup(storedRow(token));
    for (let i = 0; i < 20; i += 1) {
      const result = await verifyPortalToken(admin, token, NOW);
      expect(result.ok, `refused on attempt ${i + 1}`).toBe(true);
    }
    expect(writes(), 'verification wrote to the database').toEqual([]);
  });

  it('looks the token up by its HASH, never by the token itself', async () => {
    const token = 'tok-hash';
    const admin = setup(storedRow(token));
    await verifyPortalToken(admin, token, NOW);
    const read = db.calls.find((c) => c.table === 'account_portal_tokens');
    const filters = JSON.stringify(read?.filters ?? []);
    expect(filters).toContain(hashConfirmToken(token));
    expect(filters).not.toContain(token);
  });

  it('refuses an expired token', async () => {
    const token = 'tok-old';
    const row = storedRow(token, { expires_at: '2026-08-01T12:00:00.000Z' });
    const result = await verifyPortalToken(setup(row), token, NOW);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('expired');
    expect(result.userId).toBeNull();
  });

  it('treats the expiry instant itself as expired', async () => {
    // A boundary worth pinning either way; closed is the safe side.
    const token = 'tok-edge';
    const row = storedRow(token, { expires_at: NOW.toISOString() });
    expect((await verifyPortalToken(setup(row), token, NOW)).ok).toBe(false);
  });

  it('refuses a revoked token even while it is still inside its window', async () => {
    const token = 'tok-dead';
    const row = storedRow(token, { revoked_at: '2026-09-01T09:00:00.000Z' });
    const result = await verifyPortalToken(setup(row), token, NOW);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('revoked');
  });

  it('refuses a token that is not in the table', async () => {
    const result = await verifyPortalToken(setup(null), 'never-issued', NOW);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unknown');
  });

  it('refuses a row whose stored hash does not match, however it was found', async () => {
    /*
      Defence against the lookup, not against the caller. The `.eq` finds the
      row; this decides whether to accept it. If that query ever became fuzzy,
      through a rewrite or a case-insensitive collation, a near-miss would
      otherwise be accepted.
    */
    const row = storedRow('a-different-token');
    const result = await verifyPortalToken(setup(row), 'tok-mismatch', NOW);
    expect(result.ok).toBe(false);
  });

  it('refuses an absent or empty token without reaching the database', async () => {
    const admin = setup(storedRow('anything'));
    for (const bad of [null, undefined, '', '   ']) {
      expect((await verifyPortalToken(admin, bad, NOW)).ok).toBe(false);
    }
    expect(db.calls, 'an empty token still hit the database').toEqual([]);
  });

  it('FAILS CLOSED when the table cannot be read', async () => {
    // A database blip must not become an open door. It is also the state
    // during an incident, which is exactly when it matters.
    const token = 'tok-err';
    const admin = setup(storedRow(token));
    db.inject((c) => c.table === 'account_portal_tokens', { message: 'connection reset' });
    const result = await verifyPortalToken(admin, token, NOW);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('error');
  });

  it('refuses a row whose expiry is not a date', async () => {
    const token = 'tok-nan';
    const row = storedRow(token, { expires_at: 'not a date' });
    expect((await verifyPortalToken(setup(row), token, NOW)).ok).toBe(false);
  });
});

describe('revokePortalTokensForBooking', () => {
  it('stamps every live token for the booking', async () => {
    const admin = setup(null);
    await revokePortalTokensForBooking(admin, BOOKING, NOW);
    const update = db.calls.find((c) => c.op === 'update');
    expect((update?.payload as Record<string, string>).revoked_at).toBe(NOW.toISOString());
    expect(JSON.stringify(update?.filters)).toContain(BOOKING);
  });

  it('leaves already-revoked rows alone, so the timestamp stays true', async () => {
    // Re-stamping would rewrite when revocation actually happened, which is
    // the one thing the column is for.
    const admin = setup(null);
    await revokePortalTokensForBooking(admin, BOOKING, NOW);
    const update = db.calls.find((c) => c.op === 'update');
    expect(update?.filters).toContainEqual(['is', 'revoked_at', null]);
  });

  it('marks rather than deletes, so a support question stays answerable', async () => {
    const admin = setup(null);
    await revokePortalTokensForBooking(admin, BOOKING, NOW);
    expect(db.calls.some((c) => c.op === 'delete')).toBe(false);
  });

  it('reports 0 rather than throwing when the update fails', async () => {
    const admin = setup(null);
    db.inject((c) => c.op === 'update', { message: 'nope' });
    await expect(revokePortalTokensForBooking(admin, BOOKING, NOW)).resolves.toBe(0);
  });
});
