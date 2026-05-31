import { notFound } from 'next/navigation';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { getPublicVenueForBookBySlug } from '@/lib/booking/get-public-venue-for-book';
import { isUnifiedSchedulingVenue } from '@/lib/booking/unified-scheduling';
import { BookPublicLayout } from '@/components/booking/BookPublicLayout';
import { loadBookPublicLayoutData } from '@/lib/booking/load-book-public-layout-data';
import type { LockedPractitionerBooking } from '@/components/booking/BookingFlowRouter';

async function getActivePractitionerForBook(
  venueId: string,
  practitionerSlugSegment: string,
): Promise<LockedPractitionerBooking | null> {
  const norm = practitionerSlugSegment.trim().toLowerCase();
  if (!norm) return null;

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from('unified_calendars')
    .select('id, name, is_active, slug')
    .eq('venue_id', venueId)
    .eq('slug', norm)
    .maybeSingle();

  if (error || !data || !data.is_active) return null;
  const bookingSlug = typeof data.slug === 'string' && data.slug ? data.slug : norm;
  return { id: data.id, name: data.name, bookingSlug };
}

export default async function BookPractitionerPage({
  params,
}: {
  params: Promise<{ 'venue-slug': string; 'practitioner-slug': string }>;
}) {
  const { 'venue-slug': venueSlug, 'practitioner-slug': practitionerSlug } = await params;
  const venue = await getPublicVenueForBookBySlug(venueSlug);
  if (!venue) notFound();
  if (!isUnifiedSchedulingVenue(venue.booking_model)) notFound();

  const lockedPractitioner = await getActivePractitionerForBook(venue.id, practitionerSlug);
  if (!lockedPractitioner) notFound();

  const { services, team } = await loadBookPublicLayoutData(getSupabaseAdminClient(), venue);

  return (
    <BookPublicLayout venue={venue} lockedPractitioner={lockedPractitioner} team={team} services={services} />
  );
}
