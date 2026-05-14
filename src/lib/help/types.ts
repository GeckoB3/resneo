export type HelpPlanFilter = 'restaurant' | 'appointments' | 'all';

/**
 * Optional grouping for category landing pages.
 * Appointments uses plans | setup | operations | growth.
 * Getting started uses gs-* keys (see GettingStartedHelpCategorySections).
 */
export type HelpArticleSectionKey =
  | 'plans'
  | 'setup'
  | 'operations'
  | 'growth'
  | 'gs-start-here'
  | 'gs-know-the-app'
  | 'gs-configure-venue'
  | 'gs-open-the-doors';

export interface HelpArticle {
  slug: string;
  title: string;
  description: string;
  content: string;
  /** When set, venue readers on Restaurant/Founding tiers see this body instead of `content`. */
  markdownRestaurant?: string;
  /** When set, venue readers on Appointments (Light/Plus/Pro) tiers see this body instead of `content`. */
  markdownAppointments?: string;
  tags?: string[];
  helpSection?: HelpArticleSectionKey;
}

export interface HelpCategory {
  slug: string;
  title: string;
  description: string;
  plan: HelpPlanFilter;
  articles: HelpArticle[];
}

/** Flat record for Fuse search */
export interface HelpSearchDoc {
  id: string;
  href: string;
  categorySlug: string;
  categoryTitle: string;
  articleSlug: string;
  title: string;
  description: string;
  tagsText: string;
  content: string;
}
