import { normalizePublicBaseUrl } from '@/lib/public-base-url';

/** Signed-in customer bookings list (requires session). */
export function accountBookingsPortalUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  if (!raw) return null;
  const base = normalizePublicBaseUrl(raw);
  return `${base}/account/bookings`;
}

/** Fresh magic-link request URL for the account booking dashboard. */
export function accountBookingsMagicLinkUrl(email: string | null | undefined): string | null {
  const raw = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  if (!raw) return null;
  const base = normalizePublicBaseUrl(raw);
  const url = new URL('/auth/magic', base);
  const normalisedEmail = email?.trim().toLowerCase();
  if (normalisedEmail) url.searchParams.set('email', normalisedEmail);
  url.searchParams.set('context', 'customer');
  url.searchParams.set('redirect', '/account/bookings');
  return url.toString();
}
