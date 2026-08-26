import { describe, it, expect } from 'vitest';

import {
  buildAppCallbackUrl,
  isAppDeepLink,
  renderAppHandoffPage,
} from '@/lib/auth/app-deep-link';

describe('isAppDeepLink', () => {
  it('accepts only the app scheme', () => {
    expect(isAppDeepLink('resneo://callback')).toBe(true);
    for (const other of [
      'https://www.resneo.com/auth/confirm',
      'javascript:alert(1)',
      // Must not match on substring: a lookalike scheme is not the app.
      'notresneo://callback',
      'http://resneo://callback',
      '',
      null,
      undefined,
    ]) {
      expect(isAppDeepLink(other)).toBe(false);
    }
  });
});

describe('buildAppCallbackUrl', () => {
  it('builds the shape the app callback screen verifies', () => {
    expect(buildAppCallbackUrl('abc123', 'magiclink')).toBe(
      'resneo://callback?token_hash=abc123&type=magiclink',
    );
  });

  it('refuses an unknown otp type rather than emitting a link the app cannot use', () => {
    expect(buildAppCallbackUrl('abc123', 'nonsense')).toBeNull();
    expect(buildAppCallbackUrl('', 'magiclink')).toBeNull();
  });

  it('rejects a token that is not the shape GoTrue issues', () => {
    // These can only come from a crafted URL, never from an email we sent. Refusing them
    // here is what keeps the hand-off page free of anything needing to be escaped.
    for (const hostile of [
      'a&b=c',
      '</script><script>alert(1)</script>',
      '"><img src=x onerror=alert(1)>',
      'a'.repeat(256),
    ]) {
      expect(buildAppCallbackUrl(hostile, 'magiclink')).toBeNull();
    }
  });

  it('accepts the real hex shape', () => {
    const real = 'a6ca1a361d4e405a6a14b7a9dad498f66100739f7da141904cd85e8f';
    expect(buildAppCallbackUrl(real, 'magiclink')).toBe(
      `resneo://callback?token_hash=${real}&type=magiclink`,
    );
  });
});

describe('renderAppHandoffPage', () => {
  it('escapes the link in the href and the inline script', () => {
    // token_hash is attacker-influencable via the URL, so neither context may break out.
    const hostile = 'resneo://callback?token_hash="><script>alert(1)</script>&type=magiclink';
    const html = renderAppHandoffPage(hostile, 'https://example.test/login');
    expect(html).not.toContain('"><script>alert(1)');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
  });

  it('offers a web route out for a reader whose device cannot open the app', () => {
    const html = renderAppHandoffPage('resneo://callback?token_hash=x&type=magiclink', 'https://example.test/login');
    expect(html).toContain('https://example.test/login');
    expect(html).toContain('Open the ResNeo app');
  });

  it('keeps the token out of any other origin', () => {
    const html = renderAppHandoffPage('resneo://callback?token_hash=x&type=magiclink', 'https://example.test/login');
    expect(html).toContain('name="referrer" content="no-referrer"');
  });
});
