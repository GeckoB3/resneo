import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { z } from 'zod';
import { normalizeToE164 } from '@/lib/phone/e164';
import { normalizeWebsiteUrlForStorage } from '@/lib/urls/website-url';
import {
  activeModelsToLegacyEnabledModels,
  resolveActiveBookingModels,
} from '@/lib/booking/active-models';
import type { BookingModel } from '@/types/booking-models';
import { isAppointmentPlanTier } from '@/lib/tier-enforcement';
import { backfillVenueEmailIfEmptyFromStaff } from '@/lib/venue-contact-email';
import { assertCanDisableBookingModels } from '@/lib/booking/venue-booking-model-disable-guard';
import { parseVenueFeatureFlags, resolveAppointmentsFeatureFlags } from '@/lib/feature-flags';
import { normalizeEmbedAccentHex } from '@/lib/embed/accent-colour';
import { mergeBookingPageConfigPatch } from '@/lib/booking/booking-page-theme';

/** Pan/zoom framing for logo and cover on the public booking page (sanitised again after parse). */
const bookingPageImageFramingSchema = z.object({
  x: z.number().min(0).max(100).optional(),
  y: z.number().min(0).max(100).optional(),
  zoom: z.number().min(0.5).max(3).optional(),
});

const venueProfileSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Slug: lowercase letters, numbers, hyphens only').optional(),
  address: z.string().max(500).optional(),
  phone: z.string().max(24).optional(),
  email: z.string().email().max(255).optional().or(z.literal('')),
  cover_photo_url: z.string().url().max(2000).nullable().optional(),
  logo_url: z.string().url().max(2000).nullable().optional(),
  cuisine_type: z.string().max(100).optional(),
  price_band: z.string().max(50).optional(),
  no_show_grace_minutes: z.number().int().min(10).max(60).optional(),
  kitchen_email: z.string().email().max(255).optional().or(z.literal('')),
  timezone: z.string().max(50).optional(),
  /** Public booking page link; empty clears. Stored as https URL or null. */
  website_url: z.string().max(2000).optional(),
  /** Canonical active booking models; appointments plan uses this as the editable source of truth. */
  active_booking_models: z.array(z.string()).optional(),
  /** Secondary bookable models (C/D/E); normalised with {@link normalizeEnabledModels}. */
  enabled_models: z.array(z.string()).optional(),
  /** Guest booking: combined slots vs pick-area-first (table_reservation). */
  public_booking_area_mode: z.enum(['auto', 'manual']).optional(),
  /** When true, public booking must complete magic-link login before checkout (see booking create). */
  require_account_login_for_bookings: z.boolean().optional(),
  /** 6-digit hex (optional `#`) for embed iframe `?accent=` query param. Empty string clears. */
  embed_accent_colour: z.string().max(7).optional(),
  /** Public booking-page branding/content (Booking Site Studio); sanitised server-side. */
  booking_page_config: z
    .object({
      brand_primary: z.string().max(7).nullable().optional(),
      brand_accent: z.string().max(7).nullable().optional(),
      about: z.string().max(4000).nullable().optional(),
      announcement: z.string().max(600).nullable().optional(),
      font_preset: z.string().max(40).nullable().optional(),
      logo_crop: bookingPageImageFramingSchema.nullable().optional(),
      cover_crop: bookingPageImageFramingSchema.nullable().optional(),
      /** When false, cover is constrained to the booking content column instead of edge-to-edge. */
      cover_full_width: z.boolean().optional(),
      gallery: z.array(z.string().max(2000)).max(50).nullable().optional(),
      service_photos: z.record(z.string(), z.string().max(2000)).nullable().optional(),
      show_services_tab: z.boolean().optional(),
      show_team_tab: z.boolean().optional(),
      show_about_tab: z.boolean().optional(),
      team_profiles: z
        .record(
          z.string(),
          z
            .object({
              bio: z.string().max(2000).nullable().optional(),
              photo: z.string().max(2000).nullable().optional(),
              specialties: z.string().max(400).nullable().optional(),
              hidden: z.boolean().optional(),
            })
            .partial(),
        )
        .nullable()
        .optional(),
      social_links: z
        .object({
          instagram: z.string().max(400).nullable().optional(),
          facebook: z.string().max(400).nullable().optional(),
          tiktok: z.string().max(400).nullable().optional(),
          x: z.string().max(400).nullable().optional(),
        })
        .partial()
        .nullable()
        .optional(),
    })
    .partial()
    .optional(),
}).refine((data) => Object.keys(data).filter((k) => data[k as keyof typeof data] !== undefined).length > 0, { message: 'At least one field required' });

