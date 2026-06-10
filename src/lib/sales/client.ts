/**
 * Client-side sales code helpers for signup. No server-only imports.
 */

import { SALES_CODE_COOKIE_NAME } from '@/lib/sales/constants';

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export interface SalesValidationOk {
  ok: true;
  code: string;
  salesperson_name: string;
}

export interface SalesValidationFail {
  ok: false;
  reason: string;
}

export type SalesValidationClientResult = SalesValidationOk | SalesValidationFail;

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

export function persistSalesCodeCookie(code: string): void {
  if (typeof document === 'undefined') return;
  const value = encodeURIComponent(code);
  const isSecure = typeof window !== 'undefined' && window.location.protocol === 'https:';
  const secureAttr = isSecure ? '; Secure' : '';
  document.cookie = `${SALES_CODE_COOKIE_NAME}=${value}; Max-Age=${COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secureAttr}`;
}

export function clearSalesCodeCookie(): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${SALES_CODE_COOKIE_NAME}=; Max-Age=0; Path=/; SameSite=Lax`;
}

/** Sales codes take precedence over the venue referral programme; drop the referral cookie. */
export function clearReferralCodeCookieForSalesPrecedence(): void {
  if (typeof document === 'undefined') return;
  document.cookie = 'reserveni_ref=; Max-Age=0; Path=/; SameSite=Lax';
}

export function loadSalesCodeFromCookieOrUrl(fromUrl: string | null): string | null {
  if (fromUrl && fromUrl.trim()) {
    const upper = fromUrl.trim().toUpperCase();
    // Persist so the code survives email-confirmation round trips. The referral
    // cookie is only cleared after the sales code validates (sales takes precedence).
    persistSalesCodeCookie(upper);
    return upper;
  }
  const fromCookie = readCookie(SALES_CODE_COOKIE_NAME);
  if (fromCookie && fromCookie.trim()) return fromCookie.trim().toUpperCase();
  return null;
}

export async function validateSalesCodeClient(
  code: string,
): Promise<SalesValidationClientResult> {
  const trimmed = code.trim();
  if (!trimmed) return { ok: false, reason: 'invalid_input' };
  try {
    const res = await fetch(`/api/sales-program/validate?code=${encodeURIComponent(trimmed)}`, {
      method: 'GET',
      credentials: 'same-origin',
    });
    if (!res.ok) return { ok: false, reason: 'request_failed' };
    const json = (await res.json()) as SalesValidationClientResult;
    return json;
  } catch {
    return { ok: false, reason: 'network' };
  }
}
