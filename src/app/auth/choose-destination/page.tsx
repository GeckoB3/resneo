import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { redirect } from 'next/navigation';
import { isSalesAgent } from '@/lib/sales/auth';
import { escapeLikePattern } from '@/lib/db/like-escape';

export default async function ChooseDestinationPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirectTo=/auth/choose-destination');

  const isSales = isSalesAgent(user);

  // Detect which surfaces this user actually has so we only show real options.
  const admin = getSupabaseAdminClient();
  const emailNorm = (user.email ?? '').trim().toLowerCase();
  const [staffByUser, staffByEmail, guestByUser, guestByEmail] = await Promise.all([
    admin
      .from('staff')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .is('revoked_at', null),
    emailNorm
      ? admin
          .from('staff')
          .select('id', { count: 'exact', head: true })
          .ilike('email', escapeLikePattern(emailNorm))
          .is('revoked_at', null)
      : Promise.resolve({ count: 0 }),
    admin.from('guests').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
    emailNorm
      ? admin.from('guests').select('id', { count: 'exact', head: true }).ilike('email', escapeLikePattern(emailNorm))
      : Promise.resolve({ count: 0 }),
  ]);

  const hasStaff = ((staffByUser.count ?? 0) > 0) || ((staffByEmail.count ?? 0) > 0);
  const hasGuest = ((guestByUser.count ?? 0) > 0) || ((guestByEmail.count ?? 0) > 0);

  const options: Array<{ href: string; title: string; description: string; primary: boolean }> = [];
  if (isSales) {
    options.push({
      href: '/sales',
      title: 'Sales dashboard',
      description: 'Track your signups, revenue share, and bonuses',
      primary: true,
    });
  }
  if (hasStaff) {
    options.push({
      href: '/dashboard',
      title: 'Venue dashboard',
      description: 'Manage bookings, guests, and your venue',
      primary: !isSales,
    });
  }
  if (hasGuest) {
    options.push({
      href: '/account',
      title: 'My bookings (account)',
      description: 'View and manage your own bookings',
      primary: !isSales && !hasStaff,
    });
  }

  // Single surface (or none we recognise): skip the chooser entirely.
  if (options.length === 1) redirect(options[0].href);
  if (options.length === 0) redirect(hasStaff ? '/dashboard' : '/account');

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-slate-50 p-6">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold text-slate-900">Where would you like to go?</h1>
        <p className="mt-2 text-sm text-slate-600">
          Your account has access to more than one area. Pick a destination — you can switch later.
        </p>
      </div>
      <div className="grid w-full max-w-2xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {options.map((opt) => (
          <Link
            key={opt.href}
            href={opt.href}
            className={`group flex flex-col gap-1 rounded-2xl border p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${
              opt.primary
                ? 'border-brand-200 bg-white ring-1 ring-brand-100'
                : 'border-slate-200 bg-white'
            }`}
          >
            <span className="text-sm font-semibold text-slate-900 group-hover:text-brand-700">
              {opt.title}
            </span>
            <span className="text-xs leading-relaxed text-slate-500">{opt.description}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
