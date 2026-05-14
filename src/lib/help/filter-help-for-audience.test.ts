import { describe, expect, it } from 'vitest';
import type { BookingModel } from '@/types/booking-models';
import {
  buildHelpSearchDocsForAudience,
  filterHelpCategoriesForAudience,
  isHelpCategorySlugVisible,
  presentHelpCategoriesForNav,
} from '@/lib/help/filter-help-for-audience';
import type { HelpAudienceContext } from '@/lib/help/help-audience-context';
import { HELP_CATEGORIES } from '@/lib/help/navigation';

function venueCtx(partial: Omit<Extract<HelpAudienceContext, { mode: 'venue' }>, 'mode'>): HelpAudienceContext {
  return { mode: 'venue', ...partial };
}

describe('filterHelpCategoriesForAudience', () => {
  it('returns full catalogue for anonymous', () => {
    const out = filterHelpCategoriesForAudience({ mode: 'anonymous' });
    expect(out).toHaveLength(HELP_CATEGORIES.length);
  });

  it('hides restaurant category for appointments tier', () => {
    const ctx = venueCtx({
      venueId: 'v1',
      pricingTier: 'plus',
      bookingModel: 'unified_scheduling',
      enabledModels: [],
      showRestaurantHelp: false,
      showAppointmentsHelp: true,
      hybridScheduleAddOns: false,
    });
    const slugs = filterHelpCategoriesForAudience(ctx).map((c) => c.slug);
    expect(slugs).not.toContain('restaurant');
    expect(slugs).toContain('appointments');
    expect(slugs).toContain('getting-started');
  });

  it('hides appointments for restaurant table-only (no schedule add-ons)', () => {
    const ctx = venueCtx({
      venueId: 'v1',
      pricingTier: 'restaurant',
      bookingModel: 'table_reservation',
      enabledModels: [],
      showRestaurantHelp: true,
      showAppointmentsHelp: false,
      hybridScheduleAddOns: false,
    });
    const slugs = filterHelpCategoriesForAudience(ctx).map((c) => c.slug);
    expect(slugs).toContain('restaurant');
    expect(slugs).not.toContain('appointments');
  });

  it('shows appointments for restaurant + event secondary', () => {
    const ctx = venueCtx({
      venueId: 'v1',
      pricingTier: 'restaurant',
      bookingModel: 'table_reservation',
      enabledModels: ['event_ticket'] as BookingModel[],
      showRestaurantHelp: true,
      showAppointmentsHelp: true,
      hybridScheduleAddOns: true,
    });
    const slugs = filterHelpCategoriesForAudience(ctx).map((c) => c.slug);
    expect(slugs).toContain('restaurant');
    expect(slugs).toContain('appointments');
  });
});

describe('presentHelpCategoriesForNav', () => {
  it('renames appointments category title for hybrid restaurant + schedule', () => {
    const ctx = venueCtx({
      venueId: 'v1',
      pricingTier: 'restaurant',
      bookingModel: 'table_reservation',
      enabledModels: ['class_session'],
      showRestaurantHelp: true,
      showAppointmentsHelp: true,
      hybridScheduleAddOns: true,
    });
    const cats = presentHelpCategoriesForNav(filterHelpCategoriesForAudience(ctx), ctx);
    const appt = cats.find((c) => c.slug === 'appointments');
    expect(appt?.title).toBe('Schedule & other booking types');
  });
});

describe('isHelpCategorySlugVisible', () => {
  it('matches filter output', () => {
    const ctx = venueCtx({
      venueId: 'v1',
      pricingTier: 'light',
      bookingModel: 'unified_scheduling',
      enabledModels: [],
      showRestaurantHelp: false,
      showAppointmentsHelp: true,
      hybridScheduleAddOns: false,
    });
    expect(isHelpCategorySlugVisible(ctx, 'appointments')).toBe(true);
    expect(isHelpCategorySlugVisible(ctx, 'restaurant')).toBe(false);
  });
});

describe('buildHelpSearchDocsForAudience', () => {
  it('excludes hidden categories from search docs', () => {
    const ctx = venueCtx({
      venueId: 'v1',
      pricingTier: 'plus',
      bookingModel: 'unified_scheduling',
      enabledModels: [],
      showRestaurantHelp: false,
      showAppointmentsHelp: true,
      hybridScheduleAddOns: false,
    });
    const docs = buildHelpSearchDocsForAudience(ctx);
    expect(docs.some((d) => d.categorySlug === 'restaurant')).toBe(false);
    expect(docs.some((d) => d.categorySlug === 'appointments')).toBe(true);
  });
});
