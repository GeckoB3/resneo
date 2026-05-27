/**
 * Wire a new venue to the pending referral. Called from BOTH venue-creation paths
 * (signup-complete API + checkout webhook) so whichever fires first wins, and the
 * second is a no-op thanks to UNIQUE(referred_venue_id) on referrals.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { validateReferralCode } from './lookup';
import { detectSelfReferral } from './anti-abuse';
import { recordReferralTransition } from './audit';
import { referralProgrammeEnabled } from './constants';

interface AttachReferralParams {
  admin: SupabaseClient;
  referralCode: string | null | undefined;
  referredVenueId: string;
  refereeEmail: string | null | undefined;
}

export async function attachReferralOnSignup(
  params: AttachReferralParams,
): Promise<void> {
  const { admin, referralCode, referredVenueId, refereeEmail } = params;
  if (!referralCode) return;
  if (!referralProgrammeEnabled()) return;

  // Idempotent: if a referral row already exists for this referred venue, do nothing.
  const { data: existing } = await admin
    .from('referrals')
    .select('id, status')
    .eq('referred_venue_id', referredVenueId)
    .maybeSingle();
  if (existing) {
    console.log('[referrals/attach] referral row already exists for venue', {
      referredVenueId,
      status: (existing as { status?: string }).status,
    });
    return;
  }

  const validation = await validateReferralCode(admin, referralCode);
  if (!validation.ok) {
    console.warn('[referrals/attach] referral code failed validation at venue creation', {
      referredVenueId,
      reason: validation.reason,
    });
    return;
  }

  const referrerVenueId = validation.value.referrer_venue_id;

  // Self-referral guard. On hit, write a void row so we have an audit trail.
  const selfReferralReason = await detectSelfReferral({
    admin,
    referrerVenueId,
    referredVenueId,
    refereeEmail,
  });

  if (selfReferralReason) {
    const { data: voidRow } = await admin
      .from('referrals')
      .insert({
        code: validation.value.code,
        referrer_venue_id: referrerVenueId,
        referred_venue_id: referredVenueId,
        status: 'void',
        void_reason: selfReferralReason,
      })
      .select('id')
      .maybeSingle();
    if (voidRow?.id) {
      await recordReferralTransition(admin, {
        referralId: (voidRow as { id: string }).id,
        fromStatus: null,
        toStatus: 'void',
        detail: { reason: selfReferralReason },
      });
    }
    return;
  }

  const { data: inserted, error: insErr } = await admin
    .from('referrals')
    .insert({
      code: validation.value.code,
      referrer_venue_id: referrerVenueId,
      referred_venue_id: referredVenueId,
      status: 'referee_signed_up',
      referee_trial_applied_at: new Date().toISOString(),
    })
    .select('id')
    .maybeSingle();

  if (insErr) {
    // unique_violation on referred_venue_id = the other path beat us. Safe to ignore.
    const code = (insErr as { code?: string }).code;
    if (code === '23505' || /duplicate key/i.test(insErr.message ?? '')) {
      return;
    }
    console.error('[referrals/attach] insert failed', {
      referredVenueId,
      referrerVenueId,
      error: insErr.message,
    });
    return;
  }

  if (inserted?.id) {
    await recordReferralTransition(admin, {
      referralId: (inserted as { id: string }).id,
      fromStatus: null,
      toStatus: 'referee_signed_up',
      detail: { code: validation.value.code },
    });
  }
}
