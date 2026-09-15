import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { apiError } from '@/lib/api/error-codes';
import { staffLoginOwnedByVenue } from '@/lib/auth/staff-login-ownership';
import { z } from 'zod';

const schema = z.object({
  new_password: z.string().min(8, 'Password must be at least 8 characters'),
});

/**
 * POST /api/venue/staff/[id]/reset-password - admin sets a new password for a team member.
 *
 * Acts only on the login bound to the staff row (staff.user_id), never on an email match:
 * invite inserts rows for any address with no user_id, so an email match could reach a
 * customer's own login. It also refuses a login used anywhere beyond this venue's team
 * (see staffLoginOwnedByVenue). Those people get an emailed sign-in link instead, through
 * resend-invite, and choose their own password.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    if (!requireAdmin(staff)) return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });

    const { id } = await params;
    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();

    const { data: target } = await admin
      .from('staff')
      .select('id, email, venue_id, user_id, revoked_at')
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();

    if (!target) return NextResponse.json({ error: 'Staff member not found' }, { status: 404 });

    const email = (target.email as string).trim().toLowerCase();
    const ownership = await staffLoginOwnedByVenue(admin, staff.venue_id, {
      email,
      user_id: (target.user_id as string | null) ?? null,
      revoked_at: (target.revoked_at as string | null) ?? null,
    });

    if (!ownership.ok) {
      if (ownership.reason === 'used_elsewhere') {
        return NextResponse.json(
          apiError(
            `${email} also uses this login outside your team, so only they can change its password. Use the envelope button to email them a sign-in link, and they can choose a new password there.`,
            'STAFF_LOGIN_USED_ELSEWHERE',
          ),
          { status: 409 },
        );
      }
      return NextResponse.json(
        apiError(
          ownership.reason === 'revoked'
            ? `${email} no longer has access to your team, so there is no password to set.`
            : `${email} has not accepted their invite yet, so there is no login to set a password for. Use the envelope button to send them a new sign-in link.`,
          'STAFF_LOGIN_NOT_CLAIMED',
        ),
        { status: 409 },
      );
    }

    const { error: updateErr } = await admin.auth.admin.updateUserById(ownership.userId, {
      password: parsed.data.new_password,
    });

    if (updateErr) {
      console.error('Admin password reset failed:', updateErr);
      return NextResponse.json({ error: 'Password reset failed. Please try again.' }, { status: 500 });
    }

    console.info('[staff/reset-password] password set by venue admin', {
      venueId: staff.venue_id,
      staffId: target.id,
      targetUserId: ownership.userId,
      actorStaffId: staff.id,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('POST /api/venue/staff/[id]/reset-password failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
