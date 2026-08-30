import { createHash, randomBytes, timingSafeEqual } from 'crypto';

/**
 * The house hashed-token primitives: 256 bits of randomness, stored as a
 * sha256 hex digest, never in plaintext.
 *
 * Ten call sites mint booking manage tokens with these, and P3-4a's portal
 * tokens reuse them rather than growing a parallel scheme.
 */

export function generateConfirmToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashConfirmToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Constant-time comparison (P3-4a).
 *
 * This was `hashConfirmToken(token) === storedHash`, and `===` on strings
 * returns as soon as two bytes differ, so how long it takes to refuse a token
 * depends on how much of the hash the caller got right. Every other verifier
 * in this codebase already avoids that: `payment-token.ts` and
 * `marketing-unsubscribe.ts` both use `timingSafeEqual`. This one was the
 * exception, and P3-4a's instruction was to fix it here rather than copy it.
 *
 * **The length check is not redundant.** `timingSafeEqual` THROWS when the
 * buffers differ in length, so a stored hash that is malformed, truncated, or
 * left over from some other scheme would turn a refusal into a 500. The length
 * of a sha256 digest is public, so comparing it early leaks nothing worth
 * having.
 */
export function verifyConfirmToken(token: string, storedHash: string | null): boolean {
  if (!storedHash) return false;
  const expected = Buffer.from(hashConfirmToken(token), 'utf8');
  const actual = Buffer.from(storedHash, 'utf8');
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
