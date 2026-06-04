/** Audit-log helpers for Linked Accounts (§10). Write-events are captured by a
 * DB trigger; read-events are recorded here, debounced to 5-minute windows. */

import type { SupabaseClient } from '@supabase/supabase-js';

const READ_DEBOUNCE_MS = 5 * 60 * 1000;

interface ReadAuditParams {
  admin: SupabaseClient;
  linkId: string;
  actingVenueId: string;
  actingUserId: string | null;
  owningVenueId: string;
  actionType: 'viewed_calendar' | 'viewed_booking';
  resourceType?: string | null;
  resourceId?: string | null;
}

/**
 * Record a cross-venue read. Deduped by (acting_user_id, resource_id, action)
 * within a 5-minute window so a calendar render does not spam the log.
 */
export async function recordReadAudit(params: ReadAuditParams): Promise<void> {
  const {
    admin,
    linkId,
    actingVenueId,
    actingUserId,
    owningVenueId,
    actionType,
    resourceType = null,
    resourceId = null,
  } = params;

  try {
    const sinceIso = new Date(Date.now() - READ_DEBOUNCE_MS).toISOString();
    let dedupe = admin
      .from('account_link_audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('acting_venue_id', actingVenueId)
      .eq('action_type', actionType)
      .gte('created_at', sinceIso);
    dedupe = actingUserId
      ? dedupe.eq('acting_user_id', actingUserId)
      : dedupe.is('acting_user_id', null);
    dedupe = resourceId ? dedupe.eq('resource_id', resourceId) : dedupe.is('resource_id', null);

    const { count } = await dedupe;
    if ((count ?? 0) > 0) return;

    const { error } = await admin.from('account_link_audit_log').insert({
      link_id: linkId,
      acting_venue_id: actingVenueId,
      acting_user_id: actingUserId,
      owning_venue_id: owningVenueId,
      action_type: actionType,
      resource_type: resourceType,
      resource_id: resourceId,
    });
    if (error) {
      console.error('[linked-accounts] recordReadAudit insert failed:', error.message);
    }
  } catch (err) {
    // Audit logging must never break the read it accompanies.
    console.error('[linked-accounts] recordReadAudit error:', err);
  }
}

interface BookingWriteAuditParams {
  admin: SupabaseClient;
  linkId: string;
  actingVenueId: string;
  actingUserId: string | null;
  owningVenueId: string;
  actionType: 'created_booking' | 'edited_booking' | 'cancelled_booking' | 'deleted_booking';
  bookingId: string;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
}

/** Records cross-venue booking writes when the DB trigger GUC path is not used. */
export async function recordBookingWriteAudit(params: BookingWriteAuditParams): Promise<void> {
  const {
    admin,
    linkId,
    actingVenueId,
    actingUserId,
    owningVenueId,
    actionType,
    bookingId,
    beforeState = null,
    afterState = null,
  } = params;

  try {
    const { error } = await admin.from('account_link_audit_log').insert({
      link_id: linkId,
      acting_venue_id: actingVenueId,
      acting_user_id: actingUserId,
      owning_venue_id: owningVenueId,
      action_type: actionType,
      resource_type: 'booking',
      resource_id: bookingId,
      before_state: beforeState,
      after_state: afterState,
    });
    if (error) {
      console.error('[linked-accounts] recordBookingWriteAudit insert failed:', error.message);
    }
  } catch (err) {
    console.error('[linked-accounts] recordBookingWriteAudit error:', err);
  }
}

/** Human-readable label for an audit action_type. */
export function auditActionLabel(actionType: string): string {
  switch (actionType) {
    case 'viewed_calendar':
      return 'Viewed calendar';
    case 'viewed_booking':
      return 'Viewed booking';
    case 'created_booking':
      return 'Created booking';
    case 'edited_booking':
      return 'Edited booking';
    case 'cancelled_booking':
      return 'Cancelled booking';
    case 'deleted_booking':
      return 'Deleted booking';
    default:
      return actionType;
  }
}
