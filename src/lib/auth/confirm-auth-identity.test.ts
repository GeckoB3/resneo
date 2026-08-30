/**
 * The redirect loop, and why it needs a test rather than a comment.
 *
 * `resolveAuthIdentity` prefers `getClaims()`, which verifies the JWT LOCALLY
 * and so cannot see revocation: a session signed out elsewhere keeps producing
 * valid claims until its access token expires. Middleware trusted that and
 * treated the caller as signed in; `/account`'s layout used `getUser()`, was
 * told there was no user, and redirected to `/login`; middleware bounced them
 * straight back. The customer got ERR_TOO_MANY_REDIRECTS instead of a sign-in
 * form, and it cost a CI run to find.
 *
 * The fix has to hold BOTH ways, which is the whole reason this is a test: a
 * rejected session must be disbelieved, and an unreachable auth server must
 * NOT be, or an auth blip signs everybody out at once.
 */
import { describe, it, expect } from 'vitest';
import { confirmAuthIdentity } from './resolve-auth-identity';
import type { SupabaseClient } from '@supabase/supabase-js';

const IDENTITY = {
  id: 'user-1',
  email: 'guest@example.test',
  appMetadata: {},
  userMetadata: { from_claims: true },
} as Parameters<typeof confirmAuthIdentity>[1];

function client(result: { user?: unknown; error?: { status?: number } | null }) {
  return {
    auth: { getUser: async () => ({ data: { user: result.user ?? null }, error: result.error ?? null }) },
  } as unknown as SupabaseClient;
}

describe('confirmAuthIdentity', () => {
  it('confirms a live session, preferring the server’s metadata', async () => {
    // The server's copy is fresher than the JWT's, which is why /login asked
    // for it in the first place.
    const got = await confirmAuthIdentity(
      client({ user: { id: 'user-1', user_metadata: { from_server: true } } }),
      IDENTITY,
    );
    expect(got.confirmed).toBe(true);
    expect(got.metadata).toEqual({ from_server: true });
  });

  it('DISBELIEVES a session the auth server rejects', async () => {
    // The loop. A 401 is GoTrue saying the session is gone, and that has to
    // win over claims that merely have not expired yet.
    for (const status of [400, 401, 403, 404, 499]) {
      const got = await confirmAuthIdentity(client({ error: { status } }), IDENTITY);
      expect(got.confirmed, `status ${status} should not be believed`).toBe(false);
    }
  });

  it('KEEPS the session when the auth server is merely unreachable', async () => {
    // Fails open on purpose: treating an outage as a mass sign-out would turn
    // an auth blip into every signed-in customer losing their session.
    for (const status of [500, 502, 503, 0]) {
      const got = await confirmAuthIdentity(client({ error: { status } }), IDENTITY);
      expect(got.confirmed, `status ${status} should be tolerated`).toBe(true);
    }
    const noStatus = await confirmAuthIdentity(client({ error: {} }), IDENTITY);
    expect(noStatus.confirmed).toBe(true);
  });

  it('falls back to the claims metadata when it cannot get better', async () => {
    const got = await confirmAuthIdentity(client({ error: { status: 503 } }), IDENTITY);
    expect(got.metadata).toEqual({ from_claims: true });
  });

  it('tolerates a user row with no usable metadata', async () => {
    const got = await confirmAuthIdentity(client({ user: { id: 'user-1', user_metadata: null } }), IDENTITY);
    expect(got.confirmed).toBe(true);
    expect(got.metadata).toEqual({ from_claims: true });
  });
});
