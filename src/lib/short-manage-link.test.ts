import { describe, expect, it } from 'vitest';
import { createHmac } from 'crypto';
import { createShortManageLink, resolveShortManageBookingId } from '@/lib/short-manage-link';

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
