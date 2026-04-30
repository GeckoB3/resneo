import { createHmac, timingSafeEqual } from 'crypto';
import { normalizePublicBaseUrl } from '@/lib/public-base-url';
import { getPaymentTokenSecret, tryGetPaymentTokenSecret } from '@/lib/payment-token';

/** Default expiry for scoped manage tokens (14 days). */
const MANAGE_LINK_TTL_SEC = 60 * 60 * 24 * 14;
/** Compatibility window for old stateless /m/{payload}.{sig} links. */
const LEGACY_MANAGE_LINK_ACCEPT_UNTIL_MS = Date.UTC(2026, 7, 1, 0, 0, 0);

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

/**
 * Generate an HMAC signature for a booking ID (used as an alternative auth
 * mechanism that doesn't require storing/overwriting a hash in the DB).
 */
export function createBookingHmac(bookingId: string): string {
  return createHmac('sha256', getPaymentTokenSecret())
    .update(`manage:${bookingId}`)
    .digest('base64url');
}

/**
 * Verify an HMAC signature for a booking ID.
 */
export function verifyBookingHmac(bookingId: string, hmac: string): boolean {
  const secret = tryGetPaymentTokenSecret();
  if (!secret) return false;
  const expected = createHmac('sha256', secret)
    .update(`manage:${bookingId}`)
    .digest('base64url');
  if (expected.length !== hmac.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(hmac));
}
