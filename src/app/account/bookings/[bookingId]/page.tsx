import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { getBookingDetailForGuest } from '@/lib/booking/guest-actions/booking-detail';
import { GuestBookingDetailView } from '@/components/booking/GuestBookingDetailView';
import { PageHeader } from '@/components/ui/dashboard/PageHeader';
import { ManageBookingLink } from '@/components/account/ManageBookingLink';

/**
 * WCAG 2.4.2 (Level A): every page needs a title that describes it. Next
 * otherwise falls back to the root layout's title, so a screen-reader user
 * could not tell from the announcement which page they landed on.
 */
export const metadata = {
  title: 'Booking details',
  description: 'The full detail of one of your bookings.',
};

type PageProps = { params: Promise<{ bookingId: string }> };

/**
 * One booking, rendered by the same component the emailed manage link uses
 * (P2-4, AD9).
 *
 * It had its own 280-line rendering of the same booking: a second telling of
 * the cancellation window, the deposit state and the card-hold terms, which is
 * the policy the guest is being asked to accept. Two renderings of one policy
 * is a drift risk that no test can close, only notice. This page now loads the
 * shared DTO and hands it to the shared view, so the two surfaces agree by
 * construction.
 *
 * **Ownership is decided server-side**, by the same primitive the action routes
 * use, so a booking that is not the caller's is a 404 here exactly as it is
 * there. The view is handed the DTO rather than fetching it, which also means
 * the page renders complete on first paint instead of flashing a spinner.
 */
export default async function AccountBookingDetailPage({ params }: PageProps) {
  const { bookingId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const result = await getBookingDetailForGuest(
    { admin: getSupabaseAdminClient(), session: supabase },
    { bookingId, actor: { kind: 'session', userId: user.id } },
  );
  if (!result.ok) notFound();

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Account" title="Booking details" />
      {/*
        `embedded`, so the shared view drops the wordmark and footer it needs
        when it is the whole page: the portal layout already provides both.
      */}
      <GuestBookingDetailView
        bookingId={bookingId}
        actor={{ kind: 'session' }}
        initialDetail={result.data}
        chrome="embedded"
      />
      {/*
        The manage link stays until P2-2 and P2-3 give the session actor its own
        cancel and reschedule handlers. P2-4 is scoped as a pure extraction, so
        the shared view renders no buttons for a session actor yet, and removing
        this before those land would leave a customer on a detail page with no
        way to act. P2-5 removes it once they have.
      */}
      <div className="text-sm">
        <ManageBookingLink
          bookingId={bookingId}
          label="Manage booking"
          className="inline-flex min-h-10 items-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 font-medium text-brand-700 shadow-sm disabled:opacity-60"
        />
      </div>
    </div>
  );
}
