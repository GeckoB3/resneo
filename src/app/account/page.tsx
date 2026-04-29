import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Welcome back</h1>
        <p className="mt-1 text-slate-600">
          Signed in as <span className="font-medium text-slate-800">{display}</span>
          {user?.email ? (
            <span className="text-slate-500">
              {' '}
              · {user.email}
            </span>
          ) : null}
        </p>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-medium text-slate-900">Quick links</h2>
        <ul className="mt-3 list-inside list-disc space-y-2 text-slate-700">
          <li>
            <Link href="/account/bookings" className="text-brand-700 hover:underline">
              View your bookings
            </Link>
          </li>
          <li>
            <Link href="/account/profile" className="text-brand-700 hover:underline">
              Profile &amp; preferences
            </Link>
          </li>
          <li>
            <Link href="/account/credits" className="text-brand-700 hover:underline">
              Credits
            </Link>
          </li>
          <li>
            <Link href="/account/memberships" className="text-brand-700 hover:underline">
              Memberships
            </Link>
          </li>
          <li>
            <Link href="/account/payment-methods" className="text-brand-700 hover:underline">
              Payment methods
            </Link>
          </li>
          <li>
            <Link href="/account/security" className="text-brand-700 hover:underline">
              Security &amp; data
            </Link>
          </li>
          <li>
            <Link href="/dashboard" className="text-brand-700 hover:underline">
              Go to venue dashboard
            </Link>{' '}
            <span className="text-sm text-slate-500">(if you have staff access)</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
