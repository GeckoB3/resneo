import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { loadAccountBookings } from '@/lib/account/account-bookings';

/**
 * GET /api/account/bookings — upcoming/past bookings for linked guest rows (server-side join).
 */
export async function GET(request: Request) {
  try {
    const supabase = await createRouteHandlerClient(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

    const bookings = await loadAccountBookings(supabase, getSupabaseAdminClient(), 100);
    return NextResponse.json({ bookings });
  } catch (e) {
    console.error('[account/bookings]', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
