/**
 * The house hashed-token primitives, which had no test at all despite ten call
 * sites minting booking manage tokens with them and two verifying against them.
 *
 * Written for P3-4a, which reuses these for portal tokens and whose first
 * instruction was to fix the `===` comparison here rather than copy it into a
 * second scheme.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { generateConfirmToken, hashConfirmToken, verifyConfirmToken } from './confirm-token';

describe('generateConfirmToken', () => {
  it('is 256 bits of randomness, URL-safe', () => {
    const token = generateConfirmToken();
    // base64url of 32 bytes is 43 characters, no padding, no + or /.
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateConfirmToken()));
    expect(seen.size).toBe(200);
  });
});

describe('hashConfirmToken', () => {
  it('is a sha256 hex digest, so it is what the column stores', () => {
    expect(hashConfirmToken('hello')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable, or every issued token would stop verifying', () => {
    expect(hashConfirmToken('hello')).toBe(hashConfirmToken('hello'));
  });

  it('is not the token, which is the whole point of storing it', () => {
    const token = generateConfirmToken();
    expect(hashConfirmToken(token)).not.toContain(token);
  });
});

describe('verifyConfirmToken', () => {
  it('accepts the token it hashed', () => {
    const token = generateConfirmToken();
    expect(verifyConfirmToken(token, hashConfirmToken(token))).toBe(true);
  });

  it('refuses a different token', () => {
    expect(verifyConfirmToken('wrong', hashConfirmToken(generateConfirmToken()))).toBe(false);
  });

  it('refuses when nothing is stored, rather than accepting anything', () => {
    // The booking column is nullable, so this is the state of every booking
    // whose token has never been minted.
    expect(verifyConfirmToken('anything', null)).toBe(false);
    expect(verifyConfirmToken('anything', '')).toBe(false);
  });

  it('compares in constant time', () => {
    /*
      P3-4a's stated fix. `===` on strings returns at the first differing byte,
      so how long a refusal takes depends on how much of the hash the caller
      got right, and a token can be recovered a byte at a time by measurement.

      Asserted structurally rather than by timing: a timing assertion on a
      shared CI runner is a flake generator, and what can actually regress here
      is somebody putting `===` back.

      BLOCK COMMENTS ARE STRIPPED FIRST. The function's own docstring quotes the
      comparison it replaced, to say what was wrong with it, and matching the
      raw file made this fail against the explanation rather than the code.
    */
    const source = fs
      .readFileSync(path.join(process.cwd(), 'src/lib/confirm-token.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(source).toContain('timingSafeEqual');
    expect(source).not.toMatch(/hashConfirmToken\(token\)\s*===/);
  });

  it('refuses a malformed stored hash instead of throwing', () => {
    /*
      `timingSafeEqual` THROWS on differing lengths, so without the length
      guard a truncated or foreign value in the column would become a 500 on
      the confirm route rather than a refused link. Both verifiers of this
      function sit on paths a guest reaches from an email.
    */
    const token = generateConfirmToken();
    for (const stored of ['short', 'f'.repeat(63), 'f'.repeat(65), 'not a hash at all']) {
      expect(() => verifyConfirmToken(token, stored)).not.toThrow();
      expect(verifyConfirmToken(token, stored)).toBe(false);
    }
  });

  it('refuses a hash of the right LENGTH but the wrong value', () => {
    // The vacuity guard on the row above: returning false for everything would
    // pass it, and would also break every manage link ever issued.
    const token = generateConfirmToken();
    expect(verifyConfirmToken(token, 'a'.repeat(64))).toBe(false);
    expect(verifyConfirmToken(token, hashConfirmToken(token))).toBe(true);
  });
});
