import { runSessionBookingAction } from '@/lib/api/session-booking-action';
import { confirmAttendanceForGuest } from '@/lib/booking/guest-actions/confirm-attendance';

type Params = { params: Promise<{ id: string }> };

/**
 * Confirm attendance for one of the caller's own bookings (P2-1, AD1).
 *
 * The action the "please confirm you are coming" email asks for, available in
 * the portal so a customer who has lost the email is not stuck. Idempotent in
 * the service: confirming an already-confirmed booking succeeds rather than
 * erroring, which matters here more than on the emailed link, because a portal
 * button is easy to press twice.
 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return runSessionBookingAction(request, ({ clients, actor }) =>
    confirmAttendanceForGuest(clients, { bookingId: id, actor }),
  );
}
