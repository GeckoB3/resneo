'use client';

import useSWR from 'swr';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { Pill } from '@/components/ui/dashboard/Pill';
import { DashboardChartSkeleton } from '@/components/ui/dashboard/DashboardSkeletons';
import type { SmsUsageDisplay } from '@/lib/billing/sms-usage-display';

async function fetchSmsUsage(): Promise<SmsUsageDisplay | null> {
  const res = await fetch('/api/venue/sms-usage-display', { credentials: 'same-origin' });
  if (!res.ok) return null;
  const body = (await res.json()) as { usage?: SmsUsageDisplay | null };
  return body.usage ?? null;
}

export function SmsUsageBanner() {
  const { data: smsUsage, isLoading } = useSWR('venue-sms-usage-display', fetchSmsUsage, {
    revalidateOnFocus: false,
    dedupingInterval: 120_000,
  });

  if (isLoading) {
    return (
      <SectionCard elevated>
        <SectionCard.Header eyebrow="Usage" title="SMS segments this period" />
        <SectionCard.Body>
          <div className="h-20 animate-pulse rounded-xl bg-slate-100" aria-hidden />
        </SectionCard.Body>
      </SectionCard>
    );
  }

  if (!smsUsage) return null;

  return (
    <SectionCard elevated>
      <SectionCard.Header eyebrow="Usage" title="SMS segments this period" />
      <SectionCard.Body className="space-y-3">
        {smsUsage.billing_mode === 'light_metered' ? (
          <>
            <p className="text-sm text-slate-700">
              <span className="font-semibold text-slate-900">{smsUsage.messages_sent}</span>
              {' SMS segments used this period'}
            </p>
            <p className="text-xs leading-relaxed text-slate-600">
              On Appointments Light there is no included SMS bundle. Each SMS segment is billed at £
              {smsUsage.billable_unit_gbp.toFixed(2)} through Stripe Billing Meters.
            </p>
            {smsUsage.messages_sent > 0 ? (
              <div className="flex flex-wrap items-start gap-2 rounded-xl border border-slate-200/90 bg-slate-50/80 px-3 py-2.5 text-sm text-slate-800">
                <Pill variant="neutral" size="sm" dot>
                  Estimated this month
                </Pill>
                <span>
                  About £{(smsUsage.overage_amount_pence / 100).toFixed(2)} for {smsUsage.messages_sent}{' '}
                  {smsUsage.messages_sent === 1 ? 'segment' : 'segments'} at £{smsUsage.billable_unit_gbp.toFixed(2)}{' '}
                  each (before invoice). Final amounts appear on your Stripe subscription invoice at period end.
                </span>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <div className="h-2 min-w-[100px] flex-1 max-w-sm overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-brand-500"
                  style={{
                    width: `${Math.min(
                      100,
                      smsUsage.messages_included > 0
                        ? (smsUsage.messages_sent / smsUsage.messages_included) * 100
                        : 0,
                    )}%`,
                  }}
                />
              </div>
              <p className="text-sm text-slate-700">
                <span className="font-semibold text-slate-900">{smsUsage.messages_sent}</span>
                {' / '}
                {smsUsage.messages_included} included
                <span className="text-slate-500"> ({smsUsage.remaining} left)</span>
              </p>
            </div>
            {smsUsage.overage_count > 0 ? (
              <div className="flex flex-wrap items-start gap-2 rounded-xl border border-amber-200/80 bg-amber-50/60 px-3 py-2.5 text-sm text-amber-950">
                <Pill variant="warning" size="sm" dot>
                  Overage
                </Pill>
                <span>
                  {smsUsage.overage_count} SMS segments beyond your included allowance — about £
                  {(smsUsage.overage_amount_pence / 100).toFixed(2)} at £{smsUsage.billable_unit_gbp.toFixed(2)} each.
                  Overage is metered against the current Stripe subscription period.
                </span>
              </div>
            ) : null}
          </>
        )}
      </SectionCard.Body>
    </SectionCard>
  );
}
