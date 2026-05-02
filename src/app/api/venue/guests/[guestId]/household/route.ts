import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';
import { insertContactAuditEvent } from '@/lib/guests/contact-audit';

const linkSchema = z.object({
  other_guest_id: z.string().uuid(),
});

/**
 * GET — households this guest belongs to with member list.
 * POST — link another guest into a shared household (creates household if needed).
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

    const { data: memberships, error: mErr } = await staff.db
      .from('guest_household_members')
      .select('household_id, role, is_primary')
      .eq('guest_id', guestId);

    if (mErr) {
      console.error('household members load failed:', mErr);
      return NextResponse.json({ error: 'Failed to load household' }, { status: 500 });
    }

    const householdIds = [...new Set((memberships ?? []).map((m) => (m as { household_id: string }).household_id))];

    if (householdIds.length === 0) {
      return NextResponse.json({ households: [] });
    }

    const { data: households } = await staff.db
      .from('guest_households')
      .select('id, name, created_at')
      .eq('venue_id', staff.venue_id)
      .in('id', householdIds);

    const { data: allMembers } = await staff.db
      .from('guest_household_members')
      .select('household_id, guest_id, role, is_primary')
      .in('household_id', householdIds);

    const guestIds = [...new Set((allMembers ?? []).map((m) => (m as { guest_id: string }).guest_id))];
    const { data: names } = await staff.db.from('guests').select('id, name').eq('venue_id', staff.venue_id).in('id', guestIds);

    const nameById = new Map((names ?? []).map((n) => [(n as { id: string }).id, (n as { name: string | null }).name]));

    const hhList = (households ?? []).map((h) => {
      const hid = (h as { id: string }).id;
      const members = (allMembers ?? [])
        .filter((m) => (m as { household_id: string }).household_id === hid)
        .map((m) => {
          const row = m as { guest_id: string; role: string | null; is_primary: boolean };
          return {
            guest_id: row.guest_id,
            name: nameById.get(row.guest_id) ?? null,
            role: row.role,
            is_primary: row.is_primary,
          };
        });
      return {
        id: hid,
        name: (h as { name: string | null }).name,
        created_at: (h as { created_at: string }).created_at,
        members,
      };
    });

    return NextResponse.json({ households: hhList });
  } catch (err) {
    console.error('GET household failed:', err);
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

    const { guestId } = await params;
    const parsed = linkSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const otherId = parsed.data.other_guest_id;
    if (otherId === guestId) {
      return NextResponse.json({ error: 'Cannot link guest to self' }, { status: 400 });
    }

    const { data: pair, error: pErr } = await staff.db
      .from('guests')
      .select('id')
      .eq('venue_id', staff.venue_id)
      .in('id', [guestId, otherId]);

    if (pErr || !pair || pair.length !== 2) {
      return NextResponse.json({ error: 'Guests not found' }, { status: 404 });
    }

    const { data: aMemberships } = await staff.db
      .from('guest_household_members')
      .select('household_id')
      .eq('guest_id', guestId);

    const { data: bMemberships } = await staff.db
      .from('guest_household_members')
      .select('household_id')
      .eq('guest_id', otherId);

    const aHouse = (aMemberships ?? [])[0] as { household_id: string } | undefined;
    const bHouse = (bMemberships ?? [])[0] as { household_id: string } | undefined;

    let householdId: string;

    if (aHouse && bHouse && aHouse.household_id === bHouse.household_id) {
      return NextResponse.json({ success: true, household_id: aHouse.household_id, already_linked: true });
    }

    if (aHouse) {
      householdId = aHouse.household_id;
      const { error: insErr } = await staff.db.from('guest_household_members').insert({
        household_id: householdId,
        guest_id: otherId,
        is_primary: false,
      });
      if (insErr?.code === '23505') {
        return NextResponse.json({ success: true, household_id: householdId, already_linked: true });
      }
      if (insErr) {
        console.error('household link insert failed:', insErr);
        return NextResponse.json({ error: 'Failed to link guest' }, { status: 500 });
      }
    } else if (bHouse) {
      householdId = bHouse.household_id;
      const { error: insErr } = await staff.db.from('guest_household_members').insert({
        household_id: householdId,
        guest_id: guestId,
        is_primary: false,
      });
      if (insErr) {
        console.error('household link insert failed:', insErr);
        return NextResponse.json({ error: 'Failed to link guest' }, { status: 500 });
      }
    } else {
      const { data: hh, error: hhErr } = await staff.db
        .from('guest_households')
        .insert({ venue_id: staff.venue_id, name: null })
        .select('id')
        .single();

      if (hhErr || !hh) {
        console.error('household create failed:', hhErr);
        return NextResponse.json({ error: 'Failed to create household' }, { status: 500 });
      }

      householdId = (hh as { id: string }).id;
      await staff.db.from('guest_household_members').insert([
        { household_id: householdId, guest_id: guestId, is_primary: true },
        { household_id: householdId, guest_id: otherId, is_primary: false },
      ]);
    }

    await insertContactAuditEvent(staff.db, {
      venue_id: staff.venue_id,
      guest_id: guestId,
      actor_staff_id: staff.id,
      event_type: 'household_linked',
      metadata: { other_guest_id: otherId, household_id: householdId },
    });

    return NextResponse.json({ success: true, household_id: householdId });
  } catch (err) {
    console.error('POST household link failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
