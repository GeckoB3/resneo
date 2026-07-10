import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';

/** Guest-safe card-hold state label for the GDPR export (spec §15). */
function cardHoldExportState(hold: {
  charged_at: string | null;
  released_at: string | null;
  stripe_payment_method_id: string | null;
}): string {
  if (hold.charged_at) return 'charged';
  if (hold.released_at) return 'released';
  if (hold.stripe_payment_method_id) return 'card_held';
  return 'awaiting_card';
}

const querySchema = z.object({
  guest_id: z.string().uuid(),
});

/**
 * GET /api/venue/gdpr/export-guest?guest_id= — admin-only structured JSON export.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
    if (!requireAdmin(staff)) {
      return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    const parsed = querySchema.safeParse({
      guest_id: request.nextUrl.searchParams.get('guest_id') ?? '',
    });
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid guest_id' }, { status: 400 });
    }

    const guestId = parsed.data.guest_id;

    const { data: guest, error: gErr } = await staff.db
      .from('guests')
      .select('*')
      .eq('id', guestId)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();

    if (gErr || !guest) {
      return NextResponse.json({ error: 'Guest not found' }, { status: 404 });
    }

    const { data: defs } = await staff.db.from('custom_client_fields').select('*').eq('venue_id', staff.venue_id);

    const { data: bookings } = await staff.db
      .from('bookings')
      .select('id, booking_date, booking_time, party_size, status, guest_email, deposit_status, deposit_amount_pence, created_at')
      .eq('guest_id', guestId)
      .eq('venue_id', staff.venue_id)
      .order('booking_date', { ascending: false })
      .limit(200);

    // Spec §15 — the consent snapshot is personal data, so the export includes
    // a guest-safe card-hold summary per booking (fee, state, consent text and
    // timestamp). Hold rows are service-role only, hence the admin client; no
    // Stripe ids or internal columns are exposed.
    const bookingIds = (bookings ?? []).map((b: { id: string }) => b.id);
    const holdsByBooking = new Map<
      string,
      { fee_pence: number; state: string; terms_text: string | null; terms_accepted_at: string | null }
    >();
    if (bookingIds.length > 0) {
      const { data: holdRows, error: holdErr } = await getSupabaseAdminClient()
        .from('booking_card_holds')
        .select('booking_id, fee_pence, stripe_payment_method_id, charged_at, released_at, terms_snapshot')
        .in('booking_id', bookingIds);
      if (holdErr) {
        console.error('export-guest: card-hold load failed:', holdErr);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
      }
      for (const row of holdRows ?? []) {
        const hold = row as {
          booking_id: string;
          fee_pence: number;
          stripe_payment_method_id: string | null;
          charged_at: string | null;
          released_at: string | null;
          terms_snapshot: { text?: unknown; accepted_at?: unknown } | null;
        };
        holdsByBooking.set(hold.booking_id, {
          fee_pence: hold.fee_pence,
          state: cardHoldExportState(hold),
          terms_text: typeof hold.terms_snapshot?.text === 'string' ? hold.terms_snapshot.text : null,
          terms_accepted_at:
            typeof hold.terms_snapshot?.accepted_at === 'string' ? hold.terms_snapshot.accepted_at : null,
        });
      }
    }
    const bookingsWithHolds = (bookings ?? []).map((b: { id: string }) => ({
      ...b,
      card_hold: holdsByBooking.get(b.id) ?? null,
    }));

    const { data: comms } = await staff.db
      .from('communications')
      .select('*')
      .eq('venue_id', staff.venue_id)
      .eq('guest_id', guestId)
      .order('created_at', { ascending: false })
      .limit(200);

    const { data: docs } = await staff.db
      .from('guest_documents')
      .select('id, file_name, mime_type, file_size_bytes, category, created_at, uploaded_at, deleted_at')
      .eq('venue_id', staff.venue_id)
      .eq('guest_id', guestId);

    const { data: audits } = await staff.db
      .from('contact_audit_events')
      .select('*')
      .eq('venue_id', staff.venue_id)
      .eq('guest_id', guestId)
      .order('created_at', { ascending: false })
      .limit(500);

    const { data: mkt } = await staff.db
      .from('guest_marketing_consent_events')
      .select('*')
      .eq('venue_id', staff.venue_id)
      .eq('guest_id', guestId)
      .order('created_at', { ascending: false })
      .limit(200);

    const { data: hhMembers } = await staff.db.from('guest_household_members').select('*').eq('guest_id', guestId);

    const { data: loyalty } = await staff.db
      .from('guest_loyalty_ledger')
      .select('*')
      .eq('venue_id', staff.venue_id)
      .eq('guest_id', guestId)
      .order('created_at', { ascending: false })
      .limit(500);

    return NextResponse.json({
      exported_at: new Date().toISOString(),
      guest,
      custom_field_definitions: defs ?? [],
      bookings: bookingsWithHolds,
      communications: comms ?? [],
      documents: docs ?? [],
      contact_audit_events: audits ?? [],
      marketing_consent_events: mkt ?? [],
      household_memberships: hhMembers ?? [],
      loyalty_ledger: loyalty ?? [],
    });
  } catch (err) {
    console.error('GET export-guest failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
