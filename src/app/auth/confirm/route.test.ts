/**
 * `/auth/confirm` must be usable as an `emailRedirectTo` target whichever shape the
 * Supabase "Magic Link" template currently produces.
 *
 * The mobile app depends on that template (it calls `signInWithOtp` directly), and the
 * web magic-link fallback shares it. Switching the template to `?token_hash=` for the app
 * must not strand the web fallback on a route that only understands `?code=`, so this route
 * forwards a PKCE code, and any GoTrue error params, to `/auth/callback`.
 *
 * Only the no-token_hash branches are covered here: they return before any Supabase client
 * is constructed, so they need no client stubs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The verify path needs a client that fails cleanly, so tests asserting a link is *not*
 * handed to the app still exercise the fall-through instead of throwing on an undefined stub.
 */
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { verifyOtp: vi.fn(async () => ({ error: { message: 'Token has expired' } })) },
  })),
}));
vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { GET } from './route';

/** Request origin. The redirect origin comes from NEXT_PUBLIC_BASE_URL, not from this. */
const BASE = 'https://example.test';

function get(query: string): Request {
  return new Request(`${BASE}/auth/confirm${query}`);
}

/** The `Location` of the redirect this route returns. */
async function locationOf(query: string): Promise<URL> {
  const res = await GET(get(query));
  const location = res.headers.get('location');
  expect(location, 'route did not redirect').toBeTruthy();
  return new URL(location as string);
}

describe('GET /auth/confirm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards a PKCE code to /auth/callback, preserving it and next', async () => {
    const url = await locationOf('?code=abc123&next=%2Fdashboard');
    expect(url.pathname).toBe('/auth/callback');
    expect(url.searchParams.get('code')).toBe('abc123');
    expect(url.searchParams.get('next')).toBe('/dashboard');
  });

  it('forwards GoTrue error params so /auth/callback can render expired-link copy', async () => {
    const url = await locationOf(
      '?error=access_denied&error_description=Email+link+is+invalid+or+has+expired',
    );
    expect(url.pathname).toBe('/auth/callback');
    expect(url.searchParams.get('error')).toBe('access_denied');
    expect(url.searchParams.get('error_description')).toBe(
      'Email link is invalid or has expired',
    );
  });

  it('sanitises next rather than forwarding an attacker-supplied absolute URL', async () => {
    const url = await locationOf('?code=abc123&next=https%3A%2F%2Fevil.test%2Fsteal');
    // The redirect is anchored to the configured base URL, never to anything in the link.
    expect(url.origin).not.toBe('https://evil.test');
    expect(url.searchParams.get('next') ?? '').not.toContain('evil.test');
  });

  it('preserves the set-password next used by the password-reset flow', async () => {
    // `login-form.tsx` sends resetPasswordForEmail here with next=/auth/set-password.
    // If that were dropped, a reset recipient would land signed in but never be asked
    // to choose a password.
    const url = await locationOf('?code=abc123&next=%2Fauth%2Fset-password');
    expect(url.pathname).toBe('/auth/callback');
    expect(url.searchParams.get('next')).toBe('/auth/set-password');
  });

  it('hands a mobile link to the app WITHOUT spending the token', async () => {
    const res = await GET(
      get('?token_hash=TH-1&type=magiclink&redirect_to=resneo%3A%2F%2Fcallback'),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('resneo://callback?token_hash=TH-1&amp;type=magiclink');
    // The token is single-use: verifying here would leave the app with nothing.
    expect(vi.mocked(createClient)).not.toHaveBeenCalled();
    // A one-time credential sits in this URL.
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('carries the recovery type through, so the app asks for a new password', async () => {
    const res = await GET(
      get('?token_hash=TH-2&type=recovery&redirect_to=resneo%3A%2F%2Fcallback'),
    );
    expect(await res.text()).toContain('type=recovery');
  });

  it('never bounces to a scheme other than the app', async () => {
    for (const hostile of ['javascript:alert(1)', 'https://evil.test/steal', 'notresneo://x']) {
      const res = await GET(
        get(`?token_hash=TH&type=magiclink&redirect_to=${encodeURIComponent(hostile)}`),
      );
      // Anything else falls through to normal handling, never to a hand-off page.
      expect(res.headers.get('content-type') ?? '').not.toContain('text/html');
    }
  });

  it('reads next out of redirect_to when it is not a top-level param', async () => {
    // This is the shape the fixed templates send for web callers.
    const redirect = encodeURIComponent(
      'https://example.test/auth/confirm?next=%2Fauth%2Fset-password',
    );
    const url = await locationOf(`?code=abc123&redirect_to=${redirect}`);
    expect(url.searchParams.get('next')).toBe('/auth/set-password');
  });

  it('still fails closed when there is nothing usable in the link', async () => {
    const url = await locationOf('');
    expect(url.pathname).not.toBe('/auth/callback');
  });
});
