import type { SupabaseClient } from '@supabase/supabase-js';
import {
  parseVenueFeatureFlags,
  resolveAppointmentsFeatureFlag,
} from '@/lib/feature-flags';
import {
  sendAppointmentWaitlistOfferNotification,
  type AppointmentWaitlistOfferNotifyResult,
} from '@/lib/communications/send-appointment-waitlist-offer';

export interface AppointmentWaitlistOfferEntryNotifyRow {
  desired_date: string;
  desired_time: string | null;
  guest_first_name: string | null;
  guest_last_name: string | null;
  guest_email: string | null;
  guest_phone: string;
}

function publicBookingUrl(slug: string | null | undefined): string | null {
  if (!slug?.trim()) return null;
  const base = (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://www.reserveni.com').replace(/\/$/, '');
  return `${base}/book/${slug.trim()}`;
}

/**
 * Sends email/SMS when staff manually offers an appointment waitlist slot (Phase 1a.3 polish).
 * No-ops when `waitlist_v2` is disabled for the venue.
 */
export async function notifyAppointmentWaitlistOfferForEntry(
  admin: SupabaseClient,
  venueId: string,
  entry: AppointmentWaitlistOfferEntryNotifyRow,
  expiresAtIso: string,
): Promise<AppointmentWaitlistOfferNotifyResult & { skipped?: boolean }> {
  const { data: venueRow, error: venueErr } = await admin
    .from('venues')
    .select('name, phone, slug, feature_flags')
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

  const desiredTimeHm = entry.desired_time ? String(entry.desired_time).slice(0, 5) : '—';

  return sendAppointmentWaitlistOfferNotification({
    venueId,
    venueName: String(venueRow.name ?? 'Venue'),
    venuePhone: typeof venueRow.phone === 'string' ? venueRow.phone : null,
    bookingPageUrl: publicBookingUrl(typeof venueRow.slug === 'string' ? venueRow.slug : null),
    guestFirstName: entry.guest_first_name,
    guestLastName: entry.guest_last_name,
    guestEmail: entry.guest_email,
    guestPhone: entry.guest_phone,
    desiredDate: entry.desired_date,
    desiredTimeHm,
    expiresAtIso,
  });
}
