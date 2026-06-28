/**
 * Client-side sales code helpers for signup. No server-only imports.
 */

import {
  SALES_CODE_COOKIE_NAME,
  SALES_TRIAL_COOKIE_NAME,
  clampSalesTrialDays,
} from '@/lib/sales/constants';

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export interface SalesValidationOk {
  ok: true;
  code: string;
  salesperson_name: string;
  /** Free-trial days this code grants — drives the signup trial copy. */
  trial_days: number;
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

export function persistSalesCodeCookie(code: string, trialDays?: number): void {
  if (typeof document === 'undefined') return;
  const value = encodeURIComponent(code);
  const isSecure = typeof window !== 'undefined' && window.location.protocol === 'https:';
  const secureAttr = isSecure ? '; Secure' : '';
  document.cookie = `${SALES_CODE_COOKIE_NAME}=${value}; Max-Age=${COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secureAttr}`;
  // Persist the validated trial length alongside the code so the cookie-only signup interstitials
  // (/signup/plan, /signup/appointments-light) can show the right "N-day free trial" copy without
  // re-validating. Display-only — checkout re-reads the authoritative value from the code.
  if (typeof trialDays === 'number' && Number.isFinite(trialDays)) {
    document.cookie = `${SALES_TRIAL_COOKIE_NAME}=${clampSalesTrialDays(trialDays)}; Max-Age=${COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secureAttr}`;
  }
}

export function clearSalesCodeCookie(): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${SALES_CODE_COOKIE_NAME}=; Max-Age=0; Path=/; SameSite=Lax`;
  document.cookie = `${SALES_TRIAL_COOKIE_NAME}=; Max-Age=0; Path=/; SameSite=Lax`;
}

/** Reads the display-only sales-trial cookie set by {@link persistSalesCodeCookie}. */
export function readSalesTrialDaysFromCookie(): number | null {
  const raw = readCookie(SALES_TRIAL_COOKIE_NAME);
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? clampSalesTrialDays(n) : null;
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

/**
 * A network/server/rate-limit failure (vs a definitively-invalid code). On these, callers must
 * NOT clear the cookie or downgrade the offer — the code may be valid and the server re-validates
 * authoritatively at checkout.
 */
export function isTransientSalesValidationFailure(reason: string): boolean {
  return reason === 'request_failed' || reason === 'network' || reason === 'rate_limited';
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
