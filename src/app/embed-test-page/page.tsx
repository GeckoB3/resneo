import Script from 'next/script';
import { EMBED_IFRAME_DEFAULT_HEIGHT_PX } from '@/lib/embed/widget-frame';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { normalizePublicBaseUrl } from '@/lib/public-base-url';

const PLUS1_DEV_EMAIL = 'plus1@reserveni.com';

async function resolveVenueForEmbedTest(
  slugOverride?: string,
): Promise<{ slug: string; name: string; email: string } | null> {
  const admin = getSupabaseAdminClient();

  if (slugOverride?.trim()) {
    const { data: venue } = await admin
      .from('venues')
      .select('slug, name')
      .eq('slug', slugOverride.trim())
      .maybeSingle();
    if (!venue?.slug) return null;
    return { slug: venue.slug, name: venue.name, email: PLUS1_DEV_EMAIL };
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
    .select('slug, name')
    .eq('id', staff.venue_id)
    .maybeSingle();

  if (!venue?.slug) return null;

  return {
    slug: venue.slug,
    name: venue.name,
    email: (staff.email as string) ?? PLUS1_DEV_EMAIL,
  };
}

export default async function EmbedTestPage({
  searchParams,
}: {
  searchParams: Promise<{ slug?: string }>;
}) {
  const { slug: slugParam } = await searchParams;
  const venue = await resolveVenueForEmbedTest(slugParam);
  const origin = normalizePublicBaseUrl(process.env.NEXT_PUBLIC_BASE_URL);
  const resizeScriptSrc = `${origin}/embed/resize.js`;

  if (!venue) {
    return (
      <main className="min-h-screen bg-slate-50 px-6 py-16">
        <div className="mx-auto max-w-lg rounded-2xl border border-red-200 bg-white p-8 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Embed test — venue not found</h1>
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

  const embedUrl = `${origin}/embed/${venue.slug}`;
  const bookUrl = `${origin}/book/${venue.slug}`;
  const snippet = `<iframe src="${embedUrl}" width="100%" height="${EMBED_IFRAME_DEFAULT_HEIGHT_PX}" style="border:none;overflow:hidden;" scrolling="no" id="reserveni-widget"></iframe>
<script src="${resizeScriptSrc}"></script>`;

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-2xl space-y-8">
        <header className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Internal test</p>
          <h1 className="text-2xl font-bold text-slate-900">Embed widget test</h1>
          <p className="text-sm text-slate-600">
            Venue: <span className="font-medium text-slate-900">{venue.name}</span> (
            <span className="font-mono text-slate-800">{venue.slug}</span>) · Account{' '}
            <span className="font-mono text-slate-800">{venue.email}</span>
          </p>
          <p className="text-sm text-slate-500">
            Hosted page:{' '}
            <a href={bookUrl} className="text-brand-700 underline hover:text-brand-800">
              {bookUrl}
            </a>
          </p>
        </header>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg ring-1 ring-slate-900/5">
          <div className="border-b border-slate-100 bg-slate-50 px-4 py-2.5">
            <p className="text-xs font-medium text-slate-600">Live embed preview</p>
          </div>
          <div className="p-4">
            <iframe
              src={embedUrl}
              width="100%"
              height={EMBED_IFRAME_DEFAULT_HEIGHT_PX}
              style={{ border: 'none', overflow: 'hidden' }}
              scrolling="no"
              id="reserveni-widget"
              title={`ReserveNI booking widget — ${venue.name}`}
            />
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Embed snippet</h2>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs leading-relaxed text-slate-100">
            {snippet}
          </pre>
        </section>
      </div>

      <Script src={resizeScriptSrc} strategy="afterInteractive" />
    </main>
  );
}
