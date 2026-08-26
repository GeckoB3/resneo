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
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: vi.fn() }));

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

  it('still fails closed when there is nothing usable in the link', async () => {
    const url = await locationOf('');
    expect(url.pathname).not.toBe('/auth/callback');
  });
});
