import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { requireCompliancePlan } from '@/lib/compliance/auth';
import { restoreComplianceTypeVersion } from '@/lib/compliance/types-service';

interface RouteCtx {
  params: { id: string } | Promise<{ id: string }>;
}

const bodySchema = z.object({ version_id: z.string().uuid() });

/** POST /api/venue/compliance/types/[id]/versions/restore — re-publish a prior version (admin). */
export async function POST(request: NextRequest, ctx: RouteCtx) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    if (!requireAdmin(staff)) return NextResponse.json({ error: 'Admin role required.' }, { status: 403 });
    const gate = await requireCompliancePlan(staff);
    if (!gate.ok) return gate.response;

    const { id } = await Promise.resolve(ctx.params);
    const body = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'A version_id is required.' }, { status: 400 });
    }

    const result = await restoreComplianceTypeVersion(staff.db, {
      venueId: staff.venue_id,
      staffId: staff.id,
      typeId: id,
      versionId: parsed.data.version_id,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.value, { status: 201 });
  } catch (err) {
    console.error('POST /api/venue/compliance/types/[id]/versions/restore failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
