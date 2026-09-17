import type { SupabaseClient } from '@supabase/supabase-js';
import { loadCollectiveBookingLinksForVenue } from '@/lib/linked-accounts/collectives';
import { venueBookingPageUrl } from '@/lib/emails/venue-email-data';
import { normalizePublicBaseUrl } from '@/lib/public-base-url';
import { resolveOwnPageHandover } from '@/lib/linked-accounts/replicas/page-handover';

/**
 * The address a "Book again" button should open for a venue.
 *
 * A venue in a live combined collective sends the customer to the combined page
 * (its dedicated `/book/c/{slug}`, or the member address it adopted), because that
 * is the page the venue chose to be booked through. Otherwise the venue's own
 * `/book/{slug}`. Null only when the venue has no slug at all.
 *
 * On a shared-services collective the answer is the same derived rule the page itself follows
 * (§6.9, SB-19): the collective page only while the venue's own page hands over to it, so a link
 * never lands on a page that cannot show the venue. The collective page opens on its service list,
 * which is where a parked service's customer should land too (D2).
 *
 * The collective lookup is best effort: a failure there must never cost the
 * customer the venue link, so it falls back to the solo page.
 */
export async function resolveVenueBookingPageUrl(
  admin: SupabaseClient,
  venue: { id: string; slug?: string | null },
): Promise<string | null> {
  try {
    const handover = await resolveOwnPageHandover(admin, venue.id);
    if (handover) {
      return handover.redirect
        ? `${normalizePublicBaseUrl(process.env.NEXT_PUBLIC_BASE_URL)}${handover.publicPath}`
        : venueBookingPageUrl(venue.slug);
    }
    const links = await loadCollectiveBookingLinksForVenue(admin, venue.id);
    const first = links[0]?.url?.trim();
    if (first) return `${normalizePublicBaseUrl(process.env.NEXT_PUBLIC_BASE_URL)}${first}`;
  } catch (err) {
    console.error('[resolveVenueBookingPageUrl] collective lookup failed, using solo page', { venueId: venue.id, err });
  }
  return venueBookingPageUrl(venue.slug);
}
