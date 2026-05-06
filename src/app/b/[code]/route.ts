import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { createBookingHmac } from '@/lib/short-manage-link';
import { createPaymentPageUrl } from '@/lib/payment-token';
import { resolvePublicSiteOriginFromRequest } from '@/lib/public-base-url';

/**
 * GET /b/:code — Resolve database short link for SMS-friendly URLs.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code: rawCode } = await params;
  const code = rawCode?.trim() ?? '';
  const baseUrl = resolvePublicSiteOriginFromRequest(request);

  if (code.length < 6) {
    return NextResponse.redirect(new URL('/', baseUrl));
  }

  const admin = getSupabaseAdminClient();
  const nowIso = new Date().toISOString();

  const { data: linkRow, error: linkErr } = await admin
    .from('booking_short_links')
    .select('booking_id, purpose, venue_id, access_count')
    .eq('code', code)
    .is('revoked_at', null)
    .gt('expires_at', nowIso)
    .maybeSingle();

  if (linkErr || !linkRow) {
    return NextResponse.redirect(new URL('/', baseUrl));
  }

  const link = linkRow as {
    booking_id: string;
    purpose: string;
    venue_id: string;
    access_count: number | null;
  };

  const { data: booking } = await admin
    .from('bookings')
    .select('id, venue_id, status')
    .eq('id', link.booking_id)
    .maybeSingle();

  const b = booking as { id: string; venue_id: string; status: string } | null;
  if (!b || b.status === 'Cancelled' || b.venue_id !== link.venue_id) {
    return NextResponse.redirect(new URL('/', baseUrl));
  }

  const nextCount = (link.access_count ?? 0) + 1;
  void admin
    .from('booking_short_links')
    .update({
      access_count: nextCount,
      last_accessed_at: nowIso,
      updated_at: nowIso,
    })
    .eq('code', code);

  const purpose = link.purpose;

  if (purpose === 'payment') {
    const payUrl = createPaymentPageUrl(b.id, baseUrl);
    return NextResponse.redirect(payUrl);
  }

  const hmac = createBookingHmac(b.id);

  if (purpose === 'confirm') {
    return NextResponse.redirect(
      new URL(`/confirm/${b.id}?hmac=${encodeURIComponent(hmac)}`, baseUrl),
    );
  }

  return NextResponse.redirect(
    `${baseUrl}/manage/${b.id}?hmac=${encodeURIComponent(hmac)}`,
  );
}
