import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { buildDashboardHomePayload } from '@/lib/dashboard/dashboard-home-payload';
import { computeSetupStatus } from '@/lib/venue/compute-setup-status';
import { DashboardHomeClient } from './DashboardHomeClient';
import { REFERRAL_REFEREE_BONUS_DAYS } from '@/lib/referrals/constants';

export default async function DashboardHomePage() {
  const supabase = await createClient();

  const staff = await getVenueStaff(supabase);
  if (!staff) redirect('/login?redirectTo=/dashboard');

  const admin = getSupabaseAdminClient();
  let initialData;
  try {
    initialData = await buildDashboardHomePayload(admin, staff);
  } catch (e) {
    console.error('[dashboard home] build payload failed:', e);
    return (
      <div className="flex flex-col items-center justify-center p-16 text-center">
        <p className="text-sm font-medium text-slate-700">Unable to load dashboard</p>
        <p className="mt-1 text-xs text-slate-500">Please try refreshing the page.</p>
      </div>
    );
  }

  const setupStatusFromServer = staff.role === 'admin' ? await computeSetupStatus(staff) : null;

  // Referral programme: if this venue was signed up via a referral and is still trialling,
  // surface a small banner above the dashboard explaining the extended trial.
  const refereeBanner = await loadRefereeBannerData(admin, staff.venue_id);

  return (
    <>
      {refereeBanner ? (
        <div className="mx-auto w-full max-w-[1400px] px-4 pt-4 sm:px-6 lg:px-8">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            <span className="font-medium">Your referral month is active.</span>{' '}
            Trial: 14 days + {REFERRAL_REFEREE_BONUS_DAYS} days referral credit.{' '}
            {refereeBanner.trialEndDisplay
              ? `Your first charge will be on ${refereeBanner.trialEndDisplay}.`
              : ''}
          </div>
        </div>
      ) : null}
      <DashboardHomeClient
        initialData={initialData}
        setupStatusFromServer={setupStatusFromServer}
        disableClientSetupFetch
        venueId={staff.venue_id}
      />
    </>
  );
}

async function loadRefereeBannerData(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  venueId: string,
): Promise<{ trialEndDisplay: string | null } | null> {
  try {
    const { data: referral } = await admin
      .from('referrals')
      .select('id, status')
      .eq('referred_venue_id', venueId)
      .maybeSingle();
    if (!referral || (referral as { status: string }).status !== 'referee_signed_up') {
      return null;
    }
    const { data: venue } = await admin
      .from('venues')
      .select('plan_status, subscription_current_period_end')
      .eq('id', venueId)
      .maybeSingle();
    if (!venue || (venue as { plan_status?: string }).plan_status !== 'trialing') return null;
    const iso = (venue as { subscription_current_period_end?: string | null }).subscription_current_period_end;
    let trialEndDisplay: string | null = null;
    if (iso) {
      try {
        trialEndDisplay = new Date(iso).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        });
      } catch {
        trialEndDisplay = null;
      }
    }
    return { trialEndDisplay };
  } catch (e) {
    console.warn('[dashboard home] referee banner load failed', { e });
    return null;
  }
}
