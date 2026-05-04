import type { SupabaseClient } from '@supabase/supabase-js';
import { BOOKING_ACTIVE_STATUSES } from '@/lib/table-management/constants';

/** Shown when hard-deleting catalogue entities that still have live future bookings. */
export const UPCOMING_ACTIVE_BOOKINGS_BLOCK_DELETE =
  'There are upcoming active bookings linked to this item. Cancel or reschedule them before deleting it.';

function todayIsoDateUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function hasUpcomingActiveBookingsForVenueServiceItem(
  admin: SupabaseClient,
  venueId: string,
  serviceItemId: string,
): Promise<{ blocked: boolean; error?: string }> {
  const today = todayIsoDateUtc();
  const { data, error } = await admin
    .from('bookings')
    .select('id')
    .eq('venue_id', venueId)
    .eq('service_item_id', serviceItemId)
    .gte('booking_date', today)
    .in('status', [...BOOKING_ACTIVE_STATUSES])
    .limit(1);

  if (error) {
    console.error('hasUpcomingActiveBookingsForVenueServiceItem:', error.message);
    return { blocked: true, error: 'Could not verify existing bookings.' };
  }
  return { blocked: (data?.length ?? 0) > 0 };
}

export async function hasUpcomingActiveBookingsForVenueAppointmentService(
  admin: SupabaseClient,
  venueId: string,
  appointmentServiceId: string,
): Promise<{ blocked: boolean; error?: string }> {
  const today = todayIsoDateUtc();
  const { data, error } = await admin
    .from('bookings')
    .select('id')
    .eq('venue_id', venueId)
    .eq('appointment_service_id', appointmentServiceId)
    .gte('booking_date', today)
    .in('status', [...BOOKING_ACTIVE_STATUSES])
    .limit(1);

  if (error) {
    console.error('hasUpcomingActiveBookingsForVenueAppointmentService:', error.message);
    return { blocked: true, error: 'Could not verify existing bookings.' };
  }
  return { blocked: (data?.length ?? 0) > 0 };
}

export async function hasUpcomingActiveBookingsForVenueResource(
  admin: SupabaseClient,
  venueId: string,
  resourceUnifiedCalendarId: string,
): Promise<{ blocked: boolean; error?: string }> {
  const today = todayIsoDateUtc();
  const { data, error } = await admin
    .from('bookings')
    .select('id')
    .eq('venue_id', venueId)
    .eq('resource_id', resourceUnifiedCalendarId)
    .gte('booking_date', today)
    .in('status', [...BOOKING_ACTIVE_STATUSES])
    .limit(1);

  if (error) {
    console.error('hasUpcomingActiveBookingsForVenueResource:', error.message);
    return { blocked: true, error: 'Could not verify existing bookings.' };
  }
  return { blocked: (data?.length ?? 0) > 0 };
}

/** Class type: any active booking tied to a non-cancelled instance on or after today. */
export async function hasUpcomingActiveBookingsForClassType(
  admin: SupabaseClient,
  venueId: string,
  classTypeId: string,
): Promise<{ blocked: boolean; error?: string }> {
  const today = todayIsoDateUtc();
  const { data: instances, error: instErr } = await admin
    .from('class_instances')
    .select('id')
    .eq('class_type_id', classTypeId)
    .eq('is_cancelled', false)
    .gte('instance_date', today);

  if (instErr) {
    console.error('hasUpcomingActiveBookingsForClassType (instances):', instErr.message);
    return { blocked: true, error: 'Could not verify class sessions.' };
  }
  const ids = (instances ?? []).map((r) => (r as { id: string }).id);
  if (ids.length === 0) return { blocked: false };

  const { data, error } = await admin
    .from('bookings')
    .select('id')
    .eq('venue_id', venueId)
    .in('class_instance_id', ids)
    .in('status', [...BOOKING_ACTIVE_STATUSES])
    .limit(1);

  if (error) {
    console.error('hasUpcomingActiveBookingsForClassType (bookings):', error.message);
    return { blocked: true, error: 'Could not verify existing bookings.' };
  }
  return { blocked: (data?.length ?? 0) > 0 };
}

/** Single class instance: active bookings for this session (any date — avoids orphaning live rows). */
export async function hasActiveBookingsForClassInstance(
  admin: SupabaseClient,
  venueId: string,
  classInstanceId: string,
): Promise<{ blocked: boolean; error?: string }> {
  const { data, error } = await admin
    .from('bookings')
    .select('id')
    .eq('venue_id', venueId)
    .eq('class_instance_id', classInstanceId)
    .in('status', [...BOOKING_ACTIVE_STATUSES])
    .limit(1);

  if (error) {
    console.error('hasActiveBookingsForClassInstance:', error.message);
    return { blocked: true, error: 'Could not verify existing bookings.' };
  }
  return { blocked: (data?.length ?? 0) > 0 };
}

/** Timetable row: block delete while future sessions from this rule still have active bookings. */
export async function hasUpcomingActiveBookingsForClassTimetableEntry(
  admin: SupabaseClient,
  venueId: string,
  timetableEntryId: string,
): Promise<{ blocked: boolean; error?: string }> {
  const today = todayIsoDateUtc();
  const { data: instances, error: instErr } = await admin
    .from('class_instances')
    .select('id')
    .eq('timetable_entry_id', timetableEntryId)
    .eq('is_cancelled', false)
    .gte('instance_date', today);

  if (instErr) {
    console.error('hasUpcomingActiveBookingsForClassTimetableEntry (instances):', instErr.message);
    return { blocked: true, error: 'Could not verify class sessions.' };
  }
  const ids = (instances ?? []).map((r) => (r as { id: string }).id);
  if (ids.length === 0) return { blocked: false };

  const { data, error } = await admin
    .from('bookings')
    .select('id')
    .eq('venue_id', venueId)
    .in('class_instance_id', ids)
    .in('status', [...BOOKING_ACTIVE_STATUSES])
    .limit(1);

  if (error) {
    console.error('hasUpcomingActiveBookingsForClassTimetableEntry (bookings):', error.message);
    return { blocked: true, error: 'Could not verify existing bookings.' };
  }
  return { blocked: (data?.length ?? 0) > 0 };
}
