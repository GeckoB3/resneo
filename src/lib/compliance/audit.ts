import type { SupabaseClient } from '@supabase/supabase-js';

/** Append-only compliance audit event types (spec §4.7.1). */
export type ComplianceAuditEventType =
  | 'type.created'
  | 'type.updated'
  | 'type.archived'
  | 'type.restored'
  | 'version.created'
  | 'requirement.added'
  | 'requirement.removed'
  | 'requirement.updated'
  | 'record.captured'
  | 'record.updated'
  | 'record.voided'
  | 'record.viewed'
  | 'guest.compliance_erased'
  | 'link.issued'
  | 'link.sent'
  | 'link.consumed'
  | 'link.expired'
  | 'link.revoked';

export interface ComplianceAuditEventInput {
  venueId: string;
  eventType: ComplianceAuditEventType;
  actorType: 'staff' | 'client' | 'system';
  actorStaffId?: string | null;
  guestId?: string | null;
  complianceRecordId?: string | null;
  complianceFormLinkId?: string | null;
  complianceTypeId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Write a row to the append-only `compliance_audit_events` table.
 * Best-effort: a failure to log must never fail the parent operation, so errors
 * are logged and swallowed (mirrors contact_audit_events usage).
 */
export async function writeComplianceAuditEvent(
  admin: SupabaseClient,
  input: ComplianceAuditEventInput,
): Promise<void> {
  const { error } = await admin.from('compliance_audit_events').insert({
    venue_id: input.venueId,
    event_type: input.eventType,
    actor_type: input.actorType,
    actor_staff_id: input.actorStaffId ?? null,
    guest_id: input.guestId ?? null,
    compliance_record_id: input.complianceRecordId ?? null,
    compliance_form_link_id: input.complianceFormLinkId ?? null,
    compliance_type_id: input.complianceTypeId ?? null,
    metadata: input.metadata ?? {},
  });
  if (error) {
    console.error('[writeComplianceAuditEvent] insert failed:', error.message, {
      venueId: input.venueId,
      eventType: input.eventType,
    });
  }
}
