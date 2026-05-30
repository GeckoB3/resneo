/**
 * Safe public site origin for customer-facing URLs (booking links, widgets, emails).
 * Hardens against malformed `NEXT_PUBLIC_BASE_URL` in .env (e.g. two lines merged without a newline).
 */
const DEFAULT_PUBLIC_ORIGIN = 'https://www.resneo.com';

export function normalizePublicBaseUrl(raw: string | undefined): string {
  if (!raw || typeof raw !== 'string') return DEFAULT_PUBLIC_ORIGIN;

  const firstLine = raw.trim().split(/\r?\n/)[0]?.trim() ?? '';
  if (!firstLine) return DEFAULT_PUBLIC_ORIGIN;

  try {
    const u = new URL(firstLine);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return DEFAULT_PUBLIC_ORIGIN;
    return `${u.protocol}//${u.host}`;
  } catch {
    // e.g. "http://localhost:3000STRIPE_APPOINTMENTS_PRO_PRICE_ID=price_xxx" (missing newline between env vars)
    const m = firstLine.match(/^(https?:\/\/[a-zA-Z0-9.-]+(?::\d+)?)/);
    if (m) {
      try {
        const u = new URL(m[1]);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return DEFAULT_PUBLIC_ORIGIN;
        return `${u.protocol}//${u.host}`;
      } catch {
        return DEFAULT_PUBLIC_ORIGIN;
      }
    }
  }

  return DEFAULT_PUBLIC_ORIGIN;
}

/** Host only (for display), e.g. `www.example.com` or `localhost:3000`. */
export function publicBaseUrlHost(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return 'localhost';
  }
}

/**
 * For API routes building guest-facing URLs: normalized env base, else Vercel host, else request origin.
 */
export function resolvePublicSiteOriginFromRequest(request: { nextUrl: { origin: string } }): string {
  const raw = process.env.NEXT_PUBLIC_BASE_URL;
  if (typeof raw === 'string' && raw.trim() !== '') {
    return normalizePublicBaseUrl(raw);
  }
  if (process.env.VERCEL_URL) {
    return normalizePublicBaseUrl(`https://${process.env.VERCEL_URL}`);
  }
  return normalizePublicBaseUrl(request.nextUrl.origin);
}
