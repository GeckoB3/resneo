import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { loadAccountHome } from '@/lib/account/account-home';
import { apiError, NO_STORE_HEADERS, UNAUTHORISED_ERROR } from '@/lib/api/error-codes';

/**
 * GET /api/account/home (P1-1, AD5, AD6)
 *
 * A thin adapter over `loadAccountHome`. The server page calls the same
 * function directly rather than fetching this route, so the two can never
 * disagree about what the hub contains; this exists for the mobile client and
 * for anything that needs the hub over HTTP.
 *
 * `createRouteHandlerClient` per AD6: the bookings half reads
 * `bookings_account_safe` as the caller, so ownership is the database's
 * business rather than this handler's.
 */
export async function GET(request: Request) {
  try {
    const supabase = await createRouteHandlerClient(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(apiError(UNAUTHORISED_ERROR, 'UNAUTHENTICATED'), {
        status: 401,
        headers: NO_STORE_HEADERS,
      });
    }

    const home = await loadAccountHome(supabase, getSupabaseAdminClient());
    return NextResponse.json(home, { headers: NO_STORE_HEADERS });
  } catch (e) {
    console.error('[account/home]', e);
    return NextResponse.json(apiError('Could not load your account.', 'INTERNAL_ERROR'), {
      status: 500,
      headers: NO_STORE_HEADERS,
    });
  }
}
