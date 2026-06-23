import { createHmac, timingSafeEqual } from 'crypto';
import { normalizePublicBaseUrl } from '@/lib/public-base-url';
import { getPaymentTokenSecret, tryGetPaymentTokenSecret } from '@/lib/payment-token';

/** Default expiry for scoped manage tokens (14 days). */
const MANAGE_LINK_TTL_SEC = 60 * 60 * 24 * 14;
/**
 * Compatibility window for old stateless `/m/{payload}.{sig}` links AND legacy
 * expiry-less `?hmac=` bearer values. After this instant both are rejected, so a
 * leaked non-expiring link cannot be replayed forever.
 */
export const LEGACY_MANAGE_LINK_ACCEPT_UNTIL_MS = Date.UTC(2026, 7, 1, 0, 0, 0);

function parseLegacyShortManageCode(code: string, secret: string): string | null {
  if (Date.now() > LEGACY_MANAGE_LINK_ACCEPT_UNTIL_MS) return null;

  const dotIdx = code.lastIndexOf('.');
  if (dotIdx < 1) return null;
  const payload = code.slice(0, dotIdx);
  const sig = code.slice(dotIdx + 1);

  const expectedFull = createHmac('sha256', secret).update(payload).digest('base64url');
  const expected = expectedFull.slice(0, 12);
  if (expected.length !== sig.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  } catch {
    return null;
  }

  try {
    const bytes = Buffer.from(payload, 'base64url');
    if (bytes.length !== 16) return null;
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  } catch {
    return null;
  }
}

function parseV2ShortManageCode(code: string, secret: string): string | null {
  const without = code.startsWith('v2.') ? code.slice(3) : null;
  if (!without) return null;
  const lastDot = without.lastIndexOf('.');
  if (lastDot < 1) return null;
  const payload = without.slice(0, lastDot);
  const sig = without.slice(lastDot + 1);
  const expected = createHmac('sha256', secret)
    .update(`manage2:${payload}`)
    .digest('base64url')
    .slice(0, 18);
  if (expected.length !== sig.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  } catch {
    return null;
  }
  let parsed: { v?: number; bid?: string; exp?: number };
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      v?: number;
      bid?: string;
      exp?: number;
    };
  } catch {
    return null;
  }
  if (parsed.v !== 2 || typeof parsed.bid !== 'string' || typeof parsed.exp !== 'number') return null;
  if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
  return parsed.bid;
}

