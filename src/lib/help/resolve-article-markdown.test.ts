import { describe, expect, it } from 'vitest';
import type { HelpArticle } from '@/lib/help/types';
import type { HelpAudienceContext } from '@/lib/help/help-audience-context';
import { resolveArticleMarkdown } from '@/lib/help/resolve-article-markdown';

describe('resolveArticleMarkdown', () => {
  const article: HelpArticle = {
    slug: 'x',
    title: 'T',
    description: 'D',
    content: 'DEFAULT',
    markdownRestaurant: 'REST',
    markdownAppointments: 'APPT',
  };

  it('uses default content for anonymous', () => {
    expect(resolveArticleMarkdown(article, { mode: 'anonymous' })).toBe('DEFAULT');
  });

  it('uses markdownAppointments for appointment tier', () => {
    const ctx: HelpAudienceContext = {
      mode: 'venue',
      venueId: 'v',
      pricingTier: 'plus',
      bookingModel: 'unified_scheduling',
      enabledModels: [],
      showRestaurantHelp: false,
      showAppointmentsHelp: true,
      hybridScheduleAddOns: false,
    };
    expect(resolveArticleMarkdown(article, ctx)).toBe('APPT');
  });

  it('uses markdownRestaurant for restaurant tier', () => {
    const ctx: HelpAudienceContext = {
      mode: 'venue',
      venueId: 'v',
      pricingTier: 'restaurant',
      bookingModel: 'table_reservation',
      enabledModels: [],
      showRestaurantHelp: true,
      showAppointmentsHelp: false,
      hybridScheduleAddOns: false,
    };
    expect(resolveArticleMarkdown(article, ctx)).toBe('REST');
  });
});
