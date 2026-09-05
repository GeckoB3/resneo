/**
 * Staff waitlist slot opportunities — enrich, offer, dismiss.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  findMatchingWaitlistEntries,
  type WaitlistEntryCandidate,
} from '@/lib/booking/offer-appointment-waitlist-on-cancel';
import {
  cancelledBookingFromFreedSlot,
  slotTimeHm,
  type WaitlistFreedSlotContext,
} from '@/lib/booking/waitlist-freed-slot';
import { enrichWaitlistEntriesForDisplay } from '@/lib/booking/waitlist-entry-display';
import { findAppointmentWaitlistAvailability } from '@/lib/booking/waitlist-offer-availability';
import { offerWaitlistEntryByStaff } from '@/lib/booking/waitlist-offer-staff';
import { recordWaitlistSlotOpportunityFromSlot } from '@/lib/booking/record-waitlist-slot-opportunity';

export interface WaitlistSlotOpportunityRow {
  id: string;
  venue_id: string;
  slot_date: string;
  slot_time: string;
  practitioner_id: string | null;
  calendar_id: string | null;
  appointment_service_id: string | null;
  service_item_id: string | null;
  source_booking_id: string | null;
  status: string;
  created_at: string;
}

export interface EnrichedWaitlistSlotOpportunity {
  id: string;
  slot_date: string;
  slot_time_hm: string;
  service_name: string | null;
  calendar_name: string | null;
  matching_waitlist_count: number;
  created_at: string;
}

export function opportunityToFreedSlot(row: WaitlistSlotOpportunityRow): WaitlistFreedSlotContext {
  return {
    venueId: row.venue_id,
    slotDate: row.slot_date,
    slotTime: row.slot_time,
    calendarId: row.calendar_id ?? row.practitioner_id ?? null,
    appointmentServiceId: row.appointment_service_id,
    serviceItemId: row.service_item_id,
    sourceBookingId: row.source_booking_id,
  };
}

export type WaitlistEntrySlotLookup = {
  desired_date: string;
  appointment_service_id?: string | null;
  service_item_id?: string | null;
  practitioner_id?: string | null;
};

/** Prefer a known freed slot from staff alerts over generic availability sampling. */
export async function findOpenWaitlistOpportunityForEntry(
  admin: SupabaseClient,
  venueId: string,
  entry: WaitlistEntrySlotLookup,
): Promise<WaitlistSlotOpportunityRow | null> {
  let query = admin
    .from('waitlist_slot_opportunities')
    .select('*')
    .eq('venue_id', venueId)
    .eq('slot_date', entry.desired_date)
    .eq('status', 'open')
    .order('created_at', { ascending: true });

  const serviceItemId = entry.service_item_id ?? null;
  const appointmentServiceId = entry.appointment_service_id ?? null;
  if (serviceItemId) {
    query = query.eq('service_item_id', serviceItemId);
  } else if (appointmentServiceId) {
    query = query.eq('appointment_service_id', appointmentServiceId);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[findOpenWaitlistOpportunityForEntry] query failed:', error, { venueId });
    return null;
  }

  const rows = (data ?? []) as WaitlistSlotOpportunityRow[];
  if (rows.length === 0) return null;

  const practitionerId = entry.practitioner_id ?? null;
  if (practitionerId) {
    const match = rows.find(
      (row) => row.calendar_id === practitionerId || row.practitioner_id === practitionerId,
    );
    if (match) return match;
  }

  return rows[0] ?? null;
}

async function resolveCalendarName(
  admin: SupabaseClient,
  calendarId: string | null,
): Promise<string | null> {
  if (!calendarId) return null;

  const { data: calendar } = await admin
    .from('unified_calendars')
    .select('name')
    .eq('id', calendarId)
    .maybeSingle();
  if (calendar?.name) return String(calendar.name);

  const { data: practitioner } = await admin
    .from('practitioners')
    .select('name')
    .eq('id', calendarId)
    .maybeSingle();
  return practitioner?.name ? String(practitioner.name) : null;
}

