import { describe, expect, it } from 'vitest';
import {
  buildMagicLinkConfirmNextQuery,
  resolveAuthNextPath,
  sanitizeAuthNextPath,
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

describe('buildMagicLinkConfirmNextQuery', () => {
  it('wraps booking paths for confirm emails', () => {
    expect(buildMagicLinkConfirmNextQuery('/book/my-venue')).toBe(
      '/auth/callback?next=%2Fbook%2Fmy-venue',
    );
  });
});
