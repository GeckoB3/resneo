import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { loadAccountBookings } from '@/lib/account/account-bookings';
import { bookingModelShortLabel } from '@/lib/booking/infer-booking-row-model';
import {
  filterAccountBookings,
  parseAccountBookingFilter,
  type AccountBookingFilter,
} from '@/lib/account/account-booking-filters';

export default async function AccountBookingsPage({
  searchParams,
}: {
  searchParams?: Promise<{ filter?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const filter = parseAccountBookingFilter(sp.filter);
  const todayUtcDate = new Date().toISOString().slice(0, 10);

  const supabase = await createClient();
  await supabase.auth.getUser();

  const bookings = await loadAccountBookings(supabase, getSupabaseAdminClient(), 100);

  const filtered = filterAccountBookings(bookings, filter, todayUtcDate);

  const tabs: Array<{ id: AccountBookingFilter; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'upcoming', label: 'Upcoming' },
    { id: 'past', label: 'Past' },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900">Your bookings</h1>
      <div className="flex flex-wrap gap-2 text-sm">
        {tabs.map((t) => (
          <Link
            key={t.id}
            href={t.id === 'all' ? '/account/bookings' : `/account/bookings?filter=${t.id}`}
            className={
              filter === t.id
                ? 'rounded-full bg-brand-600 px-3 py-1 font-semibold text-white'
                : 'rounded-full border border-slate-200 bg-white px-3 py-1 font-medium text-slate-700 hover:bg-slate-50'
            }
          >
            {t.label}
          </Link>
        ))}
      </div>
      {bookings.length === 0 ? (
        <p className="text-slate-600">No bookings linked to this account yet.</p>
      ) : filtered.length === 0 ? (
        <p className="text-slate-600">No bookings in this view.</p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white shadow-sm">
          {filtered.map((b) => (
            <li key={b.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium text-slate-900">{b.venue?.name ?? 'Venue'}</p>
                <p className="text-sm text-slate-600">
                  {bookingModelShortLabel(b.booking_model)} · {b.booking_date} · {String(b.booking_time).slice(0, 5)} ·{' '}
                  {b.party_size} guests · {b.status}
                </p>
              </div>
              <div className="flex gap-3 text-sm font-medium">
                <Link href={`/account/bookings/${b.id}`} className="text-brand-700 hover:underline">
                  Details
                </Link>
                <a href={b.manage_booking_link} className="text-brand-700 hover:underline">
                  Manage
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-slate-500">
        Filters use the UTC calendar day. For exact local times, check the venue confirmation email.
      </p>
    </div>
  );
}
