import type { SupabaseClient } from '@supabase/supabase-js';
import { computeSmsMonthlyAllowance } from '@/lib/billing/sms-allowance';
import { SMS_LIGHT_GBP_PER_MESSAGE, SMS_OVERAGE_GBP_PER_MESSAGE } from '@/lib/pricing-constants';
import { resolveSmsBillingPeriod } from '@/lib/sms-usage';

export type SmsUsageBillingMode = 'light_metered' | 'bundle_allowance';

export interface SmsUsageDisplay {
  messages_sent: number;
  messages_included: number;
  remaining: number;
  overage_count: number;
  overage_amount_pence: number;
  /** Light: every SMS segment is metered; other tiers: segments beyond included allowance. */
  billing_mode: SmsUsageBillingMode;
  /** GBP per billable Twilio segment for this venue (0.08 Light, 0.06 overage on other plans). */
  billable_unit_gbp: number;
}

/**
 * Current-period SMS segment figures for dashboard / settings.
 * Included count comes from `computeSmsMonthlyAllowance` (tier-based).
 */
export async function getSmsUsageDisplayForVenue(
  admin: SupabaseClient,
  venueId: string,
): Promise<SmsUsageDisplay | null> {
  const { data: venue, error: vErr } = await admin
    .from('venues')
    .select('pricing_tier, calendar_count, subscription_current_period_start, subscription_current_period_end')
    .eq('id', venueId)
    .maybeSingle();
  if (vErr || !venue) return null;

  const row = venue as {
    pricing_tier?: string | null;
    calendar_count?: number | null;
    subscription_current_period_start?: string | null;
    subscription_current_period_end?: string | null;
  };
  const included = computeSmsMonthlyAllowance(row.pricing_tier ?? 'appointments', row.calendar_count ?? null);
  const period = resolveSmsBillingPeriod(row);

  let usageQuery = admin
    .from('sms_usage')
    .select('messages_sent, overage_amount_pence, overage_rate_pence')
    .eq('venue_id', venueId);
  if (period.periodStartIso && period.periodEndIso) {
    usageQuery = usageQuery
      .eq('stripe_period_start', period.periodStartIso)
      .eq('stripe_period_end', period.periodEndIso);
  } else {
    usageQuery = usageQuery.eq('billing_month', period.billingMonth);
  }

  const { data: usage } = await usageQuery.maybeSingle();

  const u = usage as {
    messages_sent?: number;
    overage_amount_pence?: number;
    overage_rate_pence?: number;
  } | null;

  const sent = u?.messages_sent ?? 0;
  const tierLower = (row.pricing_tier ?? '').toLowerCase();
  if (tierLower === 'light') {
    const unit = typeof u?.overage_rate_pence === 'number' ? u.overage_rate_pence / 100 : SMS_LIGHT_GBP_PER_MESSAGE;
    const overagePenceLight =
      typeof u?.overage_amount_pence === 'number'
        ? u.overage_amount_pence
        : sent * Math.round(unit * 100);
    return {
      messages_sent: sent,
      messages_included: 0,
      remaining: 0,
      overage_count: sent,
      overage_amount_pence: overagePenceLight,
      billing_mode: 'light_metered',
      billable_unit_gbp: unit,
    };
  }

  const remaining = Math.max(0, included - sent);
  const overageCount = Math.max(0, sent - included);
  const unit = typeof u?.overage_rate_pence === 'number' ? u.overage_rate_pence / 100 : SMS_OVERAGE_GBP_PER_MESSAGE;
  const overagePence = overageCount * Math.round(unit * 100);

  return {
    messages_sent: sent,
    messages_included: included,
    remaining,
    overage_count: overageCount,
    overage_amount_pence: overagePence,
    billing_mode: 'bundle_allowance',
    billable_unit_gbp: unit,
  };
}
