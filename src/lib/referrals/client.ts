/**
 * Client-side referral helpers used by the signup page.
 * No imports from server-only modules — safe to bundle.
 */

const COOKIE_NAME = 'reserveni_ref';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export interface ReferralValidationOk {
  ok: true;
  code: string;
  referrer_venue_name: string;
}

export interface ReferralValidationFail {
  ok: false;
  reason: string;
}

export type ReferralValidationClientResult = ReferralValidationOk | ReferralValidationFail;

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const target = `${name}=`;
  const parts = document.cookie.split(';');
  for (const raw of parts) {
    const part = raw.trim();
    if (part.startsWith(target)) {
      try {
        return decodeURIComponent(part.slice(target.length)) || null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function persistReferralCodeCookie(code: string): void {
  if (typeof document === 'undefined') return;
  const value = encodeURIComponent(code);
  const isSecure = typeof window !== 'undefined' && window.location.protocol === 'https:';
  const secureAttr = isSecure ? '; Secure' : '';
  document.cookie = `${COOKIE_NAME}=${value}; Max-Age=${COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secureAttr}`;
}

export function clearReferralCodeCookie(): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${COOKIE_NAME}=; Max-Age=0; Path=/; SameSite=Lax`;
}

export function loadReferralCodeFromCookieOrUrl(
  fromUrl: string | null,
): string | null {
  if (fromUrl && fromUrl.trim()) {
    const upper = fromUrl.trim().toUpperCase();
    // Persist URL value so it survives email-confirmation round trips.
    persistReferralCodeCookie(upper);
    return upper;
  }
  const fromCookie = readCookie(COOKIE_NAME);
  if (fromCookie && fromCookie.trim()) return fromCookie.trim().toUpperCase();
  return null;
}

export async function validateReferralCodeClient(
  code: string,
): Promise<ReferralValidationClientResult> {
  const trimmed = code.trim();
  if (!trimmed) return { ok: false, reason: 'invalid_input' };
  try {
    const res = await fetch(`/api/referrals/validate?code=${encodeURIComponent(trimmed)}`, {
      method: 'GET',
      credentials: 'same-origin',
    });
    if (!res.ok) return { ok: false, reason: 'request_failed' };
    const json = (await res.json()) as ReferralValidationClientResult;
    return json;
  } catch {
    return { ok: false, reason: 'network' };
  }
}
