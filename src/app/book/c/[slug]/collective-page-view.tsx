/**
 * Shared server rendering for the public combined booking page (plan §22). The
 * collective is presented as ONE venue: we build a synthetic `VenuePublic` + a
 * merged catalogue and render the STANDARD `BookPublicLayout`, so the customer
 * experience is identical to a single venue. Used both at `/book/c/{slug}` and —
 * when a collective adopts a member's slug — at `/book/{venue-slug}`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { VenuePublic } from '@/components/booking/types';
import type { BookingPagePublicService } from '@/lib/booking/booking-page-tabs';
import {
  loadCollectiveBrandingBySlug,
  loadPublicCollective,
  type CollectiveBranding,
} from '@/lib/linked-accounts/collectives';
import {
  loadCollectiveVenuePublic,
  loadCollectivePublicServices,
  loadCollectiveTeam,
} from '@/lib/linked-accounts/collective-venue';
import { readableAccentForWhiteText } from '@/lib/linked-accounts/branding-contrast';
import { BookPublicLayout } from '@/components/booking/BookPublicLayout';

export function accentFromBranding(branding: CollectiveBranding): string {
  return readableAccentForWhiteText(branding.primary_colour, '#003B6F');
}

export type CollectivePageView =
  | { status: 'notfound' }
  | { status: 'unavailable'; name: string; branding: CollectiveBranding }
  | {
      status: 'live';
      venue: VenuePublic;
      services: BookingPagePublicService[];
      team: Array<{ id: string; name: string }>;
    };

/**
 * Assemble the synthetic single-venue dataset for a collective slug. Runs the
 * single reconcile + ≥2-eligible-members gate (via `loadPublicCollective`), then
 * builds the virtual venue + merged catalogue/team for the standard layout.
 */
export async function loadCollectivePageView(
  admin: SupabaseClient,
  slug: string,
): Promise<CollectivePageView> {
  // Gate: reconcile + require ≥2 currently-eligible members (returns null otherwise).
  const collective = await loadPublicCollective(admin, slug);
  if (!collective) {
    const known = await loadCollectiveBrandingBySlug(admin, slug);
    if (!known) return { status: 'notfound' };
    return { status: 'unavailable', name: known.name, branding: known.branding };
  }

  const venue = await loadCollectiveVenuePublic(admin, collective.id);
  if (!venue || venue.booking_paused) {
    // No bookable offerings yet (host hasn't built the catalogue) → branded notice.
    const known = await loadCollectiveBrandingBySlug(admin, slug);
    return {
      status: 'unavailable',
      name: known?.name ?? collective.name,
      branding: known?.branding ?? collective.branding,
    };
  }

  const [services, team] = await Promise.all([
    loadCollectivePublicServices(admin, collective.id, venue.booking_page_config),
    loadCollectiveTeam(admin, collective.id),
  ]);
  return { status: 'live', venue, services, team };
}

/** §19.3 — branded "not available" state for a known-but-not-live collective. */
export function CollectiveUnavailable({
  name,
  branding,
}: {
  name: string;
  branding: CollectiveBranding;
}) {
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
          This booking page isn’t available right now.
        </p>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
          It may be being set up or paused. Please check back soon, or contact the venue directly.
        </p>
      </main>
    </div>
  );
}

/** The live combined page — the standard single-venue layout over the virtual venue. */
export function CollectivePageBody({
  view,
}: {
  view: Extract<CollectivePageView, { status: 'live' }>;
}) {
  return <BookPublicLayout venue={view.venue} team={view.team} services={view.services} />;
}
