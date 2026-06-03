import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { requireCompliancePlan } from '@/lib/compliance/auth';
import { getTemplateBySlug } from '@/lib/compliance/library';
import { createComplianceType, getComplianceTypeWithVersion } from '@/lib/compliance/types-service';

interface RouteCtx {
  params: { slug: string } | Promise<{ slug: string }>;
}

/** POST /api/venue/compliance/library/[slug]/clone — clone a library template into the venue (admin). */
export async function POST(_request: NextRequest, ctx: RouteCtx) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    if (!requireAdmin(staff)) return NextResponse.json({ error: 'Admin role required.' }, { status: 403 });
    const gate = await requireCompliancePlan(staff);
    if (!gate.ok) return gate.response;

    const { slug } = await Promise.resolve(ctx.params);
    const template = getTemplateBySlug(slug);
    if (!template) return NextResponse.json({ error: 'Library template not found.' }, { status: 404 });

    const result = await createComplianceType(staff.db, {
      venueId: staff.venue_id,
      staffId: staff.id,
      name: template.name,
      category: template.category,
      resultType: template.result_type,
      validityPeriodDays: template.validity_period_days,
      captureMethods: [...template.capture_methods],
      description: template.description ?? null,
      formSchema: template.form_schema,
      libraryTemplateSlug: template.slug,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    const withVersion = await getComplianceTypeWithVersion(staff.db, staff.venue_id, result.value.type.id);
    return NextResponse.json(withVersion.ok ? withVersion.value : { type: result.value.type }, { status: 201 });
  } catch (err) {
    console.error('POST /api/venue/compliance/library/[slug]/clone failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
