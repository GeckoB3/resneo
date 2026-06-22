import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import {
  accountBookingTimeZone,
  formatAccountBookingDateTime,
  friendlyAccountBookingStatus,
  loadAccountUpcomingBookingsByModel,
  type AccountTicketLine,
} from '@/lib/account/account-bookings';
import { PageHeader } from '@/components/ui/dashboard/PageHeader';

function ticketSummary(lines: AccountTicketLine[] | undefined, partySize: number): string {
  if (lines && lines.length > 0) {
    return lines.map((l) => `${l.quantity} × ${l.label}`).join(', ');
  }
  return `${partySize} ${partySize === 1 ? 'ticket' : 'tickets'}`;
}

export default async function AccountEventsHubPage() {
  const todayUtcDate = new Date().toISOString().slice(0, 10);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from('user_profiles').select('timezone').eq('id', user.id).maybeSingle()
    : { data: null };
  const profileTz = (profile?.timezone as string | null | undefined)?.trim() || null;

  const bookings = await loadAccountUpcomingBookingsByModel(
    supabase,
    getSupabaseAdminClient(),
    'event_ticket',
    todayUtcDate,
  );

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Account"
        title="Your events"
        subtitle="Upcoming event tickets linked to your account. Open a booking for the full ticket breakdown or use the venue manage link."
      />

      {bookings.length === 0 ? (
        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 text-center shadow-sm shadow-slate-900/5">
          <p className="text-slate-600">No upcoming event tickets.</p>
          <p className="mt-1 text-sm text-slate-500">Tickets you book for venue events will appear here.</p>
          <Link href="/account/bookings" className="mt-4 inline-block text-sm font-semibold text-brand-700 hover:underline">
            View all bookings
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm shadow-slate-900/5">
          {bookings.map((b) => {
            const tz = accountBookingTimeZone(b, profileTz);
            const { date, time } = formatAccountBookingDateTime(b.booking_date, b.booking_time, tz, {
              withWeekday: true,
            });
            return (
              <li key={b.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">{b.cde_context?.title ?? b.venue?.name ?? 'Event'}</p>
                  <p className="text-sm text-slate-600">
                    {b.venue?.name ? `${b.venue.name} · ` : ''}
                    {date}
                    {time ? ` · ${time}` : ''}
                    {b.cde_context?.subtitle ? ` · ${b.cde_context.subtitle}` : ''}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {ticketSummary(b.cde_context?.ticket_lines, b.party_size)} ·{' '}
                    {friendlyAccountBookingStatus(b.status)}
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
            );
          })}
        </ul>
      )}

      <p className="text-xs text-slate-500">
        Times are shown in each venue’s local timezone. Only upcoming, non-cancelled tickets are listed.
      </p>
    </div>
  );
}
