import type { Metadata } from 'next';
import { HelpLayoutShell } from '@/components/help/HelpLayoutShell';
import {
  buildHelpSearchDocsForAudience,
  filterHelpCategoriesForAudience,
  presentHelpCategoriesForNav,
} from '@/lib/help/filter-help-for-audience';
import { getCachedHelpAudienceContext } from '@/lib/help/help-audience-context';
import { buildSearchDocs } from '@/lib/help/navigation';

export const metadata: Metadata = {
  title: 'Help',
  description:
    'Resneo help: restaurant and appointment booking, settings, Stripe, communications, reports, and troubleshooting.',
};

/** Session-aware: personalised nav/search when signed in with a venue. */
export const dynamic = 'force-dynamic';

export default async function HelpLayout({ children }: { children: React.ReactNode }) {
  const audienceContext = await getCachedHelpAudienceContext();
  const visibleCategories = presentHelpCategoriesForNav(
    filterHelpCategoriesForAudience(audienceContext),
    audienceContext,
  );
  const searchDocs =
    audienceContext.mode === 'anonymous' ? buildSearchDocs() : buildHelpSearchDocsForAudience(audienceContext);

  return (
    <HelpLayoutShell
      audienceContext={audienceContext}
      visibleCategories={visibleCategories}
      searchDocs={searchDocs}
    >
      {children}
    </HelpLayoutShell>
  );
}
