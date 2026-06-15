/**
 * Server-side referral code lookup + validation. Used by:
 *   - GET /api/referrals/validate
 *   - POST /api/signup/create-checkout (server-side re-validation)
 *   - Venue creation paths (re-resolve referrer_venue_id before insert)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { REFERRER_GOOD_STANDING_STATUSES } from './constants';

export interface ValidatedReferral {
  code: string;
  referrer_venue_id: string;
  referrer_venue_name: string;
}

export type ReferralValidationFailure =
  | 'not_found'
  | 'inactive'
  | 'referrer_not_in_good_standing'
  | 'invalid_input';

export type ReferralValidationResult =
  | { ok: true; value: ValidatedReferral }
  | { ok: false; reason: ReferralValidationFailure };

const CODE_PATTERN = /^[A-Z0-9-]{3,40}$/;

export function normaliseReferralCodeInput(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toUpperCase();
  if (!trimmed) return null;
  if (!CODE_PATTERN.test(trimmed)) return null;
  return trimmed;
}

/**
 * Look up a referral code and verify the owning venue is in good standing.
 * Uses the admin client so RLS doesn't block (this endpoint is intentionally
 * world-callable for the public signup page).
 */
export async function validateReferralCode(
  admin: SupabaseClient,
  rawCode: string | null | undefined,
): Promise<ReferralValidationResult> {
  const normalised = normaliseReferralCodeInput(rawCode);
  if (!normalised) return { ok: false, reason: 'invalid_input' };

  // Two-step lookup avoids PostgREST join-shape ambiguity (the join can resolve to either
  // an object or an array depending on FK inference, especially across Supabase versions).
  const { data: codeRow, error: codeErr } = await admin
    .from('referral_codes')
    .select('code, active, venue_id')
    .ilike('code', normalised)
    .maybeSingle();

  if (codeErr) {
    console.error('[referrals/lookup] code lookup failed', { code: normalised, error: codeErr.message });
    return { ok: false, reason: 'not_found' };
  }
  if (!codeRow) return { ok: false, reason: 'not_found' };
  if (codeRow.active === false) return { ok: false, reason: 'inactive' };

  const { data: venueRow, error: venueErr } = await admin
    .from('venues')
    .select('id, name, plan_status')
    .eq('id', codeRow.venue_id)
    .maybeSingle();
  if (venueErr || !venueRow) return { ok: false, reason: 'not_found' };

  const venue = venueRow as { id: string; name: string | null; plan_status: string | null };
  const planStatus = (venue.plan_status ?? '').toLowerCase();
  if (!REFERRER_GOOD_STANDING_STATUSES.has(planStatus)) {
    return { ok: false, reason: 'referrer_not_in_good_standing' };
  }

  return {
    ok: true,
    value: {
      code: codeRow.code,
      referrer_venue_id: venue.id,
      referrer_venue_name: (venue.name ?? '').trim() || 'A ResNeo venue',
    },
  };
}
