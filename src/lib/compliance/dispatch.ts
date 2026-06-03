import type { SupabaseClient } from '@supabase/supabase-js';
import type { BookingModel } from '@/types/booking-models';
import type { BookingEmailData, VenueEmailData } from '@/lib/emails/types';
import { venueRowToEmailData } from '@/lib/emails/venue-email-data';
import { formatGuestDisplayName } from '@/lib/guests/name';
import { sendPolicyMessage } from '@/lib/communications/outbound';
import type { CommunicationMessageKey } from '@/lib/communications/policies';
import { complianceFormPublicUrl } from '@/lib/compliance/form-links-service';
import type { ComplianceLinkSentVia } from '@/lib/compliance/constants';

/**
 * Dispatch a compliance form-link message through the existing policy-driven
 * communications subsystem (spec §12). Channel/timing are governed by the venue's
 * communication policies (Settings → Communications); this just renders + sends
 * the chosen channel and reports whether it went out.
 */
export interface DispatchResult {
  ok: boolean;
  reason?: 'no_destination' | 'send_failed' | 'disabled' | 'not_found';
}

export type ComplianceDispatchKind = 'request' | 'reminder' | 'expiring';

const MESSAGE_KEY_BY_KIND: Record<ComplianceDispatchKind, CommunicationMessageKey> = {
  request: 'compliance_form_request',
  reminder: 'compliance_form_reminder',
  expiring: 'compliance_record_expiring',
};

export async function dispatchComplianceFormLink(
  admin: SupabaseClient,
  params: {
    venueId: string;
    guestId: string;
    linkId: string;
    code: string;
    sentVia: Exclude<ComplianceLinkSentVia, 'manual_copy'>;
    kind: ComplianceDispatchKind;
  },
): Promise<DispatchResult> {
  const [{ data: guestRow }, { data: venueRow }, { data: linkRow }] = await Promise.all([
    admin
      .from('guests')
      .select('id, first_name, last_name, email, phone')
      .eq('id', params.guestId)
      .eq('venue_id', params.venueId)
      .maybeSingle(),
    admin
      .from('venues')
      .select('name, address, phone, booking_model, email, reply_to_email, timezone')
      .eq('id', params.venueId)
      .maybeSingle(),
    admin
      .from('compliance_form_links')
      .select('id, compliance_type_id, expires_at, created_at, booking_id, compliance_types!inner(name)')
      .eq('id', params.linkId)
      .eq('venue_id', params.venueId)
      .maybeSingle(),
  ]);

  if (!guestRow || !venueRow || !linkRow) return { ok: false, reason: 'not_found' };

  const guest = guestRow as { first_name: string | null; last_name: string | null; email: string | null; phone: string | null };
  const guestEmail = guest.email?.trim() || null;
  const guestPhone = guest.phone?.trim() || null;
  if (params.sentVia === 'email' && !guestEmail) return { ok: false, reason: 'no_destination' };
  if (params.sentVia === 'sms' && !guestPhone) return { ok: false, reason: 'no_destination' };

  const vr = venueRow as {
    name?: string;
    address?: string | null;
    phone?: string | null;
    booking_model?: BookingModel | null;
    email?: string | null;
    reply_to_email?: string | null;
    timezone?: string | null;
  };
  if (!vr.name) return { ok: false, reason: 'not_found' };

  const venue: VenueEmailData = venueRowToEmailData({
    name: vr.name,
    address: vr.address ?? null,
    phone: vr.phone ?? null,
    email: vr.email ?? null,
    reply_to_email: vr.reply_to_email ?? null,
    timezone: vr.timezone ?? null,
  });

  const link = linkRow as {
    compliance_type_id: string;
    expires_at: string;
    created_at: string;
    booking_id: string | null;
    compliance_types: { name?: string } | { name?: string }[] | null;
  };
  const typeJoin = Array.isArray(link.compliance_types) ? link.compliance_types[0] : link.compliance_types;
  const formName = typeJoin?.name ?? 'form';
  const expiryDays = Math.max(
    1,
    Math.round((new Date(link.expires_at).getTime() - new Date(link.created_at).getTime()) / 86_400_000),
  );

  // Prefer the linked booking's date for the message; else today.
  let bookingDate = new Date().toISOString().slice(0, 10);
  let bookingTime = '00:00:00';
  if (link.booking_id) {
    const { data: b } = await admin
      .from('bookings')
      .select('booking_date, booking_time')
      .eq('id', link.booking_id)
      .maybeSingle();
    const br = b as { booking_date?: string; booking_time?: string } | null;
    if (br?.booking_date) bookingDate = br.booking_date;
    if (br?.booking_time) bookingTime = br.booking_time;
  }

  const minimalBooking: BookingEmailData = {
    id: params.guestId,
    guest_name: formatGuestDisplayName(guest.first_name, guest.last_name),
    guest_email: guestEmail,
    guest_phone: guestPhone,
    booking_date: bookingDate,
    booking_time: bookingTime,
    party_size: 1,
    booking_model: (vr.booking_model as BookingModel | null) ?? 'table_reservation',
  };

  const baseOptions = {
    venueId: params.venueId,
    booking: minimalBooking,
    venue,
    messageKey: MESSAGE_KEY_BY_KIND[params.kind],
    mode: 'upsert' as const,
    guestIdForLog: params.guestId,
    complianceFormLink: complianceFormPublicUrl(params.code),
    complianceFormName: formName,
    complianceExpiryDays: expiryDays,
  };

  let outcome = await sendPolicyMessage({ ...baseOptions, channel: params.sentVia });

  // Compliance SMS isn't governed by a per-lane channel toggle in Settings →
  // Communications, so an SMS-preferring venue would otherwise receive nothing.
  // Fall back to email so the guest always gets the form link.
  if (!outcome.sent && params.sentVia === 'sms' && guestEmail) {
    outcome = await sendPolicyMessage({ ...baseOptions, channel: 'email' });
  }

  if (outcome.sent) return { ok: true };
  return { ok: false, reason: outcome.reason === 'disabled' ? 'disabled' : 'send_failed' };
}
