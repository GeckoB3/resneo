import { createHmac, timingSafeEqual } from 'crypto';
import { normalizePublicBaseUrl } from '@/lib/public-base-url';
import { getPaymentTokenSecret, tryGetPaymentTokenSecret } from '@/lib/payment-token';

/**
 * Unsubscribe links for Contact Users emails. The link carries the recipient row id
 * (`platform_broadcast_recipients.id`), never the address, and an HMAC over it; the row says which
 * address to opt out. Same secret and signature length as the guest marketing unsubscribe
 * (src/lib/marketing-unsubscribe.ts), under a different prefix so one can never verify as the other.
 */

function signatureForRecipient(recipientId: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`platform-updates-unsubscribe:${recipientId}`)
    .digest('base64url')
    .slice(0, 22);
}

/** The page a person lands on from the email footer (asks before it unsubscribes). */
export function createBroadcastUnsubscribePageUrl(recipientId: string): string {
  const base = normalizePublicBaseUrl(process.env.NEXT_PUBLIC_BASE_URL);
  const url = new URL('/updates/unsubscribe', base);
  url.searchParams.set('r', recipientId);
  url.searchParams.set('sig', signatureForRecipient(recipientId, getPaymentTokenSecret()));
  return url.toString();
}

/** RFC 8058 one-click endpoint for the List-Unsubscribe header (mail apps POST to it). */
export function createBroadcastOneClickUnsubscribeUrl(recipientId: string): string {
  const base = normalizePublicBaseUrl(process.env.NEXT_PUBLIC_BASE_URL);
  const url = new URL('/api/updates/unsubscribe', base);
  url.searchParams.set('r', recipientId);
  url.searchParams.set('sig', signatureForRecipient(recipientId, getPaymentTokenSecret()));
  return url.toString();
}

/** Footer link used in test sends: the page explains it is a test and changes nothing. */
export function createBroadcastTestUnsubscribeUrl(): string {
  const base = normalizePublicBaseUrl(process.env.NEXT_PUBLIC_BASE_URL);
  const url = new URL('/updates/unsubscribe', base);
  url.searchParams.set('test', '1');
  return url.toString();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function verifyBroadcastUnsubscribeSignature(recipientId: string, sig: string): boolean {
  if (!UUID_RE.test(recipientId)) return false;
  const secret = tryGetPaymentTokenSecret();
  if (!secret) return false;
  const expected = signatureForRecipient(recipientId, secret);
  if (expected.length !== sig.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  } catch {
    return false;
  }
}
