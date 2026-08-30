import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { loadAccountSafeGuests } from '@/lib/account/account-bookings';
import { loadVenueNames } from '@/lib/account/account-venues';
import { NO_STORE_HEADERS } from '@/lib/api/error-codes';

/**
 * GET /api/account/venues - the customer's relationship with each venue (P5-1).
 *
 * `GET /api/account/profile` returns only `{profile, user}`, so the linked
 * guest rows, which is where marketing consent and the visit history live,
 * had no route at all. The profile page read them directly, which meant a
 * native client could not show a customer which venues they are known at.
 *
 * Read through `guests_account_safe` on the SESSION client, so the view's own
 * WHERE clause is what scopes it, and venue names are added from ids the
 * caller has already been shown.
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

    const relationships = await loadAccountSafeGuests(supabase);
    const names = await loadVenueNames(relationships.map((r) => r.venue_id));

    return NextResponse.json(
      {
        venues: relationships.map((r) => ({
          venue_id: r.venue_id,
          venue_name: names.get(r.venue_id) ?? null,
          first_booked_at: r.first_booked_at,
          last_booked_at: r.last_booked_at,
          total_bookings_count: r.total_bookings_count,
          marketing_consent: r.marketing_consent,
          marketing_consent_at: r.marketing_consent_at,
          marketing_opt_out: r.marketing_opt_out,
        })),
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (e) {
    console.error('[account/venues]', e);
    return NextResponse.json(
      { error: 'Internal error', code: 'INTERNAL_ERROR' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
