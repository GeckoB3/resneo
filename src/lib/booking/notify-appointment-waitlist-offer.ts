import type { SupabaseClient } from '@supabase/supabase-js';
import {
  parseVenueFeatureFlags,
  resolveAppointmentsFeatureFlag,
} from '@/lib/feature-flags';
import {
  sendAppointmentWaitlistOfferNotification,
  type AppointmentWaitlistOfferNotifyResult,
} from '@/lib/communications/send-appointment-waitlist-offer';
import { formatWaitlistTimeWindowLabel } from '@/lib/booking/waitlist-time-window';
import { ensureWaitlistOfferCommunicationPolicyForVenue } from '@/lib/communications/policies';

export interface AppointmentWaitlistOfferEntryNotifyRow {
  waitlistEntryId?: string;
  desired_date: string;
  desired_time: string | null;
  desired_time_end?: string | null;
  guest_first_name: string | null;
  guest_last_name: string | null;
  guest_email: string | null;
  guest_phone: string;
  /** Specific slot offered (HH:mm:ss) when known */
  offered_slot_time?: string | null;
  offered_calendar_id?: string | null;
  appointment_service_id?: string | null;
  service_item_id?: string | null;
}

function offeredSlotHm(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  return raw.trim().slice(0, 5);
}

function timeWindowLabelForOffer(entry: AppointmentWaitlistOfferEntryNotifyRow): string {
  const slotHm = offeredSlotHm(entry.offered_slot_time);
  if (slotHm) return slotHm;
  return formatWaitlistTimeWindowLabel({
    desired_time: entry.desired_time,
    desired_time_end: entry.desired_time_end ?? null,
  });
}

/**
 * Sends email/SMS when staff offers an appointment waitlist slot.
 * No-ops when `waitlist_v2` is disabled for the venue.
 */
export async function notifyAppointmentWaitlistOfferForEntry(
  admin: SupabaseClient,
  venueId: string,
  entry: AppointmentWaitlistOfferEntryNotifyRow,
  expiresAtIso: string | null,
): Promise<AppointmentWaitlistOfferNotifyResult & { skipped?: boolean }> {
  const { data: venueRow, error: venueErr } = await admin
    .from('venues')
    .select('name, phone, slug, logo_url, address, feature_flags')
    .eq('id', venueId)
    .maybeSingle();

  if (venueErr || !venueRow) {
    console.error('[notifyAppointmentWaitlistOfferForEntry] venue lookup failed:', venueErr, {
      venueId,
    });
    return { emailSent: false, smsSent: false, skipped: true };
  }

  const venueFlags = parseVenueFeatureFlags(
    (venueRow as { feature_flags?: unknown }).feature_flags,
  );
  if (!resolveAppointmentsFeatureFlag('waitlist_v2', venueFlags)) {
    return { emailSent: false, smsSent: false, skipped: true };
  }

  await ensureWaitlistOfferCommunicationPolicyForVenue(venueId);

  const desiredTimeHm = timeWindowLabelForOffer(entry);
  const venueSlug = typeof venueRow.slug === 'string' ? venueRow.slug : null;
  const bookingBase = (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://www.resneo.com').replace(/\/$/, '');
  const bookingPageUrl = venueSlug
    ? `${bookingBase}/book/${encodeURIComponent(venueSlug)}`
    : null;

  return sendAppointmentWaitlistOfferNotification({
    venueId,
    venueName: String(venueRow.name ?? 'Venue'),
    venueLogoUrl: typeof venueRow.logo_url === 'string' ? venueRow.logo_url : null,
    venueAddress: typeof venueRow.address === 'string' ? venueRow.address : null,
    venuePhone: typeof venueRow.phone === 'string' ? venueRow.phone : null,
    bookingPageUrl,
    guestFirstName: entry.guest_first_name,
    guestLastName: entry.guest_last_name,
    guestEmail: entry.guest_email,
    guestPhone: entry.guest_phone,
    desiredDate: entry.desired_date,
    desiredTimeHm,
    expiresAtIso,
  });
}
