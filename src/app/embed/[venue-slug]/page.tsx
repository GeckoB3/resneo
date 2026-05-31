import { notFound } from 'next/navigation';
import { getPublicVenueForBookBySlug } from '@/lib/booking/get-public-venue-for-book';
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

  const venue = await getPublicVenueForBookBySlug(slug);
  if (!venue) notFound();

  // Explicit ?accent= wins; otherwise fall back to the booking page's brand colour so the
  // embedded widget matches the venue's branding by default.
  const effectiveAccent =
    typeof accent === 'string' && accent.trim()
      ? accent
      : venue.booking_page_config?.brand_primary ?? null;

  return <EmbedBookingClient venue={venue} accentColour={effectiveAccent} />;
}
