import { PassesClient } from './PassesClient';
import { parsePassesTab } from './passes-tabs';

/**
 * WCAG 2.4.2 (Level A), matching the other surviving routes (P0-8). The tab is
 * not in the title: it changes without a navigation, so a title naming it would
 * be wrong the moment the customer switched tabs.
 */
export const metadata = {
  title: 'Passes and plans',
  description: 'Credits, courses, memberships and recurring reservations.',
};

/**
 * P1-5. One home for the four commerce sections that had a nav item each.
 *
 * The page has no `PageHeader` of its own: each section already renders one,
 * and the tab bar sitting above it means the panel titles itself as the
 * customer switches. A page-level heading would have put two `<h1>`s on the
 * screen, or forced a restructure of four sections the plan says should move
 * unchanged.
 */
export default async function AccountPassesPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string | string[] }>;
}) {
  const sp = (await searchParams) ?? {};
  return <PassesClient initialTab={parsePassesTab(sp.tab)} />;
}
