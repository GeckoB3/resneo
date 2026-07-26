import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { loadCollectiveBrandingBySlug } from '@/lib/linked-accounts/collectives';
import {
  loadCollectivePageView,
  CollectiveUnavailable,
  CollectivePageBody,
} from './collective-page-view';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const admin = getSupabaseAdminClient();
  // §16.1 #11 — metadata must be read-only. `loadCollectivePageView` runs a
  // reconcile (a write that can dissolve), so the page body owns that single
  // reconcile and the metadata pass uses a plain read instead.
  const known = await loadCollectiveBrandingBySlug(admin, slug);
  if (!known) return { title: 'Booking page not found' };
  if (known.status !== 'active') return { title: known.name };
  return {
    title: `${known.name}: Book online`,
    description:
      known.branding.description ?? `Book with the venues of the ${known.name} collective.`,
  };
}

export default async function CollectiveBookingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const view = await loadCollectivePageView(getSupabaseAdminClient(), slug);
  if (view.status === 'notfound') notFound();
  if (view.status === 'unavailable') {
    return <CollectiveUnavailable name={view.name} branding={view.branding} />;
  }
  return <CollectivePageBody view={view} />;
}
