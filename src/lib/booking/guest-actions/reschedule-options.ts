import type { BookingModel } from '@/types/booking-models';
import { inferBookingRowModel } from '@/lib/booking/infer-booking-row-model';
import { assertAppointmentsFeatureEnabled, parseVenueFeatureFlags } from '@/lib/feature-flags';
import { RESCHEDULE_MODIFIABLE_STATUSES } from './reschedule';
import { loadAndAuthoriseGuestBooking } from './authorise';
import { actionSuccess, type GuestActionActor, type GuestActionClients, type GuestActionResult } from './types';

/**
 * What a customer may change about a booking, without attempting to change it
 * (P2-1).
 *
 * P2-3 mounts `AppointmentBookingFlow` to perform the move, and that component
 * owns the availability call. So this deliberately returns NO slots: it answers
 * the questions that have to be settled before a picker is worth showing at
 * all. Is this booking movable, does the venue allow self-service changes, and
 * what does the POST need to be given for a booking of this kind.
 *
 * **It mirrors `rescheduleBookingForGuest`'s gates rather than inventing its
 * own.** The status list is imported from that module for exactly that reason.
 * The failure mode this design is avoiding is an options endpoint that drifts
 * from the action it describes: offering a reschedule the POST then refuses,
 * or hiding one it would have allowed. Where the two could still disagree is
 * noted per branch below.
 */

/** Why a booking cannot be moved, for a client that wants to branch. */
export type RescheduleBlockedReason =
  /** Cancelled, completed, or otherwise past changing. */
  | 'booking_status'
  /** The venue has turned self-service changes off. */
  | 'venue_disabled'
  /** This kind of booking is not movable at all. */
  | 'not_movable';

export interface RescheduleOptionsData {
  booking_id: string;
  booking_model: BookingModel;
  status: string;
  can_reschedule: boolean;
  blocked_reason: RescheduleBlockedReason | null;
  /** Customer-facing, and null when the booking can be moved. */
  message: string | null;
  /**
   * The body keys `POST .../reschedule` requires for this booking model.
   *
   * Returned rather than documented because the four models take genuinely
   * different bodies, and a client that guesses gets a 400 it cannot explain
   * to the customer.
   */
  required_fields: string[];
  cancellation_deadline: string | null;
  deposit_status: string | null;
  /** Current values, so a picker can open on what the customer already has. */
  current: {
    booking_date: string;
    booking_time: string;
    party_size: number;
    practitioner_id: string | null;
    appointment_service_id: string | null;
    calendar_id: string | null;
    service_item_id: string | null;
    class_instance_id: string | null;
    resource_id: string | null;
  };
  venue: { id: string; timezone: string };
}

/**
 * Which models the reschedule action can actually move, and what it needs.
 *
 * `event_ticket` is absent on purpose. `rescheduleBookingForGuest` handles
 * resource and class bookings in its CDE branch and appointments in its own,
 * and an event ticket matches neither, so it falls through to the
 * table-reservation path and would be measured against table availability.
 * The service's own comment says events stay cancel-and-rebook; saying so here
 * is what stops a portal offering a move that cannot work.
 */
const REQUIRED_FIELDS: Partial<Record<BookingModel, string[]>> = {
  unified_scheduling: [
    'booking_date',
    'booking_time',
    'practitioner_id',
    'appointment_service_id',
  ],
  practitioner_appointment: [
    'booking_date',
    'booking_time',
    'practitioner_id',
    'appointment_service_id',
  ],
  class_session: ['target_class_instance_id'],
  resource_booking: ['booking_date', 'booking_time'],
  table_reservation: ['booking_date', 'booking_time'],
};

/**
 * The models whose reschedule path checks `guest_self_reschedule`.
 *
 * NOT every model, and that asymmetry is the service's, not a simplification
 * here: `rescheduleBookingForGuest` asserts the flag in its CDE branch and in
 * its appointment branch, and the table-reservation path never reads it. The
 * flag is an *appointments* feature flag (`AppointmentsFeatureFlagKey`), so
 * that is defensible, but a copy of this list that gated tables as well would
 * report a venue as having disabled something it had not.
 */
