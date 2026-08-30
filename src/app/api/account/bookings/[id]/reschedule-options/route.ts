import { runSessionBookingAction } from '@/lib/api/session-booking-action';
import { getRescheduleOptionsForGuest } from '@/lib/booking/guest-actions/reschedule-options';

type Params = { params: Promise<{ id: string }> };

/**
 * Whether this booking can be moved, and what a move would need (P2-1).
 *
 * Returns no slots. P2-3 mounts `AppointmentBookingFlow`, which owns the
 * availability call; this answers the questions that decide whether showing a
 * picker makes sense at all.
 */
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return runSessionBookingAction(request, ({ clients, actor }) =>
    getRescheduleOptionsForGuest(clients, { bookingId: id, actor }),
  );
}
