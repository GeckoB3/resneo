import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createBroadcastOneClickUnsubscribeUrl,
  createBroadcastUnsubscribePageUrl,
  verifyBroadcastUnsubscribeSignature,
} from './broadcast-unsubscribe';

const ID = '3f2b8c1e-7a4d-4e21-9b6a-0c5d8e7f1a2b';

describe('broadcast unsubscribe links', () => {
  const saved = { secret: process.env.PAYMENT_TOKEN_SECRET, base: process.env.NEXT_PUBLIC_BASE_URL };

  beforeEach(() => {
    process.env.PAYMENT_TOKEN_SECRET = 'test-secret-for-broadcasts';
    process.env.NEXT_PUBLIC_BASE_URL = 'https://www.resneo.com';
  });

  afterEach(() => {
    if (saved.secret === undefined) delete process.env.PAYMENT_TOKEN_SECRET;
    else process.env.PAYMENT_TOKEN_SECRET = saved.secret;
    if (saved.base === undefined) delete process.env.NEXT_PUBLIC_BASE_URL;
    else process.env.NEXT_PUBLIC_BASE_URL = saved.base;
  });

  it('carries the recipient id, never an address, and verifies', () => {
    const url = new URL(createBroadcastUnsubscribePageUrl(ID));
    expect(url.pathname).toBe('/updates/unsubscribe');
    expect(url.searchParams.get('r')).toBe(ID);
    expect(url.search).not.toContain('%40');
    expect(verifyBroadcastUnsubscribeSignature(ID, url.searchParams.get('sig') ?? '')).toBe(true);
  });

  it('signs the one-click endpoint the same way', () => {
    const url = new URL(createBroadcastOneClickUnsubscribeUrl(ID));
    expect(url.pathname).toBe('/api/updates/unsubscribe');
    expect(verifyBroadcastUnsubscribeSignature(ID, url.searchParams.get('sig') ?? '')).toBe(true);
  });

  it('rejects a signature for another recipient, a tampered one, or a non-uuid id', () => {
    const sig = new URL(createBroadcastUnsubscribePageUrl(ID)).searchParams.get('sig') ?? '';
    expect(verifyBroadcastUnsubscribeSignature('3f2b8c1e-7a4d-4e21-9b6a-0c5d8e7f1a2c', sig)).toBe(false);
    expect(verifyBroadcastUnsubscribeSignature(ID, `${sig.slice(0, -1)}x`)).toBe(false);
    expect(verifyBroadcastUnsubscribeSignature('guest-123', sig)).toBe(false);
  });

  it('fails closed without a secret', () => {
    const sig = new URL(createBroadcastUnsubscribePageUrl(ID)).searchParams.get('sig') ?? '';
    delete process.env.PAYMENT_TOKEN_SECRET;
    expect(verifyBroadcastUnsubscribeSignature(ID, sig)).toBe(false);
  });
});
