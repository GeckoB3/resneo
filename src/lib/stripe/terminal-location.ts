import type { SupabaseClient } from '@supabase/supabase-js';
import { stripe } from '@/lib/stripe';

/** Trailing UK postcode in a free-text address, e.g. "BT1 5GS" / "EC1A 1BB". */
const UK_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

/**
 * Split a venue's single free-text address into the fields Stripe requires for a
 * **GB** Terminal Location.
 *
 * Stripe rejects a GB Location with no `address[city]`:
 *   "Missing required address field for a Location in GB: address[city]"
 * An earlier version of this file sent only `line1` + `country`, asserting that
 * was sufficient for GB. It is not — and because the Location is provisioned
 * lazily on the first connection-token request, that one missing field failed
 * EVERY token and took down the whole in-person payment surface at the first tap,
 * surfacing to staff as the misleading "This venue isn't enabled for in-person
 * card payments yet."
 *
 * `venues.address` is one free-text column, so there is nothing structured to
 * read. UK addresses conventionally end "…, <town>, <postcode>", so a trailing
 * postcode is peeled off and the last remaining segment taken as the city.
 * Anything undeterminable falls back to 'Unknown' rather than being guessed: a
 * Location's address is bookkeeping for reader-fleet management, not payment
 * routing or tax, so an imprecise value is harmless where an invented city is
 * not worth the risk.
 */
export function parseVenueAddressForLocation(address: string | null | undefined): {
  line1: string;
  city: string;
  postal_code?: string;
} {
  const parts = (address ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  let postal: string | undefined;
  if (parts.length > 0 && UK_POSTCODE.test(parts[parts.length - 1])) {
    postal = parts.pop();
  }

  // Only treat a segment as the city when something else can serve as line1: a
  // one-line address is more useful as the street than as a bare city.
  const city = parts.length > 1 ? (parts.pop() as string) : null;
  const line1 = parts.join(', ');

  return {
    line1: (line1 || city || 'Unknown').slice(0, 200),
    city: (city || 'Unknown').slice(0, 100),
    ...(postal ? { postal_code: postal.slice(0, 20) } : {}),
  };
}

/**
 * §6.1 — lazily provision the Stripe Terminal Location a venue's readers
 * (Tap to Pay and Bluetooth alike) connect through. Created once on the
 * venue's CONNECTED account and cached on `venues.stripe_terminal_location_id`.
 */
export async function ensureTerminalLocation(
  admin: SupabaseClient,
  venueId: string,
  connectedAccountId: string,
): Promise<string> {
  const { data: venueData, error: venueErr } = await admin
    .from('venues')
    .select('name, address, stripe_terminal_location_id')
    .eq('id', venueId)
    .maybeSingle();
  if (venueErr) {
    console.error('[terminal-location] venue load failed:', venueErr.message, { venueId });
    throw venueErr;
  }
  const venue = venueData as
    | { name: string | null; address: string | null; stripe_terminal_location_id: string | null }
    | null;
  if (!venue) throw new Error(`Venue ${venueId} not found`);
  if (venue.stripe_terminal_location_id) return venue.stripe_terminal_location_id;

  const location = await stripe.terminal.locations.create(
    {
      display_name: (venue.name ?? 'Venue').slice(0, 100),
      address: { ...parseVenueAddressForLocation(venue.address), country: 'GB' },
    },
    { stripeAccount: connectedAccountId },
  );

  const { error: saveErr } = await admin
    .from('venues')
    .update({ stripe_terminal_location_id: location.id })
    .eq('id', venueId)
    // Guard a concurrent provision: first writer wins, and losing the race is
    // harmless (both Locations are valid; only one gets cached and reused).
    .is('stripe_terminal_location_id', null);
  if (saveErr) {
    console.error('[terminal-location] location id persist failed:', saveErr.message, { venueId });
    throw saveErr;
  }

  return location.id;
}
