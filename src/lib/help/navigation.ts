import type { HelpArticle, HelpCategory, HelpPlanFilter, HelpSearchDoc } from './types';
import { stripHelpFigureMarkers } from './split-markdown-figures';
import { gettingStartedCategory } from './articles/getting-started';
import { restaurantCategory } from './articles/restaurant';
import { appointmentsCategory } from './articles/appointments';
import { settingsCategory } from './articles/settings';
import { troubleshootingCategory } from './articles/troubleshooting';

export const HELP_CATEGORIES: HelpCategory[] = [
  gettingStartedCategory,
  restaurantCategory,
  appointmentsCategory,
  settingsCategory,
  troubleshootingCategory,
];

export function getCategoryBySlug(slug: string): HelpCategory | undefined {
  return HELP_CATEGORIES.find((c) => c.slug === slug);
}

export function getArticle(categorySlug: string, articleSlug: string): HelpArticle | undefined {
  const cat = getCategoryBySlug(categorySlug);
  return cat?.articles.find((a) => a.slug === articleSlug);
}

export function helpArticleHref(categorySlug: string, articleSlug: string): string {
  return `/help/${categorySlug}/${articleSlug}`;
}

export function helpCategoryHref(categorySlug: string): string {
  return `/help/${categorySlug}`;
}

/** All article slugs per category for static generation */
export function getAllHelpPaths(): { category: string; article: string }[] {
  const out: { category: string; article: string }[] = [];
  for (const cat of HELP_CATEGORIES) {
    for (const art of cat.articles) {
      out.push({ category: cat.slug, article: art.slug });
    }
  }
  return out;
}

export function categoriesForPlanFilter(filter: HelpPlanFilter | 'all'): HelpCategory[] {
  if (filter === 'all') return HELP_CATEGORIES;
  return HELP_CATEGORIES.filter((c) => c.plan === 'all' || c.plan === filter);
}

export function buildSearchDocsFromCategories(categories: HelpCategory[]): HelpSearchDoc[] {
  const docs: HelpSearchDoc[] = [];
  for (const cat of categories) {
    for (const art of cat.articles) {
      docs.push({
        id: `${cat.slug}/${art.slug}`,
        href: helpArticleHref(cat.slug, art.slug),
        categorySlug: cat.slug,
        categoryTitle: cat.title,
        articleSlug: art.slug,
        title: art.title,
        description: art.description,
        tagsText: (art.tags ?? []).join(' '),
        content: stripHelpFigureMarkers(art.content),
      });
    }
  }
  return docs;
}

export function buildSearchDocs(): HelpSearchDoc[] {
  return buildSearchDocsFromCategories(HELP_CATEGORIES);
}

export function getAdjacentArticles(
  categorySlug: string,
  articleSlug: string,
): { prev: { href: string; title: string } | null; next: { href: string; title: string } | null } {
  const cat = getCategoryBySlug(categorySlug);
  if (!cat) return { prev: null, next: null };
  const idx = cat.articles.findIndex((a) => a.slug === articleSlug);
  if (idx < 0) return { prev: null, next: null };
  const prevArt = idx > 0 ? cat.articles[idx - 1]! : null;
  const nextArt = idx < cat.articles.length - 1 ? cat.articles[idx + 1]! : null;
  return {
    prev: prevArt ? { href: helpArticleHref(categorySlug, prevArt.slug), title: prevArt.title } : null,
    next: nextArt ? { href: helpArticleHref(categorySlug, nextArt.slug), title: nextArt.title } : null,
  };
}
