import { describe, expect, it } from 'vitest';
import {
  buildMagicLinkConfirmNextQuery,
  isSignupResumePath,
  resolveAuthNextPath,
  sanitizeAuthNextPath,
  safeSameOriginPath,
  sanitizeMagicLinkNextPath,
} from './safe-auth-redirect';

describe('sanitizeAuthNextPath', () => {
  it('allows internal paths', () => {
    expect(sanitizeAuthNextPath('/dashboard')).toBe('/dashboard');
    expect(sanitizeAuthNextPath('/auth/set-password')).toBe('/auth/set-password');
  });

  it('rejects open redirects', () => {
    expect(sanitizeAuthNextPath('//evil.com')).toBe('/dashboard');
    expect(sanitizeAuthNextPath('https://evil.com')).toBe('/dashboard');
    expect(sanitizeAuthNextPath(null)).toBe('/dashboard');
  });
});

describe('sanitizeMagicLinkNextPath', () => {
  it('allows callback and dashboard targets', () => {
    expect(sanitizeMagicLinkNextPath('/auth/callback')).toBe('/auth/callback');
    expect(sanitizeMagicLinkNextPath('/auth/callback?next=%2Fdashboard')).toBe('/auth/callback?next=%2Fdashboard');
    expect(sanitizeMagicLinkNextPath('/dashboard')).toBe('/dashboard');
    expect(sanitizeMagicLinkNextPath('/dashboard/reports')).toBe('/dashboard/reports');
    expect(sanitizeMagicLinkNextPath('/account')).toBe('/account');
    expect(sanitizeMagicLinkNextPath('/account/bookings')).toBe('/account/bookings');
    expect(sanitizeMagicLinkNextPath('/signup/payment')).toBe('/signup/payment');
    expect(sanitizeMagicLinkNextPath('/book/my-venue')).toBe('/book/my-venue');
    expect(sanitizeMagicLinkNextPath('/book/my-venue?tab=classes')).toBe('/book/my-venue?tab=classes');
    expect(sanitizeMagicLinkNextPath('/embed/my-venue')).toBe('/embed/my-venue');
  });

  it('rejects non-allowlisted paths', () => {
    expect(sanitizeMagicLinkNextPath('/api/venue/export')).toBe('/auth/callback');
    expect(sanitizeMagicLinkNextPath('/help')).toBe('/auth/callback');
    expect(sanitizeMagicLinkNextPath('//evil.com')).toBe('/auth/callback');
  });
});

describe('resolveAuthNextPath', () => {
  it('unwraps callback next query for booking pages', () => {
    expect(resolveAuthNextPath('/auth/callback?next=%2Fbook%2Fmy-venue')).toBe('/book/my-venue');
    expect(resolveAuthNextPath('/book/my-venue?tab=classes')).toBe('/book/my-venue?tab=classes');
  });
});

describe('isSignupResumePath', () => {
  it('matches the resumable signup funnel steps', () => {
    expect(isSignupResumePath('/signup/payment')).toBe(true);
    expect(isSignupResumePath('/signup/booking-models')).toBe(true);
    expect(isSignupResumePath('/signup/business-type')).toBe(true);
    expect(isSignupResumePath('/signup/plan')).toBe(true);
    expect(isSignupResumePath('/signup/payment?x=1')).toBe(true);
  });
  it('rejects non-resume paths', () => {
    expect(isSignupResumePath('/signup')).toBe(false);
    expect(isSignupResumePath('/dashboard')).toBe(false);
    expect(isSignupResumePath('/signup/success')).toBe(false);
  });
});

describe('buildMagicLinkConfirmNextQuery', () => {
  it('wraps booking paths for confirm emails', () => {
    expect(buildMagicLinkConfirmNextQuery('/book/my-venue')).toBe(
      '/auth/callback?next=%2Fbook%2Fmy-venue',
    );
  });
});

describe('open-redirect hardening', () => {
  // Each of these passed the previous guard, which checked startsWith('/') and
  // rejected only a literal '//'. The WHATWG URL parser then resolved them as
  // protocol-relative, so NextResponse.redirect sent the user off-origin from a
  // ResNeo URL. Built from char codes so shell or editor escaping cannot quietly
  // turn the payload back into something harmless.
  const BACKSLASH = '/' + String.fromCharCode(92) + 'evil.com';
  const TAB_SPLIT = '/' + String.fromCharCode(9) + '/evil.com';
  const LF_SPLIT = '/' + String.fromCharCode(10) + '/evil.com';
  const CR_SPLIT = '/' + String.fromCharCode(13) + '/evil.com';

  it.each([
    ['backslash', () => BACKSLASH],
    ['tab', () => TAB_SPLIT],
    ['newline', () => LF_SPLIT],
    ['carriage return', () => CR_SPLIT],
    ['double slash', () => '//evil.com'],
    ['absolute url', () => 'https://evil.com'],
    ['javascript scheme', () => 'javascript:alert(1)'],
  ])('sanitizeAuthNextPath rejects %s', (_label, make) => {
    expect(sanitizeAuthNextPath(make())).toBe('/dashboard');
  });

  it('sanitizeMagicLinkNextPath rejects the backslash bypass', () => {
    expect(sanitizeMagicLinkNextPath(BACKSLASH)).toBe('/auth/callback');
  });

  it('buildMagicLinkConfirmNextQuery rejects the backslash bypass', () => {
    expect(buildMagicLinkConfirmNextQuery(BACKSLASH)).toBe('/auth/callback');
  });

  it('resolveAuthNextPath rejects a bypass smuggled through the inner next param', () => {
    const nested = '/auth/callback?next=' + encodeURIComponent(BACKSLASH);
    expect(resolveAuthNextPath(nested)).toBe('/dashboard');
  });

  it.each([
    '/dashboard',
    '/account/bookings',
    '/book/my-venue-name',
    '/signup/payment',
    '/dashboard?tab=today#section',
  ])('preserves the legitimate path %s unchanged', (path) => {
    expect(sanitizeAuthNextPath(path)).toBe(path);
  });

  it('normalises path traversal rather than passing it through', () => {
    expect(sanitizeAuthNextPath('/dashboard/../super')).toBe('/super');
  });
});

describe('safeSameOriginPath', () => {
  it('falls back for an off-origin candidate', () => {
    expect(safeSameOriginPath('https://evil.com', '/dashboard')).toBe('/dashboard');
    expect(safeSameOriginPath('/' + String.fromCharCode(92) + 'evil.com', '/dashboard')).toBe('/dashboard');
  });

  it('falls back for null or empty input', () => {
    expect(safeSameOriginPath(null, '/login')).toBe('/login');
    expect(safeSameOriginPath('', '/login')).toBe('/login');
  });

  it('returns a same-origin path untouched', () => {
    expect(safeSameOriginPath('/account/bookings', '/dashboard')).toBe('/account/bookings');
  });
});
