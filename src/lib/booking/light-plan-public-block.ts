import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import {
  isPublicOnlineBookingBlocked,
  type VenueBillingFields,
} from '@/lib/billing/subscription-entitlement';

export type { VenueBillingFields } from '@/lib/billing/subscription-entitlement';
export { isPublicOnlineBookingBlocked } from '@/lib/billing/subscription-entitlement';

/**
 * For venue rows that include plan fields (and period end for accurate cancelled access).
 * Returns a JSON 403 when public online booking must be blocked.
 */
export function nextResponseIfPublicBookingBlockedFromVenueRow(row: VenueBillingFields): NextResponse | null {
  if (isPublicOnlineBookingBlocked(row)) {
    return NextResponse.json(
      { error: 'Online booking is temporarily unavailable for this venue.' },
      { status: 403 },
    );
  }
  return null;
}

/**
 * Load plan fields for `venueId` and return 403 when public booking is blocked
 * (Light + past_due, or subscription ended / cancelled with no remaining paid period).
 */
export async function nextResponseIfPublicBookingBlockedForVenue(
  admin: SupabaseClient,
  venueId: string,
): Promise<NextResponse | null> {
  const { data: row, error } = await admin
    .from('venues')
    .select('pricing_tier, plan_status, subscription_current_period_end, billing_access_source')
    .eq('id', venueId)
    .maybeSingle();

  if (error) {
    console.error('[public booking guard] venue lookup failed:', error.message, { venueId });
    return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  }
  if (!row) {
    return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  }

  return nextResponseIfPublicBookingBlockedFromVenueRow(
    row as {
      pricing_tier?: string | null;
      plan_status?: string | null;
      subscription_current_period_end?: string | null;
      billing_access_source?: string | null;
    },
  );
}
