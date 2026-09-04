import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { requireCompliancePlanForVenue } from '@/lib/compliance/auth';
import { resolveComplianceReadScope } from '@/lib/compliance/linked-read';
import { listComplianceRecords } from '@/lib/compliance/records-service';
import { listFormLinks } from '@/lib/compliance/form-links-service';

interface RouteCtx {
  params: { guestId: string } | Promise<{ guestId: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * GET /api/venue/guests/[guestId]/compliance — all records + pending links + recent audit for a guest.
 *
 * Optional `owner_venue_id=<uuid>`: the guest belongs to a linked venue (the booking
 * detail panel is showing that venue's booking). Read through the link when it shares
 * full details and personal data; see `resolveComplianceReadScope`.
 */
export async function GET(request: NextRequest, ctx: RouteCtx) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const { guestId } = await Promise.resolve(ctx.params);
    const ownerParam = request.nextUrl.searchParams.get('owner_venue_id');
    if (ownerParam && !UUID_RE.test(ownerParam)) {
      return NextResponse.json({ error: 'A valid owner_venue_id is required.' }, { status: 400 });
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    const scope = await resolveComplianceReadScope({
      staff,
      ownerVenueId: ownerParam,
      actingUserId: user?.id ?? null,
      resourceType: 'guest',
      resourceId: guestId,
    });
    if (!scope.ok) return scope.response;

    const gate = await requireCompliancePlanForVenue(scope.db, scope.venueId);
    if (!gate.ok) return gate.response;

    const { data: guest } = await scope.db
      .from('guests')
      .select('id')
      .eq('id', guestId)
      .eq('venue_id', scope.venueId)
      .maybeSingle();
    if (!guest) return NextResponse.json({ error: 'Guest not found.' }, { status: 404 });

    const [records, links, auditRes] = await Promise.all([
      listComplianceRecords(scope.db, scope.venueId, { guestId }),
      listFormLinks(scope.db, scope.venueId, { guestId }),
      scope.db
        .from('compliance_audit_events')
        .select('id, event_type, actor_type, actor_staff_id, compliance_record_id, compliance_type_id, metadata, created_at')
        .eq('venue_id', scope.venueId)
        .eq('guest_id', guestId)
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

    return NextResponse.json({
      records,
      form_links: links,
      audit_events: auditRes.data ?? [],
      linked: scope.linked,
    });
  } catch (err) {
    console.error('GET /api/venue/guests/[guestId]/compliance failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
