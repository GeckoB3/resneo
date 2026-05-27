import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { stripe } from '@/lib/stripe';
import { getVenueStaff } from '@/lib/venue-auth';
import { ensureReferralCodeForVenue } from '@/lib/referrals/code';
import {
  formatGbpPence,
  referralProgrammeEnabled,
  referralRewardPenceForTier,
} from '@/lib/referrals/constants';
import { normalizePublicBaseUrl } from '@/lib/public-base-url';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, max-age=0' } as const;

interface ReferralRow {
  id: string;
  code: string;
  status: 'pending' | 'referee_signed_up' | 'credited' | 'failed' | 'void';
  referrer_credit_amount_pence: number | null;
  referrer_credited_at: string | null;
  created_at: string;
  referred_venue_id: string | null;
  void_reason: string | null;
}

interface RefereeNameRow {
  id: string;
  name: string | null;
}

/**
 * GET /api/referrals/me — bundles everything the Refer & Earn page needs.
 * Lets client-side code refresh after share interactions without a full page reload.
 */
export async function GET() {
  if (!referralProgrammeEnabled()) {
    return NextResponse.json({ error: 'Referral programme disabled' }, { status: 404, headers: NO_STORE_HEADERS });
  }

  const supabase = await createClient();
  const staff = await getVenueStaff(supabase);
  if (!staff) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401, headers: NO_STORE_HEADERS });
  }

  const admin = staff.db;

  const { data: venue } = await admin
    .from('venues')
    .select('id, name, pricing_tier, stripe_customer_id')
    .eq('id', staff.venue_id)
    .maybeSingle();

  const venueName = venue?.name?.trim() || 'Your venue';
  const tier = (venue?.pricing_tier ?? '').toLowerCase();

  const ensured = await ensureReferralCodeForVenue({
    admin,
    venueId: staff.venue_id,
    venueName,
  });
  const code = ensured?.code ?? '';

  const { data: rows } = await admin
    .from('referrals')
    .select('id, code, status, referrer_credit_amount_pence, referrer_credited_at, created_at, referred_venue_id, void_reason')
    .eq('referrer_venue_id', staff.venue_id)
    .order('created_at', { ascending: false });

  const refereeIds = (rows ?? [])
    .map((r) => (r as ReferralRow).referred_venue_id)
    .filter((id): id is string => Boolean(id));

  let refereeNamesById: Record<string, string> = {};
  if (refereeIds.length > 0) {
    const { data: refereeRows } = await admin
      .from('venues')
      .select('id, name')
      .in('id', refereeIds);
    refereeNamesById = Object.fromEntries(
      (refereeRows ?? []).map((r) => {
        const row = r as RefereeNameRow;
        return [row.id, (row.name ?? '').trim() || 'A new venue'] as const;
      }),
    );
  }

  const referrals = (rows ?? []).map((row) => {
    const r = row as ReferralRow;
    return {
      id: r.id,
      status: r.status,
      reward_pence: r.referrer_credit_amount_pence,
      reward_display: r.referrer_credit_amount_pence != null ? formatGbpPence(r.referrer_credit_amount_pence) : null,
      occurred_at: r.referrer_credited_at ?? r.created_at,
      referee_name: r.referred_venue_id ? (refereeNamesById[r.referred_venue_id] ?? 'A new venue') : null,
      void_reason: r.void_reason,
    };
  });

  let creditRemainingPence: number | null = null;
  if (venue?.stripe_customer_id) {
    try {
      const customer = await stripe.customers.retrieve(venue.stripe_customer_id);
      if (!('deleted' in customer) || customer.deleted !== true) {
        const balance = (customer as { balance?: number }).balance ?? 0;
        creditRemainingPence = balance < 0 ? -balance : 0;
      }
    } catch (e) {
      console.warn('[api/referrals/me] balance load failed', { e });
    }
  }

  const origin = normalizePublicBaseUrl(process.env.NEXT_PUBLIC_BASE_URL);
  const shareableLink = code ? `${origin}/signup?ref=${encodeURIComponent(code)}` : '';
  const rewardPence = referralRewardPenceForTier(tier);

  return NextResponse.json(
    {
      code,
      shareable_link: shareableLink,
      reward_pence: rewardPence,
      reward_display: formatGbpPence(rewardPence),
      venue_name: venueName,
      credit_remaining_pence: creditRemainingPence,
      referrals,
    },
    { headers: NO_STORE_HEADERS },
  );
}
