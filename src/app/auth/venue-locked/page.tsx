import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getDashboardStaff } from '@/lib/venue-auth';
import { VenueLockedSignOutButton } from './VenueLockedSignOutButton';

const SUPPORT_EMAIL = 'support@resneo.com';

export const metadata = { title: 'We could not open your venue | ResNeo' };

/** Where a login with staff rows at more than one venue lands, instead of the signup flow (D38). */
export default async function VenueLockedPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirectTo=/dashboard');

  const staff = await getDashboardStaff(supabase);
  if (!staff.multipleVenues) redirect('/dashboard');

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-6 py-12">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-8">
        <h1 className="text-xl font-semibold text-slate-900">We could not open your venue</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          This account is linked to more than one venue, so we cannot tell which one to open. Please
          contact support and we will sort it out.
        </p>
        <a
          href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('My account is linked to more than one venue')}`}
          className="mt-6 inline-flex min-h-10 items-center justify-center rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
        >
          Email {SUPPORT_EMAIL}
        </a>
        <p className="mt-4 text-xs text-slate-500">Signed in as {staff.email || user.email}</p>
        <div className="mt-4">
          <VenueLockedSignOutButton />
        </div>
      </div>
    </div>
  );
}
