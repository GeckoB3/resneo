import type { HelpAudienceContext } from '@/lib/help/help-audience-context';
import type { HelpArticle } from '@/lib/help/types';
import { isAppointmentPlanTier } from '@/lib/tier-enforcement';

/**
 * Pick markdown variant for shared (`plan: 'all'`) articles. Plan-specific categories
 * typically only ship one body; optional overrides let us tailor Getting started, etc.
 */
export function resolveArticleMarkdown(article: HelpArticle, ctx: HelpAudienceContext): string {
  if (ctx.mode === 'anonymous') {
    return article.content;
  }

  if (isAppointmentPlanTier(ctx.pricingTier)) {
    return article.markdownAppointments ?? article.content;
  }

  return article.markdownRestaurant ?? article.content;
}
