import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export default async function ChooseDestinationPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirectTo=/auth/choose-destination');

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-50 p-6">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold text-slate-900">Where would you like to go?</h1>
        <p className="mt-2 text-sm text-slate-600">
          You have both a customer account and venue access. Pick a destination — you can switch later from the menu.
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Link
          href="/account"
          className="rounded-md bg-brand-600 px-6 py-3 text-center text-sm font-semibold text-white shadow hover:bg-brand-700"
        >
          My bookings (account)
        </Link>
        <Link
          href="/dashboard"
          className="rounded-md border border-slate-300 bg-white px-6 py-3 text-center text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
        >
          Venue dashboard
        </Link>
      </div>
    </div>
  );
}
