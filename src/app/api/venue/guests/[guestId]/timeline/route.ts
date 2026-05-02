import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';
import type { TimelineEventRow } from '@/types/contacts';

/**
 * GET /api/venue/guests/[guestId]/timeline — merged activity feed (bookings, comms, audits, marketing, docs, merge).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ guestId: string }> },
) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const { guestId } = await params;
    const limitRaw = Number.parseInt(request.nextUrl.searchParams.get('limit') ?? '80', 10);
    const limit = Math.min(150, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 80));

    const { data: guest, error: gErr } = await staff.db
      .from('guests')
      .select('id')
      .eq('id', guestId)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();

    if (gErr || !guest) {
      return NextResponse.json({ error: 'Guest not found' }, { status: 404 });
    }

    const { data: bookings } = await staff.db
      .from('bookings')
      .select('id, booking_date, booking_time, status, created_at')
      .eq('guest_id', guestId)
      .eq('venue_id', staff.venue_id)
      .order('created_at', { ascending: false })
      .limit(40);

    const { data: comms } = await staff.db
      .from('communications')
      .select('id, message_type, channel, status, created_at')
      .eq('venue_id', staff.venue_id)
      .eq('guest_id', guestId)
      .order('created_at', { ascending: false })
      .limit(40);

    const { data: audits } = await staff.db
      .from('contact_audit_events')
      .select('id, event_type, metadata, created_at')
      .eq('venue_id', staff.venue_id)
      .eq('guest_id', guestId)
      .order('created_at', { ascending: false })
      .limit(60);

    const { data: mkt } = await staff.db
      .from('guest_marketing_consent_events')
      .select('id, marketing_consent, marketing_opt_out, created_at')
      .eq('venue_id', staff.venue_id)
      .eq('guest_id', guestId)
      .order('created_at', { ascending: false })
      .limit(30);

    const { data: merges } = await staff.db
      .from('guest_merge_events')
      .select('id, source_guest_ids, created_at')
      .eq('venue_id', staff.venue_id)
      .eq('target_guest_id', guestId)
      .order('created_at', { ascending: false })
      .limit(10);

    const events: TimelineEventRow[] = [];

    for (const b of bookings ?? []) {
      const row = b as {
        id: string;
        booking_date: string;
        booking_time: string;
        status: string;
        created_at: string;
      };
      events.push({
        id: `b-${row.id}`,
        event_type: 'booking',
        label: `${row.booking_date} ${String(row.booking_time).slice(0, 5)} · ${row.status}`,
        occurred_at: row.created_at,
        metadata: { booking_id: row.id },
      });
    }

    for (const c of comms ?? []) {
      const row = c as { id: string; message_type: string; channel: string; status: string; created_at: string };
      events.push({
        id: `c-${row.id}`,
        event_type: 'communication',
        label: `${row.message_type} (${row.channel}) — ${row.status}`,
        occurred_at: row.created_at,
        metadata: { communication_id: row.id },
      });
    }

    for (const a of audits ?? []) {
      const row = a as { id: string; event_type: string; metadata: unknown; created_at: string };
      events.push({
        id: `a-${row.id}`,
        event_type: 'audit',
        label: row.event_type.replace(/_/g, ' '),
        occurred_at: row.created_at,
        metadata: typeof row.metadata === 'object' && row.metadata && !Array.isArray(row.metadata) ? (row.metadata as Record<string, unknown>) : {},
      });
    }

    for (const m of mkt ?? []) {
      const row = m as { id: string; marketing_consent: boolean; marketing_opt_out: boolean; created_at: string };
      events.push({
        id: `m-${row.id}`,
        event_type: 'marketing_consent',
        label: `Marketing consent ${row.marketing_consent ? 'on' : 'off'} · opt-out ${row.marketing_opt_out ? 'on' : 'off'}`,
        occurred_at: row.created_at,
        metadata: {},
      });
    }

    for (const g of merges ?? []) {
      const row = g as { id: string; source_guest_ids: string[]; created_at: string };
      events.push({
        id: `g-${row.id}`,
        event_type: 'merge',
        label: `Merged ${row.source_guest_ids?.length ?? 0} duplicate profile(s) into this contact`,
        occurred_at: row.created_at,
        metadata: { merge_event_id: row.id },
      });
    }

    events.sort((x, y) => (x.occurred_at < y.occurred_at ? 1 : x.occurred_at > y.occurred_at ? -1 : 0));

    return NextResponse.json({ events: events.slice(0, limit) });
  } catch (err) {
    console.error('GET /api/venue/guests/[guestId]/timeline failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
