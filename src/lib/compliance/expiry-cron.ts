import type { SupabaseClient } from '@supabase/supabase-js';
import { isAppointmentPlanTier } from '@/lib/tier-enforcement';
import { parseVenueFeatureFlags, resolveAppointmentsFeatureFlag } from '@/lib/feature-flags/resolve';
import { parseComplianceConfig, type ComplianceConfig } from '@/lib/compliance/config';
import { issueOrReuseFormLink, markFormLinkSent } from '@/lib/compliance/form-links-service';
import { dispatchComplianceFormLink } from '@/lib/compliance/dispatch';

/**
 * Nightly compliance expiry + reminder job (spec §5.7). Pure-ish orchestration:
 * the reminder sender is injectable so the whole flow can be unit-tested with a
 * fake Supabase client and a spy sender.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Upper bound on how far ahead we scan for reminders (max configurable cadence). */
const MAX_REMINDER_HORIZON_DAYS = 90;
const REMINDER_BATCH_LIMIT = 1000;

export interface ExpiryReminderTarget {
  recordId: string;
  venueId: string;
  guestId: string;
  complianceTypeId: string;
  expiresAt: string;
  config: ComplianceConfig;
}

export interface ComplianceExpiryDeps {
  now?: Date;
  /** Send the expiry reminder for one record. Returns true if a message went out. */
  sendReminder?: (target: ExpiryReminderTarget) => Promise<boolean>;
}

export interface ComplianceExpiryResult {
  expired: number;
  remindersAttempted: number;
  remindersSent: number;
  errors: string[];
}

/** Default reminder sender: issue/reuse a fresh link and dispatch `compliance_record_expiring`. */
async function defaultSendReminder(
  admin: SupabaseClient,
  target: ExpiryReminderTarget,
): Promise<boolean> {
  const issued = await issueOrReuseFormLink(admin, {
    venueId: target.venueId,
    staffId: null,
    guestId: target.guestId,
    complianceTypeId: target.complianceTypeId,
    config: target.config,
  });
  if (!issued.ok) return false;

  const sentVia = target.config.default_form_link_channel === 'sms' ? 'sms' : 'email';
  const result = await dispatchComplianceFormLink(admin, {
    venueId: target.venueId,
    guestId: target.guestId,
    linkId: issued.value.link.id as string,
    code: issued.value.link.code as string,
    sentVia,
    kind: 'expiring',
  });
  if (result.ok) {
    await markFormLinkSent(admin, {
      venueId: target.venueId,
      staffId: null,
      linkId: issued.value.link.id as string,
      sentVia,
      guestId: target.guestId,
      complianceTypeId: target.complianceTypeId,
    });
  }
  return result.ok;
}

export async function runComplianceExpiry(
  admin: SupabaseClient,
  deps: ComplianceExpiryDeps = {},
): Promise<ComplianceExpiryResult> {
  const now = deps.now ?? new Date();
  const nowIso = now.toISOString();
  const sendReminder = deps.sendReminder ?? ((t: ExpiryReminderTarget) => defaultSendReminder(admin, t));
  const errors: string[] = [];

  // 1. Expiry pass — flip completed records past their expiry to 'expired'.
  let expired = 0;
  const { data: expiredRows, error: expErr } = await admin
    .from('compliance_records')
    .update({ status: 'expired', updated_at: nowIso })
    .eq('status', 'completed')
    .not('expires_at', 'is', null)
    .lt('expires_at', nowIso)
    .select('id');
  if (expErr) {
    errors.push(`expiry pass: ${expErr.message}`);
  } else {
    expired = (expiredRows ?? []).length;
  }

  // 2. Reminder pass — records nearing expiry, not yet reminded this cycle.
  const horizonIso = new Date(now.getTime() + MAX_REMINDER_HORIZON_DAYS * MS_PER_DAY).toISOString();
  const { data: candidates, error: candErr } = await admin
    .from('compliance_records')
    .select('id, venue_id, guest_id, compliance_type_id, expires_at')
    .eq('status', 'completed')
    .not('expires_at', 'is', null)
    .is('reminder_sent_at', null)
    .gt('expires_at', nowIso)
    .lte('expires_at', horizonIso)
    .limit(REMINDER_BATCH_LIMIT);

  let remindersAttempted = 0;
  let remindersSent = 0;

  if (candErr) {
    errors.push(`reminder select: ${candErr.message}`);
    return { expired, remindersAttempted, remindersSent, errors };
  }

  const rows = (candidates ?? []) as Array<{
    id: string;
    venue_id: string;
    guest_id: string;
    compliance_type_id: string;
    expires_at: string;
  }>;

  // Resolve each venue's compliance config once (cadence + flag + tier gate).
  const venueIds = [...new Set(rows.map((r) => r.venue_id))];
  const configByVenue = new Map<string, ComplianceConfig | null>();
  if (venueIds.length > 0) {
    const { data: venues } = await admin
      .from('venues')
      .select('id, pricing_tier, feature_flags')
      .in('id', venueIds);
    for (const v of (venues ?? []) as Array<{ id: string; pricing_tier: string | null; feature_flags: unknown }>) {
      const flags = parseVenueFeatureFlags(v.feature_flags);
      const enabled =
        isAppointmentPlanTier(v.pricing_tier) &&
        resolveAppointmentsFeatureFlag('compliance_records_enabled', flags);
      configByVenue.set(v.id, enabled ? parseComplianceConfig(flags) : null);
    }
  }

  for (const row of rows) {
    const config = configByVenue.get(row.venue_id) ?? null;
    if (!config) continue; // compliance not active for this venue
    const cadenceDays = config.reminder_cadence_days;
    if (cadenceDays <= 0) continue; // reminders disabled
    const reminderFrom = new Date(now.getTime() + cadenceDays * MS_PER_DAY);
    if (new Date(row.expires_at).getTime() > reminderFrom.getTime()) continue; // not within cadence yet

    remindersAttempted += 1;
    let sent = false;
    try {
      sent = await sendReminder({
        recordId: row.id,
        venueId: row.venue_id,
        guestId: row.guest_id,
        complianceTypeId: row.compliance_type_id,
        expiresAt: row.expires_at,
        config,
      });
    } catch (err) {
      errors.push(`reminder ${row.id}: ${err instanceof Error ? err.message : 'unknown'}`);
    }
    if (sent) remindersSent += 1;

    // Mark reminded only on a successful send (spec §5.7 guard prevents *duplicate*
    // sends once one has gone out). A transient channel failure leaves the guard null
    // so the next nightly run retries within the cadence window, rather than silently
    // suppressing the only expiry reminder the guest would ever get.
    if (sent) {
      const { error: markErr } = await admin
        .from('compliance_records')
        .update({ reminder_sent_at: nowIso })
        .eq('id', row.id)
        .eq('venue_id', row.venue_id);
      if (markErr) errors.push(`mark reminded ${row.id}: ${markErr.message}`);
    }
  }

  return { expired, remindersAttempted, remindersSent, errors };
}
