import Link from 'next/link';
import type { ReactNode } from 'react';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { authenticatedUserHasStaffMembership } from '@/lib/venue-auth';
import { redirect } from 'next/navigation';
import { AccountSignOutButton } from '@/app/account/AccountSignOutButton';
import { AccountNav } from '@/app/account/AccountNav';
import { ToastProvider } from '@/components/ui/Toast';

export default async function AccountLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/login?redirectTo=/account');
  }

  const admin = getSupabaseAdminClient();
  const showVenueDashboard = await authenticatedUserHasStaffMembership(admin, user.id, user.email);

  const email = user.email?.trim() ?? '';
  const initial = email ? email.charAt(0).toUpperCase() : '?';

  return (
    <div className="min-h-screen bg-slate-50">
      {/*
        Skip link (WCAG 2.4.1, Level A). First tab stop on every portal page,
        which matters here more than most: the sticky header and the account
        nav put roughly fifteen links between the top of the document and the
        page content, so a keyboard user had to tab through all of them on
        every navigation.

        Visually hidden until focused rather than always visible, using size
        and clip rather than `sr-only` alone so it becomes a real, positioned
        element when it takes focus.
      */}
      <a
        href="#account-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-brand-600 focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-white focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-brand-300"
      >
        Skip to main content
      </a>
      <div
        className="pointer-events-none fixed inset-0 -z-10 opacity-[0.45]"
        aria-hidden
        style={{
          backgroundImage:
            'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(13,148,136,0.12), transparent), radial-gradient(ellipse 60% 40% at 100% 0%, rgba(5,150,105,0.06), transparent)',
        }}
      />
      <header className="sticky top-0 z-30 border-b border-slate-200/90 bg-white/90 shadow-sm shadow-slate-900/5 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:py-4">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {/*
              The wordmark goes to the hub, not to the marketing home (P1-3).
              Overview lost its nav item when the nav collapsed to four, and
              this is where a customer already expects "take me back to the
              start" to be. The marketing home is still one click away in the
              footer, which is where a signed-in customer is far less likely to
              want it. `alt` names the destination rather than just the brand,
              since for a screen reader "ResNeo" alone does not say where the
              link goes.
            */}
            <Link
              href="/account"
              className="shrink-0 rounded-lg outline-none ring-brand-500/40 focus-visible:ring-2"
            >
              <img src="/Logo.png" alt="ResNeo account overview" className="h-9 w-auto sm:h-10" />
            </Link>
            <div className="hidden h-8 w-px bg-slate-200 sm:block" aria-hidden />
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">Customer portal</p>
              <p className="truncate text-sm font-semibold text-slate-900">My account</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 sm:justify-end">
            <div className="flex min-w-0 items-center gap-2 rounded-xl border border-slate-200/80 bg-slate-50/90 px-3 py-1.5">
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-800"
                aria-hidden
              >
                {initial}
              </span>
              <span className="min-w-0 truncate text-xs font-medium text-slate-700 sm:max-w-[14rem]">{email || 'Signed in'}</span>
            </div>
            <AccountSignOutButton />
          </div>
        </div>
        <AccountNav showVenueDashboard={showVenueDashboard} />
      </header>
      {/*
        The live region every portal section announces through (P0-8). Mounted
        here rather than per page so one region serves the whole portal: several
        would compete, and a screen reader announces whichever it notices.

        A client component rendered from this server layout, so `children` stays
        server-rendered; only the provider and its consumers cross the boundary.
      */}
      <ToastProvider>
      <main
        id="account-main"
        // Focusable only as a skip-link target: without this the browser moves
        // the viewport but leaves focus where it was, so the next Tab returns
        // the user to the nav they just skipped.
        tabIndex={-1}
        className="mx-auto max-w-5xl px-4 pb-16 pt-8 outline-none sm:px-6 sm:pt-10"
      >
        {children}
      </main>
      </ToastProvider>
      <footer className="border-t border-slate-200/80 bg-white/80 py-6 text-center text-xs text-slate-500 backdrop-blur-sm">
        <div className="mx-auto max-w-5xl px-4">
          <p>
            Need help?{' '}
            <Link href="/help" className="font-medium inline-flex min-h-6 items-center text-brand-700 underline underline-offset-2">
              Visit help centre
            </Link>
            {' · '}
            <Link href="/" className="font-medium text-slate-600 hover:text-slate-900 hover:underline">
              ResNeo home
            </Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
