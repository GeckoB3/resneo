import { afterEach, describe, expect, it } from 'vitest';
import { __resetRateLimitStore, clientIpFromHeaders, rateLimit } from '@/lib/compliance/rate-limit';

afterEach(() => __resetRateLimitStore());

describe('rateLimit', () => {
  it('allows up to the limit then blocks within the window', () => {
    const key = 'k1';
    for (let i = 0; i < 3; i++) {
      expect(rateLimit(key, 3, 60_000).allowed).toBe(true);
    }
    const blocked = rateLimit(key, 3, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('tracks keys independently', () => {
    expect(rateLimit('a', 1, 60_000).allowed).toBe(true);
    expect(rateLimit('a', 1, 60_000).allowed).toBe(false);
    expect(rateLimit('b', 1, 60_000).allowed).toBe(true);
  });

  it('resets after the window elapses', () => {
    expect(rateLimit('w', 1, -1).allowed).toBe(true); // window already in the past
    expect(rateLimit('w', 1, -1).allowed).toBe(true); // bucket reset each call
  });
});

describe('clientIpFromHeaders', () => {
  it('takes the first hop from x-forwarded-for', () => {
    const h = new Headers({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' });
    expect(clientIpFromHeaders(h)).toBe('1.2.3.4');
  });
  it('falls back to x-real-ip then unknown', () => {
    expect(clientIpFromHeaders(new Headers({ 'x-real-ip': '9.9.9.9' }))).toBe('9.9.9.9');
    expect(clientIpFromHeaders(new Headers())).toBe('unknown');
  });
});
