import type { SupabaseClient } from '@supabase/supabase-js';
import { isAppointmentPlanTier } from '@/lib/tier-enforcement';
import { parseVenueFeatureFlags, resolveAppointmentsFeatureFlag } from '@/lib/feature-flags/resolve';
import { parseComplianceConfig, type ComplianceConfig } from '@/lib/compliance/config';
import {
  bookingDatetime,
  loadAndResolveServiceRequirements,
} from '@/lib/compliance/resolve-requirements';
import { issueOrReuseFormLink, markFormLinkSent } from '@/lib/compliance/form-links-service';
import { dispatchComplianceFormLink } from '@/lib/compliance/dispatch';

/**
 * Compliance auto-send (improvement plan Phase 1, G1–G3).
 *
 * `ensureComplianceFormLinksForBooking` issues (or reuses) form links for a
 * booking's unmet client-online requirements when the venue has auto-send on, and
 * returns them so the booking confirmation can carry them (the form lands in the
 * same email the guest already gets — Fresha/Phorest-style). Idempotent + fail-safe.
 *
 * `runComplianceFormReminders` chases pending, not-yet-completed links before the
 * appointment, capped and suppressed once consumed.
 */

const MS_PER_HOUR = 60 * 60 * 1000;

export interface BookingFormLink {
  name: string;
  url: string;
}

interface BookingFkParams {
  venueId: string;
  guestId: string | null;
  bookingId: string | null;
  appointmentServiceId: string | null;
  serviceItemId: string | null;
  bookingDate: string;
  bookingTime: string | null;
}

async function loadVenueComplianceContext(
  admin: SupabaseClient,
  venueId: string,
): Promise<{ enabled: boolean; config: ComplianceConfig }> {
  const { data: venue } = await admin
    .from('venues')
    .select('pricing_tier, feature_flags')
    .eq('id', venueId)
    .maybeSingle();
  if (!venue) return { enabled: false, config: parseComplianceConfig(null) };
  const tier = (venue as { pricing_tier?: string | null }).pricing_tier ?? null;
  const flags = parseVenueFeatureFlags((venue as { feature_flags?: unknown }).feature_flags);
  const enabled = isAppointmentPlanTier(tier) && resolveAppointmentsFeatureFlag('compliance_records_enabled', flags);
  return { enabled, config: parseComplianceConfig(flags) };
}

/**
 * Issue/reuse links for a booking's unmet, client-online-capturable requirements.
 * Returns the links to show in the confirmation. Never throws.
 */
export async function ensureComplianceFormLinksForBooking(
  admin: SupabaseClient,
  params: BookingFkParams,
): Promise<BookingFormLink[]> {
  try {
    if (!params.guestId) return [];
    if (!params.appointmentServiceId && !params.serviceItemId) return [];

    const ctx = await loadVenueComplianceContext(admin, params.venueId);
    if (!ctx.enabled) return [];

    const bookingDt = bookingDatetime(params.bookingDate, params.bookingTime);
    const hoursUntil = (bookingDt.getTime() - Date.now()) / MS_PER_HOUR;

    const resolution = await loadAndResolveServiceRequirements(admin, {
      venueId: params.venueId,
      guestId: params.guestId,
      appointmentServiceId: params.appointmentServiceId,
      serviceItemId: params.serviceItemId,
      bookingDatetime: bookingDt,
    });
    if (!resolution.applicable) return [];

    const unmet = resolution.resolved.filter((r) => r.state === 'missing' || r.state === 'expired');
    if (unmet.length === 0) return [];

    // Which of those types can the client complete online?
    const typeIds = [...new Set(unmet.map((r) => r.requirement.compliance_type_id))];
    const { data: typeRows } = await admin
      .from('compliance_types')
      .select('id, capture_methods')
      .eq('venue_id', params.venueId)
      .in('id', typeIds);
    const onlineTypeIds = new Set(
      ((typeRows ?? []) as Array<{ id: string; capture_methods: string[] | null }>)
        .filter((t) => (t.capture_methods ?? []).includes('client_online'))
        .map((t) => t.id),
    );

    const links: BookingFormLink[] = [];
    for (const req of unmet) {
      if (!onlineTypeIds.has(req.requirement.compliance_type_id)) continue;
      // Only requirements set to email the link in the confirmation are auto-sent. 'inline'
      // forms are completed during the booking flow (Phase 2c) and 'none' is not surfaced online.
      if (req.requirement.online_collection !== 'confirmation_link') continue;
      // Online submission window closed (lead-time requirement) — leave for in-venue capture.
      if (
        req.requirement.lock_period_hours !== null &&
        hoursUntil < req.requirement.lock_period_hours
      ) {
        continue;
      }
      const issued = await issueOrReuseFormLink(admin, {
        venueId: params.venueId,
        staffId: null,
        guestId: params.guestId,
        complianceTypeId: req.requirement.compliance_type_id,
        bookingId: params.bookingId,
        config: ctx.config,
      });
      if (issued.ok) {
        links.push({ name: req.requirement.compliance_type_name, url: issued.value.publicUrl });
      }
    }
    return links;
  } catch (err) {
    console.error('[ensureComplianceFormLinksForBooking] failed:', err instanceof Error ? err.message : err, {
      venueId: params.venueId,
      bookingId: params.bookingId,
    });
    return [];
  }
}

