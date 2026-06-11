import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BookingModel } from '@/types/booking-models';
import { defaultNewUnifiedCalendarWorkingHours } from '@/lib/availability/practitioner-defaults';

/**
 * Minimal catalogue rows created from import Step 3b (create-new).
 * Aligns with dashboard defaults where possible.
 */
export async function createEntityForBookingImport(params: {
  admin: SupabaseClient;
  venueId: string;
  bookingModel: BookingModel;
  referenceType: 'service' | 'staff';
  name: string;
  sessionId: string;
  /** Service setup collected from the user (import wizard); falls back to 60min / no price. */
  durationMinutes?: number | null;
  pricePence?: number | null;
}): Promise<{ id: string; entityType: 'service_item' | 'unified_calendar' | 'appointment_service' | 'practitioner' }> {
  const { admin, venueId, bookingModel, referenceType, name, sessionId } = params;
  const label = name.trim();
  if (!label) throw new Error('Name required');
  const duration =
    params.durationMinutes && params.durationMinutes > 0 && params.durationMinutes <= 24 * 60
      ? Math.round(params.durationMinutes)
      : 60;
  const pricePence =
    params.pricePence != null && params.pricePence >= 0 ? Math.round(params.pricePence) : null;

  if (bookingModel === 'unified_scheduling') {
    if (referenceType === 'service') {
      const { data, error } = await admin
        .from('service_items')
        .insert({
          venue_id: venueId,
          name: label,
          description: null,
          item_type: 'service',
          duration_minutes: duration,
          buffer_minutes: 0,
          processing_time_minutes: 0,
          price_pence: pricePence,
          payment_requirement: 'none',
          deposit_pence: null,
          price_type: 'fixed',
          colour: '#3B82F6',
          is_active: true,
          sort_order: 0,
          max_advance_booking_days: 90,
          min_booking_notice_hours: 1,
          cancellation_notice_hours: 48,
          allow_same_day_booking: true,
        })
        .select('id')
        .single();
      if (error || !data) throw new Error(error?.message ?? 'Failed to create service');
      await admin.from('import_records').insert({
        session_id: sessionId,
        venue_id: venueId,
        record_type: 'service_item',
        record_id: (data as { id: string }).id,
        action: 'created',
        previous_data: null,
      });
      return { id: (data as { id: string }).id, entityType: 'service_item' };
    }

    const calId = randomUUID();
    const wh = defaultNewUnifiedCalendarWorkingHours();
    const { data: uc, error: ucErr } = await admin
      .from('unified_calendars')
      .insert({
        id: calId,
        venue_id: venueId,
        name: label,
        staff_id: null,
        slug: null,
        working_hours: wh,
        break_times: [],
        break_times_by_day: null,
        days_off: [],
        sort_order: 0,
        is_active: true,
        colour: '#3B82F6',
        calendar_type: 'practitioner',
      })
      .select('id')
      .single();
    if (ucErr || !uc) throw new Error(ucErr?.message ?? 'Failed to create calendar');
    await admin.from('import_records').insert({
      session_id: sessionId,
      venue_id: venueId,
      record_type: 'unified_calendar',
      record_id: (uc as { id: string }).id,
      action: 'created',
      previous_data: null,
    });
    return { id: (uc as { id: string }).id, entityType: 'unified_calendar' };
  }

  if (bookingModel === 'practitioner_appointment') {
    if (referenceType === 'service') {
      const { data, error } = await admin
        .from('appointment_services')
        .insert({
          venue_id: venueId,
          name: label,
          description: null,
          duration_minutes: duration,
          buffer_minutes: 0,
          price_pence: pricePence,
          deposit_pence: null,
          is_active: true,
          sort_order: 0,
        })
        .select('id')
        .single();
      if (error || !data) throw new Error(error?.message ?? 'Failed to create appointment service');
      await admin.from('import_records').insert({
        session_id: sessionId,
        venue_id: venueId,
        record_type: 'appointment_service',
        record_id: (data as { id: string }).id,
        action: 'created',
        previous_data: null,
      });
      return { id: (data as { id: string }).id, entityType: 'appointment_service' };
    }

    const { data, error } = await admin
      .from('practitioners')
      .insert({
        venue_id: venueId,
        name: label,
        email: null,
        phone: null,
        working_hours: {},
        break_times: [],
        days_off: [],
        is_active: true,
        sort_order: 0,
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'Failed to create practitioner');
    await admin.from('import_records').insert({
      session_id: sessionId,
      venue_id: venueId,
      record_type: 'practitioner',
      record_id: (data as { id: string }).id,
      action: 'created',
      previous_data: null,
    });
    return { id: (data as { id: string }).id, entityType: 'practitioner' };
  }

  throw new Error('Create flow not available for this booking model');
}
