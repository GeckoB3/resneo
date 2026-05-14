import { HELP_CATEGORIES, helpArticleHref } from '@/lib/help/navigation';
import type { HelpAudienceContext } from '@/lib/help/help-audience-context';
import { resolveArticleMarkdown } from '@/lib/help/resolve-article-markdown';
import { stripHelpFigureMarkers } from '@/lib/help/split-markdown-figures';
import type { HelpCategory, HelpSearchDoc } from '@/lib/help/types';

/**
 * Categories (and later per-article rules) visible for this reader.
 * Anonymous users always see the full catalogue.
 */
export function filterHelpCategoriesForAudience(ctx: HelpAudienceContext): HelpCategory[] {
  if (ctx.mode === 'anonymous') {
    return HELP_CATEGORIES;
  }

  return HELP_CATEGORIES.filter((cat) => {
    if (cat.plan === 'all') return true;
    if (cat.plan === 'restaurant') return ctx.showRestaurantHelp;
    if (cat.plan === 'appointments') return ctx.showAppointmentsHelp;
    return true;
  });
}

/**
 * Optional presentation overrides for nav (e.g. hybrid restaurant + schedule add-ons).
 */
export function presentHelpCategoriesForNav(
  categories: HelpCategory[],
  ctx: HelpAudienceContext,
): HelpCategory[] {
  if (ctx.mode !== 'venue' || !ctx.hybridScheduleAddOns) {
    return categories;
  }
  return categories.map((cat) => {
    if (cat.slug !== 'appointments') return cat;
    return {
      ...cat,
      title: 'Schedule & other booking types',
      description:
        'Classes, events, resources, and unified calendars alongside your restaurant tools—the same guides as the Appointments plan where those features overlap.',
    };
  });
}

export function isHelpCategorySlugVisible(ctx: HelpAudienceContext, categorySlug: string): boolean {
  return filterHelpCategoriesForAudience(ctx).some((c) => c.slug === categorySlug);
}

/** Search index scoped to visible categories and resolved markdown for the signed-in venue. */
export function buildHelpSearchDocsForAudience(ctx: HelpAudienceContext): HelpSearchDoc[] {
  const categories = presentHelpCategoriesForNav(filterHelpCategoriesForAudience(ctx), ctx);
  const docs: HelpSearchDoc[] = [];
  for (const cat of categories) {
    const categoryTitle = cat.title;
    for (const art of cat.articles) {
      const markdown = resolveArticleMarkdown(art, ctx);
      docs.push({
        id: `${cat.slug}/${art.slug}`,
        href: helpArticleHref(cat.slug, art.slug),
        categorySlug: cat.slug,
        categoryTitle,
        articleSlug: art.slug,
        title: art.title,
        description: art.description,
        tagsText: (art.tags ?? []).join(' '),
        content: stripHelpFigureMarkers(markdown),
      });
    }
  }
  return docs;
}
