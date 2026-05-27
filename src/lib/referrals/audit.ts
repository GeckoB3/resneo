import type { SupabaseClient } from '@supabase/supabase-js';

export type ReferralStatus =
  | 'pending'
  | 'referee_signed_up'
  | 'credited'
  | 'failed'
  | 'void';

/**
 * Append-only log of referral state transitions. Best-effort: failures are logged
 * but not thrown so they never block the user-facing flow.
 */
export async function recordReferralTransition(
  admin: SupabaseClient,
  params: {
    referralId: string;
    fromStatus: ReferralStatus | null;
    toStatus: ReferralStatus;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await admin.from('referral_audit').insert({
    referral_id: params.referralId,
    from_status: params.fromStatus,
    to_status: params.toStatus,
    detail: params.detail ?? null,
  });
  if (error) {
    console.error('[referrals/audit] insert failed', {
      referralId: params.referralId,
      from: params.fromStatus,
      to: params.toStatus,
      error: error.message,
    });
  }
}
