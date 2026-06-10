import type { SupabaseClient } from '@supabase/supabase-js';
import { ACTIVE_SUBSCRIBER_PLAN_STATUS } from '@/lib/sales/constants';

/**
 * Sync attribution status with venue plan_status (paying active vs not).
 */
export async function syncSalesAttributionWithPlanStatus(
  admin: SupabaseClient,
  venueId: string,
  planStatus: string,
): Promise<void> {
  const isPaying = planStatus.toLowerCase().trim() === ACTIVE_SUBSCRIBER_PLAN_STATUS;
  const now = new Date().toISOString();

  if (isPaying) {
    const { error } = await admin
      .from('sales_attributions')
      .update({ status: 'active', updated_at: now })
      .eq('venue_id', venueId)
      .not('first_paid_at', 'is', null)
      .in('status', ['churned', 'pending']);
    if (error) {
      console.error('[sales/churn] reactivate failed', { venueId, error: error.message });
    }
    return;
  }

  const { error } = await admin
    .from('sales_attributions')
    .update({ status: 'churned', updated_at: now })
    .eq('venue_id', venueId)
    .eq('status', 'active');
  if (error) {
    console.error('[sales/churn] churn update failed', { venueId, error: error.message });
  }
}
