import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { collectivePageMetadata } from '@/lib/booking/booking-page-metadata';
import {
  loadCollectivePageView,
  CollectiveUnavailable,
  CollectivePageBody,
  DissolvedCollectivePage,
} from './collective-page-view';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  // §16.1 #11: metadata is read-only. `loadCollectivePageView` runs a reconcile, so the page body
  // owns that and this pass reads (D48, SEO-01).
  return collectivePageMetadata(getSupabaseAdminClient(), slug);
}

export default async function CollectiveBookingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const view = await loadCollectivePageView(getSupabaseAdminClient(), slug);
  if (view.status === 'notfound') notFound();
  if (view.status === 'dissolved') return <DissolvedCollectivePage page={view.page} />;
  if (view.status === 'unavailable') {
    return <CollectiveUnavailable name={view.name} branding={view.branding} />;
  }
  return <CollectivePageBody view={view} />;
}
