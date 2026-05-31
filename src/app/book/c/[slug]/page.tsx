import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { getPublicVenueForBookBySlug } from '@/lib/booking/get-public-venue-for-book';
import type { VenuePublic } from '@/components/booking/types';
import {
  loadPublicCollective,
  type PublicCollective,
} from '@/lib/linked-accounts/collectives';
import { CollectiveBookingFlow } from './CollectiveBookingFlow';

export const dynamic = 'force-dynamic';

function accentColour(collective: PublicCollective): string {
  const c = collective.branding.primary_colour;
  return c && /^#[0-9A-Fa-f]{6}$/.test(c) ? c : '#003B6F';
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const admin = getSupabaseAdminClient();
  const collective = await loadPublicCollective(admin, slug);
  if (!collective) return { title: 'Booking page not found' };
  return {
    title: `${collective.name} — Book online`,
    description:
      collective.branding.description ??
      `Book with the venues of the ${collective.name} collective.`,
  };
}

export default async function CollectiveBookingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const admin = getSupabaseAdminClient();
  const collective = await loadPublicCollective(admin, slug);
  if (!collective) notFound();

  const accent = accentColour(collective);

  // Load each member venue's public booking dataset so the chosen venue's
  // normal booking flow can be mounted in-page (§7.1). Members whose booking
  // page is not live are simply not bookable from the combined page.
  const memberVenues: Record<string, VenuePublic> = {};
  await Promise.all(
    collective.members.map(async (m) => {
      const venue = await getPublicVenueForBookBySlug(m.venueSlug);
      if (venue) memberVenues[m.venueId] = venue;
    }),
  );

  return (
    <div className="min-h-[100dvh] bg-slate-50">
      <header className="px-4 py-10 text-white sm:py-14" style={{ backgroundColor: accent }}>
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 text-center">
          {collective.branding.logo_url ? (
            <img
              src={collective.branding.logo_url}
              alt={collective.name}
              className="h-16 w-16 rounded-full bg-white object-contain p-1"
            />
          ) : null}
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{collective.name}</h1>
          {collective.branding.description ? (
            <p className="max-w-xl text-sm text-white/90">{collective.branding.description}</p>
          ) : null}
          <p className="text-xs text-white/70">
            {collective.members.length} venues · one place to book
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        <CollectiveBookingFlow
          collective={collective}
          memberVenues={memberVenues}
          accent={accent}
        />
        <p className="pt-2 text-center text-xs text-slate-400">
          Each venue manages its own bookings and client data. Powered by Resneo.
        </p>
      </main>
    </div>
  );
}
