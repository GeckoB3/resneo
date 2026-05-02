import type { SupabaseClient } from '@supabase/supabase-js';

export interface ContactAuditInsert {
  venue_id: string;
  guest_id: string | null;
  actor_staff_id: string;
  event_type: string;
  metadata?: Record<string, unknown>;
}

/**
 * Append-only contact/GDPR audit row. Call from server routes using service-role client.
 */
export async function insertContactAuditEvent(
  db: SupabaseClient,
  row: ContactAuditInsert,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await db.from('contact_audit_events').insert({
    venue_id: row.venue_id,
    guest_id: row.guest_id,
    actor_staff_id: row.actor_staff_id,
    event_type: row.event_type,
    metadata: row.metadata ?? {},
  });
  if (error) {
    console.error('[insertContactAuditEvent] insert failed:', error.message, row);
    return { ok: false, message: error.message };
  }
  return { ok: true };
}
