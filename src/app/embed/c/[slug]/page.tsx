import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { loadCollectivePageView } from '@/app/book/c/[slug]/collective-page-view';
import { EmbedBookingClient } from '@/app/embed/[venue-slug]/EmbedBookingClient';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The collective page's embed (plan §6.9, CB-06). `/book/c/{slug}` refuses to be framed; this path
 * sits under `/embed`, which any site may frame, and posts the same height messages as a venue's.
 */
export default async function CollectiveEmbedPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ accent?: string }>;
}) {
  const { slug } = await params;
  const { accent } = await searchParams;
  const view = await loadCollectivePageView(getSupabaseAdminClient(), slug);
  if (view.status === 'notfound') notFound();
  if (view.status !== 'live') {
    const name = view.status === 'dissolved' ? view.page.name : view.name;
    return (
      <main className="w-full bg-white px-3 py-6 text-center">
        <p className="text-sm font-semibold text-slate-900">{name}</p>
        <p className="mt-1 text-sm text-slate-600">Online booking is not available right now.</p>
      </main>
    );
  }
  const accentColour =
    typeof accent === 'string' && accent.trim() ? accent : view.venue.booking_page_config?.brand_primary ?? null;
  return <EmbedBookingClient venue={view.venue} accentColour={accentColour} />;
}
