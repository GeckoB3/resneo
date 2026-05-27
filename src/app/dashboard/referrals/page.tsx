import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { stripe } from '@/lib/stripe';
import { getDashboardStaff } from '@/lib/venue-auth';
import { ensureReferralCodeForVenue } from '@/lib/referrals/code';
import {
  formatGbpPence,
  referralProgrammeEnabled,
  referralRewardPenceForTier,
} from '@/lib/referrals/constants';
import { normalizePublicBaseUrl } from '@/lib/public-base-url';
import { PageFrame } from '@/components/ui/dashboard/PageFrame';
import { PageHeader } from '@/components/ui/dashboard/PageHeader';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { ReferAndEarnClient } from './ReferAndEarnClient';

export const dynamic = 'force-dynamic';

interface ReferralRow {
  id: string;
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

interface ReferralRowForUi {
  id: string;
  refereeName: string;
  status: ReferralRow['status'];
  statusLabel: string;
  rewardDisplay: string | null;
  occurredAt: string;
  voidReason: string | null;
}

const STATUS_LABEL: Record<ReferralRow['status'], string> = {
  pending: 'Pending',
  referee_signed_up: 'Signed up — trialling',
  credited: 'Credited',
  failed: 'Did not convert',
  void: 'Void',
};

export default async function ReferralsPage() {
  if (!referralProgrammeEnabled()) {
    redirect('/dashboard');
  }

  const supabase = await createClient();
  const staff = await getDashboardStaff(supabase);
  if (!staff?.venue_id) {
    redirect('/login?redirectTo=/dashboard/referrals');
  }

  const admin = staff.db;

  // Venue context.
  const { data: venue } = await admin
    .from('venues')
    .select('id, name, pricing_tier, stripe_customer_id')
    .eq('id', staff.venue_id)
    .maybeSingle();

  const venueName = venue?.name?.trim() || 'Your venue';
  const pricingTier = (venue?.pricing_tier ?? '').toLowerCase();

  // Ensure a code exists (lazy creation for venues older than the backfill).
  const ensured = await ensureReferralCodeForVenue({
    admin,
    venueId: staff.venue_id,
    venueName,
  });
  const code = ensured?.code ?? '';

  // Referrals authored by this venue.
  const { data: rawReferrals } = await admin
    .from('referrals')
    .select('id, status, referrer_credit_amount_pence, referrer_credited_at, created_at, referred_venue_id, void_reason')
    .eq('referrer_venue_id', staff.venue_id)
    .order('created_at', { ascending: false });

  const refereeIds = (rawReferrals ?? [])
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

  const referralsForUi: ReferralRowForUi[] = (rawReferrals ?? []).map((row) => {
    const r = row as ReferralRow;
    const refereeName = r.referred_venue_id ? refereeNamesById[r.referred_venue_id] ?? 'A new venue' : 'Pending signup';
    return {
      id: r.id,
      refereeName,
      status: r.status,
      statusLabel: STATUS_LABEL[r.status],
      rewardDisplay: r.referrer_credit_amount_pence != null ? formatGbpPence(r.referrer_credit_amount_pence) : null,
      occurredAt: r.referrer_credited_at ?? r.created_at,
      voidReason: r.void_reason,
    };
  });

  const totalCreditedPence = (rawReferrals ?? [])
    .filter((r) => (r as ReferralRow).status === 'credited')
    .reduce((sum, r) => sum + ((r as ReferralRow).referrer_credit_amount_pence ?? 0), 0);

  // Stripe customer balance — negative means credit available to the customer.
  let creditRemainingPence: number | null = null;
  if (venue?.stripe_customer_id) {
    try {
      const customer = await stripe.customers.retrieve(venue.stripe_customer_id);
      if (!('deleted' in customer) || customer.deleted !== true) {
        const balance = (customer as { balance?: number }).balance ?? 0;
        // A negative balance = credit owed *to* the customer. Convert to a positive pence figure.
        creditRemainingPence = balance < 0 ? -balance : 0;
      }
    } catch (e) {
      console.warn('[referrals] customer balance load failed', { e });
    }
  }

  const rewardPenceForThisTier = referralRewardPenceForTier(pricingTier);
  const rewardDisplay = formatGbpPence(rewardPenceForThisTier);

  const origin = normalizePublicBaseUrl(process.env.NEXT_PUBLIC_BASE_URL);
  const shareableLink = code ? `${origin}/signup?ref=${encodeURIComponent(code)}` : '';

  const counts = {
    total: referralsForUi.length,
    credited: referralsForUi.filter((r) => r.status === 'credited').length,
    pending: referralsForUi.filter((r) => r.status === 'referee_signed_up' || r.status === 'pending').length,
  };

  return (
    <PageFrame>
      <PageHeader
        eyebrow="Refer & Earn"
        title="Refer a venue, get a free month"
        subtitle={
          <>
            Share your referral code with another venue. When they sign up and their first paid invoice
            settles, we&rsquo;ll add a <strong>{rewardDisplay} credit</strong> to your next ReserveNI invoice
            and they&rsquo;ll get an extra free month on top of their 14-day trial.
          </>
        }
      />

      <div className="mt-6">
        <ReferAndEarnClient
          code={code}
          shareableLink={shareableLink}
          rewardDisplay={rewardDisplay}
          referrerVenueName={venueName}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SectionCard>
          <SectionCard.Body>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Credits earned</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{formatGbpPence(totalCreditedPence)}</p>
            <p className="mt-1 text-xs text-slate-500">Across {counts.credited} {counts.credited === 1 ? 'referral' : 'referrals'}.</p>
          </SectionCard.Body>
        </SectionCard>
        <SectionCard>
          <SectionCard.Body>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Credit on next invoice</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">
              {creditRemainingPence != null ? formatGbpPence(creditRemainingPence) : '—'}
            </p>
            <p className="mt-1 text-xs text-slate-500">Applied automatically by Stripe.</p>
          </SectionCard.Body>
        </SectionCard>
        <SectionCard>
          <SectionCard.Body>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">In progress</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{counts.pending}</p>
            <p className="mt-1 text-xs text-slate-500">Trialling now — credits when they pay.</p>
          </SectionCard.Body>
        </SectionCard>
      </div>

      <div className="mt-6">
        <SectionCard>
          <SectionCard.Header
            title="Your referrals"
            description="Status updates automatically once the venue pays their first invoice."
          />
          <SectionCard.Body className="px-0 py-0 sm:px-0 sm:py-0">
            {referralsForUi.length === 0 ? (
              <div className="px-6 py-10 text-center text-sm text-slate-500">
                No referrals yet. Share your code above to get started.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-slate-50/70 text-left text-xs font-semibold uppercase tracking-widest text-slate-500">
                    <tr>
                      <th className="px-6 py-3">Venue</th>
                      <th className="px-6 py-3">Status</th>
                      <th className="px-6 py-3">Credit</th>
                      <th className="px-6 py-3">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {referralsForUi.map((row) => (
                      <tr
                        key={row.id}
                        className={`border-t border-slate-100 ${
                          row.status === 'void' || row.status === 'failed' ? 'text-slate-400' : 'text-slate-700'
                        }`}
                      >
                        <td className="px-6 py-3 font-medium">{row.refereeName}</td>
                        <td className="px-6 py-3">
                          <StatusPill status={row.status} label={row.statusLabel} />
                        </td>
                        <td className="px-6 py-3">{row.rewardDisplay ?? '—'}</td>
                        <td className="px-6 py-3 text-slate-500">{formatDate(row.occurredAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard.Body>
        </SectionCard>
      </div>
    </PageFrame>
  );
}

function StatusPill({ status, label }: { status: ReferralRow['status']; label: string }) {
  const styles: Record<ReferralRow['status'], string> = {
    pending: 'bg-slate-100 text-slate-700',
    referee_signed_up: 'bg-amber-100 text-amber-900',
    credited: 'bg-emerald-100 text-emerald-900',
    failed: 'bg-slate-100 text-slate-500',
    void: 'bg-slate-100 text-slate-400',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${styles[status]}`}>
      {label}
    </span>
  );
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return '—';
  }
}
