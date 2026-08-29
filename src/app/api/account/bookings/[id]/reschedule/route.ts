import { readJsonBody, runSessionBookingAction } from '@/lib/api/session-booking-action';
import { rescheduleBookingForGuest } from '@/lib/booking/guest-actions/reschedule';
import type { RescheduleRequest } from '@/lib/booking/guest-actions/reschedule';

type Params = { params: Promise<{ id: string }> };

/** The body keys the service understands. Anything else is ignored. */
function readChanges(body: Record<string, unknown>): RescheduleRequest {
  const str = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v : undefined);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  return {
    booking_date: str(body.booking_date),
    booking_time: str(body.booking_time),
    party_size: num(body.party_size),
    practitioner_id: str(body.practitioner_id),
    appointment_service_id: str(body.appointment_service_id),
    duration_minutes: num(body.duration_minutes) ?? null,
    booking_end_time: str(body.booking_end_time) ?? null,
    target_class_instance_id: str(body.target_class_instance_id),
  };
}

/**
 * Move one of the caller's own bookings (P2-1, AD1).
 *
 * The body is picked apart rather than forwarded wholesale: the service reads
 * named fields, and passing an unfiltered object through would let a client set
 * keys the service might later come to read. What each booking model requires
 * is answered by `GET .../reschedule-options`, so a client does not have to
 * guess and get a 400 it cannot explain.
 *
 * Reading the body happens INSIDE the adapter's callback, after the 401, which
 * `account-routes-auth.test.ts` asserts for every route under `/api/account`.
 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return runSessionBookingAction(request, async ({ clients, actor }) =>
    rescheduleBookingForGuest(clients, {
      bookingId: id,
      actor,
      changes: readChanges(await readJsonBody(request)),
    }),
  );
}
