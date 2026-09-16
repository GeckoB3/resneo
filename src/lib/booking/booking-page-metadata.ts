/**
 * Metadata for the public booking pages (plan D48, PB-17, SB-37; UX spec `public.meta.*`; tests
 * SEO-01, SEO-02; W19).
 *
 * Every `/book` route gets its own title, description, Open Graph card and canonical. The
 * collective page is canonical for itself and for any venue address it has adopted, so search
 * engines see one page, not two copies. A venue page whose appointments hand over to its collective
 * points its canonical there too; its own page stays canonical while it shows. Reads only: a
 * metadata pass must never write.
 */
import type { Metadata } from 'next';
import type { SupabaseClient } from '@supabase/supabase-js';
import { collectiveCopy } from '@/lib/linked-accounts/collective-copy';
import { resolveOwnPageHandover } from '@/lib/linked-accounts/replicas/page-handover';

type Row = Record<string, unknown>;

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** A description that reads well in a search result: one line, at most about 160 characters. */
export function metaDescription(raw: string): string {
  const flat = raw.replace(/\s+/g, ' ').trim();
  if (flat.length <= 160) return flat;
  const cut = flat.slice(0, 157);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 100 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function card(params: {
  title: string;
  description: string;
  canonical: string;
  image: string | null;
  index: boolean;
}): Metadata {
  const images = params.image ? [{ url: params.image }] : undefined;
  return {
    title: params.title,
    description: params.description,
    alternates: { canonical: params.canonical },
    openGraph: {
      type: 'website',
      title: params.title,
      description: params.description,
      url: params.canonical,
      siteName: 'ResNeo',
      ...(images ? { images } : {}),
    },
    twitter: {
      card: images ? 'summary_large_image' : 'summary',
      title: params.title,
      description: params.description,
      ...(images ? { images: images.map((i) => i.url) } : {}),
    },
    robots: params.index ? { index: true, follow: true } : { index: false, follow: true },
  };
}

/** `/book/c/{slug}`: the collective page, canonical for itself and any address it adopted. */
export async function collectivePageMetadata(admin: SupabaseClient, slug: string): Promise<Metadata> {
  const { data: row } = await admin
    .from('venue_collectives')
    .select('id, name, slug, status, branding, booking_page_config')
    .eq('slug', slug.toLowerCase())
    .maybeSingle();
  if (!row) return { title: 'Booking page not found', robots: { index: false, follow: false } };
  const collective = row as Row;
  const name = text(collective.name) ?? 'Venue collective';
  if (collective.status === 'dissolved') {
    return {
      title: collectiveCopy('public.dissolved.title', { collective: name }),
      robots: { index: false, follow: true },
    };
  }
  const { count } = await admin
    .from('venue_collective_members')
    .select('id', { count: 'exact', head: true })
    .eq('collective_id', collective.id as string)
    .eq('status', 'active');
  const config = (collective.booking_page_config ?? {}) as Row;
  const branding = (collective.branding ?? {}) as Row;
  const about = text(config.about) ?? text(branding.description);
  return card({
    title: collectiveCopy('public.meta.title', { collective: name }),
    description: metaDescription(
      about ?? collectiveCopy('public.meta.description', { collective: name, venueCount: count ?? 0 }),
    ),
    canonical: `/book/c/${collective.slug as string}`,
    image: text(config.cover_photo_url) ?? text(branding.logo_url),
    index: collective.status === 'active',
  });
}

async function loadVenue(admin: SupabaseClient, slug: string): Promise<Row | null> {
  const { data } = await admin
    .from('venues')
    .select('id, name, slug, address, cover_photo_url, logo_url, booking_page_config')
    .eq('slug', slug.toLowerCase())
    .maybeSingle();
  return (data as Row | null) ?? null;
}

/**
 * The live collective that serves this venue's address in place, or that its appointment links
 * hand over to: its page's metadata applies, since that is the page a search result should open.
 */
async function servingCollectiveSlug(admin: SupabaseClient, venue: Row): Promise<string | null> {
  const { data: adopted } = await admin
    .from('venue_collectives')
    .select('slug')
    .eq('adopted_venue_id', venue.id as string)
    .eq('status', 'active')
    .eq('page_mode', 'unified_catalog')
    .maybeSingle();
  if (adopted?.slug) return adopted.slug as string;
  const handover = await resolveOwnPageHandover(admin, venue.id as string).catch(() => null);
  return handover?.redirect && !handover.otherModels ? handover.collectiveSlug : null;
}

/** `/book/{venue}`: the venue's own page, unless a collective page serves or replaces it. */
export async function venuePageMetadata(admin: SupabaseClient, slug: string): Promise<Metadata> {
  const venue = await loadVenue(admin, slug);
  if (!venue) return { title: 'Booking page not found', robots: { index: false, follow: false } };
  const collectiveSlug = await servingCollectiveSlug(admin, venue);
  if (collectiveSlug) return collectivePageMetadata(admin, collectiveSlug);
  const name = text(venue.name) ?? 'Book online';
  const config = (venue.booking_page_config ?? {}) as Row;
  const about = text(config.about);
  const address = text(venue.address);
  return card({
    title: `Book with ${name}`,
    description: metaDescription(about ?? `Book online with ${name}${address ? `, ${address}` : ''}.`),
    canonical: `/book/${venue.slug as string}`,
    image: text(venue.cover_photo_url) ?? text(venue.logo_url),
    index: true,
  });
}

/** `/book/{venue}/{calendar}`: one person's page at the venue, or the collective page it hands over to. */
export async function calendarPageMetadata(
  admin: SupabaseClient,
  venueSlug: string,
  calendarSlug: string,
): Promise<Metadata> {
  const venue = await loadVenue(admin, venueSlug);
  if (!venue) return { title: 'Booking page not found', robots: { index: false, follow: false } };
  const handover = await resolveOwnPageHandover(admin, venue.id as string).catch(() => null);
  if (handover?.redirect) return collectivePageMetadata(admin, handover.collectiveSlug);
  const { data: calendar } = await admin
    .from('unified_calendars')
    .select('name, slug, is_active')
    .eq('venue_id', venue.id as string)
    .eq('slug', calendarSlug.trim().toLowerCase())
    .maybeSingle();
  if (!calendar || calendar.is_active === false) {
    return { title: 'Booking page not found', robots: { index: false, follow: false } };
  }
  const name = text(venue.name) ?? 'the venue';
  const person = text(calendar.name) ?? 'us';
  return card({
    title: `Book with ${person} at ${name}`,
    description: metaDescription(`Book online with ${person} at ${name}.`),
    canonical: `/book/${venue.slug as string}/${calendar.slug as string}`,
    image: text(venue.cover_photo_url) ?? text(venue.logo_url),
    index: true,
  });
}
