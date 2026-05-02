import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { insertContactAuditEvent } from '@/lib/guests/contact-audit';

const postSchema = z.object({
  delta_points: z.number().int(),
  reason: z.string().min(1).max(200),
});

/**
 * GET — loyalty ledger + computed balance.
 * POST — admin adjustment (append ledger row).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ guestId: string }> },
) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const { guestId } = await params;

    const { data: guest, error: gErr } = await staff.db
      .from('guests')
      .select('id')
      .eq('id', guestId)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();

    if (gErr || !guest) {
      return NextResponse.json({ error: 'Guest not found' }, { status: 404 });
    }

    const { data: rows, error } = await staff.db
      .from('guest_loyalty_ledger')
      .select('id, delta_points, balance_after, reason, created_at')
      .eq('venue_id', staff.venue_id)
      .eq('guest_id', guestId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('loyalty list failed:', error);
      return NextResponse.json({ error: 'Failed to load loyalty' }, { status: 500 });
    }

    let balance = 0;
    for (const r of [...(rows ?? [])].reverse()) {
      balance += (r as { delta_points: number }).delta_points;
    }

    return NextResponse.json({ balance, ledger: rows ?? [] });
  } catch (err) {
    console.error('GET loyalty failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ guestId: string }> },
) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
    if (!requireAdmin(staff)) {
      return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    const { guestId } = await params;
    const parsed = postSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const { data: guest, error: gErr } = await staff.db
      .from('guests')
      .select('id')
      .eq('id', guestId)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();

    if (gErr || !guest) {
      return NextResponse.json({ error: 'Guest not found' }, { status: 404 });
    }

    const { data: prior } = await staff.db
      .from('guest_loyalty_ledger')
      .select('delta_points')
      .eq('venue_id', staff.venue_id)
      .eq('guest_id', guestId);

    let balance = 0;
    for (const r of prior ?? []) {
      balance += (r as { delta_points: number }).delta_points;
    }
    const nextBalance = balance + parsed.data.delta_points;

    const { data: row, error: insErr } = await staff.db
      .from('guest_loyalty_ledger')
      .insert({
        venue_id: staff.venue_id,
        guest_id: guestId,
        delta_points: parsed.data.delta_points,
        balance_after: nextBalance,
        reason: parsed.data.reason.trim(),
        created_by_staff_id: staff.id,
      })
      .select('id, delta_points, balance_after, reason, created_at')
      .single();

    if (insErr) {
      console.error('loyalty insert failed:', insErr);
      return NextResponse.json({ error: 'Failed to record adjustment' }, { status: 500 });
    }

    await insertContactAuditEvent(staff.db, {
      venue_id: staff.venue_id,
      guest_id: guestId,
      actor_staff_id: staff.id,
      event_type: 'loyalty_adjustment',
      metadata: { delta_points: parsed.data.delta_points, balance_after: nextBalance },
    });

    return NextResponse.json({ entry: row, balance: nextBalance });
  } catch (err) {
    console.error('POST loyalty failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
