import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import {
  getVenueStaff,
  requireAdmin,
  staffEmailAtOtherVenueMessage,
  staffMembershipElsewhere,
} from '@/lib/venue-auth';
import { apiError } from '@/lib/api/error-codes';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { setStaffPractitionerLink, setStaffUnifiedCalendarAssignments } from '@/lib/staff-practitioner-link';
import { deliverStaffAccessLinkEmail } from '@/lib/staff-invite-email';
import { getStaffAuthBaseUrl } from '@/lib/staff-invite-redirect';
import { assertStaffSlotAvailable } from '@/lib/light-plan';
import { planDisplayName } from '@/lib/pricing-constants';
import { z } from 'zod';

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'staff']),
  name: z.string().max(200).optional(),
  /** Optional: link to one calendar (legacy single-select). */
  practitioner_id: z.string().uuid().nullable().optional(),
  /** Optional: unified scheduling — assign any combination of bookable calendars. */
  calendar_ids: z.array(z.string().uuid()).optional(),
});

/** POST /api/venue/staff/invite - invite staff by email (admin only). Sends a magic link (SendGrid when configured) or Supabase invite to /auth/callback → set password. */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
    if (!requireAdmin(staff)) {
      return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    const body = await request.json();
    const parsed = inviteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const {
      email,
      role,
      name,
      practitioner_id: practitionerIdOpt,
      calendar_ids: calendarIdsOpt,
    } = parsed.data;
    const normalisedEmail = email.trim().toLowerCase();

    const admin = getSupabaseAdminClient();

    const { data: venueRow } = await admin
      .from('venues')
      .select('name, booking_model')
      .eq('id', staff.venue_id)
      .single();
    const bookingModel = (venueRow?.booking_model as string) ?? 'table_reservation';

    const effectiveCalendarIds =
      role === 'staff'
        ? calendarIdsOpt && calendarIdsOpt.length > 0
          ? calendarIdsOpt
          : practitionerIdOpt
            ? [practitionerIdOpt]
            : []
        : [];

    const unifiedCalendarIdsToValidate = effectiveCalendarIds;
    if (unifiedCalendarIdsToValidate.length > 0) {
      const { data: ucs } = await admin
        .from('unified_calendars')
        .select('id, is_active')
        .eq('venue_id', staff.venue_id)
        .in('id', unifiedCalendarIdsToValidate);
      if (!ucs || ucs.length !== unifiedCalendarIdsToValidate.length) {
        return NextResponse.json({ error: 'One or more calendars were not found' }, { status: 400 });
      }
      if (ucs.some((uc) => uc.is_active === false)) {
        return NextResponse.json(
          {
            error:
              'Inactive calendars cannot be assigned to staff. Activate the calendar first or choose another.',
          },
          { status: 400 },
        );
      }
    } else if (practitionerIdOpt) {
      const { data: prCheck } = await admin
        .from('practitioners')
        .select('id, is_active')
        .eq('id', practitionerIdOpt)
        .eq('venue_id', staff.venue_id)
        .maybeSingle();
      if (!prCheck) {
        return NextResponse.json({ error: 'Calendar not found' }, { status: 400 });
      }
      if (prCheck.is_active === false) {
        return NextResponse.json(
          {
            error:
              'Inactive calendars cannot be assigned to staff. Activate the calendar first or choose another.',
          },
          { status: 400 },
        );
      }
    }

    const { data: existing } = await staff.db
      .from('staff')
      .select('id')
      .eq('venue_id', staff.venue_id)
      .eq('email', normalisedEmail)
      .maybeSingle();

    const staffLimit = await assertStaffSlotAvailable(staff.venue_id);
    if (!staffLimit.allowed) {
      const { data: vrow } = await admin
        .from('venues')
        .select('pricing_tier')
        .eq('id', staff.venue_id)
        .maybeSingle();
      const tierLabel = planDisplayName((vrow as { pricing_tier?: string } | null)?.pricing_tier);
      return NextResponse.json(
        {
          error: `Your ${tierLabel} plan allows up to ${staffLimit.limit} team login(s). Upgrade to add more team members.`,
          code: 'PLAN_STAFF_LIMIT',
        },
        { status: 403 },
      );
    }

    if (existing) {
      return NextResponse.json({ error: 'This email is already a staff member for this venue' }, { status: 409 });
    }

    if (await staffMembershipElsewhere(admin, staff.venue_id, normalisedEmail)) {
      return NextResponse.json(
        apiError(staffEmailAtOtherVenueMessage(normalisedEmail), 'STAFF_EMAIL_AT_OTHER_VENUE'),
        { status: 409 },
      );
    }

    const trimmedName = name?.trim();
    const venueName = venueRow?.name?.trim() || 'your venue';
    const userMetadata: Record<string, unknown> = {
      venue_id: staff.venue_id,
      has_set_password: false,
    };
    if (trimmedName) {
      userMetadata.full_name = trimmedName;
    }

    const deliver = await deliverStaffAccessLinkEmail({
      admin,
      email: normalisedEmail,
      baseUrl: getStaffAuthBaseUrl(request),
      userMetadata,
      venueName,
    });

    let inviteEmailSent = false;
    if (deliver.ok) {
      inviteEmailSent = true;
    } else if ('allowStaffInsertWithoutEmail' in deliver && deliver.allowStaffInsertWithoutEmail) {
      inviteEmailSent = false;
    } else {
      return NextResponse.json({ error: deliver.error }, { status: deliver.status });
    }

    const { data: newStaff, error: insertError } = await staff.db
      .from('staff')
      .insert({
        venue_id: staff.venue_id,
        email: normalisedEmail,
        name: trimmedName || null,
        role,
      })
      .select('id, email, name, role, created_at')
      .single();

    if (insertError) {
      console.error('staff insert failed:', insertError);
      return NextResponse.json({ error: 'Failed to add staff member' }, { status: 500 });
    }

    let linkedPractitionerId: string | null = null;
    let linkedPractitionerName: string | null = null;
    let linked_calendar_ids: string[] = [];

    const unifiedIdsToAssign = effectiveCalendarIds;

    if (unifiedIdsToAssign.length > 0) {
      const linkResult = await setStaffUnifiedCalendarAssignments(
        admin,
        staff.venue_id,
        newStaff.id,
        unifiedIdsToAssign,
      );
      if (!linkResult.ok) {
        console.error('[staff/invite] calendar link failed:', linkResult.error);
        return NextResponse.json(
          {
            error:
              'Invite was sent but linking to calendars failed. You can assign calendars from Settings → Staff.',
          },
          { status: 500 },
        );
      }
      linked_calendar_ids = unifiedIdsToAssign;
      linkedPractitionerId = unifiedIdsToAssign[0] ?? null;
      const { data: nameRows } = await admin
        .from('unified_calendars')
        .select('id, name')
        .eq('venue_id', staff.venue_id)
        .in('id', unifiedIdsToAssign);
      const nameById = new Map((nameRows ?? []).map((r) => [r.id as string, ((r.name as string) ?? '').trim()]));
      linkedPractitionerName =
        unifiedIdsToAssign.map((id) => nameById.get(id) ?? '').filter(Boolean).join(', ') || null;
    } else if (role === 'staff' && practitionerIdOpt) {
      const linkResult = await setStaffPractitionerLink(
        admin,
        staff.venue_id,
        newStaff.id,
        practitionerIdOpt,
        { bookingModel },
      );
      if (!linkResult.ok) {
        console.error('[staff/invite] calendar link failed:', linkResult.error);
        return NextResponse.json(
          {
            error:
              'Invite was sent but linking to the calendar failed. You can assign the calendar from Settings → Staff.',
          },
          { status: 500 },
        );
      }
      linkedPractitionerId = practitionerIdOpt;
      const { data: prNamed } = await admin
        .from('practitioners')
        .select('name')
        .eq('id', practitionerIdOpt)
        .eq('venue_id', staff.venue_id)
        .maybeSingle();
      linkedPractitionerName = prNamed?.name ?? null;
    }

    return NextResponse.json(
      {
        message: 'Invite sent',
        invite_email_sent: inviteEmailSent,
        staff: {
          ...newStaff,
          linked_calendar_ids,
          linked_practitioner_id: linkedPractitionerId,
          linked_practitioner_name: linkedPractitionerName,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('POST /api/venue/staff/invite failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
