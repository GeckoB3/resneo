import type { SupabaseClient } from '@supabase/supabase-js';
import { eraseGuestCompliance } from '@/lib/compliance/gdpr';

export async function runImportUndo(admin: SupabaseClient, sessionId: string, venueId: string): Promise<void> {
  const { data: session } = await admin
    .from('import_sessions')
    .select('id, undo_available_until, undone_at, status')
    .eq('id', sessionId)
    .eq('venue_id', venueId)
    .single();

  if (!session) throw new Error('Session not found');
  const s = session as { undo_available_until?: string | null; undone_at?: string | null; status?: string };
  if (s.undone_at) throw new Error('Import already undone');
  if (s.status !== 'complete') throw new Error('Import is not complete');
  if (!s.undo_available_until || new Date(s.undo_available_until) < new Date()) {
    throw new Error('Undo window has expired');
  }

  const { data: records } = await admin
    .from('import_records')
    .select('*')
    .eq('session_id', sessionId)
    .eq('venue_id', venueId)
    .order('created_at', { ascending: false });

  const rows = (records ?? []) as Array<{
    record_type: string;
    record_id: string;
    action: string;
    previous_data: Record<string, unknown> | null;
  }>;

  const bookingIds = rows.filter((r) => r.record_type === 'booking' && r.action === 'created').map((r) => r.record_id);
  if (bookingIds.length) {
    const { error: refBookingErr } = await admin
      .from('external_record_refs')
      .delete()
      .eq('venue_id', venueId)
      .eq('entity_type', 'booking')
      .in('entity_id', bookingIds);
    if (refBookingErr) {
      throw new Error(`Undo failed (external_record_refs): ${refBookingErr.message}`);
    }

    // Imported bookings may carry reminder-log rows written at import time by
    // recordImportPassedReminderLogs. Remove them so undo leaves no orphaned
    // communication_logs (and so an ON DELETE NO ACTION FK can't block the
    // booking delete below).
    const { error: commsLogErr } = await admin
      .from('communication_logs')
      .delete()
      .eq('venue_id', venueId)
      .in('booking_id', bookingIds);
    if (commsLogErr) {
      throw new Error(`Undo failed (communication_logs): ${commsLogErr.message}`);
    }

    // Legacy DBs: table_statuses.booking_id used to block deletes (NO ACTION). Clear before delete.
    const { error: clearTsErr } = await admin.from('table_statuses').update({ booking_id: null }).in('booking_id', bookingIds);
    if (clearTsErr) {
      throw new Error(`Undo failed (table statuses): ${clearTsErr.message}`);
    }

    const { error: bookingDelErr } = await admin.from('bookings').delete().in('id', bookingIds);
    if (bookingDelErr) {
      throw new Error(`Undo failed (bookings): ${bookingDelErr.message}`);
    }
  }

  const ucIds = rows
    .filter((r) => r.record_type === 'unified_calendar' && r.action === 'created')
    .map((r) => r.record_id);
  if (ucIds.length) {
    await admin.from('calendar_service_assignments').delete().in('calendar_id', ucIds);
    await admin.from('unified_calendars').delete().in('id', ucIds).eq('venue_id', venueId);
  }

  const siIds = rows
    .filter((r) => r.record_type === 'service_item' && r.action === 'created')
    .map((r) => r.record_id);
  if (siIds.length) {
    await admin.from('service_items').delete().in('id', siIds).eq('venue_id', venueId);
  }

  const asIds = rows
    .filter((r) => r.record_type === 'appointment_service' && r.action === 'created')
    .map((r) => r.record_id);
  if (asIds.length) {
    await admin.from('practitioner_services').delete().in('service_id', asIds);
    await admin.from('appointment_services').delete().in('id', asIds).eq('venue_id', venueId);
  }

  const prIds = rows
    .filter((r) => r.record_type === 'practitioner' && r.action === 'created')
    .map((r) => r.record_id);
  if (prIds.length) {
    await admin.from('practitioner_services').delete().in('practitioner_id', prIds);
    await admin.from('practitioners').delete().in('id', prIds).eq('venue_id', venueId);
  }

  const guestIdsDeleted = rows
    .filter((r) => r.record_type === 'guest' && r.action === 'created')
    .map((r) => r.record_id);
  if (guestIdsDeleted.length) {
    const { error: refGuestErr } = await admin
      .from('external_record_refs')
      .delete()
      .eq('venue_id', venueId)
      .eq('entity_type', 'guest')
      .in('entity_id', guestIdsDeleted);
    if (refGuestErr) {
      throw new Error(`Undo failed (external_record_refs guests): ${refGuestErr.message}`);
    }

    // Compliance hygiene (improvement plan Phase 4 / G7): the guests.delete() below
    // cascade-deletes compliance_records rows but leaves their signature/file objects
    // orphaned in the compliance-files bucket. Erase those first (best-effort).
    for (const gid of guestIdsDeleted) {
      await eraseGuestCompliance(admin, venueId, gid);
    }
  }

  for (const r of rows) {
    if (r.record_type !== 'guest') continue;
    if (r.action === 'created') {
      await admin.from('guests').delete().eq('id', r.record_id).eq('venue_id', venueId);
    } else if (r.action === 'updated' && r.previous_data) {
      const prev = r.previous_data;
      await admin
        .from('guests')
        .update({
          first_name: prev.first_name as string | null,
          last_name: prev.last_name as string | null,
          email: prev.email as string | null,
          phone: prev.phone as string | null,
          visit_count: prev.visit_count as number,
          tags: prev.tags as string[],
          marketing_opt_out: prev.marketing_opt_out as boolean,
          last_visit_date: prev.last_visit_date as string | null,
          custom_fields: prev.custom_fields as Record<string, unknown>,
          updated_at: new Date().toISOString(),
        })
        .eq('id', r.record_id)
        .eq('venue_id', venueId);
    }
  }

  await admin
    .from('import_sessions')
    .update({
      status: 'undone',
      undone_at: new Date().toISOString(),
      undo_available_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId);
}
