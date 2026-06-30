import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { requireCompliancePlan } from '@/lib/compliance/auth';
import { complianceFormLinkCreateSchema } from '@/lib/compliance/zod-schemas';
import { issueOrReuseFormLink, listFormLinks, markFormLinkSent } from '@/lib/compliance/form-links-service';
import { dispatchComplianceFormLink } from '@/lib/compliance/dispatch';

/** GET /api/venue/compliance/form-links?guest_id=&status= — list links. */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    const gate = await requireCompliancePlan(staff);
    if (!gate.ok) return gate.response;

    const sp = request.nextUrl.searchParams;
    const links = await listFormLinks(staff.db, staff.venue_id, {
      guestId: sp.get('guest_id'),
      status: sp.get('status'),
    });
    return NextResponse.json({ links });
  } catch (err) {
    console.error('GET /api/venue/compliance/form-links failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** POST /api/venue/compliance/form-links — issue (or reuse) a link and send it. */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    const gate = await requireCompliancePlan(staff);
    if (!gate.ok) return gate.response;

    const body = await request.json().catch(() => null);
    const parsed = complianceFormLinkCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    // Resolve a deliverable channel: prefer the requested one, fall back to whatever the
    // guest actually has on file, and if neither, still create the link so staff can copy
    // it (the caller gets dispatched:false + public_url) rather than hitting a dead end.
    const { data: guest } = await staff.db
      .from('guests')
      .select('id, email, phone')
      .eq('id', parsed.data.guest_id)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();
    if (!guest) return NextResponse.json({ error: 'Guest not found.' }, { status: 404 });
    const g = guest as { email: string | null; phone: string | null };
    const hasEmail = Boolean(g.email?.trim());
    const hasPhone = Boolean(g.phone?.trim());

    let channel: 'email' | 'sms' | 'manual_copy' = parsed.data.send_via;
    if (channel === 'email' && !hasEmail) channel = hasPhone ? 'sms' : 'manual_copy';
    else if (channel === 'sms' && !hasPhone) channel = hasEmail ? 'email' : 'manual_copy';

    const issued = await issueOrReuseFormLink(staff.db, {
      venueId: staff.venue_id,
      staffId: staff.id,
      guestId: parsed.data.guest_id,
      complianceTypeId: parsed.data.compliance_type_id,
      bookingId: parsed.data.booking_id ?? null,
      config: gate.ctx.config,
    });
    if (!issued.ok) return NextResponse.json({ error: issued.error }, { status: issued.status });

    let dispatched = false;
    if (channel !== 'manual_copy') {
      const result = await dispatchComplianceFormLink(staff.db, {
        venueId: staff.venue_id,
        guestId: parsed.data.guest_id,
        linkId: issued.value.link.id as string,
        code: issued.value.link.code as string,
        sentVia: channel,
        kind: 'request',
      });
      if (result.ok) {
        dispatched = true;
        await markFormLinkSent(staff.db, {
          venueId: staff.venue_id,
          staffId: staff.id,
          linkId: issued.value.link.id as string,
          sentVia: channel,
          guestId: parsed.data.guest_id,
          complianceTypeId: parsed.data.compliance_type_id,
        });
      }
    }

    return NextResponse.json(
      {
        link: issued.value.link,
        public_url: issued.value.publicUrl,
        reused: issued.value.reused,
        dispatched,
        // The channel actually used (after fallback), so the caller can tell the user.
        sent_via: dispatched ? channel : null,
      },
      { status: issued.value.reused ? 200 : 201 },
    );
  } catch (err) {
    console.error('POST /api/venue/compliance/form-links failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
