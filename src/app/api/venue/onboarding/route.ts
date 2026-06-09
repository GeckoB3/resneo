import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { BookingModel } from '@/types/booking-models';
import { z } from 'zod';
import {
  activeModelsToLegacyEnabledModels,
  resolveActiveBookingModels,
} from '@/lib/booking/active-models';
import { isAppointmentPlanTier } from '@/lib/tier-enforcement';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { normalizeWebsiteUrlForStorage } from '@/lib/urls/website-url';
import { candidateVenueSlugs, firstAvailableVenueSlug } from '@/lib/venue/unique-venue-slug';

const onboardingEmailSchema = z.string().trim().email().max(255);

export async function PATCH(request: Request) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
    if (!requireAdmin(staff)) {
      return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }
    const admin = staff.db;

    const body = await request.json();
    const updates: Record<string, unknown> = {};

    if (typeof body.onboarding_step === 'number') {
      updates.onboarding_step = body.onboarding_step;
    }

    if (typeof body.appointments_onboarding_unified_flow === 'boolean') {
      updates.appointments_onboarding_unified_flow = body.appointments_onboarding_unified_flow;
    }

    if (typeof body.onboarding_completed === 'boolean') {
      updates.onboarding_completed = body.onboarding_completed;
    }

    if (typeof body.name === 'string' && body.name.trim()) {
      updates.name = body.name.trim();
    }

    if (typeof body.address === 'string') {
      updates.address = body.address.trim();
    }

    if (typeof body.phone === 'string') {
      updates.phone = body.phone.trim();
    }

    if (typeof body.email === 'string') {
      const email = body.email.trim();
      if (email) {
        const parsed = onboardingEmailSchema.safeParse(email);
        if (!parsed.success) {
          return NextResponse.json({ error: 'Invalid business email address' }, { status: 400 });
        }
        updates.email = parsed.data;
        updates.reply_to_email = parsed.data;
      } else {
        updates.email = null;
        updates.reply_to_email = null;
      }
    }

    if (typeof body.website_url === 'string') {
      const rawWebsiteUrl = body.website_url.trim();
      const normalizedWebsiteUrl = normalizeWebsiteUrlForStorage(rawWebsiteUrl);
      if (rawWebsiteUrl && !normalizedWebsiteUrl) {
        return NextResponse.json({ error: 'Invalid website URL' }, { status: 400 });
      }
      updates.website_url = normalizedWebsiteUrl;
    }

    // The client derives this slug from the business name. We don't write it directly: a unique
    // variant is resolved below so a name that clashes with an existing venue never blocks
    // onboarding (the URL can be changed later in venue settings).
    let preferredSlug: string | null = null;
    if (typeof body.slug === 'string' && body.slug.trim()) {
      preferredSlug =
        body.slug
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-+|-+$/g, '') || null;
    }

    if (typeof body.currency === 'string' && ['GBP', 'EUR'].includes(body.currency)) {
      updates.currency = body.currency;
    }

    if (body.active_booking_models !== undefined) {
      const { data: venueRow, error: venueErr } = await admin
        .from('venues')
        .select('booking_model, enabled_models, active_booking_models, pricing_tier')
        .eq('id', staff.venue_id)
        .single();
      if (venueErr || !venueRow) {
        return NextResponse.json({ error: 'Failed to validate booking models' }, { status: 500 });
      }
      const activeModels = resolveActiveBookingModels({
        pricingTier: (venueRow as { pricing_tier?: string | null }).pricing_tier,
        bookingModel: (venueRow as { booking_model?: BookingModel }).booking_model,
        enabledModels: (venueRow as { enabled_models?: unknown }).enabled_models,
        activeBookingModels: body.active_booking_models,
      });
      if (isAppointmentPlanTier((venueRow as { pricing_tier?: string | null }).pricing_tier) && activeModels.length === 0) {
        return NextResponse.json({ error: 'At least one booking model must remain active.' }, { status: 400 });
      }
      const bookingModel =
        activeModels[0] ??
        (((venueRow as { booking_model?: BookingModel }).booking_model as BookingModel | undefined) ??
          'table_reservation');
      updates.booking_model = bookingModel;
      updates.active_booking_models = activeModels;
      updates.enabled_models = activeModelsToLegacyEnabledModels(activeModels, bookingModel);
    }

    if (Object.keys(updates).length === 0 && !preferredSlug) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    // Resolve a unique booking-page slug, then persist. A clashing business name must never block
    // onboarding, so we pick the first free variant automatically — the preferred slug, then the
    // fewest-digit numbered suffix (`my-business2`, `my-business3`, …) — and retry on the rare race
    // where a chosen variant is taken between the availability check and the write.
    const slugCandidates = preferredSlug ? candidateVenueSlugs(preferredSlug) : [];
    let currentSlug: string | null = null;
    if (preferredSlug) {
      const { data: current } = await admin
        .from('venues')
        .select('slug')
        .eq('id', staff.venue_id)
        .single();
      currentSlug = (current as { slug?: string | null } | null)?.slug ?? null;
    }

    const maxAttempts = preferredSlug ? 4 : 1;
    let lastError: { code?: string; message: string } | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (preferredSlug) {
        if (currentSlug && slugCandidates.includes(currentSlug)) {
          // The venue already holds a valid unique variant of this name — keep it so re-submitting
          // the profile step doesn't churn the booking URL.
          updates.slug = currentSlug;
        } else {
          const { data: clashes } = await admin
            .from('venues')
            .select('slug')
            .in('slug', slugCandidates)
            .neq('id', staff.venue_id);
          const taken = new Set((clashes ?? []).map((row) => (row as { slug: string }).slug));
          updates.slug =
            firstAvailableVenueSlug(preferredSlug, (slug) => taken.has(slug)) ??
            `${preferredSlug}-${Date.now().toString(36)}`;
        }
      }

      const { error: updateError } = await admin
        .from('venues')
        .update(updates)
        .eq('id', staff.venue_id);

      if (!updateError) {
        lastError = null;
        break;
      }
      lastError = updateError;
      // Only a slug-uniqueness race is retryable; the next pass re-queries and skips the taken one.
      const retryableSlugRace =
        updateError.code === '23505' &&
        preferredSlug !== null &&
        currentSlug !== updates.slug &&
        attempt < maxAttempts;
      if (!retryableSlugRace) break;
    }

    if (lastError) {
      return NextResponse.json(
        { error: 'Failed to update: ' + lastError.message },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      slug: typeof updates.slug === 'string' ? updates.slug : undefined,
    });
  } catch (err) {
    console.error('[venue/onboarding] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET() {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
    const admin = staff.db;

    const { data: venue, error: venueError } = await admin
      .from('venues')
      .select(
        'id, name, slug, address, phone, email, website_url, booking_model, enabled_models, active_booking_models, business_type, business_category, terminology, pricing_tier, calendar_count, onboarding_step, onboarding_completed, appointments_onboarding_unified_flow, currency, stripe_connected_account_id'
      )
      .eq('id', staff.venue_id)
      .single();

    if (venueError || !venue) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }

    const v = venue as Record<string, unknown>;
    const activeModels = resolveActiveBookingModels({
      pricingTier: v.pricing_tier as string | null | undefined,
      bookingModel: v.booking_model as BookingModel | undefined,
      enabledModels: v.enabled_models,
      activeBookingModels: v.active_booking_models,
    });
    const bookingModel = activeModels[0] ?? ((v.booking_model as BookingModel) ?? 'table_reservation');

    return NextResponse.json({
      venue: {
        ...venue,
        booking_model: bookingModel,
        active_booking_models: activeModels,
        enabled_models: activeModelsToLegacyEnabledModels(activeModels, bookingModel),
        is_admin: staff.role === 'admin',
      },
    });
  } catch (err) {
    console.error('[venue/onboarding] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
