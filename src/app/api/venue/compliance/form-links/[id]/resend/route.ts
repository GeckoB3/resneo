import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';
import { requireCompliancePlan } from '@/lib/compliance/auth';
import { complianceFormPublicUrl, markFormLinkSent } from '@/lib/compliance/form-links-service';
import { dispatchComplianceFormLink } from '@/lib/compliance/dispatch';

interface RouteCtx {
  params: { id: string } | Promise<{ id: string }>;
}

/** POST /api/venue/compliance/form-links/[id]/resend — resend an existing link (does not regenerate code). */
export async function POST(request: NextRequest, ctx: RouteCtx) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    const gate = await requireCompliancePlan(staff);
    if (!gate.ok) return gate.response;

    const { id } = await Promise.resolve(ctx.params);
    const body = await request.json().catch(() => ({}));
    const sentVia = body?.send_via === 'sms' ? 'sms' : 'email';

    const { data: link } = await staff.db
      .from('compliance_form_links')
      .select('id, code, status, guest_id, compliance_type_id, expires_at')
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();
    if (!link) return NextResponse.json({ error: 'Form link not found.' }, { status: 404 });
    const l = link as {
      code: string;
      status: string;
      guest_id: string;
      compliance_type_id: string;
      expires_at: string;
    };
    if (l.status !== 'pending' || new Date(l.expires_at).getTime() <= Date.now()) {
      return NextResponse.json({ error: 'Only active pending links can be resent.' }, { status: 409 });
    }

    const result = await dispatchComplianceFormLink(staff.db, {
      venueId: staff.venue_id,
      guestId: l.guest_id,
      linkId: id,
      code: l.code,
      sentVia,
      kind: 'request',
    });
    if (result.ok) {
      await markFormLinkSent(staff.db, {
        venueId: staff.venue_id,
        staffId: staff.id,
        linkId: id,
        sentVia,
        guestId: l.guest_id,
        complianceTypeId: l.compliance_type_id,
      });
    }

    return NextResponse.json({ public_url: complianceFormPublicUrl(l.code), dispatched: result.ok });
  } catch (err) {
    console.error('POST /api/venue/compliance/form-links/[id]/resend failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
