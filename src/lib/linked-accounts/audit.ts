/** Audit-log helpers for Linked Accounts (§10). Write-events are captured by a
 * DB trigger; read-events are recorded here, debounced to 5-minute windows. */

import type { SupabaseClient } from '@supabase/supabase-js';
import { buildBookingAuditSnapshot } from '@/lib/linked-accounts/redact-booking-pii';

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
  /** The account link that authorised the write, or null when a collective did (plan §6.5). */
  linkId?: string | null;
  /**
   * The collective that authorised the write. `account_link_audit_log` takes either authority since
   * 20270215120000 (`account_link_audit_log_one_authority`), so a collective staff booking at
   * another member's venue is audited without inventing a pairwise link (D41).
   */
  collectiveId?: string | null;
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
    linkId = null,
    collectiveId = null,
    actingVenueId,
    actingUserId,
    owningVenueId,
    actionType,
    bookingId,
    beforeState = null,
    afterState = null,
  } = params;
  if (!linkId && !collectiveId) {
    console.error('[linked-accounts] recordBookingWriteAudit needs a link or a collective');
    return;
  }

  try {
    const { error } = await admin.from('account_link_audit_log').insert({
      link_id: linkId,
      collective_id: collectiveId,
      acting_venue_id: actingVenueId,
      acting_user_id: actingUserId,
      owning_venue_id: owningVenueId,
      action_type: actionType,
      resource_type: 'booking',
      resource_id: bookingId,
      // Callers pass whole booking rows, which carry the client's name, contact
      // details and free text. This table is append-only, visible to both venues
      // and outlives the link, so only operational fields are retained. A DB
      // trigger enforces the same projection; this keeps the PII from leaving
      // the application at all.
      before_state: buildBookingAuditSnapshot(beforeState),
      after_state: buildBookingAuditSnapshot(afterState),
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

/**
 * One audit row per booking a member's staff made at another member's venue through the collective
 * (plan §6.5 "Staff authority": authorised by collective role, audited, stamping the acting venue).
 * A booking at the acting venue's own calendars is not cross-venue and is not audited here.
 */
export async function recordCollectiveBookingAudit(params: {
  admin: SupabaseClient;
  collectiveId: string;
  actingVenueId: string;
  actingUserId: string | null;
  owningVenueId: string;
  bookingIds: string[];
  actionType?: 'created_booking' | 'edited_booking' | 'cancelled_booking';
}): Promise<void> {
  if (params.actingVenueId === params.owningVenueId || params.bookingIds.length === 0) return;
  for (const bookingId of params.bookingIds) {
    await recordBookingWriteAudit({
      admin: params.admin,
      collectiveId: params.collectiveId,
      actingVenueId: params.actingVenueId,
      actingUserId: params.actingUserId,
      owningVenueId: params.owningVenueId,
      actionType: params.actionType ?? 'created_booking',
      bookingId,
    });
  }
}
