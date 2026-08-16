/**
 * When an appointment booking is cancelled, process the freed slot according to the
 * venue's waitlist mode (staff alert, notify in order, or notify all).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  parseVenueFeatureFlags,
  resolveAppointmentsFeatureFlag,
} from '@/lib/feature-flags';
import { inferBookingRowModel } from '@/lib/booking/infer-booking-row-model';
import { notifyAppointmentWaitlistOfferForEntry } from '@/lib/booking/notify-appointment-waitlist-offer';
import { APPOINTMENT_WAITLIST_COMPLETED_STATUS } from '@/lib/booking/waitlist-offer-constants';
import { parseWaitlistConfig, type AppointmentWaitlistMode } from '@/lib/booking/waitlist-config';
import { recordWaitlistSlotOpportunity } from '@/lib/booking/record-waitlist-slot-opportunity';
import {
  freedSlotFromCancelledBooking,
} from '@/lib/booking/waitlist-freed-slot';
import {
  hasActiveWaitlistOfferForSlot,
  offerWaitlistEntryInOrder,
} from '@/lib/booking/waitlist-offer-in-order';
import { markWaitlistOpportunitiesFilledForSlot } from '@/lib/booking/waitlist-slot-opportunity-service';
import { isWaitlistFreedSlotStillUnbooked } from '@/lib/booking/is-waitlist-freed-slot-unbooked';
import { findAppointmentWaitlistAvailability } from '@/lib/booking/waitlist-offer-availability';
import {
  waitlistTimeMatchesFreedSlot,
  type WaitlistTimeFields,
} from '@/lib/booking/waitlist-time-window';
import type { BookingModel } from '@/types/booking-models';

export interface CancelledBookingForWaitlistOffer {
  id: string;
  venue_id: string;
  booking_date: string;
  booking_time: string;
  practitioner_id?: string | null;
  calendar_id?: string | null;
  appointment_service_id?: string | null;
  service_item_id?: string | null;
  booking_model?: string | null;
  experience_event_id?: string | null;
  class_instance_id?: string | null;
  resource_id?: string | null;
  event_session_id?: string | null;
}

export interface WaitlistEntryCandidate {
  id: string;
  desired_date: string;
  desired_time: string | null;
  desired_time_end?: string | null;
  practitioner_id: string | null;
  appointment_service_id: string | null;
  service_item_id: string | null;
  guest_first_name: string | null;
  guest_last_name: string | null;
  guest_email: string | null;
  guest_phone: string;
  created_at: string;
}

export type OfferAppointmentWaitlistOnCancelResult =
  | {
      offered: true;
      mode: 'notify_in_order';
      waitlistEntryId: string;
      emailSent: boolean;
      smsSent: boolean;
    }
  | {
      offered: true;
      mode: 'notify_all';
      notifiedCount: number;
      emailSentCount: number;
      smsSentCount: number;
    }
  | {
      offered: false;
      mode: AppointmentWaitlistMode;
      reason: string;
      staffAlertId?: string;
    };

const APPOINTMENT_MODELS: BookingModel[] = ['practitioner_appointment', 'unified_scheduling'];

export function isAppointmentBookingForWaitlistOffer(booking: CancelledBookingForWaitlistOffer): boolean {
  return APPOINTMENT_MODELS.includes(inferBookingRowModel(booking));
}

export function freedPractitionerId(booking: CancelledBookingForWaitlistOffer): string | null {
  return booking.calendar_id ?? booking.practitioner_id ?? null;
}

export function freedServiceIds(booking: CancelledBookingForWaitlistOffer): {
  serviceItemId: string | null;
  appointmentServiceId: string | null;
} {
  return {
    serviceItemId: booking.service_item_id ?? null,
    appointmentServiceId: booking.appointment_service_id ?? null,
  };
}

export function waitlistServiceMatchesFreedSlot(
  entry: Pick<WaitlistEntryCandidate, 'service_item_id' | 'appointment_service_id'>,
  freed: ReturnType<typeof freedServiceIds>,
): boolean {
  const entryIds = [entry.service_item_id, entry.appointment_service_id].filter(Boolean) as string[];
  const freedIds = [freed.serviceItemId, freed.appointmentServiceId].filter(Boolean) as string[];
  if (entryIds.length === 0 || freedIds.length === 0) return false;
  return entryIds.some((entryId) => freedIds.includes(entryId));
}

export function waitlistPractitionerMatchesFreedSlot(
  entryPractitionerId: string | null,
  freedPractitioner: string | null,
): boolean {
  if (!entryPractitionerId) return true;
  if (!freedPractitioner) return true;
  return entryPractitionerId === freedPractitioner;
}

export function findMatchingWaitlistEntries(
  entries: WaitlistEntryCandidate[],
  booking: CancelledBookingForWaitlistOffer,
): WaitlistEntryCandidate[] {
  const freedTimeHm =
    typeof booking.booking_time === 'string' ? booking.booking_time.slice(0, 5) : '';
  const practitioner = freedPractitionerId(booking);
  const serviceIds = freedServiceIds(booking);

  return entries.filter((entry) => {
    if (!waitlistServiceMatchesFreedSlot(entry, serviceIds)) return false;
    if (!waitlistPractitionerMatchesFreedSlot(entry.practitioner_id, practitioner)) return false;
    const timeFields: WaitlistTimeFields = {
      desired_time: entry.desired_time,
      desired_time_end: entry.desired_time_end ?? null,
    };
    return waitlistTimeMatchesFreedSlot(timeFields, freedTimeHm);
  });
}

/** @deprecated Use findMatchingWaitlistEntries — returns first FIFO match. */
export function pickFirstMatchingWaitlistEntry(
  entries: WaitlistEntryCandidate[],
  booking: CancelledBookingForWaitlistOffer,
): WaitlistEntryCandidate | null {
  return findMatchingWaitlistEntries(entries, booking)[0] ?? null;
}