export interface FormReminderResult {
  sent: number;
  errors: string[];
}

export interface FormReminderTarget {
  linkId: string;
  code: string;
  venueId: string;
  guestId: string;
  complianceTypeId: string;
  config: ComplianceConfig;
}

/** Default sender: dispatch `compliance_form_reminder`, mark sent on success. */
async function defaultSendFormReminder(admin: SupabaseClient, t: FormReminderTarget): Promise<boolean> {
  const sentVia = t.config.default_form_link_channel === 'sms' ? 'sms' : 'email';
  const result = await dispatchComplianceFormLink(admin, {
    venueId: t.venueId,
    guestId: t.guestId,
    linkId: t.linkId,
    code: t.code,
    sentVia,
    kind: 'reminder',
  });
  if (result.ok) {
    await markFormLinkSent(admin, {
      venueId: t.venueId,
      staffId: null,
      linkId: t.linkId,
      sentVia,
      guestId: t.guestId,
      complianceTypeId: t.complianceTypeId,
    });
  }
  return result.ok;
}

/**
 * Chase pending form links for upcoming bookings (improvement plan G3). Email-first
 * (via venue policy), capped at `maxReminders`, throttled to one send per ~20h, and
 * naturally stops once the link is consumed (consumed links aren't selected).
 * `sendReminder` is injectable for tests.
 */
export async function runComplianceFormReminders(
  admin: SupabaseClient,
  opts: {
    now?: Date;
    maxReminders?: number;
    windowHours?: number;
    sendReminder?: (target: FormReminderTarget) => Promise<boolean>;
  } = {},
): Promise<FormReminderResult> {
  const now = opts.now ?? new Date();
  const maxReminders = opts.maxReminders ?? 2;
  const windowHours = opts.windowHours ?? 72;
  const throttleMs = 20 * MS_PER_HOUR;
  const sendReminder = opts.sendReminder ?? ((t: FormReminderTarget) => defaultSendFormReminder(admin, t));
  const errors: string[] = [];
  let sent = 0;

  const { data: linkRows, error } = await admin
    .from('compliance_form_links')
    .select('id, code, venue_id, guest_id, compliance_type_id, booking_id, reminder_count, last_reminded_at, expires_at')
    .eq('status', 'pending')
    .not('booking_id', 'is', null)
    .lt('reminder_count', maxReminders)
    .gt('expires_at', now.toISOString())
    .limit(500);
  if (error) {
    errors.push(`select: ${error.message}`);
    return { sent, errors };
  }

  const links = (linkRows ?? []) as Array<{
    id: string;
    code: string;
    venue_id: string;
    guest_id: string;
    compliance_type_id: string;
    booking_id: string;
    reminder_count: number;
    last_reminded_at: string | null;
    expires_at: string;
  }>;
  if (links.length === 0) return { sent, errors };

  // Batch-load the bookings to filter to the upcoming window.
  const bookingIds = [...new Set(links.map((l) => l.booking_id))];
  const { data: bookingRows } = await admin
    .from('bookings')
    .select('id, booking_date, booking_time, status')
    .in('id', bookingIds);
  const bookingById = new Map(
    ((bookingRows ?? []) as Array<{ id: string; booking_date: string; booking_time: string | null; status: string }>).map(
      (b) => [b.id, b],
    ),
  );

  const ACTIVE = new Set(['Pending', 'Booked', 'Confirmed', 'Seated']);
  const configByVenue = new Map<string, ComplianceConfig | null>();

  for (const link of links) {
    const booking = bookingById.get(link.booking_id);
    if (!booking || !ACTIVE.has(booking.status)) continue;

    const bookingDt = bookingDatetime(booking.booking_date, booking.booking_time);
    const hoursUntil = (bookingDt.getTime() - now.getTime()) / MS_PER_HOUR;
    if (hoursUntil <= 0 || hoursUntil > windowHours) continue; // only chase upcoming, within window

    if (link.last_reminded_at && now.getTime() - new Date(link.last_reminded_at).getTime() < throttleMs) {
      continue; // already reminded recently
    }

    // Resolve venue config / enabled once per venue.
    if (!configByVenue.has(link.venue_id)) {
      const ctx = await loadVenueComplianceContext(admin, link.venue_id);
      configByVenue.set(link.venue_id, ctx.enabled ? ctx.config : null);
    }
    const config = configByVenue.get(link.venue_id);
    if (!config) continue; // compliance disabled for this venue now

    let ok = false;
    try {
      ok = await sendReminder({
        linkId: link.id,
        code: link.code,
        venueId: link.venue_id,
        guestId: link.guest_id,
        complianceTypeId: link.compliance_type_id,
        config,
      });
    } catch (err) {
      errors.push(`reminder ${link.id}: ${err instanceof Error ? err.message : 'unknown'}`);
    }
    if (ok) sent += 1;

    // Count + throttle regardless of outcome so a failing channel isn't hammered.
    await admin
      .from('compliance_form_links')
      .update({ reminder_count: link.reminder_count + 1, last_reminded_at: now.toISOString() })
      .eq('id', link.id);
  }

  return { sent, errors };
}
