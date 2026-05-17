import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getSupabaseAdminClient } from '@/lib/supabase';
import {
  loadPublicCollective,
  type PublicCollective,
} from '@/lib/linked-accounts/collectives';

export const dynamic = 'force-dynamic';

function accentColour(collective: PublicCollective): string {
  const c = collective.branding.primary_colour;
  return c && /^#[0-9A-Fa-f]{6}$/.test(c) ? c : '#4E6B78';
}

function formatPrice(pence: number | null): string {
  if (pence == null) return '';
  return `£${(pence / 100).toFixed(2)}`;
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

  return (
    <div className="min-h-[100dvh] bg-slate-50">
      {/* Branding header */}
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
        {collective.allowAnyPractitioner ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-bold text-slate-900">
              No preference? Book with any available practitioner
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Several venues in {collective.name} offer the same services. Pick whichever venue
              below has a time that suits you — you can browse each venue&rsquo;s live availability
              from its booking page.
            </p>
          </section>
        ) : null}

        {collective.serviceGrouping === 'by_service_type' ? (
          <ServiceTypeView collective={collective} accent={accent} />
        ) : (
          <PractitionerView collective={collective} accent={accent} />
        )}

        <p className="pt-2 text-center text-xs text-slate-400">
          Each venue manages its own bookings and client data. Powered by ReserveNI.
        </p>
      </main>
    </div>
  );
}

function bookButton(href: string, accent: string, label: string) {
  return (
    <a
      href={href}
      className="inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-xs font-semibold text-white shadow-sm"
      style={{ backgroundColor: accent }}
    >
      {label}
    </a>
  );
}

function PractitionerView({
  collective,
  accent,
}: {
  collective: PublicCollective;
  accent: string;
}) {
  return (
    <div className="space-y-4">
      {collective.members.map((m) => (
        <section
          key={m.venueId}
          className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-bold text-slate-900">{m.venueName}</h2>
            {bookButton(`/book/${m.venueSlug}`, accent, 'Book at this venue')}
          </div>
          {m.practitioners.length > 0 ? (
            <ul className="mt-3 divide-y divide-slate-100">
              {m.practitioners.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="text-sm text-slate-700">{p.name}</span>
                  {bookButton(
                    p.slug ? `/book/${m.venueSlug}/${p.slug}` : `/book/${m.venueSlug}`,
                    accent,
                    'Book',
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-slate-500">
              Browse this venue&rsquo;s booking page for available times.
            </p>
          )}
        </section>
      ))}
    </div>
  );
}

function ServiceTypeView({
  collective,
  accent,
}: {
  collective: PublicCollective;
  accent: string;
}) {
  // Group services by lower-cased name across all member venues.
  const groups = new Map<
    string,
    { name: string; offers: { venueName: string; venueSlug: string; price: number | null }[] }
  >();
  for (const m of collective.members) {
    for (const s of m.services) {
      const key = s.name.toLowerCase().trim();
      const group = groups.get(key) ?? { name: s.name, offers: [] };
      group.offers.push({
        venueName: m.venueName,
        venueSlug: m.venueSlug,
        price: s.pricePence,
      });
      groups.set(key, group);
    }
  }
  const sorted = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));

  if (sorted.length === 0) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm">
        No services are currently published for this collective.
      </section>
    );
  }

  return (
    <div className="space-y-4">
      {sorted.map((group) => (
        <section
          key={group.name}
          className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <h2 className="text-base font-bold text-slate-900">{group.name}</h2>
          <ul className="mt-3 divide-y divide-slate-100">
            {group.offers.map((offer) => (
              <li
                key={`${group.name}-${offer.venueSlug}`}
                className="flex items-center justify-between gap-2 py-2"
              >
                <span className="text-sm text-slate-700">
                  {offer.venueName}
                  {offer.price != null ? (
                    <span className="ml-2 text-xs text-slate-500">
                      {formatPrice(offer.price)}
                    </span>
                  ) : null}
                </span>
                {bookButton(`/book/${offer.venueSlug}`, accent, 'Book')}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
