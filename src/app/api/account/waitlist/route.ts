import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { loadAccountWaitlist } from '@/lib/account/account-waitlist';
import { NO_STORE_HEADERS } from '@/lib/api/error-codes';

/**
 * GET /api/account/waitlist - the places this customer is waiting for (P4-4).
 *
 * Scoped by the account's own verified email, because `waitlist_entries` has
 * no guest id: an entry is made before any booking exists, so the address the
 * customer typed is the only identity it carries.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createRouteHandlerClient(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorised', code: 'UNAUTHENTICATED' },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    const entries = await loadAccountWaitlist(getSupabaseAdminClient(), user.email);
    return NextResponse.json({ entries }, { headers: NO_STORE_HEADERS });
  } catch (e) {
    console.error('[account/waitlist]', e);
    return NextResponse.json(
      { error: 'Internal error', code: 'INTERNAL_ERROR' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
