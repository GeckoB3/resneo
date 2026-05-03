import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { OnboardingLogoutButton } from '@/components/onboarding/OnboardingLogoutButton';
import { isPlatformSuperuser } from '@/lib/platform-auth';
import { hasActiveVenueSupportSession } from '@/lib/support-session-server';
import { resolveActiveBookingModels } from '@/lib/booking/active-models';
import { isAppointmentPlanTier } from '@/lib/tier-enforcement';
import { getVenueStaff } from '@/lib/venue-auth';

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect('/login?redirectTo=/onboarding');
  }
  if (user && isPlatformSuperuser(user)) {
    const allowVenueShell = await hasActiveVenueSupportSession(supabase);
    if (!allowVenueShell) {
      redirect('/super');
    }
  }
  const staff = await getVenueStaff(supabase);
  if (!staff) {
    redirect('/signup/business-type');
  }
  const { data: venue } = await staff.db
    .from('venues')
    .select('booking_model, enabled_models, active_booking_models, pricing_tier, onboarding_completed')
    .eq('id', staff.venue_id)
    .maybeSingle();

  if (!venue) {
    redirect('/signup/business-type');
  }
  if ((venue as { onboarding_completed?: boolean | null }).onboarding_completed === true) {
    redirect('/dashboard');
  }

  const v = venue as {
    booking_model?: string | null;
    enabled_models?: unknown;
    active_booking_models?: unknown;
    pricing_tier?: string | null;
  };
  const activeModels = resolveActiveBookingModels({
    pricingTier: v.pricing_tier,
    bookingModel: v.booking_model,
    enabledModels: v.enabled_models,
    activeBookingModels: v.active_booking_models,
  });
  if (isAppointmentPlanTier(v.pricing_tier) && activeModels.length === 0) {
    redirect('/signup/booking-models');
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <nav className="border-b border-slate-100 bg-white/80 backdrop-blur-md">
        <div className="mx-auto grid max-w-4xl grid-cols-3 items-center px-6 py-4">
          <div aria-hidden className="min-w-0" />
          <div className="flex justify-center">
            <Link href="/" className="flex-shrink-0">
              <img src="/Logo.png" alt="ReserveNI" className="h-9 w-auto" />
            </Link>
          </div>
          <div className="flex min-w-0 justify-end">
            <OnboardingLogoutButton />
          </div>
        </div>
      </nav>
      <main className="flex flex-1 items-start justify-center px-4 py-12 sm:py-16">
        {children}
      </main>
    </div>
  );
}
