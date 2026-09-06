import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: vi.fn() }));
vi.mock('@/lib/light-plan', () => ({ assertCalendarSlotAvailable: vi.fn() }));
vi.mock('@/lib/stripe/venue-customer-payment', () => ({ venueHasStripePaymentMethodForSms: vi.fn() }));

import { buildAssistantVenueContext, loadAssistantVenueContext, planLabelForTier, todayInTimezone, type AssistantContextDeps } from './venue-context';

const NOW = new Date('2026-09-06T22:30:00Z');

function deps(over: Partial<AssistantContextDeps> = {}): AssistantContextDeps {
  return {
    calendarUsage: async () => ({ current: 4, limit: 5 }),
    smsCardOnFile: async () => true,
    now: () => NOW,
    ...over,
  };
}

const PLUS_ROW = {
  pricing_tier: 'plus',
  plan_status: 'active',
  subscription_current_period_end: null,
  booking_model: 'unified_scheduling',
  enabled_models: [],
  active_booking_models: ['unified_scheduling', 'class_session'],
  feature_flags: { waitlist_v2: true, compliance_records_enabled: true, any_available_practitioner: false },
  terminology: { client: 'Clients', booking: 'Appointments', staff: 'Stylists' },
  timezone: 'Europe/London',
  stripe_connected_account_id: 'acct_123',
};

/** Docs/help-assistant-plan.md, 5.1: tier, flag and role mapping. */
describe('buildAssistantVenueContext', () => {
  it('maps a Plus admin venue', async () => {
    const ctx = await buildAssistantVenueContext(PLUS_ROW, { venueId: 'v1', role: 'admin', client: 'web', page: '/dashboard' }, deps());
    expect(ctx.planLabel).toBe('Appointments Plus');
    expect(ctx.planStatus).toBe('active');
    expect(ctx.role).toBe('admin');
    expect(ctx.activeBookingModels).toEqual(['unified_scheduling', 'class_session']);
    expect(ctx.stripeConnected).toBe(true);
    // guest_self_reschedule defaults on; compliance is its own line, not a flag label.
    expect(ctx.featureFlagsOn).toEqual(expect.arrayContaining(['appointment waitlist', 'guest self-reschedule']));
    expect(ctx.featureFlagsOn).not.toContain('any available practitioner');
    expect(ctx.complianceEnabled).toBe(true);
    expect(ctx.sms).toBe('included');
    expect(ctx.calendars).toEqual({ used: 4, limit: 5 });
    expect(ctx.terminology).toEqual({ client: 'Clients', booking: 'Appointments', staff: 'Stylists' });
    expect(ctx.timezone).toBe('Europe/London');
    expect(ctx.client).toBe('web');
    expect(ctx.page).toBe('/dashboard');
    expect(ctx.today).toBe('2026-09-06');
  });

  it('marks a Light venue with no card on file as pay as you go, with one calendar', async () => {
    const ctx = await buildAssistantVenueContext(
      { ...PLUS_ROW, pricing_tier: 'light', feature_flags: {} },
      { venueId: 'v1', role: 'staff', client: 'app', page: null },
      deps({ calendarUsage: async () => ({ current: 1, limit: 1 }), smsCardOnFile: async () => false }),
    );
    expect(ctx.planLabel).toBe('Appointments Light');
    expect(ctx.sms).toBe('pay_as_you_go_no_card');
    expect(ctx.calendars).toEqual({ used: 1, limit: 1 });
    expect(ctx.role).toBe('staff');
    expect(ctx.client).toBe('app');
    expect(ctx.complianceEnabled).toBe(false);
  });

  it('reads a card on file for Light, and an unlimited plan as no limit', async () => {
    const ctx = await buildAssistantVenueContext(
      { ...PLUS_ROW, pricing_tier: 'light' },
      { venueId: 'v1', role: 'admin', client: 'web', page: null },
      deps({ calendarUsage: async () => ({ current: 3, limit: Infinity }) }),
    );
    expect(ctx.sms).toBe('pay_as_you_go_card_on_file');
    expect(ctx.calendars).toEqual({ used: 3, limit: null });
  });

  it('does not let compliance through on a restaurant tier, and names the plan', async () => {
    const ctx = await buildAssistantVenueContext(
      { ...PLUS_ROW, pricing_tier: 'founding', feature_flags: { compliance_records_enabled: true } },
      { venueId: 'v1', role: 'admin', client: 'web', page: null },
      deps(),
    );
    expect(ctx.planLabel).toBe('Founding Partner');
    expect(ctx.complianceEnabled).toBe(false);
  });

  it('derives cancelled from a cancelling plan whose period has ended', async () => {
    const ctx = await buildAssistantVenueContext(
      { ...PLUS_ROW, plan_status: 'cancelling', subscription_current_period_end: '2026-09-01T00:00:00Z' },
      { venueId: 'v1', role: 'admin', client: 'web', page: null },
      deps(),
    );
    expect(ctx.planStatus).toBe('cancelled');
  });

  it('survives helpers that fail and rows that are empty', async () => {
    const ctx = await buildAssistantVenueContext(
      {},
      { venueId: 'v1', role: 'admin', client: 'web', page: null },
      deps({
        calendarUsage: async () => {
          throw new Error('db down');
        },
      }),
    );
    expect(ctx.planLabel).toBe('Unknown plan');
    expect(ctx.calendars).toBeNull();
    expect(ctx.stripeConnected).toBe(false);
    expect(ctx.terminology).toBeNull();
    expect(ctx.timezone).toBe('Europe/London');
  });
});

describe('loadAssistantVenueContext', () => {
  it('reads the venue through the staff client and passes the role through', async () => {
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    Object.assign(builder, { select: chain, eq: chain, maybeSingle: async () => ({ data: PLUS_ROW, error: null }) });
    const staff = { id: 's1', venue_id: 'v1', email: 'a@b.c', role: 'staff' as const, db: { from: () => builder } as never };
    const ctx = await loadAssistantVenueContext(staff, { client: 'web', page: '/dashboard/calendar' }, deps());
    expect(ctx.role).toBe('staff');
    expect(ctx.planLabel).toBe('Appointments Plus');
    expect(ctx.page).toBe('/dashboard/calendar');
  });
});

describe('helpers', () => {
  it('labels every tier the articles name', () => {
    expect(planLabelForTier('light')).toBe('Appointments Light');
    expect(planLabelForTier('plus')).toBe('Appointments Plus');
    expect(planLabelForTier('appointments')).toBe('Appointments Pro');
    expect(planLabelForTier('restaurant')).toBe('Restaurant');
    expect(planLabelForTier(null)).toBe('Unknown plan');
  });

  it('formats today in the venue timezone', () => {
    expect(todayInTimezone('Europe/London', NOW)).toBe('2026-09-06');
    expect(todayInTimezone('Pacific/Auckland', NOW)).toBe('2026-09-07');
    expect(todayInTimezone('Not/AZone', NOW)).toBe('2026-09-06');
  });
});
