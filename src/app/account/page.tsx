import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { authenticatedUserHasStaffMembership } from '@/lib/venue-auth';
import { PageHeader } from '@/components/ui/dashboard/PageHeader';

const portalCardClass =
  'group relative flex flex-col rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/5 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-200/80 hover:shadow-md hover:shadow-brand-900/5';

type ShortcutIconKind = 'calendar' | 'user' | 'wallet' | 'card' | 'shield' | 'building' | 'spark';

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
    case 'card':
      return (
        <svg className={`${common} text-slate-600`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z" />
        </svg>
      );
    case 'shield':
      return (
        <svg className={`${common} text-emerald-600`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
        </svg>
      );
    case 'building':
      return (
        <svg className={`${common} text-brand-700`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6.75H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
        </svg>
      );
    default:
      return (
        <svg className={`${common} text-fuchsia-600`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.847a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.847.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z" />
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

  const firstName = display.split(/\s+/)[0] ?? display;
  const greeting = firstName === 'Guest' ? 'Welcome' : `Welcome back, ${firstName}`;

  const admin = getSupabaseAdminClient();
  const showVenueDashboard = await authenticatedUserHasStaffMembership(admin, user!.id, user?.email);

  const shortcuts: Array<{
    href: string;
    title: string;
    description: string;
    icon: ShortcutIconKind;
  }> = [
    {
      href: '/account/bookings',
      title: 'Bookings',
      description: 'View and manage reservations linked to your email.',
      icon: 'calendar',
    },
    {
      href: '/account/events',
      title: 'Events',
      description: 'Upcoming event tickets and details.',
      icon: 'spark',
    },
    {
      href: '/account/classes',
      title: 'Classes',
      description: 'Sessions, passes, and class activity.',
      icon: 'spark',
    },
    {
      href: '/account/resources',
      title: 'Resources',
      description: 'Upcoming court, room, and equipment bookings.',
      icon: 'building',
    },
    {
      href: '/account/profile',
      title: 'Profile',
      description: 'Name, preferences, marketing consent, and devices.',
      icon: 'user',
    },
    {
      href: '/account/credits',
      title: 'Credits',
      description: 'Venue credit balances and purchases.',
      icon: 'wallet',
    },
    {
      href: '/account/courses',
      title: 'Courses',
      description: 'Enrolments and one-off course purchases.',
      icon: 'spark',
    },
    {
      href: '/account/memberships',
      title: 'Memberships',
      description: 'Recurring plans and member benefits.',
      icon: 'spark',
    },
    {
      href: '/account/recurring',
      title: 'Recurring',
      description: 'Subscriptions and renewal settings.',
      icon: 'spark',
    },
    {
      href: '/account/payment-methods',
      title: 'Payments',
      description: 'Saved cards for faster checkout.',
      icon: 'card',
    },
    {
      href: '/account/security#password',
      title: 'Security',
      description: 'Password, sessions, and account data.',
      icon: 'shield',
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

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Overview"
        title={greeting}
        subtitle={
          <>
            Signed in as <span className="font-medium text-slate-800">{display}</span>
            {user?.email ? (
              <span className="text-slate-500">
                {' '}
                · {user.email}
              </span>
            ) : null}
            . Use the shortcuts below or the navigation bar to manage your ResNeo activity.
          </>
        }
      />

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
