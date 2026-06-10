import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { sendEmail } from '@/lib/emails/send-email';
import { renderStaffWelcomeEmail } from '@/lib/emails/templates/staff-welcome-email';
import { assertStaffSlotAvailable } from '@/lib/light-plan';
import { planDisplayName } from '@/lib/pricing-constants';
import { z } from 'zod';
import { setStaffPractitionerLink, setStaffUnifiedCalendarAssignments } from '@/lib/staff-practitioner-link';

const createSchema = z
  .object({
    email: z.string().email('Valid email required'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    password_confirm: z.string().min(1, 'Please confirm the password'),
    name: z.string().max(200).optional(),
    role: z.enum(['admin', 'staff']),
    /** Optional: link to one calendar (legacy single-select). */
    practitioner_id: z.string().uuid().nullable().optional(),
    /** Optional: unified scheduling — assign any combination of bookable calendars. Overrides practitioner_id when set. */
    calendar_ids: z.array(z.string().uuid()).optional(),
  })
  .refine((d) => d.password === d.password_confirm, {
    message: 'Passwords do not match',
    path: ['password_confirm'],
  });

/** POST /api/venue/staff/create - admin creates a new staff user with email and password. */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    if (!requireAdmin(staff)) return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });

    const body = await request.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid request', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { email, password, name, role, practitioner_id: practitionerIdOpt, calendar_ids: calendarIdsOpt } =
      parsed.data;
    const normalisedEmail = email.trim().toLowerCase();

    const admin = getSupabaseAdminClient();

    const { data: venueRow } = await admin
      .from('venues')
      .select('name, booking_model')
      .eq('id', staff.venue_id)
      .single();
    const venueName = venueRow?.name?.trim() || 'Your venue';
    const bookingModel = (venueRow?.booking_model as string) ?? 'table_reservation';

    // Admin users are never calendar-restricted.
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

    const baseUrl =
      process.env.NEXT_PUBLIC_BASE_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : request.nextUrl.origin);
    const loginUrl = `${baseUrl.replace(/\/$/, '')}/login`;

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

    // Check if already a staff member at this venue
    const { data: existing } = await admin
      .from('staff')
      .select('id')
      .eq('venue_id', staff.venue_id)
      .eq('email', normalisedEmail)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: 'This email is already a staff member at this venue' }, { status: 409 });
    }

    // Create the Supabase Auth user (or link to existing)
    let authUserId: string | null = null;

    // Check if auth user already exists
    const { data: existingUsers } = await admin.auth.admin.listUsers();
    const existingAuthUser = existingUsers?.users?.find(
      (u) => u.email?.toLowerCase() === normalisedEmail,
    );

    if (existingAuthUser) {
      authUserId = existingAuthUser.id;
      // Ensure they can sign in with email/password without a separate confirmation step
      const { error: updateErr } = await admin.auth.admin.updateUserById(authUserId, {
        password,
        email_confirm: true,
      });
      if (updateErr) {
        console.error('Auth user update failed:', updateErr);
        return NextResponse.json(
          { error: 'Failed to set password for this account. Try again or contact support.' },
          { status: 500 },
        );
      }
    } else {
      const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
        email: normalisedEmail,
        password,
        email_confirm: true,
        user_metadata: { venue_id: staff.venue_id },
      });

      if (createErr) {
        console.error('Auth user creation failed:', createErr);
        return NextResponse.json(
          { error: 'Failed to create user account. Try again or contact support.' },
          { status: 500 },
        );
      }
      authUserId = newUser.user.id;
    }

    // Insert into staff table
    const { data: newStaff, error: insertErr } = await admin
      .from('staff')
      .insert({
        venue_id: staff.venue_id,
        email: normalisedEmail,
        name: name?.trim() || null,
        role,
        // Durable auth link: the auth user was just created (or matched) above,
        // so identity resolution never has to rely on the fragile email match.
        user_id: authUserId,
      })
      .select('id, email, name, role, created_at')
      .single();

    if (insertErr) {
      console.error('Staff insert failed:', insertErr);
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
        console.error('[staff/create] calendar link failed:', linkResult.error);
        return NextResponse.json(
          {
            error:
              'User was created but linking to calendars failed. You can assign calendars from Settings → Staff.',
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
        console.error('[staff/create] calendar link failed:', linkResult.error);
        return NextResponse.json(
          {
            error:
              'User was created but linking to the calendar failed. You can assign the calendar from Settings → Staff.',
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

    const { html, text } = renderStaffWelcomeEmail({
      venueName,
      email: normalisedEmail,
      password,
      role,
      loginUrl,
    });

    let welcomeEmailSent = false;
    try {
      const messageId = await sendEmail({
        to: normalisedEmail,
        subject: `Your ${venueName} dashboard login - Resneo`,
        html,
        text,
      });
      welcomeEmailSent = messageId !== null;
      if (!welcomeEmailSent) {
        console.warn(
          '[POST /api/venue/staff/create] Welcome email not sent (SendGrid not configured or empty recipient).',
          { venueId: staff.venue_id, email: normalisedEmail },
        );
      }
    } catch (emailErr) {
      console.error('[POST /api/venue/staff/create] Welcome email failed:', emailErr, {
        venueId: staff.venue_id,
        email: normalisedEmail,
      });
    }

    return NextResponse.json(
      {
        staff: {
          ...newStaff,
          linked_calendar_ids,
          linked_practitioner_id: linkedPractitionerId,
          linked_practitioner_name: linkedPractitionerName,
        },
        welcome_email_sent: welcomeEmailSent,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('POST /api/venue/staff/create failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
