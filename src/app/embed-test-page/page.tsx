import type { Metadata } from 'next';
import { buildVenueEmbedSnippet, normalizeEmbedAccentHex } from '@/lib/embed/accent-colour';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { normalizePublicBaseUrl } from '@/lib/public-base-url';
import { EmbedTestSalonSite } from './EmbedTestSalonSite';

const PLUS1_DEV_EMAIL = 'plus1@resneo.com';

export const metadata: Metadata = {
  title: 'Book online | Salon embed preview',
  description: 'Preview how the Reserve NI booking widget looks on a hair salon website.',
  robots: { index: false, follow: false },
};

async function resolveVenueForEmbedTest(
  slugOverride?: string,
): Promise<{ slug: string; name: string; email: string; embedAccentColour: string | null } | null> {
  const admin = getSupabaseAdminClient();

  if (slugOverride?.trim()) {
    const { data: venue } = await admin
      .from('venues')
      .select('slug, name, embed_accent_colour')
      .eq('slug', slugOverride.trim())
      .maybeSingle();
    if (!venue?.slug) return null;
    return {
      slug: venue.slug,
      name: venue.name,
      email: PLUS1_DEV_EMAIL,
      embedAccentColour: normalizeEmbedAccentHex(
        (venue as { embed_accent_colour?: string | null }).embed_accent_colour,
      ),
    };
  }

  const { data: staff } = await admin
    .from('staff')
    .select('venue_id, email')
    .ilike('email', PLUS1_DEV_EMAIL)
    .limit(1)
    .maybeSingle();

  if (!staff?.venue_id) return null;

  const { data: venue } = await admin
    .from('venues')
    .select('slug, name, embed_accent_colour')
    .eq('id', staff.venue_id)
    .maybeSingle();

  if (!venue?.slug) return null;

  return {
    slug: venue.slug,
    name: venue.name,
    email: (staff.email as string) ?? PLUS1_DEV_EMAIL,
    embedAccentColour: normalizeEmbedAccentHex(
      (venue as { embed_accent_colour?: string | null }).embed_accent_colour,
    ),
  };
}

export default async function EmbedTestPage({
  searchParams,
}: {
  searchParams: Promise<{ slug?: string; accent?: string }>;
}) {
  const { slug: slugParam, accent: accentParam } = await searchParams;
  const venue = await resolveVenueForEmbedTest(slugParam);
  const origin = normalizePublicBaseUrl(process.env.NEXT_PUBLIC_BASE_URL);

  if (!venue) {
    return (
      <main className="min-h-screen bg-[#f7f4f0] px-6 py-16">
        <div className="mx-auto max-w-lg rounded-2xl border border-red-200 bg-white p-8 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Salon preview — venue not found</h1>
          <p className="mt-3 text-sm text-slate-600">
            No venue found for <span className="font-mono text-slate-800">{PLUS1_DEV_EMAIL}</span>
            {slugParam ? (
              <>
                {' '}
                or slug <span className="font-mono text-slate-800">{slugParam}</span>
              </>
            ) : null}
            . Run the dev seed or pass <span className="font-mono">?slug=your-venue-slug</span>.
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
    />
  );
}
