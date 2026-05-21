import { getSupabaseAdminClient } from '@/lib/supabase';
import { resolveCallerGrantOverVenue } from '@/lib/linked-accounts/queries';
import type { LinkGrant } from '@/lib/linked-accounts/types';
import type { VenueStaff } from '@/lib/venue-auth';

/** Row shape returned from `bookings` for staff/linked access checks. */
export type StaffAccessibleBookingRow = {
  id: string;
  venue_id: string;
  guest_id: string;
  status: string;
  booking_date: string;
  booking_time: string;
  party_size: number;
  booking_model?: string | null;
  practitioner_id?: string | null;
  calendar_id?: string | null;
  appointment_service_id?: string | null;
  service_item_id?: string | null;
  stripe_payment_intent_id?: string | null;
  deposit_status?: string | null;
  deposit_amount_pence?: number | null;
  group_booking_id?: string | null;
  processing_time_blocks?: unknown;
  service_variant_id?: string | null;
  experience_event_id?: string | null;
  class_instance_id?: string | null;
  resource_id?: string | null;
  client_arrived_at?: string | null;
  staff_attendance_confirmed_at?: string | null;
  guest_attendance_confirmed_at?: string | null;
  booking_end_time?: string | null;
  estimated_end_time?: string | null;
  cancellation_deadline?: string | null;
  dietary_notes?: string | null;
  special_requests?: string | null;
  internal_notes?: string | null;
  occasion?: string | null;
  area_id?: string | null;
  event_session_id?: string | null;
  [key: string]: unknown;
};

export interface StaffBookingAccessContext {
  booking: StaffAccessibleBookingRow;
  ownerVenueId: string;
  isOwnVenue: boolean;
  linkedGrant: LinkGrant | null;
  linkId: string | null;
}

export type StaffBookingAccessResult =
  | { ok: true; ctx: StaffBookingAccessContext }
  | { ok: false; status: 404 | 403; error: string };

/** Load a booking the signed-in staff member may access (own venue or linked grant). */
export async function loadStaffAccessibleBooking(
  staff: VenueStaff,
  bookingId: string,
): Promise<StaffBookingAccessResult> {
  const { data: booking, error } = await staff.db
    .from('bookings')
    .select('*')
    .eq('id', bookingId)
    .maybeSingle();

  if (error || !booking) {
    return { ok: false, status: 404, error: 'Booking not found' };
  }

  const ownerVenueId = booking.venue_id as string;
  const isOwnVenue = ownerVenueId === staff.venue_id;

  if (isOwnVenue) {
  return {
    ok: true,
    ctx: {
      booking: booking as StaffAccessibleBookingRow,
      ownerVenueId,
      isOwnVenue: true,
      linkedGrant: null,
      linkId: null,
    },
  };
  }

  const admin = getSupabaseAdminClient();
  const access = await resolveCallerGrantOverVenue(admin, staff.venue_id, ownerVenueId);
  if (!access || access.grant.calendar === 'none') {
    return { ok: false, status: 403, error: 'You do not have access to this booking.' };
  }

  return {
    ok: true,
    ctx: {
      booking: booking as StaffAccessibleBookingRow,
      ownerVenueId,
      isOwnVenue: false,
      linkedGrant: access.grant,
      linkId: access.linkId,
    },
  };
}

export function linkedGrantAllowsMutation(
  grant: LinkGrant | null,
  isOwnVenue: boolean,
): boolean {
  if (isOwnVenue) return true;
  return grant?.act === 'edit_existing' || grant?.act === 'create_edit_cancel';
}

export function linkedGrantAllowsCancel(
  grant: LinkGrant | null,
  isOwnVenue: boolean,
): boolean {
  if (isOwnVenue) return true;
  return grant?.act === 'create_edit_cancel';
}

export function linkedGrantHasFullDetails(
  grant: LinkGrant | null,
  isOwnVenue: boolean,
): boolean {
  if (isOwnVenue) return true;
  return grant?.calendar === 'full_details';
}

export interface LinkedStaffCreateContext {
  ownerVenueId: string;
  linkId: string;
  actingVenueId: string;
  actorUserId: string | null;
}

/** Resolve target venue for staff booking create (own venue or linked owner with create grant). */
export async function resolveLinkedStaffCreateScope(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  staffVenueId: string,
  ownerVenueId: string | undefined | null,
  actorUserId: string | null,
): Promise<
  | { ok: true; venueId: string; linked: LinkedStaffCreateContext | null }
  | { ok: false; status: 400 | 403; error: string }
> {
  if (!ownerVenueId || ownerVenueId === staffVenueId) {
    return { ok: true, venueId: staffVenueId, linked: null };
  }

  const access = await resolveCallerGrantOverVenue(admin, staffVenueId, ownerVenueId);
  if (!access) {
    return { ok: false, status: 403, error: 'You do not have an active link with that venue.' };
  }
  if (access.grant.act !== 'create_edit_cancel') {
    return {
      ok: false,
      status: 403,
      error: 'This link does not allow creating bookings in the other venue.',
    };
  }

  return {
    ok: true,
    venueId: ownerVenueId,
    linked: {
      ownerVenueId,
      linkId: access.linkId,
      actingVenueId: staffVenueId,
      actorUserId,
    },
  };
}
