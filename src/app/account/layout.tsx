import Link from 'next/link';
import type { ReactNode } from 'react';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { AccountSignOutButton } from '@/app/account/AccountSignOutButton';
import { AccountNav } from '@/app/account/AccountNav';

export default async function AccountLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/login?redirectTo=/account');
  }

  const [{ count: staffByUserId }, { count: staffByEmail }] = await Promise.all([
    supabase.from('staff').select('id', { count: 'exact', head: true }).eq('user_id', user.id).is('revoked_at', null),
    user.email
      ? supabase
          .from('staff')
          .select('id', { count: 'exact', head: true })
          .ilike('email', user.email.trim())
          .is('revoked_at', null)
      : Promise.resolve({ count: 0 }),
  ]);
  const showVenueDashboard = (staffByUserId ?? 0) > 0 || (staffByEmail ?? 0) > 0;

  const email = user.email?.trim() ?? '';
  const initial = email ? email.charAt(0).toUpperCase() : '?';

  return (
    <div className="min-h-screen bg-slate-50">
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
            <Link href="/" className="shrink-0 rounded-lg outline-none ring-brand-500/40 focus-visible:ring-2">
              <img src="/Logo.png" alt="ReserveNI" className="h-9 w-auto sm:h-10" />
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
      <main className="mx-auto max-w-5xl px-4 pb-16 pt-8 sm:px-6 sm:pt-10">{children}</main>
      <footer className="border-t border-slate-200/80 bg-white/80 py-6 text-center text-xs text-slate-500 backdrop-blur-sm">
        <div className="mx-auto max-w-5xl px-4">
          <p>
            Need help?{' '}
            <Link href="/help" className="font-medium text-brand-700 hover:underline">
              Visit help centre
            </Link>
            {' · '}
            <Link href="/" className="font-medium text-slate-600 hover:text-slate-900 hover:underline">
              ReserveNI home
            </Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
