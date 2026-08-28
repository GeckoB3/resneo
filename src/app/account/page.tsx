import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { authenticatedUserHasStaffMembership } from '@/lib/venue-auth';
import { PageHeader } from '@/components/ui/dashboard/PageHeader';
import { EmptyState } from '@/components/ui/dashboard/EmptyState';
import { NextBookingCard } from '@/components/account/NextBookingCard';
import { loadAccountHome } from '@/lib/account/account-home';

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
  title: 'My account',
  description: 'Your bookings, passes and profile in one place.',
};

const portalCardClass =
  'group relative flex flex-col rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/5 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-200/80 hover:shadow-md hover:shadow-brand-900/5';

/**
 * Four kinds, one per shortcut (P1-3). It carried seven when the grid listed
 * every route in the portal; `card`, `shield` and `spark` went with the four
 * cards they drew. Kept trimmed rather than left in place: an unused icon in a
 * portal mid-rebuild reads as a card someone deleted by mistake.
 */
type ShortcutIconKind = 'calendar' | 'user' | 'wallet' | 'building';

function AccountShortcutIcon({ kind }: { kind: ShortcutIconKind }) {
  const common = 'h-6 w-6 shrink-0';
  switch (kind) {
    case 'calendar':
      return (
        <svg className={`${common} text-brand-600`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5a2.25 2.25 0 0 0 2.25-2.25m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5a2.25 2.25 0 0 1 2.25 2.25v7.5" />
        </svg>
      );
    case 'user':
      return (
        <svg className={`${common} text-violet-600`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
        </svg>
      );
    case 'wallet':
      return (
        <svg className={`${common} text-amber-600`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 12m18 0v6a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 18v-6m18 0V9M3 12V9m18 3V9M3 12V9c0-.621.504-1.125 1.125-1.125h15.75c.621 0 1.125.504 1.125 1.125v3" />
        </svg>
      );
    default:
      return (
        <svg className={`${common} text-brand-700`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6.75H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
        </svg>
      );
  }
}

export default async function AccountHomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase.from('user_profiles').select('*').eq('id', user!.id).maybeSingle();

  const display =
    (profile as { display_name?: string | null } | null)?.display_name?.trim() ||
    user?.email ||
    'Guest';

  // An email address is not a name. Falling back to one wrapped the greeting
  // over four lines at 375px and pushed the next booking below the fold, which
  // is the one thing P1-2 requires to be above it.
  const hasName = Boolean(
    (profile as { display_name?: string | null } | null)?.display_name?.trim(),
  );
  const firstName = hasName ? (display.split(/\s+/)[0] ?? display) : null;
  const greeting = firstName ? `Welcome back, ${firstName}` : 'Welcome back';

  const admin = getSupabaseAdminClient();
  // The customer's own timezone is a DISPLAY fallback only: each booking is
  // rendered in its venue's zone, which is the zone its stored times are in.
  const profileTz = (profile?.timezone as string | null | undefined)?.trim() || null;
  const showVenueDashboard = await authenticatedUserHasStaffMembership(admin, user!.id, user?.email);

  /*
    Three shortcuts, not eleven (P1-3, closes G18).

    The grid used to list every route in the portal, which made it a third menu
    on top of the nav and the retired `/account/classes` hub, and it repeated
    the nav almost item for item. What is left mirrors the four primary nav
    items minus Help, which the footer and the nav both carry: a hub that
    answers "when is my next appointment" first (P1-2) does not need to answer
    "what pages exist" a second time in the same viewport.

    The retired destinations are not stranded. Events and resources are type
    filters on Bookings, credits, courses, memberships and recurring are tabs
    on Passes and plans, and payments and security are sections of Profile.
  */
  const shortcuts: Array<{
    href: string;
    title: string;
    description: string;
    icon: ShortcutIconKind;
  }> = [
    {
      href: '/account/bookings',
      title: 'Bookings',
      description: 'Every reservation and visit, including events and resources.',
      icon: 'calendar',
    },
    {
      href: '/account/passes',
      title: 'Passes and plans',
      description: 'Credits, courses, memberships and repeat bookings.',
      icon: 'wallet',
    },
    {
      href: '/account/profile',
      title: 'Profile',
      description: 'Contact details, saved cards, password and notifications.',
      icon: 'user',
    },
    ...(showVenueDashboard
      ? [
          {
            href: '/dashboard',
            title: 'Venue dashboard',
            description: 'Staff tools for your restaurant or venue.',
            icon: 'building' as const,
          },
        ]
      : []),
  ];

  const home = await loadAccountHome(supabase, admin);

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Overview"
        title={greeting}
      />

      {/*
        The hub answers "when is my next appointment" before it offers a menu
        (P1-2, G1). It used to be a grid of links to other pages, so the most
        common reason to open a customer portal was the one thing it did not
        answer.
      */}
      {home.next_booking ? (
        <NextBookingCard
          booking={home.next_booking}
          appointment={home.next_booking_appointment}
          formLinks={home.next_booking_form_links}
          profileTz={profileTz}
        />
      ) : (
        <EmptyState
          title="No upcoming bookings"
          description="When you book with a venue on ResNeo, your next appointment appears here."
          action={
            <Link
              href="/account/bookings"
              className="inline-flex min-h-10 items-center justify-center rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
            >
              See your booking history
            </Link>
          }
        />
      )}

      {home.upcoming_count > 1 ? (
        <p className="text-sm text-slate-600">
          You have{' '}
          <Link
            href="/account/bookings?filter=upcoming"
            className="inline-flex min-h-6 items-center font-semibold text-brand-700 underline underline-offset-2"
          >
            {home.upcoming_count} upcoming bookings
          </Link>{' '}
          across {home.venues.length} {home.venues.length === 1 ? 'venue' : 'venues'}.
        </p>
      ) : null}

      <section aria-labelledby="account-shortcuts-heading">
        <h2 id="account-shortcuts-heading" className="sr-only">
          Account shortcuts
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shortcuts.map((item) => (
            <Link key={item.href} href={item.href} className={portalCardClass}>
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-50 ring-1 ring-slate-100 transition-colors group-hover:bg-white group-hover:ring-brand-100">
                  <AccountShortcutIcon kind={item.icon} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900">{item.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-slate-600">{item.description}</p>
                </div>
                <svg
                  className="mt-1 h-5 w-5 shrink-0 text-slate-300 transition-colors group-hover:text-brand-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                  aria-hidden
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
