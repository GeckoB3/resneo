import { describe, expect, it } from 'vitest';
import { createHmac } from 'crypto';
import {
  BOOKING_HMAC_TTL_SEC,
  createBookingHmac,
  createShortManageLink,
  resolveShortManageBookingId,
  verifyBookingHmac,
} from '@/lib/short-manage-link';

describe('short manage links', () => {
  it('creates compact v3 token that resolves back to booking id', () => {
    const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const url = createShortManageLink(id);
    const segment = new URL(url).pathname.split('/').pop()!;
    expect(segment.startsWith('v3.')).toBe(true);
    expect(url.length).toBeLessThanOrEqual(75);
    expect(resolveShortManageBookingId(segment)).toBe(id);
  });

  it('rejects tampered v3 token', () => {
    const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const url = createShortManageLink(id);
    const segment = new URL(url).pathname.split('/').pop()!;
    const lastDot = segment.lastIndexOf('.');
    const sig = segment.slice(lastDot + 1);
    const lastChar = sig.length > 0 ? sig[sig.length - 1]! : '';
    const tamperedSig =
      sig.length > 0 ? sig.slice(0, -1) + (lastChar === 'a' ? 'b' : 'a') : '!';
    const tampered = `${segment.slice(0, lastDot + 1)}${tamperedSig}`;
    expect(resolveShortManageBookingId(tampered)).toBeNull();
  });

  it('still resolves existing v2 manage links', () => {
    const id = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
    const payloadObj = { v: 2 as const, bid: id, exp: Math.floor(Date.now() / 1000) + 3600 };
    const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
    const secret = process.env.PAYMENT_TOKEN_SECRET?.trim() ?? '';
    const sig = createHmac('sha256', secret)
      .update(`manage2:${payload}`)
      .digest('base64url')
      .slice(0, 18);

    expect(resolveShortManageBookingId(`v2.${payload}.${sig}`)).toBe(id);
  });
});

describe('booking HMAC bearer value', () => {
  const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const secret = process.env.PAYMENT_TOKEN_SECRET?.trim() ?? '';

  it('creates an expiring value that verifies', () => {
    const value = createBookingHmac(id);
    expect(value).toContain('.');
    const [expPart] = value.split('.');
    expect(/^\d+$/.test(expPart)).toBe(true);
    // Expiry is in the future and roughly the configured TTL out.
    const exp = Number(expPart);
    const now = Math.floor(Date.now() / 1000);
    expect(exp).toBeGreaterThan(now);
    expect(exp).toBeLessThanOrEqual(now + BOOKING_HMAC_TTL_SEC + 5);
    expect(verifyBookingHmac(id, value)).toBe(true);
  });

  it('rejects a tampered signature', () => {
    const value = createBookingHmac(id);
    const dot = value.indexOf('.');
    const sig = value.slice(dot + 1);
    const lastChar = sig[sig.length - 1];
    const tamperedSig = sig.slice(0, -1) + (lastChar === 'a' ? 'b' : 'a');
    expect(verifyBookingHmac(id, `${value.slice(0, dot + 1)}${tamperedSig}`)).toBe(false);
  });

  it('rejects an expired token', () => {
    const exp = Math.floor(Date.now() / 1000) - 60;
    const sig = createHmac('sha256', secret)
      .update(`manage:${id}:${exp}`)
      .digest('base64url');
    expect(verifyBookingHmac(id, `${exp}.${sig}`)).toBe(false);
  });

  it('rejects a value whose expiry was swapped (not covered by the signature)', () => {
    const value = createBookingHmac(id);
    const sig = value.slice(value.indexOf('.') + 1);
    const farFuture = Math.floor(Date.now() / 1000) + BOOKING_HMAC_TTL_SEC * 10;
    // Re-signing happens over the original exp, so a swapped exp must fail.
    expect(verifyBookingHmac(id, `${farFuture}.${sig}`)).toBe(false);
  });

  it('still verifies a legacy expiry-less signature', () => {
    const legacy = createHmac('sha256', secret).update(`manage:${id}`).digest('base64url');
    expect(legacy).not.toContain('.');
    expect(verifyBookingHmac(id, legacy)).toBe(true);
  });

  it('rejects a legacy signature for a different booking id', () => {
    const legacy = createHmac('sha256', secret)
      .update('manage:bbbbbbbb-cccc-dddd-eeee-ffffffffffff')
      .digest('base64url');
    expect(verifyBookingHmac(id, legacy)).toBe(false);
  });
});
