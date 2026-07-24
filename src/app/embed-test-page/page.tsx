import type { Metadata } from 'next';
import { buildVenueEmbedSnippet, normalizeEmbedAccentHex } from '@/lib/embed/accent-colour';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { normalizePublicBaseUrl } from '@/lib/public-base-url';
import { EmbedTestSalonSite } from './EmbedTestSalonSite';

/**
 * The demo venue's owner. Tried in order: the account predates the Reserve NI
 * to ResNeo rename, and which domain is on it differs between environments, so
 * checking both keeps the page working either way instead of silently falling
 * through to "venue not found".
 */
const PLUS1_EMAILS = ['plus1@reserveni.com', 'plus1@resneo.com'] as const;

/**
 * Last resort: the plus1 venue's slug in production. Used when no staff row
 * matches either email (for example if the owner's address changes again).
 */
const PLUS1_FALLBACK_SLUG = 'live-plus';

/**
 * Demo salon site used to show prospective customers what the ResNeo booking
 * widget looks like embedded in a real website. "Aura Hair Studio" is
 * fictional; the widget itself is the live one for the venue resolved below,
 * so everything in it (services, staff, availability, accent colour) is real.
 *
 * Deliberately kept out of search: `noindex` here, plus `/embed-test-page` in
 * the robots.ts disallow list. Direct links still work fine.
 * Pass `?debug=1` for the developer panel, `?slug=` / `?accent=` to override.
 */
export const metadata: Metadata = {
  title: 'Aura Hair Studio | Hair, colour, and styling in Belfast',
  description:
    'A demonstration salon website showing the ResNeo booking widget embedded in a live page.',
  robots: { index: false, follow: false },
};

type ResolvedVenue = {
  slug: string;
  name: string;
  email: string;
  embedAccentColour: string | null;
};

type VenueRow = { slug: string; name: string; embed_accent_colour?: string | null };

function toResolvedVenue(venue: VenueRow, email: string): ResolvedVenue {
  return {
    slug: venue.slug,
    name: venue.name,
    email,
    embedAccentColour: normalizeEmbedAccentHex(venue.embed_accent_colour),
  };
}

async function venueBySlug(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  slug: string,
): Promise<VenueRow | null> {
  const { data } = await admin
    .from('venues')
    .select('slug, name, embed_accent_colour')
    .eq('slug', slug)
    .maybeSingle();
  return (data as VenueRow | null)?.slug ? (data as VenueRow) : null;
}

/**
 * Find the venue whose live widget the demo embeds. In order:
 * an explicit `?slug=`, then the plus1 owner under either email domain, then
 * the known production slug.
 */
async function resolveVenueForEmbedTest(slugOverride?: string): Promise<ResolvedVenue | null> {
  const admin = getSupabaseAdminClient();

  if (slugOverride?.trim()) {
    const venue = await venueBySlug(admin, slugOverride.trim());
    return venue ? toResolvedVenue(venue, PLUS1_EMAILS[0]) : null;
  }

  for (const email of PLUS1_EMAILS) {
    const { data: staff } = await admin
      .from('staff')
      .select('venue_id, email')
      .ilike('email', email)
      .limit(1)
      .maybeSingle();
    if (!staff?.venue_id) continue;

    const { data: venue } = await admin
      .from('venues')
      .select('slug, name, embed_accent_colour')
      .eq('id', staff.venue_id)
      .maybeSingle();
    const row = venue as VenueRow | null;
    if (row?.slug) return toResolvedVenue(row, (staff.email as string) ?? email);
  }

  const fallback = await venueBySlug(admin, PLUS1_FALLBACK_SLUG);
  return fallback ? toResolvedVenue(fallback, PLUS1_EMAILS[0]) : null;
}

export default async function EmbedTestPage({
  searchParams,
}: {
  searchParams: Promise<{ slug?: string; accent?: string; debug?: string }>;
}) {
  const { slug: slugParam, accent: accentParam, debug: debugParam } = await searchParams;
  const venue = await resolveVenueForEmbedTest(slugParam);
  const origin = normalizePublicBaseUrl(process.env.NEXT_PUBLIC_BASE_URL);

  if (!venue) {
    return (
      <main className="min-h-screen bg-[#f7f4f0] px-6 py-16">
        <div className="mx-auto max-w-lg rounded-2xl border border-red-200 bg-white p-8 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Salon demo: venue not found</h1>
          {slugParam ? (
            <p className="mt-3 text-sm text-slate-600">
              No venue has the slug{' '}
              <span className="font-mono text-slate-800">{slugParam}</span> in this environment.
            </p>
          ) : (
            <p className="mt-3 text-sm text-slate-600">
              No venue found for{' '}
              <span className="font-mono text-slate-800">{PLUS1_EMAILS.join(' or ')}</span>, and
              nothing has the slug{' '}
              <span className="font-mono text-slate-800">{PLUS1_FALLBACK_SLUG}</span>. That is
              expected on a local database that does not carry the demo venue.
            </p>
          )}
          <p className="mt-3 text-sm text-slate-600">
            Pass <span className="font-mono">?slug=your-venue-slug</span> to point the demo at any
            venue in this environment.
          </p>
        </div>
      </main>
    );
  }

  const accentOverride = normalizeEmbedAccentHex(
    typeof accentParam === 'string' ? accentParam : undefined,
  );
  const accentHex = accentOverride ?? venue.embedAccentColour;
  const { embedUrl, snippet } = buildVenueEmbedSnippet({
    baseUrl: origin,
    venueSlug: venue.slug,
    accentHex,
  });
  const bookUrl = `${origin.replace(/\/$/, '')}/book/${venue.slug}`;
  const resizeScriptSrc = `${origin.replace(/\/$/, '')}/embed/resize.js`;

  return (
    <EmbedTestSalonSite
      venueName={venue.name}
      venueSlug={venue.slug}
      embedUrl={embedUrl}
      resizeScriptSrc={resizeScriptSrc}
      bookUrl={bookUrl}
      snippet={snippet}
      accentHex={accentHex}
      showDeveloperPanel={debugParam === '1'}
    />
  );
}
