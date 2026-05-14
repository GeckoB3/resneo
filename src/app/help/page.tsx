import { HelpHomeClient } from '@/components/help/HelpHomeClient';
import {
  filterHelpCategoriesForAudience,
  presentHelpCategoriesForNav,
} from '@/lib/help/filter-help-for-audience';
import { getCachedHelpAudienceContext } from '@/lib/help/help-audience-context';

export default async function HelpHomePage() {
  const audienceContext = await getCachedHelpAudienceContext();
  const visibleCategories = presentHelpCategoriesForNav(
    filterHelpCategoriesForAudience(audienceContext),
    audienceContext,
  );

  return <HelpHomeClient audienceContext={audienceContext} visibleCategories={visibleCategories} />;
}
