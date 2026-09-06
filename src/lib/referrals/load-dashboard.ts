import { stripe } from '@/lib/stripe';
import { ensureReferralCodeForVenue } from '@/lib/referrals/code';
import {
  formatGbpPence,
  referralProgrammeEnabled,
  referralRewardPenceForTier,
} from '@/lib/referrals/constants';
import { normalizePublicBaseUrl } from '@/lib/public-base-url';
import type { SupabaseClient } from '@supabase/supabase-js';

export type ReferralDashboardStatus =
  | 'pending'
  | 'referee_signed_up'
  | 'credited'
  | 'failed'
  | 'void';

export interface ReferralRowForUi {
  id: string;
  refereeName: string;
  status: ReferralDashboardStatus;
  statusLabel: string;
  rewardDisplay: string | null;
  occurredAt: string;
  voidReason: string | null;
}

export interface ReferralsDashboardData {
  code: string;
  shareableLink: string;
  rewardDisplay: string;
  referrerVenueName: string;
  referralsForUi: ReferralRowForUi[];
  totalCreditedPence: number;
  creditRemainingPence: number | null;
  counts: {
    total: number;
    credited: number;
    pending: number;
  };
}

const STATUS_LABEL: Record<ReferralDashboardStatus, string> = {
  pending: 'Pending',
  referee_signed_up: 'Signed up, trialling',
  credited: 'Credited',
  failed: 'Did not convert',
  void: 'Void',
};

interface ReferralRow {
  id: string;
  status: ReferralDashboardStatus;
  referrer_credit_amount_pence: number | null;
  referrer_credited_at: string | null;
  created_at: string;
  referred_venue_id: string | null;
  void_reason: string | null;
}

/** Server-side payload for Refer & Earn dashboard UI (settings tab or legacy page). */
export async function loadReferralsDashboardForVenue(
  admin: SupabaseClient,
  venueId: string,
): Promise<ReferralsDashboardData | null> {
  if (!referralProgrammeEnabled()) {
    return null;
  }

  const { data: venue } = await admin
    .from('venues')
    .select('id, name, pricing_tier, stripe_customer_id')
    .eq('id', venueId)
    .maybeSingle();

  const venueName = venue?.name?.trim() || 'Your venue';
  const pricingTier = (venue?.pricing_tier ?? '').toLowerCase();

  const ensured = await ensureReferralCodeForVenue({
    admin,
    venueId,
    venueName,
  });
  const code = ensured?.code ?? '';

  const { data: rawReferrals } = await admin
    .from('referrals')
    .select(
      'id, status, referrer_credit_amount_pence, referrer_credited_at, created_at, referred_venue_id, void_reason',
    )
    .eq('referrer_venue_id', venueId)
    .order('created_at', { ascending: false });

  const refereeIds = (rawReferrals ?? [])
    .map((r) => (r as ReferralRow).referred_venue_id)
    .filter((id): id is string => Boolean(id));

  let refereeNamesById: Record<string, string> = {};
  if (refereeIds.length > 0) {
    const { data: refereeRows } = await admin.from('venues').select('id, name').in('id', refereeIds);
    refereeNamesById = Object.fromEntries(
      (refereeRows ?? []).map((r) => {
        const row = r as { id: string; name: string | null };
        return [row.id, (row.name ?? '').trim() || 'A new venue'] as const;
      }),
    );
  }

  const referralsForUi: ReferralRowForUi[] = (rawReferrals ?? []).map((row) => {
    const r = row as ReferralRow;
    const refereeName = r.referred_venue_id
      ? refereeNamesById[r.referred_venue_id] ?? 'A new venue'
      : 'Pending signup';
    return {
      id: r.id,
      refereeName,
      status: r.status,
      statusLabel: STATUS_LABEL[r.status],
      rewardDisplay:
        r.referrer_credit_amount_pence != null ? formatGbpPence(r.referrer_credit_amount_pence) : null,
      occurredAt: r.referrer_credited_at ?? r.created_at,
      voidReason: r.void_reason,
    };
  });

  const totalCreditedPence = (rawReferrals ?? [])
    .filter((r) => (r as ReferralRow).status === 'credited')
    .reduce((sum, r) => sum + ((r as ReferralRow).referrer_credit_amount_pence ?? 0), 0);

  let creditRemainingPence: number | null = null;
  if (venue?.stripe_customer_id) {
    try {
      const customer = await stripe.customers.retrieve(venue.stripe_customer_id);
      if (!('deleted' in customer) || customer.deleted !== true) {
        const balance = (customer as { balance?: number }).balance ?? 0;
        creditRemainingPence = balance < 0 ? -balance : 0;
      }
    } catch (e) {
      console.warn('[referrals] customer balance load failed', { e });
    }
  }

  const rewardDisplay = formatGbpPence(referralRewardPenceForTier(pricingTier));
  const origin = normalizePublicBaseUrl(process.env.NEXT_PUBLIC_BASE_URL);
  const shareableLink = code ? `${origin}/signup/choose-plan?ref=${encodeURIComponent(code)}` : '';

  return {
    code,
    shareableLink,
    rewardDisplay,
    referrerVenueName: venueName,
    referralsForUi,
    totalCreditedPence,
    creditRemainingPence,
    counts: {
      total: referralsForUi.length,
      credited: referralsForUi.filter((r) => r.status === 'credited').length,
      pending: referralsForUi.filter((r) => r.status === 'referee_signed_up' || r.status === 'pending').length,
    },
  };
}