const FLAG_GATED_MODELS: ReadonlySet<BookingModel> = new Set<BookingModel>([
  'unified_scheduling',
  'practitioner_appointment',
  'class_session',
  'resource_booking',
]);

/** The wording the reschedule service itself returns, so the two agree. */
const DISABLED_MESSAGE: Partial<Record<BookingModel, string>> = {
  unified_scheduling: 'Online appointment changes are not available for this venue.',
  practitioner_appointment: 'Online appointment changes are not available for this venue.',
  class_session: 'Online booking changes are not available for this venue.',
  resource_booking: 'Online booking changes are not available for this venue.',
};

export async function getRescheduleOptionsForGuest(
  clients: GuestActionClients,
  params: { bookingId: string; actor: GuestActionActor },
): Promise<GuestActionResult<RescheduleOptionsData>> {
  const { bookingId, actor } = params;

  // The same authorisation primitive the actions use, so someone else's
  // booking is a 404 here too. An options endpoint that answered 403 would
  // hand an id-prober the existence check the actions deny them.
  const loaded = await loadAndAuthoriseGuestBooking(clients, bookingId, actor);
  if (!loaded.ok) return loaded;

  const booking = loaded.data;
  const model = inferBookingRowModel(booking);

  const { data: venueRow } = await clients.admin
    .from('venues')
    .select('feature_flags, timezone')
    .eq('id', booking.venue_id)
    .single();

  const timezone =
    typeof (venueRow as { timezone?: string | null } | null)?.timezone === 'string' &&
    String((venueRow as { timezone?: string | null }).timezone).trim() !== ''
      ? String((venueRow as { timezone?: string | null }).timezone).trim()
      : 'Europe/London';

  const current = {
    booking_date: booking.booking_date,
    booking_time: booking.booking_time,
    party_size: booking.party_size,
    practitioner_id: booking.practitioner_id ?? null,
    appointment_service_id: booking.appointment_service_id ?? null,
    calendar_id: booking.calendar_id ?? null,
    service_item_id: booking.service_item_id ?? null,
    class_instance_id: booking.class_instance_id ?? null,
    resource_id: booking.resource_id ?? null,
  };

  const base = {
    booking_id: booking.id,
    booking_model: model,
    status: booking.status,
    cancellation_deadline: booking.cancellation_deadline ?? null,
    deposit_status: booking.deposit_status ?? null,
    current,
    venue: { id: booking.venue_id, timezone },
  };

  const blocked = (
    blocked_reason: RescheduleBlockedReason,
    message: string,
  ): GuestActionResult<RescheduleOptionsData> =>
    actionSuccess({
      ...base,
      can_reschedule: false,
      blocked_reason,
      message,
      required_fields: [],
    });

  // Status first, matching the order of the action: a cancelled booking is not
  // movable whatever the venue's settings say, and answering "the venue has
  // turned changes off" would be a wrong explanation of a right refusal.
  if (!RESCHEDULE_MODIFIABLE_STATUSES.includes(booking.status)) {
    return blocked('booking_status', 'This booking can no longer be changed online.');
  }

  const required = REQUIRED_FIELDS[model];
  if (!required) {
    return blocked(
      'not_movable',
      'Tickets cannot be moved to another time. Cancel this booking and book again if you need to.',
    );
  }

  if (FLAG_GATED_MODELS.has(model)) {
    const flags = parseVenueFeatureFlags((venueRow as { feature_flags?: unknown } | null)?.feature_flags);
    try {
      assertAppointmentsFeatureEnabled('guest_self_reschedule', flags);
    } catch {
      return blocked(
        'venue_disabled',
        DISABLED_MESSAGE[model] ?? 'Online booking changes are not available for this venue.',
      );
    }
  }

  return actionSuccess({
    ...base,
    can_reschedule: true,
    blocked_reason: null,
    message: null,
    required_fields: required,
  });
}
