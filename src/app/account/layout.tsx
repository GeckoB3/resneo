import Link from 'next/link';
import type { ReactNode } from 'react';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { AccountSignOutButton } from '@/app/account/AccountSignOutButton';

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

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-4 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-medium text-slate-800">
            <Link href="/account" className="text-brand-700">
              My account
            </Link>
            <Link href="/account/bookings" className="text-slate-600 hover:text-slate-900">
              Bookings
            </Link>
            <Link href="/account/profile" className="text-slate-600 hover:text-slate-900">
              Profile
            </Link>
            <Link
              href="/account/credits"
              className="text-slate-400 hover:text-slate-600"
              title="Coming soon — not part of the current MVP"
            >
              Credits <span className="text-xs font-normal text-slate-400">(soon)</span>
            </Link>
            <Link
              href="/account/memberships"
              className="text-slate-400 hover:text-slate-600"
              title="Coming soon — not part of the current MVP"
            >
              Memberships <span className="text-xs font-normal text-slate-400">(soon)</span>
            </Link>
            <Link
              href="/account/payment-methods"
              className="text-slate-400 hover:text-slate-600"
              title="Saved cards blocked until Connect per-venue flow is specified"
            >
              Payments <span className="text-xs font-normal text-slate-400">(soon)</span>
            </Link>
            <Link href="/account/security" className="text-slate-600 hover:text-slate-900">
              Security
            </Link>
            {showVenueDashboard ? (
              <Link href="/dashboard" className="text-slate-600 hover:text-slate-900">
                Venue dashboard
              </Link>
            ) : null}
          </div>
          <AccountSignOutButton />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
    </div>
  );
}
