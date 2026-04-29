import { createHmac, timingSafeEqual } from 'crypto';
import { normalizePublicBaseUrl } from '@/lib/public-base-url';
import { getPaymentTokenSecret, tryGetPaymentTokenSecret } from '@/lib/payment-token';

function signatureForGuest(guestId: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`marketing-unsubscribe:${guestId}`)
    .digest('base64url')
    .slice(0, 18);
}

export function createMarketingUnsubscribeUrl(guestId: string): string {
  const base = normalizePublicBaseUrl(process.env.NEXT_PUBLIC_BASE_URL);
  const sig = signatureForGuest(guestId, getPaymentTokenSecret());
  const url = new URL('/api/marketing/unsubscribe', base);
  url.searchParams.set('guest_id', guestId);
  url.searchParams.set('sig', sig);
  return url.toString();
}

export function verifyMarketingUnsubscribeSignature(guestId: string, sig: string): boolean {
  const secret = tryGetPaymentTokenSecret();
  if (!secret) return false;
  const expected = signatureForGuest(guestId, secret);
  if (expected.length !== sig.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  } catch {
    return false;
  }
}