async function loadMatchingWaitingEntries(
  admin: SupabaseClient,
  row: WaitlistSlotOpportunityRow,
): Promise<WaitlistEntryCandidate[]> {
  const { data: waitingRows, error } = await admin
    .from('waitlist_entries')
    .select(
      'id, desired_date, desired_time, desired_time_end, practitioner_id, appointment_service_id, service_item_id, guest_first_name, guest_last_name, guest_email, guest_phone, created_at',
    )
    .eq('venue_id', row.venue_id)
    .eq('waitlist_kind', 'appointment')
    .eq('desired_date', row.slot_date)
    .eq('status', 'waiting')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[loadMatchingWaitingEntries] query failed:', error);
    return [];
  }

  const syntheticBooking = cancelledBookingFromFreedSlot(opportunityToFreedSlot(row));
  return findMatchingWaitlistEntries(
    (waitingRows ?? []) as WaitlistEntryCandidate[],
    syntheticBooking,
  );
}

export async function enrichWaitlistSlotOpportunities(
  admin: SupabaseClient,
  rows: WaitlistSlotOpportunityRow[],
): Promise<EnrichedWaitlistSlotOpportunity[]> {
  if (rows.length === 0) return [];

  const displayByService = await enrichWaitlistEntriesForDisplay(
    admin,
    rows.map((row) => ({
      id: row.id,
      service_item_id: row.service_item_id,
      appointment_service_id: row.appointment_service_id,
      practitioner_id: row.calendar_id ?? row.practitioner_id,
    })),
  );

  // Each row's lookups run side by side (order is kept): this used to be two
  // queries per row, one row at a time.
  const enriched: EnrichedWaitlistSlotOpportunity[] = await Promise.all(
    rows.map(async (row) => {
      const display = displayByIdSafe(displayByService, row.id);
      const [calendarName, matches] = await Promise.all([
        resolveCalendarName(admin, row.calendar_id ?? row.practitioner_id),
        loadMatchingWaitingEntries(admin, row),
      ]);
      return {
        id: row.id,
        slot_date: row.slot_date,
        slot_time_hm: slotTimeHm(row.slot_time),
        service_name: display?.service_name ?? null,
        calendar_name: calendarName,
        matching_waitlist_count: matches.length,
        created_at: row.created_at,
      };
    }),
  );

  return enriched;
}

/**
 * Ensures staff_choose alerts exist for waiting guests when bookable slots are available.
 * Covers missed cancel hooks and entries whose preferences match freed availability.
 */
export async function ensureStaffChooseOpportunitiesFromWaitlist(
  admin: SupabaseClient,
  venueId: string,
): Promise<void> {
  const { data: waitingRows, error } = await admin
    .from('waitlist_entries')
    .select(
      'desired_date, desired_time, desired_time_end, practitioner_id, appointment_service_id, service_item_id',
    )
    .eq('venue_id', venueId)
    .eq('waitlist_kind', 'appointment')
    .eq('status', 'waiting');

  if (error) {
    console.error('[ensureStaffChooseOpportunitiesFromWaitlist] query failed:', error);
    return;
  }

  for (const row of waitingRows ?? []) {
    const entry = row as {
      desired_date: string;
      desired_time: string | null;
      desired_time_end?: string | null;
      practitioner_id: string | null;
      appointment_service_id: string | null;
      service_item_id: string | null;
    };

    const availability = await findAppointmentWaitlistAvailability(admin, venueId, {
      desired_date: String(entry.desired_date),
      desired_time: entry.desired_time ?? null,
      desired_time_end: entry.desired_time_end ?? null,
      appointment_service_id: entry.appointment_service_id ?? null,
      service_item_id: entry.service_item_id ?? null,
      practitioner_id: entry.practitioner_id ?? null,
    });

    if (!availability.available || !availability.sampleSlotStartHm || !availability.sampleCalendarId) {
      continue;
    }

    await recordWaitlistSlotOpportunityFromSlot(admin, {
      venue_id: venueId,
      slot_date: String(entry.desired_date),
      slot_time: `${availability.sampleSlotStartHm}:00`,
      practitioner_id: availability.sampleCalendarId,
      calendar_id: availability.sampleCalendarId,
      appointment_service_id: entry.appointment_service_id ?? null,
      service_item_id: entry.service_item_id ?? null,
    });
  }
}

