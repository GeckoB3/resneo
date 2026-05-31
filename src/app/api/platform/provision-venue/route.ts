import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { isPlatformSuperuser } from '@/lib/platform-auth';
import { getBusinessConfig } from '@/lib/business-config';
import { updateVenueSmsMonthlyAllowance } from '@/lib/billing/sms-allowance';
import {
  activeModelsToLegacyEnabledModels,
  getDefaultBookingModelFromActive,
} from '@/lib/booking/active-models';
import { isUnifiedSchedulingVenue } from '@/lib/booking/unified-scheduling';
import { parseNotificationSettings } from '@/lib/notifications/notification-settings';
import { isAppointmentPlanTier } from '@/lib/tier-enforcement';
import type { BookingModel } from '@/types/booking-models';
import { deliverStaffAccessLinkEmail } from '@/lib/staff-invite-email';
import { normalizePublicBaseUrl } from '@/lib/public-base-url';
import {
  BILLING_ACCESS_SOURCE_SUPERUSER_FREE,
} from '@/lib/billing/billing-access-source';
import { DEFAULT_VENUE_BOOKING_LOG_EMAIL_CONFIG } from '@/lib/reports/booking-log-email-config';
import { SESSION_TIMEOUT_DEFAULT_MINUTES } from '@/lib/session-timeout';
import { hardDeleteVenueWithLinkedAccountNotifications } from '@/lib/linked-accounts/venue-deletion';
import { DEFAULT_BOOKING_PAGE_CONFIG_FOR_NEW_VENUE } from '@/lib/booking/booking-page-theme';

const provisionBodySchema = z
  .object({
    owner_email: z.string().email(),
    venue_name: z.string().min(1).max(200).trim().optional(),
    plan: z.enum(['light', 'plus', 'appointments', 'restaurant']),
    auth_mode: z.enum(['password', 'magic_link']),
    password: z.string().min(8).max(200).optional(),
    business_type: z.string().min(1).max(120).optional(),
    free_access_reason: z.string().max(2000).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.auth_mode === 'password' && (!data.password || data.password.length < 8)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Password is required (min 8 characters) when auth_mode is password.',
        path: ['password'],
      });
    }
  });

async function staffEmailExists(admin: ReturnType<typeof getSupabaseAdminClient>, email: string): Promise<boolean> {
  const { data, error } = await admin.from('staff').select('id').ilike('email', email).limit(1);
  if (error) {
    console.error('[platform/provision-venue] staff lookup failed:', error);
    return true;
  }
  return (data?.length ?? 0) > 0;
}