async function loadWaitingAppointmentWaitlistEntries(
  admin: SupabaseClient,
  venueId: string,
  bookingDate: string,
): Promise<WaitlistEntryCandidate[]> {
  const { data: waitingRows, error: listErr } = await admin
    .from('waitlist_entries')
    .select(
      'id, desired_date, desired_time, desired_time_end, practitioner_id, appointment_service_id, service_item_id, guest_first_name, guest_last_name, guest_email, guest_phone, created_at',
    )
    .eq('venue_id', venueId)
    .eq('waitlist_kind', 'appointment')
    .eq('desired_date', bookingDate)
    .eq('status', 'waiting')
    .order('created_at', { ascending: true });

  if (listErr) {
    console.error('[offerAppointmentWaitlistOnCancel] waitlist query failed:', listErr);
    return [];
  }

  return (waitingRows ?? []) as WaitlistEntryCandidate[];
}

async function notifyAllMatchingGuests(
  admin: SupabaseClient,
  venueId: string,
  bookingDate: string,
  matches: WaitlistEntryCandidate[],
): Promise<OfferAppointmentWaitlistOnCancelResult> {
  let emailSentCount = 0;
  let smsSentCount = 0;

  for (const match of matches) {
    const notify = await notifyAppointmentWaitlistOfferForEntry(
      admin,
      venueId,
      {
        waitlistEntryId: match.id,
        desired_date: bookingDate,
        desired_time: match.desired_time,
        desired_time_end: match.desired_time_end ?? null,
        guest_first_name: match.guest_first_name,
        guest_last_name: match.guest_last_name,
        guest_email: match.guest_email,
        guest_phone: match.guest_phone,
      },
      null,
    );
    if (notify.emailSent) emailSentCount += 1;
    if (notify.smsSent) smsSentCount += 1;

    const { error: completeErr } = await admin
      .from('waitlist_entries')
      .update({
        status: APPOINTMENT_WAITLIST_COMPLETED_STATUS,
        offered_at: new Date().toISOString(),
        expires_at: null,
      })
      .eq('id', match.id)
      .eq('venue_id', venueId)
      .eq('status', 'waiting');

    if (completeErr) {
      console.error('[notifyAllMatchingGuests] complete update failed:', completeErr, {
        waitlistEntryId: match.id,
        venueId,
      });
    }
  }

  return {
    offered: true,
    mode: 'notify_all',
    notifiedCount: matches.length,
    emailSentCount,
    smsSentCount,
  };
}

/**
 * Processes the freed appointment slot according to the venue waitlist mode.
 * Gated on `waitlist_v2`. Safe to call after cancel; no-ops when not applicable.
 */
