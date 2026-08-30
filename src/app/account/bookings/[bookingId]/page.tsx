import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { loadAccountPayments } from '@/lib/account/account-payments';
import { getBookingDetailForGuest } from '@/lib/booking/guest-actions/booking-detail';
import { GuestBookingDetailView } from '@/components/booking/GuestBookingDetailView';
import { PageHeader } from '@/components/ui/dashboard/PageHeader';

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

  /*
    The booking's payments (P4-2), loaded HERE rather than inside the shared
    view, and passed down as a prop.

    `GuestBookingDetailView` is also the manage page for a guest holding a
    forwardable URL (AD9). Payments are more sensitive than the booking itself,
    so the boundary is that the guest page never loads them: it cannot leak
    what it does not have. An actor check inside the view would put the same
    rule somewhere it can be got wrong by a later edit.

    Failure is carried, not swallowed, for the same reason as P4-1: an empty
    list would tell the customer they have paid nothing.
  */
  const payments = await loadAccountPayments(supabase, getSupabaseAdminClient(), { bookingId })
    .then((r) => ({ rows: r.payments, failed: false }))
    .catch((e) => {
      console.error('[account/bookings/[id]] payments:', e instanceof Error ? e.message : e);
      return { rows: [], failed: true };
    });

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
        payments={payments.rows}
        paymentsFailed={payments.failed}
      />
    </div>
  );
}
