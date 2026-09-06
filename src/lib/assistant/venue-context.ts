import type { VenueStaff } from '@/lib/venue-auth';
import { resolveActiveBookingModels } from '@/lib/booking/active-models';
import { effectivePlanStatus } from '@/lib/billing/subscription-entitlement';
import { parseVenueFeatureFlags, resolveAppointmentsFeatureFlags } from '@/lib/feature-flags/resolve';
import { isAppointmentPlanTier, isLightPlanTier } from '@/lib/tier-enforcement';
import { assertCalendarSlotAvailable } from '@/lib/light-plan';
import { venueHasStripePaymentMethodForSms } from '@/lib/stripe/venue-customer-payment';
import type { BookingModel, VenueTerminology } from '@/types/booking-models';

/**
 * What applies to THIS venue (Docs/help-assistant-plan.md, 2.3): the second layer of
 * knowledge the assistant needs beyond the articles. Plan, role, booking types, Stripe,
 * optional features, compliance, calendar usage, SMS billing state, terminology, platform.
 * Carries no personal data: no names, no emails, no client records.
 */

export type AssistantClient = 'web' | 'app';

export type AssistantSmsState = 'included' | 'pay_as_you_go_card_on_file' | 'pay_as_you_go_no_card';

export interface AssistantVenueContext {
  /** The plan name as the articles write it. */
  planLabel: string;
  /** `effectivePlanStatus()`: active, trialing, past_due, cancelling, cancelled, ... */
  planStatus: string;
  role: 'admin' | 'staff';
  activeBookingModels: BookingModel[];
  stripeConnected: boolean;
  /** Human labels of the optional features switched on (compliance is its own line). */
  featureFlagsOn: string[];
  complianceEnabled: boolean;
  sms: AssistantSmsState;
  calendars: { used: number; limit: number | null } | null;
  terminology: VenueTerminology | null;
  timezone: string;
  client: AssistantClient;
  /** Dashboard pathname the question was asked from, if the client sent one. */
  page: string | null;
  /** YYYY-MM-DD in the venue's timezone. */
  today: string;
}

export function planLabelForTier(tier: string | null | undefined): string {
  switch ((tier ?? '').toLowerCase().trim()) {
    case 'light':
      return 'Appointments Light';
    case 'plus':
      return 'Appointments Plus';
    case 'appointments':
      return 'Appointments Pro';
    case 'restaurant':
      return 'Restaurant';
    case 'founding':
      return 'Founding Partner';
    default:
      return 'Unknown plan';
  }
}

/** Labels for the optional booking features as Settings → Booking Settings names them. */
export const FEATURE_FLAG_LABELS: Record<string, string> = {
  any_available_practitioner: 'any available practitioner',
  staff_first_booking_flow: 'staff-first booking',
  guest_self_reschedule: 'guest self-reschedule',
  waitlist_v2: 'appointment waitlist',
  class_commerce_enabled: 'class packs, courses and memberships',
};

export function todayInTimezone(timezone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export interface AssistantVenueRow {
  pricing_tier?: string | null;
  plan_status?: string | null;
  subscription_current_period_end?: string | null;
  booking_model?: string | null;
  enabled_models?: unknown;
  active_booking_models?: unknown;
  feature_flags?: unknown;
  terminology?: unknown;
  timezone?: string | null;
  stripe_connected_account_id?: string | null;
}

export const ASSISTANT_VENUE_SELECT =
  'pricing_tier, plan_status, subscription_current_period_end, booking_model, enabled_models, active_booking_models, feature_flags, terminology, timezone, stripe_connected_account_id';

export interface AssistantContextDeps {
  calendarUsage: (venueId: string) => Promise<{ current: number; limit: number }>;
  smsCardOnFile: (venueId: string) => Promise<boolean>;
  now: () => Date;
}

const defaultDeps: AssistantContextDeps = {
  calendarUsage: async (venueId) => {
    const r = await assertCalendarSlotAvailable(venueId);
    return { current: r.current, limit: r.limit };
  },
  smsCardOnFile: venueHasStripePaymentMethodForSms,
  now: () => new Date(),
};

function terminologyOf(raw: unknown): VenueTerminology | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Partial<VenueTerminology>;
  if (!t.client && !t.booking && !t.staff) return null;
  return { client: t.client ?? '', booking: t.booking ?? '', staff: t.staff ?? '' };
}

/** Pure part, so tests can feed a row directly. */
export async function buildAssistantVenueContext(
  row: AssistantVenueRow,
  input: { venueId: string; role: 'admin' | 'staff'; client: AssistantClient; page: string | null },
  deps: AssistantContextDeps = defaultDeps,
): Promise<AssistantVenueContext> {
  const tier = row.pricing_tier ?? null;
  const flags = resolveAppointmentsFeatureFlags(parseVenueFeatureFlags(row.feature_flags));
  const activeBookingModels = resolveActiveBookingModels({
    pricingTier: tier,
    bookingModel: (row.booking_model as BookingModel | null | undefined) ?? undefined,
    enabledModels: row.enabled_models,
    activeBookingModels: row.active_booking_models,
  });

  const featureFlagsOn = Object.entries(flags)
    .filter(([key, on]) => on === true && key !== 'compliance_records_enabled' && FEATURE_FLAG_LABELS[key])
    .map(([key]) => FEATURE_FLAG_LABELS[key]!);

  let calendars: AssistantVenueContext['calendars'] = null;
  try {
    const usage = await deps.calendarUsage(input.venueId);
    calendars = { used: usage.current, limit: Number.isFinite(usage.limit) ? usage.limit : null };
  } catch (e) {
    console.warn('[assistant context] calendar usage unavailable', e);
  }

  let sms: AssistantSmsState = 'included';
  if (isLightPlanTier(tier)) {
    try {
      sms = (await deps.smsCardOnFile(input.venueId)) ? 'pay_as_you_go_card_on_file' : 'pay_as_you_go_no_card';
    } catch (e) {
      console.warn('[assistant context] SMS billing state unavailable', e);
      sms = 'pay_as_you_go_no_card';
    }
  }

  const timezone = row.timezone?.trim() || 'Europe/London';

  return {
    planLabel: planLabelForTier(tier),
    planStatus: effectivePlanStatus(row.plan_status, row.subscription_current_period_end, deps.now().getTime()),
    role: input.role,
    activeBookingModels,
    stripeConnected: Boolean(row.stripe_connected_account_id?.trim()),
    featureFlagsOn,
    complianceEnabled: flags.compliance_records_enabled === true && isAppointmentPlanTier(tier),
    sms,
    calendars,
    terminology: terminologyOf(row.terminology),
    timezone,
    client: input.client,
    page: input.page,
    today: todayInTimezone(timezone, deps.now()),
  };
}

export async function loadAssistantVenueContext(
  staff: VenueStaff,
  input: { client: AssistantClient; page: string | null },
  deps: AssistantContextDeps = defaultDeps,
): Promise<AssistantVenueContext> {
  const { data, error } = await staff.db.from('venues').select(ASSISTANT_VENUE_SELECT).eq('id', staff.venue_id).maybeSingle();
  if (error) {
    console.warn('[assistant context] venue lookup failed', { venueId: staff.venue_id, error: error.message });
  }
  const row = (data ?? {}) as AssistantVenueRow;
  return buildAssistantVenueContext(row, { venueId: staff.venue_id, role: staff.role, client: input.client, page: input.page }, deps);
}
