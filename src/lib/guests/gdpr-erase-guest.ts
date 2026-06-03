import type { SupabaseClient } from '@supabase/supabase-js';
import { eraseGuestCompliance } from '@/lib/compliance/gdpr';

/**
 * Admin-only anonymisation: clears CRM PII on guest and related rows while retaining bookings.
 */
export async function eraseGuestVenuePii(admin: SupabaseClient, venueId: string, guestId: string): Promise<void> {
  await admin.from('communications').delete().eq('guest_id', guestId);

  // Compliance records hold special-category data + signature/file objects in the
  // compliance-files bucket; the anonymise-not-delete flow below would otherwise
  // leave them on file (spec §13.1).
  await eraseGuestCompliance(admin, venueId, guestId);

  const { data: bookingIdsRows } = await admin.from('bookings').select('id').eq('guest_id', guestId);
  const bookingIds = (bookingIdsRows ?? []).map((r: { id: string }) => r.id);
  if (bookingIds.length > 0) {
    await admin.from('communication_logs').delete().in('booking_id', bookingIds);
  }

  await admin
    .from('bookings')
    .update({
      dietary_notes: null,
      occasion: null,
      special_requests: null,
      internal_notes: null,
      guest_email: null,
      guest_phone: null,
      guest_first_name: null,
      guest_last_name: null,
      updated_at: new Date().toISOString(),
    })
    .eq('guest_id', guestId);

  await admin
    .from('guest_documents')
    .update({ deleted_at: new Date().toISOString() })
    .eq('guest_id', guestId)
    .eq('venue_id', venueId);

  await admin.from('guest_loyalty_ledger').delete().eq('guest_id', guestId).eq('venue_id', venueId);
  await admin.from('guest_household_members').delete().eq('guest_id', guestId);
  await admin.from('guest_marketing_consent_events').delete().eq('guest_id', guestId);

  const { error: updErr } = await admin
    .from('guests')
    .update({
      first_name: null,
      last_name: null,
      email: null,
      phone: null,
      global_guest_hash: null,
      dietary_preferences: null,
      customer_profile_notes: null,
      tags: [],
      custom_fields: {},
      marketing_opt_out: true,
      marketing_consent: false,
      marketing_consent_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', guestId)
    .eq('venue_id', venueId);

  if (updErr) {
    throw new Error(updErr.message);
  }
}
