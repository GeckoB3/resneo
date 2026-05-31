import { notFound } from 'next/navigation';
import { getPublicVenueForBookBySlug } from '@/lib/booking/get-public-venue-for-book';
import { BookPublicLayout } from '@/components/booking/BookPublicLayout';
import { loadBookPublicLayoutData } from '@/lib/booking/load-book-public-layout-data';
import { getSupabaseAdminClient } from '@/lib/supabase';

export default async function BookPage({ params }: { params: Promise<{ 'venue-slug': string }> }) {
  const { 'venue-slug': slug } = await params;
  const venue = await getPublicVenueForBookBySlug(slug);
  if (!venue) notFound();

  const { services, team } = await loadBookPublicLayoutData(getSupabaseAdminClient(), venue);

  return <BookPublicLayout venue={venue} team={team} services={services} />;
}
