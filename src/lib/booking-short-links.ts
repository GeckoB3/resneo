import { randomBytes } from 'crypto';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { normalizePublicBaseUrl } from '@/lib/public-base-url';

/** Align with scoped manage tokens in `short-manage-link.ts` (14 days). */
const MANAGE_CONFIRM_TTL_MS = 60 * 60 * 24 * 14 * 1000;

/** Align with `createPaymentLinkToken` expiry (24 hours). */
const PAYMENT_TTL_MS = 24 * 60 * 60 * 1000;

const BASE62 =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export type BookingShortLinkPurpose = 'manage' | 'confirm' | 'payment';

export interface CreateBookingShortLinkOpts {
  venueId: string;
  bookingId: string;
  purpose: BookingShortLinkPurpose;
  /** Override base URL segment (e.g. cron origin). */
  publicOrigin?: string;
}

function purposeTtlMs(purpose: BookingShortLinkPurpose): number {
  return purpose === 'payment' ? PAYMENT_TTL_MS : MANAGE_CONFIRM_TTL_MS;
}

/**
 * Cryptographically random base62 code for `/b/{code}` paths.
 * Exported for unit tests.
 */
export function generateBookingShortLinkCode(length = 6): string {
  const buf = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += BASE62[buf[i]! % 62];
  }
  return out;
}

function resolvePublicUrl(publicOrigin?: string): string {
  return publicOrigin
    ? normalizePublicBaseUrl(publicOrigin)
    : normalizePublicBaseUrl(process.env.NEXT_PUBLIC_BASE_URL);
}

/**
 * Returns an existing active short URL for the booking+purpose, or creates one.
 * Collisions on `code` are retried with a new random code.
 */
export async function createOrGetBookingShortLink(opts: CreateBookingShortLinkOpts): Promise<string> {
  const admin = getSupabaseAdminClient();
  const baseUrl = resolvePublicUrl(opts.publicOrigin);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  const { data: existing, error: selErr } = await admin
    .from('booking_short_links')
    .select('code, expires_at')
    .eq('booking_id', opts.bookingId)
    .eq('purpose', opts.purpose)
    .is('revoked_at', null)
    .gt('expires_at', nowIso)
    .maybeSingle();

  if (selErr) {
    console.error('[booking-short-links] lookup failed:', selErr.message, {
      bookingId: opts.bookingId,
      purpose: opts.purpose,
    });
    throw new Error(selErr.message);
  }

  const row = existing as { code?: string } | null;
  if (row?.code) {
    return `${baseUrl}/b/${row.code}`;
  }

  const ttlMs = purposeTtlMs(opts.purpose);
  const expiresAt = new Date(now + ttlMs).toISOString();

  // Partial unique index (booking_id, purpose) includes expired rows; renew instead of insert.
  const { data: staleRow, error: staleErr } = await admin
    .from('booking_short_links')
    .select('code')
    .eq('booking_id', opts.bookingId)
    .eq('purpose', opts.purpose)
    .is('revoked_at', null)
    .maybeSingle();

  if (staleErr) {
    console.error('[booking-short-links] stale lookup failed:', staleErr.message, {
      bookingId: opts.bookingId,
      purpose: opts.purpose,
    });
    throw new Error(staleErr.message);
  }

  const stale = staleRow as { code?: string } | null;
  if (stale?.code) {
    const { error: upErr } = await admin
      .from('booking_short_links')
      .update({
        expires_at: expiresAt,
        venue_id: opts.venueId,
        updated_at: nowIso,
      })
      .eq('code', stale.code);

    if (upErr) {
      console.error('[booking-short-links] renew failed:', upErr.message, {
        bookingId: opts.bookingId,
        purpose: opts.purpose,
      });
      throw new Error(upErr.message);
    }

    return `${baseUrl}/b/${stale.code}`;
  }

  const maxAttempts = 12;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const code = generateBookingShortLinkCode(6);
    const { error: insErr } = await admin.from('booking_short_links').insert({
      code,
      venue_id: opts.venueId,
      booking_id: opts.bookingId,
      purpose: opts.purpose,
      expires_at: expiresAt,
    });

    if (!insErr) {
      return `${baseUrl}/b/${code}`;
    }

    if (insErr.code === '23505') {
      continue;
    }

    console.error('[booking-short-links] insert failed:', insErr.message, {
      bookingId: opts.bookingId,
      purpose: opts.purpose,
    });
    throw new Error(insErr.message);
  }

  throw new Error('[booking-short-links] could not allocate unique short code');
}

/**
 * Build payment guest URL using the short `/b/{code}` layer when possible.
 */
export async function createOrGetPaymentShortLink(
  venueId: string,
  bookingId: string,
  publicOrigin?: string,
): Promise<string> {
  return createOrGetBookingShortLink({
    venueId,
    bookingId,
    purpose: 'payment',
    publicOrigin,
  });
}
