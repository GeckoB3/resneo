import { createHmac } from 'crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { createLinkInviteToken, verifyLinkInviteToken } from './invite-token';

const VENUE = '11111111-2222-3333-4444-555555555555';
const NOW = 1_750_000_000_000; // fixed instant for determinism

beforeAll(() => {
  process.env.LINK_INVITE_SECRET = 'test-invite-secret';
});

describe('link invite tokens', () => {
  it('round-trips the venue id', () => {
    const token = createLinkInviteToken(VENUE, NOW);
    const result = verifyLinkInviteToken(token, NOW);
    expect(result).toEqual({ ok: true, venueId: VENUE, exp: expect.any(Number) });
  });

  it('expires after 30 days', () => {
    const token = createLinkInviteToken(VENUE, NOW);
    const justBefore = verifyLinkInviteToken(token, NOW + 30 * 24 * 60 * 60 * 1000 - 1000);
    expect(justBefore.ok).toBe(true);
    const after = verifyLinkInviteToken(token, NOW + 30 * 24 * 60 * 60 * 1000 + 1000);
    expect(after).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a tampered signature', () => {
    const token = createLinkInviteToken(VENUE, NOW);
    const [body] = token.split('.');
    expect(verifyLinkInviteToken(`${body}.deadbeefdeadbeef`, NOW)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('rejects a tampered body', () => {
    const token = createLinkInviteToken(VENUE, NOW);
    const sig = token.split('.')[1];
    const otherBody = Buffer.from(
      `${'00000000000000000000000000000000'}`,
      'hex',
    );
    const forged = `${Buffer.concat([otherBody, Buffer.alloc(4)]).toString('base64url')}.${sig}`;
    expect(verifyLinkInviteToken(forged, NOW).ok).toBe(false);
  });

  it('rejects malformed input', () => {
    expect(verifyLinkInviteToken('', NOW)).toEqual({ ok: false, reason: 'invalid' });
    expect(verifyLinkInviteToken('nodot', NOW)).toEqual({ ok: false, reason: 'invalid' });
    expect(verifyLinkInviteToken('a.b.c', NOW)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('does not validate a token signed for a different domain/secret', () => {
    // A token whose signature was produced over the raw body without the domain
    // separator must not validate, guarding against cross-feature token reuse.
    const token = createLinkInviteToken(VENUE, NOW);
    const body = token.split('.')[0];
    const wrongSig = createHmac('sha256', 'test-invite-secret')
      .update(Buffer.from(body, 'base64url'))
      .digest('base64url')
      .slice(0, 16);
    expect(verifyLinkInviteToken(`${body}.${wrongSig}`, NOW).ok).toBe(false);
  });
});
