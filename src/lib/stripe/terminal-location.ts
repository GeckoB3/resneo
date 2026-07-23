import type { SupabaseClient } from '@supabase/supabase-js';
import { stripe } from '@/lib/stripe';

/**
 * §6.1 — lazily provision the Stripe Terminal Location a venue's readers
 * (Tap to Pay and Bluetooth alike) connect through. Created once on the
 * venue's CONNECTED account and cached on `venues.stripe_terminal_location_id`.
 *
 * `venues.address` is a single free-text column, so the whole string goes into
 * `line1` (Stripe requires only line1 + country for GB Locations; the address
 * is used for fleet management, not payment routing).
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
      address: {
        line1: (venue.address?.trim() || 'Unknown').slice(0, 200),
        country: 'GB',
      },
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