/** POST /api/platform/provision-venue — create comped venue + admin staff + auth user (superuser only). */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || !isPlatformSuperuser(user)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const json = await request.json().catch(() => null);
    const parsed = provisionBodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const body = parsed.data;
    const ownerEmail = body.owner_email.trim().toLowerCase();
    const venueName = body.venue_name?.trim() || (ownerEmail.split('@')[0] ?? 'New Business');
    if (await staffEmailExists(getSupabaseAdminClient(), ownerEmail)) {
      return NextResponse.json(
        { error: 'This email already has venue access. Use a different email or remove the existing staff row first.' },
        { status: 409 },
      );
    }

    const admin = getSupabaseAdminClient();
    const grantedBy = user.id;
    const nowIso = new Date().toISOString();

    const isRestaurantPlan = body.plan === 'restaurant';
    const businessType = isRestaurantPlan
      ? 'restaurant'
      : (body.business_type?.trim() || 'other');
    const config = getBusinessConfig(businessType);

    if (isRestaurantPlan && config.model !== 'table_reservation') {
      return NextResponse.json({ error: 'Restaurant plan requires a table-booking business type.' }, { status: 400 });
    }

    // For appointment-tier plans, active_booking_models is intentionally left empty here.
    // The owner picks their booking models on /signup/booking-models after first sign-in.
    const activeModels: BookingModel[] = [];

    const bookingModel: BookingModel = isRestaurantPlan
      ? 'table_reservation'
      : getDefaultBookingModelFromActive(activeModels, config.model);
    const enabledModels = activeModelsToLegacyEnabledModels(activeModels, bookingModel);

    const slug = `venue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const venueInsert: Record<string, unknown> = {
      name: venueName,
      slug,
      booking_model: bookingModel,
      business_type: businessType,
      business_category: config.category,
      terminology: config.terms,
      pricing_tier: body.plan,
      plan_status: 'active',
      billing_access_source: BILLING_ACCESS_SOURCE_SUPERUSER_FREE,
      free_access_granted_at: nowIso,
      free_access_granted_by: grantedBy,
      free_access_reason: body.free_access_reason?.trim() || null,
      stripe_customer_id: null,
      stripe_subscription_id: null,
      stripe_subscription_item_id: null,
      stripe_sms_subscription_item_id: null,
      subscription_current_period_start: null,
      subscription_current_period_end: null,
      calendar_count: body.plan === 'light' ? 1 : null,
      onboarding_step: 0,
      onboarding_completed: false,
      appointments_onboarding_unified_flow: isAppointmentPlanTier(body.plan),
      email: ownerEmail,
      enabled_models: enabledModels,
      daily_booking_log_email_config: DEFAULT_VENUE_BOOKING_LOG_EMAIL_CONFIG,
      session_timeout_minutes: SESSION_TIMEOUT_DEFAULT_MINUTES,
      ...(isAppointmentPlanTier(body.plan)
        ? { booking_page_config: DEFAULT_BOOKING_PAGE_CONFIG_FOR_NEW_VENUE }
        : {}),
    };

    let authUserId: string | null = null;

    if (body.auth_mode === 'password') {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: ownerEmail,
        password: body.password!,
        email_confirm: true,
        user_metadata: { has_set_password: true },
      });
      if (createErr) {
        const msg = createErr.message?.toLowerCase() ?? '';
        if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
          return NextResponse.json({ error: 'An auth account with this email already exists.' }, { status: 409 });
        }
        console.error('[platform/provision-venue] createUser:', createErr);
        return NextResponse.json({ error: createErr.message ?? 'Failed to create auth user' }, { status: 500 });
      }
      authUserId = created.user?.id ?? null;
    }

    const { data: venue, error: venueError } = await admin.from('venues').insert(venueInsert).select('id').single();

    if (venueError || !venue) {
      console.error('[platform/provision-venue] venue insert failed:', venueError);
      if (authUserId) {
        const { error: delErr } = await admin.auth.admin.deleteUser(authUserId);
        if (delErr) console.error('[platform/provision-venue] rollback deleteUser failed:', delErr);
      }
      return NextResponse.json({ error: 'Failed to create venue' }, { status: 500 });
    }

    const venueId = (venue as { id: string }).id;

    const { error: staffError } = await admin.from('staff').insert({
      venue_id: venueId,
      email: ownerEmail,
      name: ownerEmail.split('@')[0] ?? 'Admin',
      role: 'admin',
    });

    if (staffError) {
      console.error('[platform/provision-venue] staff insert failed:', staffError);
      await hardDeleteVenueWithLinkedAccountNotifications(admin, venueId);
      if (authUserId) {
        const { error: delErr } = await admin.auth.admin.deleteUser(authUserId);
        if (delErr) console.error('[platform/provision-venue] rollback deleteUser failed:', delErr);
      }
      return NextResponse.json({ error: 'Failed to create staff record' }, { status: 500 });
    }

    await updateVenueSmsMonthlyAllowance(venueId);

    if (isUnifiedSchedulingVenue(bookingModel)) {
      const notification_settings = parseNotificationSettings(null);
      const { error: notifErr } = await admin
        .from('venues')
        .update({ notification_settings: notification_settings as unknown as Record<string, never> })
        .eq('id', venueId);
      if (notifErr) {
        console.warn('[platform/provision-venue] notification_settings default:', notifErr);
      }
    }

    if (body.auth_mode === 'magic_link') {
      const baseUrl = normalizePublicBaseUrl(process.env.NEXT_PUBLIC_BASE_URL);
      const linkResult = await deliverStaffAccessLinkEmail({
        admin,
        email: ownerEmail,
        baseUrl,
        userMetadata: {
          has_set_password: false,
          provisioned_by_superuser: true,
        },
        venueName,
      });

      if (!linkResult.ok) {
        await hardDeleteVenueWithLinkedAccountNotifications(admin, venueId);
        if (authUserId) {
          const { error: delErr } = await admin.auth.admin.deleteUser(authUserId);
          if (delErr) console.error('[platform/provision-venue] rollback deleteUser failed:', delErr);
        }
        return NextResponse.json({ error: linkResult.error }, { status: linkResult.status });
      }
    }

    const ownerNextPath = isAppointmentPlanTier(body.plan) ? '/signup/booking-models' : '/onboarding';

    return NextResponse.json({
      ok: true,
      venue_id: venueId,
      slug,
      owner_email: ownerEmail,
      owner_next_path: ownerNextPath,
      auth_mode: body.auth_mode,
    });
  } catch (err) {
    console.error('[platform/provision-venue] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
