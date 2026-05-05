import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { ReportsView } from './ReportsView';
import { getDashboardStaff } from '@/lib/venue-auth';
import type { BookingModel, VenueTerminology } from '@/types/booking-models';
import { DEFAULT_TERMINOLOGY } from '@/types/booking-models';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { getSmsUsageDisplayForVenue } from '@/lib/billing/sms-usage-display';
import { PageFrame } from '@/components/ui/dashboard/PageFrame';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { Pill } from '@/components/ui/dashboard/Pill';

function mergeVenueTerminology(model: BookingModel, raw: unknown): VenueTerminology {
  const base = DEFAULT_TERMINOLOGY[model];
  if (!raw || typeof raw !== 'object') return base;
  const t = raw as Partial<VenueTerminology>;
  return {
    client: typeof t.client === 'string' ? t.client : base.client,
    booking: typeof t.booking === 'string' ? t.booking : base.booking,
    staff: typeof t.staff === 'string' ? t.staff : base.staff,
  };
}

export default async function ReportsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirectTo=/dashboard/reports');

  const staff = await getDashboardStaff(supabase);
  if (staff.role !== 'admin') {
    redirect('/dashboard');
  }

  const venueId = staff.venue_id;

  if (!venueId) {
    return (
      <PageFrame maxWidthClass="max-w-lg">
        <SectionCard elevated>
          <SectionCard.Body className="py-10 text-center">
            <p className="text-slate-600">No venue linked to your account.</p>
          </SectionCard.Body>
        </SectionCard>
      </PageFrame>
    );
  }

  const { data: venueRow, error: venueRowError } = await staff.db
    .from('venues')
    .select('booking_model, terminology, pricing_tier')
    .eq('id', venueId)
    .single();

  if (venueRowError) {
    console.error('[reports page] venue booking_model load failed:', venueRowError.message);
  }

  const bookingModel = (venueRow?.booking_model as BookingModel | null) ?? 'table_reservation';
  const pricingTier = (venueRow as { pricing_tier?: string | null } | null)?.pricing_tier ?? null;
  const terminology = mergeVenueTerminology(bookingModel, venueRow?.terminology);

  const admin = getSupabaseAdminClient();
  const smsUsage = await getSmsUsageDisplayForVenue(admin, venueId);

  return (
    <PageFrame maxWidthClass="max-w-5xl" className="space-y-6">
      {smsUsage ? (
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
                  On Appointments Light there is no included SMS bundle. Each Twilio segment is billed at £
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
      ) : null}
      <ReportsView
        bookingModel={bookingModel}
        terminology={terminology}
        venueId={venueId}
        pricingTier={pricingTier}
      />
    </PageFrame>
  );
}
