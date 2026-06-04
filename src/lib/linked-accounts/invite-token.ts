import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Shareable link-invite tokens (§20). An Admin generates a one-time, expiring
 * link that encodes *their* venue id; opening it pre-fills a link request from
 * the opener's venue back to the initiator. The token grants nothing — it is a
 * convenience pre-fill, and a normal request must still be sent and accepted —
 * so a compact, stateless HMAC token (no DB row) is sufficient and revocation
 * is implicit via the 30-day expiry.
 *
 * Format: `base64url(16-byte venue uuid + 4-byte unix expiry seconds).<16-char HMAC>`
 * The HMAC is domain-separated (`INVITE_DOMAIN`) so a token from another feature
 * signed with the same secret can never validate here.
 */

const INVITE_DOMAIN = 'reserveni:link-invite:v1:';
const INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — matches a pending request (§20).
const SIG_LEN = 16;

/**
 * Secret for signing invite tokens. Prefers a dedicated `LINK_INVITE_SECRET`
 * but falls back to `PAYMENT_TOKEN_SECRET` (already required app-wide) so the
 * feature works without new env configuration. Domain separation keeps the two
 * token families distinct even when they share a secret.
 */
function tryGetInviteSecret(): string | null {
  const dedicated = process.env.LINK_INVITE_SECRET?.trim();
  if (dedicated) return dedicated;
  const shared = process.env.PAYMENT_TOKEN_SECRET?.trim();
  return shared && shared.length > 0 ? shared : null;
}

function sign(secret: string, body: Buffer): string {
  return createHmac('sha256', secret)
    .update(INVITE_DOMAIN)
    .update(body)
    .digest('base64url')
    .slice(0, SIG_LEN);
}

/** Throws if no signing secret is configured (callers should guard). */
export function createLinkInviteToken(venueId: string, now: number = Date.now()): string {
  const secret = tryGetInviteSecret();
  if (!secret) throw new Error('LINK_INVITE_SECRET (or PAYMENT_TOKEN_SECRET) is required');

  const hex = venueId.replace(/-/g, '');
  const idBytes = Buffer.from(hex, 'hex');
  if (idBytes.length !== 16) throw new Error('Invalid venue id for invite token');

  const expSec = Math.floor((now + INVITE_TTL_MS) / 1000);
  const expBuf = Buffer.alloc(4);
  expBuf.writeUInt32BE(expSec, 0);

  const body = Buffer.concat([idBytes, expBuf]);
  return `${body.toString('base64url')}.${sign(secret, body)}`;
}

export type VerifyInviteResult =
  | { ok: true; venueId: string; exp: number }
  | { ok: false; reason: 'invalid' | 'expired' | 'misconfigured' };

export function verifyLinkInviteToken(
  token: string,
  now: number = Date.now(),
): VerifyInviteResult {
  const secret = tryGetInviteSecret();
  if (!secret) return { ok: false, reason: 'misconfigured' };

  const parts = (token ?? '').trim().split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'invalid' };

  let body: Buffer;
  try {
    body = Buffer.from(parts[0], 'base64url');
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (body.length !== 20) return { ok: false, reason: 'invalid' };

  const expected = sign(secret, body);
  const received = parts[1];
  if (expected.length !== received.length) return { ok: false, reason: 'invalid' };
  try {
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(received))) {
      return { ok: false, reason: 'invalid' };
    }
  } catch {
    return { ok: false, reason: 'invalid' };
  }

  const expSec = body.readUInt32BE(16);
  const expMs = expSec * 1000;
  if (!Number.isFinite(expMs)) return { ok: false, reason: 'invalid' };
  if (now > expMs) return { ok: false, reason: 'expired' };

  const hex = body.subarray(0, 16).toString('hex');
  const venueId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return { ok: true, venueId, exp: expMs };
}
