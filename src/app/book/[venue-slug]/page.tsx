import { notFound, redirect } from 'next/navigation';
import { getPublicVenueForBookBySlug } from '@/lib/booking/get-public-venue-for-book';
import { BookPublicLayout } from '@/components/booking/BookPublicLayout';
import { loadBookPublicLayoutData } from '@/lib/booking/load-book-public-layout-data';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { resolveCombinedSlugClaim } from '@/lib/linked-accounts/catalogue';
import { handoverUrl, resolveOwnPageHandover } from '@/lib/linked-accounts/replicas/page-handover';
import { loadCollectivePageView, CollectivePageBody } from '../c/[slug]/collective-page-view';
import { searchParamsReader, type PageSearchParams } from './search-params';

export default async function BookPage({
  params,
  searchParams,
}: {
  params: Promise<{ 'venue-slug': string }>;
  searchParams?: Promise<PageSearchParams>;
}) {
  const { 'venue-slug': slug } = await params;
  const query = searchParamsReader(searchParams ? await searchParams : {});
  const admin = getSupabaseAdminClient();

  // Combined booking page (plan §5.2): a live combined collective may adopt this
  // venue's slug, or this venue may redirect its solo page to one. The claim
  // returns null once the combined page is gone, so routing heals automatically.
  const claim = await resolveCombinedSlugClaim(admin, slug);
  if (claim?.kind === 'redirect' && claim.redirectTo) {
    redirect(claim.redirectTo); // 307 (temporary) so it reverts cleanly on dissolve
  }
  if (claim?.kind === 'adopt') {
    const view = await loadCollectivePageView(admin, claim.collectiveSlug);
    if (view.status === 'live') return <CollectivePageBody view={view} />;
    // Combined page not currently live → fall through to the venue's own page so
    // the slug-donor is never stranded on a dead "unavailable" screen (plan §8.3).
  }

  let venue = await getPublicVenueForBookBySlug(slug);
  if (!venue) notFound();

  // Shared-services collectives (§6.9): the derived rule. A waitlist offer is for a time at this
  // venue, so it is answered here rather than handed over.
  const handover = await resolveOwnPageHandover(admin, venue.id);
  if (handover?.redirect && handover.publicPath !== `/book/${slug}` && !query.get('waitlist_offer')) {
    // A venue with other booking types keeps its page for them; only appointment links move on.
    if (!handover.otherModels || query.get('service_id')) {
      redirect(await handoverUrl(admin, handover, venue.id, query));
    }
    venue = {
      ...venue,
      appointments_handover: { collective_name: handover.collectiveName, href: handover.publicPath },
    };
  }

  const { services, team } = await loadBookPublicLayoutData(getSupabaseAdminClient(), venue);

  return <BookPublicLayout venue={venue} team={team} services={services} />;
}
