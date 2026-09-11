import type { SupabaseClient } from '@supabase/supabase-js';
import { loadCollectiveBookingLinksForVenue } from '@/lib/linked-accounts/collectives';
import { venueBookingPageUrl } from '@/lib/emails/venue-email-data';
import { normalizePublicBaseUrl } from '@/lib/public-base-url';

/**
 * The address a "Book again" button should open for a venue.
 *
 * A venue in a live combined collective sends the customer to the combined page
 * (its dedicated `/book/c/{slug}`, or the member address it adopted), because that
 * is the page the venue chose to be booked through. Otherwise the venue's own
 * `/book/{slug}`. Null only when the venue has no slug at all.
 *
 * The collective lookup is best effort: a failure there must never cost the
 * customer the venue link, so it falls back to the solo page.
 */
export async function resolveVenueBookingPageUrl(
  admin: SupabaseClient,
  venue: { id: string; slug?: string | null },
): Promise<string | null> {
  try {
    const links = await loadCollectiveBookingLinksForVenue(admin, venue.id);
    const first = links[0]?.url?.trim();
    if (first) return `${normalizePublicBaseUrl(process.env.NEXT_PUBLIC_BASE_URL)}${first}`;
  } catch (err) {
    console.error('[resolveVenueBookingPageUrl] collective lookup failed, using solo page', { venueId: venue.id, err });
  }
  return venueBookingPageUrl(venue.slug);
}
