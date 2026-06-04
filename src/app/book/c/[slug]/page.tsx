import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { getPublicVenueForBookBySlug } from '@/lib/booking/get-public-venue-for-book';
import type { VenuePublic } from '@/components/booking/types';
import {
  loadCollectiveBrandingBySlug,
  loadPublicCollective,
  type CollectiveBranding,
  type PublicCollective,
} from '@/lib/linked-accounts/collectives';
import { readableAccentForWhiteText } from '@/lib/linked-accounts/branding-contrast';
import { CollectiveBookingFlow } from './CollectiveBookingFlow';

export const dynamic = 'force-dynamic';

/**
 * The header paints this colour behind white text and a white logo chip, so we
 * auto-darken a too-light host choice until white text clears WCAG AA (§19.4)
 * rather than rejecting the colour outright.
 */
function accentFromBranding(branding: CollectiveBranding): string {
  return readableAccentForWhiteText(branding.primary_colour, '#003B6F');
}

function accentColour(collective: PublicCollective): string {
  return accentFromBranding(collective.branding);
}

/** §19.3 — a branded "not available" state for a known-but-not-live collective. */
function CollectiveUnavailable({ name, branding }: { name: string; branding: CollectiveBranding }) {
  const accent = accentFromBranding(branding);
  return (
    <div className="min-h-[100dvh] bg-slate-50">
      <header className="px-4 py-10 text-white sm:py-14" style={{ backgroundColor: accent }}>
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 text-center">
          {branding.logo_url ? (
            <img
              src={branding.logo_url}
              alt={name}
              className="h-16 w-16 rounded-full bg-white object-contain p-1"
            />
          ) : null}
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{name}</h1>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-12 text-center">
        <p className="text-lg font-semibold text-slate-900">
          This combined booking page isn’t available right now.
        </p>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
          The collective may have changed or paused. Each venue still takes bookings on its own
          page — please contact the venue you’d like to book with directly.
        </p>
      </main>
    </div>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const admin = getSupabaseAdminClient();
  // §16.1 #11 — metadata must be read-only. `loadPublicCollective` runs a
  // reconcile (a write that can dissolve), so the page body owns that single
  // reconcile and the metadata pass uses a plain read instead.
  const known = await loadCollectiveBrandingBySlug(admin, slug);
  if (!known) return { title: 'Booking page not found' };
  if (known.status !== 'active') return { title: known.name };
  return {
    title: `${known.name} — Book online`,
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
  const admin = getSupabaseAdminClient();
  const collective = await loadPublicCollective(admin, slug);
  if (!collective) {
    // §19.3 — distinguish "exists but not live" (branded notice) from a true 404.
    const known = await loadCollectiveBrandingBySlug(admin, slug);
    if (!known) notFound();
    return <CollectiveUnavailable name={known.name} branding={known.branding} />;
  }

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