function displayByIdSafe(
  map: Map<string, { service_name: string | null; practitioner_name: string | null }>,
  id: string,
) {
  return map.get(id) ?? null;
}

export type OfferFromOpportunityResult =
  | {
      ok: true;
      waitlistEntryId: string;
      guestName: string;
      emailSent: boolean;
      smsSent: boolean;
    }
  | { ok: false; error: string; status: number };

export async function offerWaitlistFromOpportunity(
  admin: SupabaseClient,
  venueId: string,
  opportunityId: string,
): Promise<OfferFromOpportunityResult> {
  const { data: row, error } = await admin
    .from('waitlist_slot_opportunities')
    .select('*')
    .eq('id', opportunityId)
    .eq('venue_id', venueId)
    .eq('status', 'open')
    .maybeSingle();

  if (error || !row) {
    return { ok: false, error: 'Waitlist alert not found', status: 404 };
  }

  const opportunity = row as WaitlistSlotOpportunityRow;
  const matches = await loadMatchingWaitingEntries(admin, opportunity);
  if (matches.length === 0) {
    return {
      ok: false,
      error: 'No waitlist guests match this availability anymore.',
      status: 409,
    };
  }

  const slot = opportunityToFreedSlot(opportunity);
  const offer = await offerWaitlistEntryByStaff(admin, slot, matches[0]);
  if (!offer.ok) {
    return { ok: false, error: 'Failed to offer appointment to waitlist guest', status: 500 };
  }

  const match = matches[0];
  const guestName = [match.guest_first_name, match.guest_last_name].filter(Boolean).join(' ') || 'Guest';

  await admin
    .from('waitlist_slot_opportunities')
    .update({ status: 'dismissed', dismissed_at: new Date().toISOString() })
    .eq('id', opportunityId)
    .eq('venue_id', venueId)
    .eq('status', 'open');

  return {
    ok: true,
    waitlistEntryId: offer.waitlistEntryId,
    guestName,
    emailSent: offer.emailSent,
    smsSent: offer.smsSent,
  };
}

export async function dismissWaitlistSlotOpportunity(
  admin: SupabaseClient,
  venueId: string,
  opportunityId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from('waitlist_slot_opportunities')
    .update({ status: 'dismissed', dismissed_at: new Date().toISOString() })
    .eq('id', opportunityId)
    .eq('venue_id', venueId)
    .eq('status', 'open')
    .select('id')
    .maybeSingle();

  return !error && Boolean(data);
}

export async function markWaitlistOpportunitiesFilledForSlot(
  admin: SupabaseClient,
  slot: WaitlistFreedSlotContext,
): Promise<void> {
  const timeForDb = slot.slotTime.includes(':') && slot.slotTime.length >= 8
    ? slot.slotTime
    : `${slotTimeHm(slot.slotTime)}:00`;

  let query = admin
    .from('waitlist_slot_opportunities')
    .update({ status: 'filled', filled_at: new Date().toISOString() })
    .eq('venue_id', slot.venueId)
    .eq('slot_date', slot.slotDate)
    .eq('slot_time', timeForDb)
    .eq('status', 'open');

  const calendarId = slot.calendarId;
  if (calendarId) {
    query = query.or(`calendar_id.eq.${calendarId},practitioner_id.eq.${calendarId}`);
  } else {
    query = query.is('calendar_id', null).is('practitioner_id', null);
  }

  const { error } = await query;
  if (error) {
    console.error('[markWaitlistOpportunitiesFilledForSlot] update failed:', error, {
      venueId: slot.venueId,
    });
  }
}
