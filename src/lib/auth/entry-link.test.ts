/**
 * The bug this module exists for.
 *
 * `generateLink({type: 'magiclink'})` for an address with NO auth user creates
 * the user and issues a link whose verification type is `signup`. Verifying
 * that hash as a magiclink returns 403, so one-click entry worked for every
 * customer who already had an account and failed for every customer who did
 * not. Production has 1,078 guest emails with no auth user, and they are the
 * only people these links are sent to.
 *
 * Measured against staging before writing this: a brand-new address gets
 * `action_link` carrying `type=signup` and verifying it as `signup` succeeds,
 * while `magiclink` returns 403. An existing address gets a real magiclink.
 */
import { describe, it, expect, vi } from 'vitest';
import { mintEntryLink } from './entry-link';
import type { SupabaseClient } from '@supabase/supabase-js';

function admin(properties: Record<string, unknown> | null, error: { message: string } | null = null) {
  return {
    auth: { admin: { generateLink: vi.fn(async () => ({ data: properties ? { properties } : null, error })) } },
  } as unknown as SupabaseClient;
}

describe('mintEntryLink', () => {
  it('uses the type GoTrue reports, not the one we asked for', async () => {
    // The whole bug in one row: asked for magiclink, issued a signup.
    const got = await mintEntryLink(
      admin({ hashed_token: 'h1', verification_type: 'signup' }),
      'new@example.test',
    );
    expect(got).toEqual({ tokenHash: 'h1', verificationType: 'signup' });
  });

  it('reads the type off the action link when the field is absent', async () => {
    /*
      Two sources because `verification_type` is not documented as guaranteed,
      and the action link demonstrably carries it: staging returned
      `...?type=signup` for a new address.
    */
    const got = await mintEntryLink(
      admin({
        hashed_token: 'h2',
        action_link: 'https://p.supabase.co/auth/v1/verify?token=x&type=signup&redirect_to=%2F',
      }),
      'new@example.test',
    );
    expect(got?.verificationType).toBe('signup');
  });

  it('prefers the reported field over the link', async () => {
    const got = await mintEntryLink(
      admin({
        hashed_token: 'h3',
        verification_type: 'magiclink',
        action_link: 'https://p.supabase.co/auth/v1/verify?type=signup',
      }),
      'a@example.test',
    );
    expect(got?.verificationType).toBe('magiclink');
  });

  it('falls back to magiclink when nothing says otherwise', async () => {
    // The existing-account case, which is what always worked.
    const got = await mintEntryLink(admin({ hashed_token: 'h4' }), 'known@example.test');
    expect(got?.verificationType).toBe('magiclink');
  });

  it('does not throw on a malformed action link', async () => {
    // A link we cannot parse is not a reason to refuse somebody entry.
    const got = await mintEntryLink(admin({ hashed_token: 'h5', action_link: 'not a url' }), 'a@e.test');
    expect(got?.verificationType).toBe('magiclink');
  });

  it('returns null rather than a half link when minting fails', async () => {
    expect(await mintEntryLink(admin(null, { message: 'rate limited' }), 'a@e.test')).toBeNull();
    expect(await mintEntryLink(admin({ verification_type: 'signup' }), 'a@e.test')).toBeNull();
  });
});
