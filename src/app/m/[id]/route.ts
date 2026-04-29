import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { createBookingHmac, resolveShortManageBookingId } from '@/lib/short-manage-link';
import { resolvePublicSiteOriginFromRequest } from '@/lib/public-base-url';

/**
 * GET /m/:signedCode - Verify the short-link HMAC and redirect to the manage
 * page using HMAC-based auth. This avoids overwriting the token hash in the
 * database (which would invalidate email manage links).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: code } = await params;
  const baseUrl = resolvePublicSiteOriginFromRequest(_request);

  const bookingId = resolveShortManageBookingId(code);
  if (!bookingId) {
    return NextResponse.redirect(new URL('/', baseUrl));
  }

  const supabase = getSupabaseAdminClient();
  const { data: booking } = await supabase
    .from('bookings')
    .select('id, status')
    .eq('id', bookingId)
    .maybeSingle();

  if (!booking || booking.status === 'Cancelled') {
    return NextResponse.redirect(new URL('/', baseUrl));
  }

  const hmac = createBookingHmac(booking.id);
  return NextResponse.redirect(
    `${baseUrl}/manage/${booking.id}?hmac=${encodeURIComponent(hmac)}`,
  );
}
