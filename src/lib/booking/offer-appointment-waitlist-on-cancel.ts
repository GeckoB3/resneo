/**
 * Phase 1a.3: when an appointment booking is cancelled, auto-offer the freed slot
 * to the first matching appointment waitlist entry and notify the guest.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  parseVenueFeatureFlags,
  resolveAppointmentsFeatureFlag,
} from '@/lib/feature-flags';
import { inferBookingRowModel } from '@/lib/booking/infer-booking-row-model';
import { notifyAppointmentWaitlistOfferForEntry } from '@/lib/booking/notify-appointment-waitlist-offer';
import { APPOINTMENT_WAITLIST_OFFER_TTL_MS } from '@/lib/booking/waitlist-offer-constants';
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
      waitlistEntryId: string;
      emailSent: boolean;
      smsSent: boolean;
    }
  | { offered: false; reason: string };

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
  const freedId = freed.serviceItemId ?? freed.appointmentServiceId;
  if (!freedId) return false;
  return entry.service_item_id === freedId || entry.appointment_service_id === freedId;
}

export function waitlistPractitionerMatchesFreedSlot(
  entryPractitionerId: string | null,
  freedPractitioner: string | null,
): boolean {
  if (!entryPractitionerId) return true;
  if (!freedPractitioner) return true;
  return entryPractitionerId === freedPractitioner;
}

export function waitlistTimeMatchesFreedSlot(
  entryDesiredTime: string | null,
  freedTimeHm: string,
): boolean {
  if (!entryDesiredTime) return true;
  return String(entryDesiredTime).slice(0, 5) === freedTimeHm;
}

export function pickFirstMatchingWaitlistEntry(
  entries: WaitlistEntryCandidate[],
  booking: CancelledBookingForWaitlistOffer,
): WaitlistEntryCandidate | null {
  const freedTimeHm =
    typeof booking.booking_time === 'string' ? booking.booking_time.slice(0, 5) : '';
  const practitioner = freedPractitionerId(booking);
  const serviceIds = freedServiceIds(booking);

  for (const entry of entries) {
    if (!waitlistServiceMatchesFreedSlot(entry, serviceIds)) continue;
    if (!waitlistPractitionerMatchesFreedSlot(entry.practitioner_id, practitioner)) continue;
    if (!waitlistTimeMatchesFreedSlot(entry.desired_time, freedTimeHm)) continue;
    return entry;
  }
  return null;
}

function publicBookingUrl(slug: string | null | undefined): string | null {
  if (!slug?.trim()) return null;
  const base = (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://www.reserveni.com').replace(/\/$/, '');
  return `${base}/book/${slug.trim()}`;
}

/**
 * Offers the freed appointment slot to the oldest matching waitlist guest (FIFO).
 * Gated on `waitlist_v2`. Safe to call after cancel; no-ops when not applicable.
 */
export async function offerAppointmentWaitlistOnCancel(
  admin: SupabaseClient,
  booking: CancelledBookingForWaitlistOffer,
): Promise<OfferAppointmentWaitlistOnCancelResult> {
  if (!isAppointmentBookingForWaitlistOffer(booking)) {
    return { offered: false, reason: 'not_appointment_booking' };
  }

  const freedTimeHm =
    typeof booking.booking_time === 'string' ? booking.booking_time.slice(0, 5) : '';
  if (!freedTimeHm) {
    return { offered: false, reason: 'missing_booking_time' };
  }

  const serviceIds = freedServiceIds(booking);
  if (!serviceIds.serviceItemId && !serviceIds.appointmentServiceId) {
    return { offered: false, reason: 'missing_service' };
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
    return { offered: false, reason: 'venue_not_found' };
  }

  const venueFlags = parseVenueFeatureFlags(
    (venueRow as { feature_flags?: unknown }).feature_flags,
  );
  if (!resolveAppointmentsFeatureFlag('waitlist_v2', venueFlags)) {
    return { offered: false, reason: 'waitlist_v2_disabled' };
  }

  const timeForDb = `${freedTimeHm}:00`;

  const { count: offeredCount } = await admin
    .from('waitlist_entries')
    .select('id', { count: 'exact', head: true })
    .eq('venue_id', booking.venue_id)
    .eq('waitlist_kind', 'appointment')
    .eq('status', 'offered')
    .eq('desired_date', booking.booking_date)
    .eq('desired_time', timeForDb);

  if ((offeredCount ?? 0) > 0) {
    return { offered: false, reason: 'slot_already_offered' };
  }

  const { data: waitingRows, error: listErr } = await admin
    .from('waitlist_entries')
    .select(
      'id, desired_date, desired_time, practitioner_id, appointment_service_id, service_item_id, guest_first_name, guest_last_name, guest_email, guest_phone, created_at',
    )
    .eq('venue_id', booking.venue_id)
    .eq('waitlist_kind', 'appointment')
    .eq('desired_date', booking.booking_date)
    .eq('status', 'waiting')
    .order('created_at', { ascending: true });

  if (listErr) {
    console.error('[offerAppointmentWaitlistOnCancel] waitlist query failed:', listErr, {
      bookingId: booking.id,
    });
    return { offered: false, reason: 'waitlist_query_failed' };
  }

  const match = pickFirstMatchingWaitlistEntry(
    (waitingRows ?? []) as WaitlistEntryCandidate[],
    booking,
  );
  if (!match) {
    return { offered: false, reason: 'no_matching_waitlist' };
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + APPOINTMENT_WAITLIST_OFFER_TTL_MS).toISOString();
  const updatePayload: Record<string, unknown> = {
    status: 'offered',
    offered_at: now.toISOString(),
    expires_at: expiresAt,
  };
  if (!match.desired_time) {
    updatePayload.desired_time = timeForDb;
  }

  const { data: updated, error: updateErr } = await admin
    .from('waitlist_entries')
    .update(updatePayload)
    .eq('id', match.id)
    .eq('venue_id', booking.venue_id)
    .eq('status', 'waiting')
    .select('id')
    .maybeSingle();

  if (updateErr || !updated) {
    console.error('[offerAppointmentWaitlistOnCancel] offer update failed:', updateErr, {
      waitlistEntryId: match.id,
      bookingId: booking.id,
    });
    return { offered: false, reason: 'offer_update_failed' };
  }

  const notify = await notifyAppointmentWaitlistOfferForEntry(
    admin,
    booking.venue_id,
    {
      desired_date: booking.booking_date,
      desired_time: match.desired_time ?? timeForDb,
      guest_first_name: match.guest_first_name,
      guest_last_name: match.guest_last_name,
      guest_email: match.guest_email,
      guest_phone: match.guest_phone,
    },
    expiresAt,
  );

  return {
    offered: true,
    waitlistEntryId: match.id,
    emailSent: notify.emailSent,
    smsSent: notify.smsSent,
  };
}