function parseV3ShortManageCode(code: string, secret: string): string | null {
  const without = code.startsWith('v3.') ? code.slice(3) : null;
  if (!without) return null;
  const lastDot = without.lastIndexOf('.');
  if (lastDot < 1) return null;
  const payload = without.slice(0, lastDot);
  const sig = without.slice(lastDot + 1);
  const payloadBuf = Buffer.from(payload, 'base64url');
  if (payloadBuf.length !== 20) return null;
  const expected = createHmac('sha256', secret)
    .update(Buffer.concat([Buffer.from('manage3:'), payloadBuf]))
    .digest('base64url')
    .slice(0, 12);
  if (expected.length !== sig.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  } catch {
    return null;
  }
  const expSec = payloadBuf.readUInt32BE(16);
  if (expSec < Math.floor(Date.now() / 1000)) return null;
  const hex = payloadBuf.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Verify short manage URL segment and return booking id (legacy, v2, or compact v3 scoped token).
 */
export function resolveShortManageBookingId(code: string): string | null {
  const secret = tryGetPaymentTokenSecret();
  if (!secret) return null;
  if (code.startsWith('v3.')) {
    return parseV3ShortManageCode(code, secret);
  }
  if (code.startsWith('v2.')) {
    return parseV2ShortManageCode(code, secret);
  }
  return parseLegacyShortManageCode(code, secret);
}

/**
 * Create a compact signed manage link for a booking (v3 scoped token with expiry).
 * Legacy v1 and v2 links are still accepted in {@link resolveShortManageBookingId}.
 */
export function createShortManageLink(bookingId: string): string {
  const secret = getPaymentTokenSecret();
  const hex = bookingId.replace(/-/g, '');
  const idBytes = Buffer.from(hex, 'hex');
  if (idBytes.length !== 16) {
    throw new Error('Invalid booking id for manage token');
  }
  const exp = Math.floor(Date.now() / 1000) + MANAGE_LINK_TTL_SEC;
  const expBuf = Buffer.alloc(4);
  expBuf.writeUInt32BE(exp, 0);
  const payloadBuf = Buffer.concat([idBytes, expBuf]);
  const payload = payloadBuf.toString('base64url');
  const sig = createHmac('sha256', secret)
    .update(Buffer.concat([Buffer.from('manage3:'), payloadBuf]))
    .digest('base64url')
    .slice(0, 12);
  const baseUrl = normalizePublicBaseUrl(process.env.NEXT_PUBLIC_BASE_URL);
  return `${baseUrl}/m/v3.${payload}.${sig}`;
}

/**
 * Compact signed link to the confirm/cancel guest page (same shape as manage, distinct HMAC domain).
 */
export function createShortConfirmLink(bookingId: string): string {
  const hex = bookingId.replace(/-/g, '');
  const payload = Buffer.from(hex, 'hex').toString('base64url');
  const sig = createHmac('sha256', getPaymentTokenSecret())
    .update(`confirm:${payload}`)
    .digest('base64url')
    .slice(0, 12);
  const baseUrl = normalizePublicBaseUrl(process.env.NEXT_PUBLIC_BASE_URL);
  return `${baseUrl}/c/${payload}.${sig}`;
}

/** Default TTL for booking manage/confirm HMAC bearer values (30 days). */
export const BOOKING_HMAC_TTL_SEC = 60 * 60 * 24 * 30;

function bookingHmacSignature(secret: string, bookingId: string, expEpoch: number): string {
  return createHmac('sha256', secret)
    .update(`manage:${bookingId}:${expEpoch}`)
    .digest('base64url');
}

function legacyBookingHmacSignature(secret: string, bookingId: string): string {
  return createHmac('sha256', secret).update(`manage:${bookingId}`).digest('base64url');
}

/**
 * Generate an HMAC bearer value for a booking ID (used as an alternative auth
 * mechanism that doesn't require storing/overwriting a hash in the DB).
 *
 * Format: `${expEpochSeconds}.${sigOver("manage:"+bookingId+":"+expEpoch)}`.
 * The embedded expiry bounds the lifetime of the bearer value so a leaked
 * `?hmac=` link cannot be replayed forever. {@link verifyBookingHmac} still
 * accepts the older expiry-less signature for links already emailed out.
 */
export function createBookingHmac(bookingId: string): string {
  const exp = Math.floor(Date.now() / 1000) + BOOKING_HMAC_TTL_SEC;
  const sig = bookingHmacSignature(getPaymentTokenSecret(), bookingId, exp);
  return `${exp}.${sig}`;
}

/**
 * Verify an HMAC bearer value for a booking ID.
 *
 * Accepts the new expiring format `${exp}.${sig}` (rejecting expired values) and,
 * for backward compatibility, the legacy expiry-less signature (`manage:${bookingId}`)
 * — but only until {@link LEGACY_MANAGE_LINK_ACCEPT_UNTIL_MS}, the same rotation cutoff
 * used for legacy `/m/{payload}.{sig}` links. After that date a non-expiring `?hmac=`
 * value is rejected, closing the permanent-bearer-token window (new expiring links keep
 * working). By then outstanding links have been re-issued in the expiring format and the
 * 30-day TTL on new links has long lapsed.
 */
export function verifyBookingHmac(bookingId: string, hmac: string): boolean {
  const secret = tryGetPaymentTokenSecret();
  if (!secret) return false;

  const dotIdx = hmac.indexOf('.');
  if (dotIdx > 0) {
    // New expiring format: ${expEpochSeconds}.${sig}
    const expPart = hmac.slice(0, dotIdx);
    const sig = hmac.slice(dotIdx + 1);
    if (!/^\d+$/.test(expPart)) return false;
    const exp = Number(expPart);
    if (!Number.isSafeInteger(exp)) return false;
    if (exp < Math.floor(Date.now() / 1000)) return false;
    const expected = bookingHmacSignature(secret, bookingId, exp);
    if (expected.length !== sig.length) return false;
    try {
      return timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
    } catch {
      return false;
    }
  }

  // Legacy expiry-less signature (no `.` separator): bounded by the same rotation
  // cutoff as legacy `/m/` links so it cannot serve as a permanent bearer token.
  if (Date.now() > LEGACY_MANAGE_LINK_ACCEPT_UNTIL_MS) return false;
  const expected = legacyBookingHmacSignature(secret, bookingId);
  if (expected.length !== hmac.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(hmac));
  } catch {
    return false;
  }
}