/** GET /api/venue - return the authenticated user's venue profile. */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    let venue = null;
    const { data: fullVenue, error } = await staff.db
      .from('venues')
      .select('id, name, slug, address, phone, email, reply_to_email, cover_photo_url, logo_url, cuisine_type, price_band, no_show_grace_minutes, kitchen_email, communication_templates, opening_hours, venue_opening_exceptions, booking_rules, deposit_config, availability_config, stripe_connected_account_id, timezone, currency, website_url, booking_model, enabled_models, active_booking_models, pricing_tier, terminology, public_booking_area_mode, require_account_login_for_bookings, feature_flags, embed_accent_colour, booking_page_config')
      .eq('id', staff.venue_id)
      .single();

    if (fullVenue) {
      venue = fullVenue;
    } else {
      const { data: basicVenue } = await staff.db
        .from('venues')
        .select('id, name, slug, address, phone, email, reply_to_email, cover_photo_url, logo_url, opening_hours, venue_opening_exceptions, booking_rules, deposit_config, availability_config, stripe_connected_account_id, timezone, currency, website_url, booking_model, enabled_models, active_booking_models, pricing_tier, terminology, public_booking_area_mode, require_account_login_for_bookings, feature_flags, embed_accent_colour')
        .eq('id', staff.venue_id)
        .single();
      if (basicVenue) {
        venue = { ...basicVenue, cuisine_type: null, price_band: null, no_show_grace_minutes: 15, kitchen_email: null, communication_templates: null, website_url: (basicVenue as { website_url?: string | null }).website_url ?? null };
      }
    }

    if (!venue) {
      console.error('GET /api/venue: venue not found', error?.message);
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }

    if (staff.role === 'admin') {
      const nextEmail = await backfillVenueEmailIfEmptyFromStaff(
        staff.db,
        staff.venue_id,
        (venue as { email?: string | null }).email,
        staff.email,
      );
      if (nextEmail) {
        venue = { ...(venue as object), email: nextEmail } as typeof venue;
      }
    }

    const v = venue as Record<string, unknown>;
    const activeModels = resolveActiveBookingModels({
      pricingTier: v.pricing_tier as string | null | undefined,
      bookingModel: v.booking_model as BookingModel | undefined,
      enabledModels: v.enabled_models,
      activeBookingModels: v.active_booking_models,
    });
    const primary = activeModels[0] ?? ((v.booking_model as BookingModel) ?? 'table_reservation');
    const enabledModels = activeModelsToLegacyEnabledModels(activeModels, primary);
    const featureFlagsRaw = parseVenueFeatureFlags(v.feature_flags);
    return NextResponse.json({
      ...venue,
      active_booking_models: activeModels,
      enabled_models: enabledModels,
      current_user_role: staff.role,
      feature_flags: {
        raw: featureFlagsRaw,
        resolved: resolveAppointmentsFeatureFlags(featureFlagsRaw),
      },
    });
  } catch (err) {
    console.error('GET /api/venue failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** PATCH /api/venue - update venue profile (admin only). */
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
    if (!requireAdmin(staff)) {
      return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    const body = await request.json();
    const parsed = venueProfileSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const data = parsed.data as Record<string, unknown>;
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.name !== undefined) update.name = data.name;
    if (data.slug !== undefined) update.slug = data.slug;
    if (data.address !== undefined) update.address = data.address;
    if (data.phone !== undefined) {
      const t = typeof data.phone === 'string' ? data.phone.trim() : '';
      if (!t) {
        update.phone = null;
      } else {
        const e164 = normalizeToE164(t, 'GB');
        if (!e164) {
          return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
        }
        update.phone = e164;
      }
    }
    if (data.email !== undefined) {
      const nextEmail = data.email === '' ? null : data.email;
      update.email = nextEmail;
      update.reply_to_email = nextEmail;
    }
    if (data.cover_photo_url !== undefined) update.cover_photo_url = data.cover_photo_url;
    if (data.logo_url !== undefined) update.logo_url = data.logo_url;
    if (data.cuisine_type !== undefined) update.cuisine_type = data.cuisine_type;
    if (data.price_band !== undefined) update.price_band = data.price_band;
    if (data.no_show_grace_minutes !== undefined) update.no_show_grace_minutes = data.no_show_grace_minutes;
    if (data.kitchen_email !== undefined) update.kitchen_email = data.kitchen_email === '' ? null : data.kitchen_email;
    if (data.timezone !== undefined) update.timezone = data.timezone;
    if (data.website_url !== undefined) {
      const raw = typeof data.website_url === 'string' ? data.website_url : '';
      const normalized = normalizeWebsiteUrlForStorage(raw);
      if (raw.trim() && !normalized) {
        return NextResponse.json({ error: 'Invalid website URL' }, { status: 400 });
      }
      update.website_url = normalized;
    }
    if (data.public_booking_area_mode !== undefined) {
      update.public_booking_area_mode = data.public_booking_area_mode;
    }
    if (data.require_account_login_for_bookings !== undefined) {
      update.require_account_login_for_bookings = data.require_account_login_for_bookings;
    }
    if (data.embed_accent_colour !== undefined) {
      const raw = typeof data.embed_accent_colour === 'string' ? data.embed_accent_colour : '';
      if (raw.trim() === '') {
        update.embed_accent_colour = null;
      } else {
        const normalised = normalizeEmbedAccentHex(raw);
        if (!normalised) {
          return NextResponse.json(
            { error: 'Accent colour must be a 6-digit hex value (e.g. 4F46E5).' },
            { status: 400 },
          );
        }
        update.embed_accent_colour = normalised;
      }
    }
    if (data.booking_page_config !== undefined) {
      const { data: existingRow, error: configLoadErr } = await staff.db
        .from('venues')
        .select('booking_page_config')
        .eq('id', staff.venue_id)
        .maybeSingle();
      if (configLoadErr) {
        console.error('PATCH /api/venue: could not load booking_page_config', configLoadErr);
        return NextResponse.json({ error: 'Failed to load venue settings' }, { status: 500 });
      }
      const existing =
        existingRow?.booking_page_config && typeof existingRow.booking_page_config === 'object'
          ? (existingRow.booking_page_config as Record<string, unknown>)
          : {};
      const incoming =
        data.booking_page_config && typeof data.booking_page_config === 'object'
          ? (data.booking_page_config as Record<string, unknown>)
          : {};
      update.booking_page_config = mergeBookingPageConfigPatch(existing, incoming);
    }

    let nextActiveModels: BookingModel[] | null = null;

    if (data.active_booking_models !== undefined || data.enabled_models !== undefined) {
      const { data: venueRow, error: primaryErr } = await staff.db
        .from('venues')
        .select('booking_model, enabled_models, active_booking_models, pricing_tier, timezone')
        .eq('id', staff.venue_id)
        .single();
      if (primaryErr || !venueRow) {
        console.error('PATCH /api/venue: could not load booking models', primaryErr);
        return NextResponse.json({ error: 'Failed to validate venue' }, { status: 500 });
      }
      const row = venueRow as {
        booking_model?: BookingModel;
        enabled_models?: unknown;
        active_booking_models?: unknown;
        pricing_tier?: string | null;
        timezone?: string | null;
      };
      const existingActive = resolveActiveBookingModels({
        pricingTier: row.pricing_tier,
        bookingModel: row.booking_model,
        enabledModels: row.enabled_models,
        activeBookingModels: row.active_booking_models,
      });
      const basePrimary = existingActive[0] ?? (row.booking_model ?? 'table_reservation');

      if (data.active_booking_models !== undefined) {
        nextActiveModels = resolveActiveBookingModels({
          pricingTier: row.pricing_tier,
          bookingModel: basePrimary,
          activeBookingModels: data.active_booking_models,
        });
      } else if (data.enabled_models !== undefined) {
        if (isAppointmentPlanTier(row.pricing_tier)) {
          nextActiveModels = resolveActiveBookingModels({
            pricingTier: row.pricing_tier,
            bookingModel: basePrimary,
            activeBookingModels: data.enabled_models,
          });
        } else {
          // Do not pass stored `active_booking_models` here: when it is non-empty,
          // `resolveActiveBookingModels` would ignore the new `enabled_models` entirely.
          nextActiveModels = resolveActiveBookingModels({
            pricingTier: row.pricing_tier,
            bookingModel: basePrimary,
            enabledModels: data.enabled_models,
          });
        }
      }

      if (nextActiveModels !== null) {
        if (isAppointmentPlanTier(row.pricing_tier) && nextActiveModels.length === 0) {
          return NextResponse.json({ error: 'At least one booking model must remain active.' }, { status: 400 });
        }
        const removed = existingActive.filter((m) => !nextActiveModels!.includes(m));
        try {
          await assertCanDisableBookingModels(staff.db, staff.venue_id, row.timezone, removed);
        } catch (guardErr) {
          const code = (guardErr as { code?: string }).code;
          if (code === 'BOOKING_MODEL_HAS_FUTURE_BOOKINGS') {
            return NextResponse.json({ error: (guardErr as Error).message }, { status: 409 });
          }
          console.error('PATCH /api/venue: booking model disable guard', guardErr);
          return NextResponse.json({ error: 'Failed to validate booking types' }, { status: 500 });
        }
        const nextPrimary = nextActiveModels[0] ?? basePrimary;
        update.booking_model = nextPrimary;
        update.active_booking_models = nextActiveModels;
        update.enabled_models = activeModelsToLegacyEnabledModels(nextActiveModels, nextPrimary);
      }
    }

    const { data: venue, error } = await staff.db
      .from('venues')
      .update(update)
      .eq('id', staff.venue_id)
      .select(
        'id, name, slug, address, phone, email, reply_to_email, cover_photo_url, logo_url, cuisine_type, price_band, no_show_grace_minutes, kitchen_email, timezone, website_url, booking_model, enabled_models, active_booking_models, pricing_tier, require_account_login_for_bookings, embed_accent_colour, booking_page_config',
      )
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          {
            error:
              'That booking page address is already taken by another venue. Choose a different slug (lowercase letters, numbers, and hyphens only).',
          },
          { status: 409 },
        );
      }
      console.error('PATCH /api/venue failed:', error);
      return NextResponse.json({ error: 'Failed to update venue' }, { status: 500 });
    }

    const v = venue as Record<string, unknown>;
    const activeModels = resolveActiveBookingModels({
      pricingTier: v.pricing_tier as string | null | undefined,
      bookingModel: v.booking_model as BookingModel | undefined,
      enabledModels: v.enabled_models,
      activeBookingModels: v.active_booking_models,
    });
    const primary = activeModels[0] ?? ((v.booking_model as BookingModel) ?? 'table_reservation');
    const enabledModels = activeModelsToLegacyEnabledModels(activeModels, primary);
    return NextResponse.json({ ...venue, active_booking_models: activeModels, enabled_models: enabledModels });
  } catch (err) {
    console.error('PATCH /api/venue failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
