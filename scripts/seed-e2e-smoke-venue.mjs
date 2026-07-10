/**
 * Creates or updates the Playwright smoke-test fixture venue (P0.4).
 *
 * Requires .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY
 *   E2E_STRIPE_CONNECTED_ACCOUNT_ID (Stripe test Connect account, acct_...)
 *
 * Usage:
 *   node scripts/seed-e2e-smoke-venue.mjs
 *
 * Then set in .env.local / .env.e2e:
 *   E2E_VENUE_SLUG=e2e-smoke-appointments
 *   E2E_VENUE_NAME=E2E Smoke Salon
 *   E2E_SERVICE_NAME=E2E Smoke Consultation
 *   E2E_CARD_HOLD_SERVICE_NAME=E2E Smoke Card Hold Consultation
 */

import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env.local') });
config({ path: join(__dirname, '..', '.env.e2e') });

const VENUE_SLUG = process.env.E2E_VENUE_SLUG?.trim() || 'e2e-smoke-appointments';
const VENUE_NAME = process.env.E2E_VENUE_NAME?.trim() || 'E2E Smoke Salon';
const SERVICE_NAME = process.env.E2E_SERVICE_NAME?.trim() || 'E2E Smoke Consultation';
const CARD_HOLD_SERVICE_NAME =
  process.env.E2E_CARD_HOLD_SERVICE_NAME?.trim() || 'E2E Smoke Card Hold Consultation';
const STRIPE_ACCOUNT = process.env.E2E_STRIPE_CONNECTED_ACCOUNT_ID?.trim() || null;
const DEPOSIT_PENCE = Number(process.env.E2E_DEPOSIT_PENCE ?? 1000);
const CARD_HOLD_FEE_PENCE = Number(process.env.E2E_CARD_HOLD_FEE_PENCE ?? 1500);

const DEFAULT_WORKING_HOURS = {
  1: [{ start: '09:00', end: '17:00' }],
  2: [{ start: '09:00', end: '17:00' }],
  3: [{ start: '09:00', end: '17:00' }],
  4: [{ start: '09:00', end: '17:00' }],
  5: [{ start: '09:00', end: '17:00' }],
};

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !serviceKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY');
    process.exit(1);
  }
  if (!STRIPE_ACCOUNT) {
    console.error(
      'Missing E2E_STRIPE_CONNECTED_ACCOUNT_ID — create a Stripe test Connect account and set this env var.',
    );
    console.error('See Docs/E2E_SMOKE.md');
    process.exit(1);
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: existing } = await admin.from('venues').select('id').eq('slug', VENUE_SLUG).maybeSingle();

  const venueFields = {
    name: VENUE_NAME,
    slug: VENUE_SLUG,
    timezone: 'Europe/London',
    currency: 'GBP',
    booking_model: 'unified_scheduling',
    active_booking_models: ['unified_scheduling'],
    enabled_models: [],
    pricing_tier: 'appointments',
    plan_status: 'active',
    onboarding_completed: true,
    stripe_connected_account_id: STRIPE_ACCOUNT,
    calendar_count: 1,
    feature_flags: {
      waitlist_v2: true,
      guest_self_reschedule: true,
      any_available_practitioner: true,
      // Required so the card-hold smoke service below is configurable/bookable
      // (card-hold creation paths are gated on this venue flag).
      card_hold_deposits: true,
    },
    booking_rules: {
      cancellation_notice_hours: 1,
    },
  };

  let venueId = existing?.id;
  if (venueId) {
    const { error } = await admin.from('venues').update(venueFields).eq('id', venueId);
    if (error) throw error;
    console.log('[e2e-seed] Updated venue:', venueId, VENUE_SLUG);
  } else {
    const { data: created, error } = await admin.from('venues').insert(venueFields).select('id').single();
    if (error) throw error;
    venueId = created.id;
    console.log('[e2e-seed] Created venue:', venueId, VENUE_SLUG);
  }

  const { data: calendars } = await admin
    .from('unified_calendars')
    .select('id')
    .eq('venue_id', venueId)
    .eq('is_active', true);

  let calendarId = calendars?.[0]?.id;
  if (!calendarId) {
    const { data: cal, error: calErr } = await admin
      .from('unified_calendars')
      .insert({
        venue_id: venueId,
        name: 'E2E Calendar',
        slug: 'e2e-calendar',
        colour: '#4E6B78',
        working_hours: DEFAULT_WORKING_HOURS,
        sort_order: 0,
        is_active: true,
      })
      .select('id')
      .single();
    if (calErr) throw calErr;
    calendarId = cal.id;
    console.log('[e2e-seed] Created calendar:', calendarId);
  }

  /** Create-or-update a smoke service and make sure it is linked to the calendar. */
  async function ensureService(name, paymentFields) {
    const { data: services } = await admin
      .from('service_items')
      .select('id')
      .eq('venue_id', venueId)
      .eq('name', name)
      .limit(1);

    let serviceId = services?.[0]?.id;
    if (!serviceId) {
      const { data: svc, error: svcErr } = await admin
        .from('service_items')
        .insert({
          venue_id: venueId,
          name,
          duration_minutes: 30,
          buffer_minutes: 0,
          price_pence: 5000,
          ...paymentFields,
          is_active: true,
          is_bookable_online: true,
        })
        .select('id')
        .single();
      if (svcErr) throw svcErr;
      serviceId = svc.id;
      console.log('[e2e-seed] Created service:', serviceId, name);
    } else {
      const { error: updErr } = await admin
        .from('service_items')
        .update({
          ...paymentFields,
          is_active: true,
          is_bookable_online: true,
        })
        .eq('id', serviceId);
      if (updErr) throw updErr;
      console.log('[e2e-seed] Updated service payment config:', serviceId, name);
    }

    const { data: link } = await admin
      .from('calendar_service_assignments')
      .select('id')
      .eq('calendar_id', calendarId)
      .eq('service_item_id', serviceId)
      .maybeSingle();

    if (!link) {
      const { error: linkErr } = await admin.from('calendar_service_assignments').insert({
        calendar_id: calendarId,
        service_item_id: serviceId,
      });
      if (linkErr) throw linkErr;
      console.log('[e2e-seed] Linked service to calendar:', name);
    }
    return serviceId;
  }

  // Classic upfront-deposit service.
  await ensureService(SERVICE_NAME, {
    deposit_pence: DEPOSIT_PENCE,
    payment_requirement: 'deposit',
  });

  // Card-hold service (spec §17): no payment at booking; the guest's card is
  // stored and staff can charge a no-show fee up to deposit_pence later.
  // Requires feature_flags.card_hold_deposits on the venue (set above).
  await ensureService(CARD_HOLD_SERVICE_NAME, {
    deposit_pence: CARD_HOLD_FEE_PENCE,
    payment_requirement: 'card_hold',
  });

  // NB: this fixture venue is appointments-only (unified_scheduling) and the
  // script does not seed booking_restrictions, so no card-hold table rule is
  // seeded here.

  console.log('\n[e2e-seed] Done. Add to .env.local:\n');
  console.log(`E2E_VENUE_SLUG=${VENUE_SLUG}`);
  console.log(`E2E_VENUE_NAME=${VENUE_NAME}`);
  console.log(`E2E_SERVICE_NAME=${SERVICE_NAME}`);
  console.log(`E2E_CARD_HOLD_SERVICE_NAME=${CARD_HOLD_SERVICE_NAME}`);
  console.log(`\nPublic booking URL: ${process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'}/book/${VENUE_SLUG}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