export async function offerAppointmentWaitlistOnCancel(
  admin: SupabaseClient,
  booking: CancelledBookingForWaitlistOffer,
): Promise<OfferAppointmentWaitlistOnCancelResult> {
  if (!isAppointmentBookingForWaitlistOffer(booking)) {
    return { offered: false, mode: 'notify_in_order', reason: 'not_appointment_booking' };
  }

  const freedTimeHm =
    typeof booking.booking_time === 'string' ? booking.booking_time.slice(0, 5) : '';
  if (!freedTimeHm) {
    return { offered: false, mode: 'notify_in_order', reason: 'missing_booking_time' };
  }

  const serviceIds = freedServiceIds(booking);
  if (!serviceIds.serviceItemId && !serviceIds.appointmentServiceId) {
    return { offered: false, mode: 'notify_in_order', reason: 'missing_service' };
  }

  const { data: venueRow, error: venueErr } = await admin
    .from('venues')
    .select('name, phone, slug, feature_flags')
    .eq('id', booking.venue_id)
    .maybeSingle();

  if (venueErr || !venueRow) {
    console.error('[offerAppointmentWaitlistOnCancel] venue lookup failed:', venueErr, {
      venueId: booking.venue_id,
      bookingId: booking.id,
    });
    return { offered: false, mode: 'notify_in_order', reason: 'venue_not_found' };
  }

  const venueFlags = parseVenueFeatureFlags(
    (venueRow as { feature_flags?: unknown }).feature_flags,
  );
  if (!resolveAppointmentsFeatureFlag('waitlist_v2', venueFlags)) {
    return { offered: false, mode: 'notify_in_order', reason: 'waitlist_v2_disabled' };
  }

  const waitlistConfig = parseWaitlistConfig(venueFlags);
  const mode = waitlistConfig.mode;
  const freedSlot = freedSlotFromCancelledBooking(booking);

  const waitingRows = await loadWaitingAppointmentWaitlistEntries(
    admin,
    booking.venue_id,
    booking.booking_date,
  );
  const matches = findMatchingWaitlistEntries(waitingRows, booking);

  /**
   * SA-H6. This path asked only "has someone else taken this slot", never "is
   * the venue open". So an owner who books a closure and cancels the day's
   * appointments fires one offer per cancellation, and waitlisted guests are
   * texted offers for a day the venue is shut. Five sibling waitlist paths
   * already run this helper; this one imported the unbooked check instead and
   * stopped there.
   *
   * Safe to run here because the cancellation is written before every caller
   * reaches this function, so the freed slot really is free by now. Called
   * before that write, the cancelled booking would occupy its own slot and this
   * check would suppress every offer.
   *
   * `desired_time` is the freed start exactly, which the window parser treats
   * as an exact match, so this asks about this slot and not the whole day.
   *
   * Placed after the match search so the engine runs only when there is
   * somebody to offer the slot to, and before the mode dispatch so it also
   * covers `staff_choose`: an alert about a slot nobody can book is noise, not
   * an opportunity.
   */
  const freedSlotAvailability = await findAppointmentWaitlistAvailability(
    admin,
    booking.venue_id,
    {
      desired_date: booking.booking_date,
      desired_time: freedTimeHm,
      desired_time_end: null,
      practitioner_id: freedSlot.calendarId ?? null,
      appointment_service_id: serviceIds.appointmentServiceId,
      service_item_id: serviceIds.serviceItemId,
    },
  );
  if (!freedSlotAvailability.available) {
    return {
      offered: false,
      mode,
      reason: `slot_not_bookable:${freedSlotAvailability.reason ?? 'unavailable'}`,
    };
  }

  if (mode === 'staff_choose') {
    const alert = await recordWaitlistSlotOpportunity(admin, booking);
    if (!alert.created) {
      return {
        offered: false,
        mode,
        reason: alert.reason ?? 'staff_alert_failed',
        staffAlertId: alert.opportunityId,
      };
    }
    return {
      offered: false,
      mode,
      reason: matches.length > 0 ? 'staff_choose_pending' : 'staff_choose_pending_no_match_yet',
      staffAlertId: alert.opportunityId,
    };
  }

  if (matches.length === 0) {
    return { offered: false, mode, reason: 'no_matching_waitlist' };
  }

  if (mode === 'notify_all') {
    const result = await notifyAllMatchingGuests(admin, booking.venue_id, booking.booking_date, matches);
    const stillUnbooked = await isWaitlistFreedSlotStillUnbooked(admin, freedSlot);
    if (!stillUnbooked) {
      await markWaitlistOpportunitiesFilledForSlot(admin, freedSlot);
    }
    return result;
  }

  // notify_in_order (default)
  const slotAlreadyOffered = await hasActiveWaitlistOfferForSlot(
    admin,
    booking.venue_id,
    booking.booking_date,
    booking.booking_time,
    freedSlot.calendarId,
  );
  if (slotAlreadyOffered) {
    return { offered: false, mode, reason: 'slot_already_offered' };
  }

  const match = matches[0];
  if (!match) {
    return { offered: false, mode, reason: 'no_matching_waitlist' };
  }

  const offer = await offerWaitlistEntryInOrder(admin, freedSlot, match);
  if (!offer.ok) {
    return { offered: false, mode, reason: offer.reason };
  }

  return {
    offered: true,
    mode: 'notify_in_order',
    waitlistEntryId: offer.waitlistEntryId,
    emailSent: offer.emailSent,
    smsSent: offer.smsSent,
  };
}
