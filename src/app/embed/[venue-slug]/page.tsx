import { notFound } from 'next/navigation';
import { getPublicVenueForBookBySlug } from '@/lib/booking/get-public-venue-for-book';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { resolveOwnPageHandover } from '@/lib/linked-accounts/replicas/page-handover';
import { loadCollectivePageView } from '@/app/book/c/[slug]/collective-page-view';
import { EmbedBookingClient } from './EmbedBookingClient';

export default async function EmbedPage({
  params,
  searchParams,
}: {
  params: Promise<{ 'venue-slug': string }>;
  searchParams: Promise<{ accent?: string }>;
}) {
  const { 'venue-slug': slug } = await params;
  const { accent } = await searchParams;
  if (!slug || typeof slug !== 'string') notFound();

  let venue = await getPublicVenueForBookBySlug(slug);
  if (!venue) notFound();

  // Explicit ?accent= wins; otherwise fall back to the booking page's brand colour so the
  // embedded widget matches the venue's branding by default.
  const accentFor = (fallback: string | null | undefined) =>
    typeof accent === 'string' && accent.trim() ? accent : fallback ?? null;

  // §6.9: while the venue's page hands over, its embed shows the collective's in place (a redirect
  // inside a host site's frame would lose the frame). Other booking types keep this embed, with a
  // card for appointments.
  const admin = getSupabaseAdminClient();
  const handover = await resolveOwnPageHandover(admin, venue.id);
  if (handover?.redirect) {
    if (!handover.otherModels) {
      const view = await loadCollectivePageView(admin, handover.collectiveSlug);
      if (view.status === 'live') {
        return <EmbedBookingClient venue={view.venue} accentColour={accentFor(view.venue.booking_page_config?.brand_primary)} />;
      }
    } else {
      venue = {
        ...venue,
        appointments_handover: { collective_name: handover.collectiveName, href: handover.publicPath },
      };
    }
  }

  return <EmbedBookingClient venue={venue} accentColour={accentFor(venue.booking_page_config?.brand_primary)} />;
}
