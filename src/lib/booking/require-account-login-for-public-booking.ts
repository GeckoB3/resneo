import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * When `venues.require_account_login_for_bookings` is true, public booking must run under
 * an authenticated Supabase session and the booking contact email must match that account.
 */
export async function nextResponseIfVenueRequiresAccountLoginForBooking(params: {
  requireAccountLogin: boolean;
  authSupabase: SupabaseClient;
  /** Normalised booking email from the request body; may be empty for phone-only sources. */
  bookingEmail: string | null | undefined;
}): Promise<NextResponse | null> {
  if (!params.requireAccountLogin) return null;

  const {
    data: { user },
  } = await params.authSupabase.auth.getUser();
  if (!user?.email) {
    return NextResponse.json({ error: 'Sign in is required to book this venue.' }, { status: 401 });
  }

  const bookingEmail = (params.bookingEmail ?? '').trim().toLowerCase();
  if (bookingEmail && bookingEmail !== user.email.toLowerCase().trim()) {
    return NextResponse.json(
      { error: 'Booking email must match the signed-in account for this venue.' },
      { status: 403 },
    );
  }

  return null;
}
