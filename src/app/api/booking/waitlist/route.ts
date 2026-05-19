import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { z } from 'zod';
import { normalizeToE164 } from '@/lib/phone/e164';
import { nextResponseIfPublicBookingBlockedForVenue } from '@/lib/booking/light-plan-public-block';
import { normaliseGuestNamePart } from '@/lib/guests/name';

const joinSchema = z.object({
  venue_id: z.string().uuid(),
  desired_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  desired_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  party_size: z.number().int().min(1).max(50),
  first_name: z.string().min(1).max(100),
  last_name: z.string().min(1).max(100),
  guest_email: z.string().email().optional().or(z.literal('')),
  guest_phone: z.string().min(1).max(24),
  service_id: z.string().uuid().optional(),
  notes: z.string().max(500).optional(),
});

/** POST /api/booking/waitlist - public endpoint: guest joins the standby list */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = joinSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const supabase = getSupabaseAdminClient();
    const blocked = await nextResponseIfPublicBookingBlockedForVenue(supabase, parsed.data.venue_id);
    if (blocked) return blocked;

    const guestPhoneE164 = normalizeToE164(parsed.data.guest_phone, 'GB');
    if (!guestPhoneE164) {
      return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
    }

    const guestFirst = normaliseGuestNamePart(parsed.data.first_name);
    const guestLast = normaliseGuestNamePart(parsed.data.last_name);

    const { count } = await supabase
      .from('waitlist_entries')
      .select('id', { count: 'exact', head: true })
      .eq('venue_id', parsed.data.venue_id)
      .eq('desired_date', parsed.data.desired_date)
      .eq('guest_phone', guestPhoneE164)
      .eq('waitlist_kind', 'table')
      .eq('status', 'waiting');

    if ((count ?? 0) > 0) {
      return NextResponse.json({ error: 'You are already on the waitlist for this date.' }, { status: 409 });
    }

    const { data, error } = await supabase
      .from('waitlist_entries')
      .insert({
        venue_id: parsed.data.venue_id,
        waitlist_kind: 'table',
        service_id: parsed.data.service_id ?? null,
        desired_date: parsed.data.desired_date,
        desired_time: parsed.data.desired_time ?? null,
        party_size: parsed.data.party_size,
        guest_first_name: guestFirst,
        guest_last_name: guestLast,
        guest_email: parsed.data.guest_email || null,
        guest_phone: guestPhoneE164,
        notes: parsed.data.notes || null,
      })
      .select('id, status')
      .single();

    if (error) {
      console.error('POST /api/booking/waitlist failed:', error);
      return NextResponse.json({ error: 'Failed to join waitlist' }, { status: 500 });
    }

    return NextResponse.json(
      {
        waitlist_id: data.id,
        message: 'You have been added to the standby list. We will contact you if a spot opens up.',
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('POST /api/booking/waitlist failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
