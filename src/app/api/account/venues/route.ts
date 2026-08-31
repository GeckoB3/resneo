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
          /*
            The id of the RELATIONSHIP, which is what makes the marketing
            consent below writable rather than only readable.

            `PATCH /api/account/marketing-preferences` identifies a venue
            relationship by `guest_id`, and this route was the only way a
            native client could learn one. Without it the app could show a
            customer which venues may email them and then had to send them to
            the website to change it, which is a poor answer to "stop emailing
            me". The web page never noticed because it reads the guest rows
            server-side and already holds the ids.

            Safe to publish: `guests_account_safe` is `WHERE user_id =
            auth.uid()`, so these are the caller's own rows, and the PATCH
            route re-checks ownership by `user_id` before it writes. This hands
            out an id the caller could already act on, not a new capability.
          */
          guest_id: r.id,
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
