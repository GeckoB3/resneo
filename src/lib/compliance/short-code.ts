import { randomBytes } from 'crypto';

const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * Cryptographically-random base36 code for public `/p/forms/{code}` links.
 * 10 chars ≈ 52 bits entropy — sufficient for a single-use, short-lived,
 * revocable credential (spec §4.6 / §13.4). Mirrors booking_short_links.
 */
export function generateComplianceFormCode(length = 10): string {
  const buf = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += BASE36[buf[i]! % 36];
  }
  return out;
}
