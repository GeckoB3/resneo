import { PageHeader } from '@/components/ui/dashboard/PageHeader';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import type { ReferralsDashboardData, ReferralDashboardStatus } from '@/lib/referrals/load-dashboard';
import { formatGbpPence } from '@/lib/referrals/constants';
import { explainReferralOutcome } from '@/lib/referrals/explain-outcome';
import { ReferAndEarnClient } from './ReferAndEarnClient';

export function ReferralsDashboardContent({ data }: { data: ReferralsDashboardData }) {
  const { referralsForUi, counts } = data;

  return (
    <>
      <PageHeader
        eyebrow="Refer & Earn"
        title="Refer a venue, get a free month"
        subtitle={
          <>
            Share your referral code with another venue. When they sign up and their first paid invoice
            settles, we&rsquo;ll add a <strong>{data.rewardDisplay} credit</strong> to your next ResNeo
            invoice and they&rsquo;ll get an extra free month on top of their 14-day trial.
          </>
        }
      />

      <div className="mt-6">
        <ReferAndEarnClient
          code={data.code}
          shareableLink={data.shareableLink}
          rewardDisplay={data.rewardDisplay}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SectionCard>
          <SectionCard.Body>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Credits earned</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{formatGbpPence(data.totalCreditedPence)}</p>
            <p className="mt-1 text-xs text-slate-500">
              Across {counts.credited} {counts.credited === 1 ? 'referral' : 'referrals'}.
            </p>
          </SectionCard.Body>
        </SectionCard>
        <SectionCard>
          <SectionCard.Body>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Credit on next invoice</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">
              {data.creditRemainingPence != null ? formatGbpPence(data.creditRemainingPence) : '—'}
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
                    {referralsForUi.map((row) => {
                      const explanation = explainReferralOutcome(row.status, row.voidReason);
                      const isMuted = row.status === 'void' || row.status === 'failed';
                      return (
                        <tr
                          key={row.id}
                          className={`border-t border-slate-100 align-top ${
                            isMuted ? 'text-slate-400' : 'text-slate-700'
                          }`}
                        >
                          <td className="px-6 py-3 font-medium">
                            <div>{row.refereeName}</div>
                            {explanation ? (
                              <p
                                className={`mt-1.5 text-xs font-normal leading-relaxed ${
                                  row.status === 'void' ? 'text-amber-700' : 'text-slate-500'
                                }`}
                              >
                                {explanation}
                              </p>
                            ) : null}
                          </td>
                          <td className="px-6 py-3">
                            <StatusPill status={row.status} label={row.statusLabel} />
                          </td>
                          <td className="px-6 py-3">{row.rewardDisplay ?? '—'}</td>
                          <td className="px-6 py-3 text-slate-500">{formatDate(row.occurredAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard.Body>
        </SectionCard>
      </div>
    </>
  );
}

function StatusPill({ status, label }: { status: ReferralDashboardStatus; label: string }) {
  const styles: Record<ReferralDashboardStatus, string> = {
    pending: 'bg-slate-100 text-slate-700',
    referee_signed_up: 'bg-amber-100 text-amber-900',
    credited: 'bg-brand-100 text-brand-900',
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
