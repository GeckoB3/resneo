import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { loadAccountSafeGuests } from '@/lib/account/account-bookings';
import { ProfileClient } from './ProfileClient';
import { AccountPaymentMethodsSection } from '@/components/account/AccountPaymentMethodsSection';
import { AccountSecuritySection } from '@/components/account/AccountSecuritySection';
import { PageHeader } from '@/components/ui/dashboard/PageHeader';

/**
 * WCAG 2.4.2 (Level A): every page needs a title that describes it. Next
 * otherwise falls back to the root layout's title, so all thirteen portal
 * routes announced the same thing and a screen-reader user could not tell from
 * the tab or the announcement which one they were on.
 *
 * Scoped to the surviving routes, matching P0-5: P1-3 and P1-5 turn nine of
 * the thirteen into one-line redirects, and a redirect does not need a title.
 */
export const metadata = {
  title: 'Profile and preferences',
  description:
    'Your contact details, notification settings, saved cards, password and registered devices.',
};

/**
 * Where the retired routes land (P1-3). `/account/payment-methods` redirects to
 * `#payment-methods` and `/account/security` to `#password`, so these two ids
 * are part of the routing contract rather than decoration: renaming one breaks
 * a redirect, which `retired-routes.test.ts` asserts against this list.
 */
export const PROFILE_SECTION_ANCHORS = [
  { id: 'payment-methods', label: 'Saved payment methods' },
  { id: 'password', label: 'Password and account' },
] as const;

type ProfileRow = {
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  locale: string;
  timezone: string;
  default_login_destination: 'account' | 'dashboard' | 'ask' | null;
  notification_preferences: Record<string, unknown>;
};

export default async function AccountProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/login?redirectTo=/account/profile');
  }

  const { data: profileData } = await supabase.from('user_profiles').select('*').eq('id', user.id).maybeSingle();
  const profile = (profileData ?? {
    display_name: null,
    first_name: null,
    last_name: null,
    phone: null,
    locale: 'en-GB',
    timezone: 'Europe/London',
    default_login_destination: 'ask',
    notification_preferences: {},
  }) as ProfileRow;

  const [relationships, devicesResult] = await Promise.all([
    loadAccountSafeGuests(supabase),
    supabase
      .from('user_devices')
      .select('id, platform, device_name, last_seen_at, created_at')
      .eq('user_id', user.id)
      .order('last_seen_at', { ascending: false }),
  ]);

  const venueIds = [...new Set(relationships.map((r) => r.venue_id))];
  const { data: venues } =
    venueIds.length > 0
      ? await getSupabaseAdminClient().from('venues').select('id, name').in('id', venueIds)
      : { data: [] as Array<{ id: string; name: string }> };
  const venueMap = new Map((venues ?? []).map((v) => [v.id, v.name]));

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Account"
        title="Profile & preferences"
        subtitle="Your contact details, how you sign in, notification settings, venue marketing consent, saved cards and registered devices."
      />
      {/*
        P1-3 folded payment methods and security in here, so this page now runs
        to nine sections. Two of them are the target of a redirect and would
        otherwise be reachable only by scrolling past everything else, so the
        page says up front what is on it. Plain anchors, no JavaScript: they
        work before hydration and they are what the redirects already point at.
      */}
      <nav aria-label="On this page" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {PROFILE_SECTION_ANCHORS.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            className="inline-flex min-h-6 items-center font-medium text-brand-700 underline underline-offset-2"
          >
            {section.label}
          </a>
        ))}
      </nav>
      <ProfileClient
        initialEmail={user.email ?? ''}
        initialProfile={profile}
        marketingRelationships={relationships.map((r) => ({
          id: r.id,
          venueName: venueMap.get(r.venue_id) ?? 'Venue',
          marketing_consent: r.marketing_consent,
          marketing_consent_at: r.marketing_consent_at,
          marketing_opt_out: r.marketing_opt_out,
        }))}
        devices={(devicesResult.data ?? []) as Array<{
          id: string;
          platform: string;
          device_name: string | null;
          last_seen_at: string | null;
          created_at: string;
        }>}
      />

      {/*
        Everything below arrived from a route of its own (P1-3). Each keeps the
        heading and the section id it had, because the redirects point at those
        ids and because a customer who bookmarked "my saved cards" should still
        recognise what they land on.
      */}
      <AccountPaymentMethodsSection />
      <AccountSecuritySection />

      {/*
        Where "Set up your business" went (P1-2). It was a card on the hub,
        beside a customer's own bookings, which is the wrong pitch in the wrong
        place. It moved to the foot of `ProfileClient` then, and moves again
        now that two more sections sit below it: a page footer that is not at
        the foot of the page is just a line in the middle of one.
      */}
      <p className="border-t border-slate-200/80 pt-6 text-xs text-slate-500">
        Run a business?{' '}
        <a
          href="/signup/business-type"
          className="inline-flex min-h-6 items-center font-medium text-brand-700 underline underline-offset-2"
        >
          Take bookings on ResNeo
        </a>
        .
      </p>
    </div>
  );
}
