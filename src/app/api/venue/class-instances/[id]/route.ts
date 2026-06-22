import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { staffMayManageClassTypeSessions } from '@/lib/class-instances/class-staff-scope';

/**
 * GET /api/venue/class-instances/[id] - single instance with class type.
 * Calendar-scoped: staff may only read sessions for classes they manage (C10) —
 * the roster exposes guest PII, so venue ownership alone is not sufficient.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const { id } = await params;
    const admin = getSupabaseAdminClient();

    const { data: inst, error: instErr } = await admin.from('class_instances').select('*').eq('id', id).maybeSingle();

    if (instErr || !inst) {
      return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
    }

    const { data: classType, error: ctErr } = await admin
      .from('class_types')
      .select('*')
      .eq('id', inst.class_type_id as string)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();

    if (ctErr || !classType) {
      return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
    }

    const scope = await staffMayManageClassTypeSessions(
      admin,
      staff.venue_id,
      staff,
      inst.class_type_id as string,
    );
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status });
    }

    return NextResponse.json({ ...inst, class_type: classType });
  } catch (err) {
    console.error('GET /api/venue/class-instances/[id] failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
