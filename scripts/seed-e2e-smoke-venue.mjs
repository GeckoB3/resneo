/**
 * Creates or updates the Playwright smoke-test fixture venues (P0.4).
 *
 * Two venues are seeded, both idempotent:
 *
 *   1. The original appointments fixture (slug from E2E_VENUE_SLUG). Its slug,
 *      flags and existing services are unchanged; it gains one options-and-
 *      extras service so a booking with those steps can be smoke-tested.
 *   2. A staff-first fixture on a fixed slug, with two calendars that offer
 *      overlapping but different services at different prices. That difference
 *      is the point: it is what proves the flow lists one person's own services
 *      at their own prices.
 *
 * Requires .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY
 *   E2E_STRIPE_CONNECTED_ACCOUNT_ID (Stripe test Connect account, acct_...)
 *
 * Usage:
 *   node scripts/seed-e2e-smoke-venue.mjs
 *
 * Then set the env vars it prints at the end into .env.local / .env.e2e.
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
const OPTIONS_SERVICE_NAME =
  process.env.E2E_OPTIONS_SERVICE_NAME?.trim() || 'E2E Smoke Options Consultation';

/**
 * Fixed, not read from env: the two fixtures must never collide, and a typo in
 * one env var should not quietly merge them into a single venue.
 */
const STAFF_FIRST_VENUE_SLUG = 'e2e-smoke-staff-first';
const STAFF_FIRST_VENUE_NAME = 'E2E Staff-First Salon';
const STAFF_FIRST_SHARED_SERVICE_NAME = 'E2E Shared Consultation';
const STAFF_FIRST_EXCLUSIVE_SERVICE_NAME = 'E2E Second Calendar Only';
const STAFF_FIRST_OPTIONS_SERVICE_NAME = 'E2E Staff-First Options Consultation';
const STAFF_FIRST_CALENDAR_A = 'E2E Alex';
const STAFF_FIRST_CALENDAR_B = 'E2E Bailey';
/** Alex's price for the shared service; Bailey charges the base price below. */
const STAFF_FIRST_CALENDAR_A_PRICE_PENCE = 3000;

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

function makeAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !serviceKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY');
    process.exit(1);
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Create-or-update the venue row and return its id. */
async function ensureVenue(admin, { slug, name, featureFlags, calendarCount }) {
  const { data: existing } = await admin.from('venues').select('id').eq('slug', slug).maybeSingle();

  const venueFields = {
    name,
    slug,
    timezone: 'Europe/London',
    currency: 'GBP',
    booking_model: 'unified_scheduling',
    active_booking_models: ['unified_scheduling'],
    enabled_models: [],
    pricing_tier: 'appointments',
    plan_status: 'active',
    onboarding_completed: true,
    stripe_connected_account_id: STRIPE_ACCOUNT,
    calendar_count: calendarCount,
    feature_flags: featureFlags,
    booking_rules: { cancellation_notice_hours: 1 },
  };

  if (existing?.id) {
    const { error } = await admin.from('venues').update(venueFields).eq('id', existing.id);
    if (error) throw error;
    console.log('[e2e-seed] Updated venue:', existing.id, slug);
    return existing.id;
  }
  const { data: created, error } = await admin
    .from('venues')
    .insert(venueFields)
    .select('id')
    .single();
  if (error) throw error;
  console.log('[e2e-seed] Created venue:', created.id, slug);
  return created.id;
}

/** Create-or-find a calendar by name within a venue. */
async function ensureCalendar(admin, venueId, { name, slug, sortOrder }) {
  const { data: existing } = await admin
    .from('unified_calendars')
    .select('id')
    .eq('venue_id', venueId)
    .eq('name', name)
    .maybeSingle();
  if (existing?.id) return existing.id;

  const { data: cal, error } = await admin
    .from('unified_calendars')
    .insert({
      venue_id: venueId,
      name,
      slug,
      colour: '#4E6B78',
      working_hours: DEFAULT_WORKING_HOURS,
      sort_order: sortOrder,
      is_active: true,
    })
    .select('id')
    .single();
  if (error) throw error;
  console.log('[e2e-seed] Created calendar:', cal.id, name);
  return cal.id;
}

/** Create-or-update a service and return its id. Matched by name within the venue. */
async function ensureService(admin, venueId, name, fields) {
  const { data: services } = await admin
    .from('service_items')
    .select('id')
    .eq('venue_id', venueId)
    .eq('name', name)
    .limit(1);

  const payload = {
    duration_minutes: 30,
    buffer_minutes: 0,
    price_pence: 5000,
    ...fields,
    is_active: true,
    is_bookable_online: true,
  };

  let serviceId = services?.[0]?.id;
  if (!serviceId) {
    const { data: svc, error } = await admin
      .from('service_items')
      .insert({ venue_id: venueId, name, ...payload })
      .select('id')
      .single();
    if (error) throw error;
    serviceId = svc.id;
    console.log('[e2e-seed] Created service:', serviceId, name);
  } else {
    const { error } = await admin.from('service_items').update(payload).eq('id', serviceId);
    if (error) throw error;
    console.log('[e2e-seed] Updated service:', serviceId, name);
  }
  return serviceId;
}

/** Link a service to a calendar, optionally at a price only that calendar charges. */
async function linkServiceToCalendar(admin, calendarId, serviceId, customPricePence = null) {
  const { data: link } = await admin
    .from('calendar_service_assignments')
    .select('id')
    .eq('calendar_id', calendarId)
    .eq('service_item_id', serviceId)
    .maybeSingle();

  if (link?.id) {
    const { error } = await admin
      .from('calendar_service_assignments')
      .update({ custom_price_pence: customPricePence })
      .eq('id', link.id);
    if (error) throw error;
    return;
  }
  const { error } = await admin.from('calendar_service_assignments').insert({
    calendar_id: calendarId,
    service_item_id: serviceId,
    custom_price_pence: customPricePence,
  });
  if (error) throw error;
}

/** Replace a service's options so re-running the seed cannot pile up duplicates. */
async function ensureVariants(admin, venueId, serviceId, variants) {
  const { error: delErr } = await admin
    .from('service_variants')
    .delete()
    .eq('venue_id', venueId)
    .eq('service_item_id', serviceId);
  if (delErr) throw delErr;

  const { error } = await admin.from('service_variants').insert(
    variants.map((v, idx) => ({
      venue_id: venueId,
      service_item_id: serviceId,
      appointment_service_id: null,
      name: v.name,
      description: null,
      duration_minutes: v.durationMinutes,
      buffer_minutes: 0,
      price_pence: v.pricePence,
      deposit_pence: null,
      sort_order: idx,
      is_active: true,
      processing_time_blocks: [],
    })),
  );
  if (error) throw error;
  console.log('[e2e-seed] Set options on service:', serviceId, variants.map((v) => v.name).join(', '));
}

/**
 * Give a service one optional extras group. Optional (min_select 0) so it never
 * blocks Continue: the smoke test is about reaching the step, not validation.
 */
async function ensureAddonGroup(admin, venueId, serviceId, { groupName, addonName }) {
  const { data: existingGroup } = await admin
    .from('addon_groups')
    .select('id')
    .eq('venue_id', venueId)
    .eq('name', groupName)
    .maybeSingle();

  let groupId = existingGroup?.id;
  if (!groupId) {
    const { data: group, error } = await admin
      .from('addon_groups')
      .insert({
        venue_id: venueId,
        name: groupName,
        selection_type: 'single',
        min_select: 0,
        max_select: 1,
        hidden_from_online: false,
        is_active: true,
        sort_order: 0,
      })
      .select('id')
      .single();
    if (error) throw error;
    groupId = group.id;
    console.log('[e2e-seed] Created extras group:', groupId, groupName);
  }

  const { data: existingAddon } = await admin
    .from('addons')
    .select('id')
    .eq('addon_group_id', groupId)
    .eq('name', addonName)
    .maybeSingle();
  if (!existingAddon?.id) {
    const { error } = await admin.from('addons').insert({
      addon_group_id: groupId,
      venue_id: venueId,
      name: addonName,
      additional_price_pence: 500,
      additional_duration_minutes: 10,
      is_active: true,
      sort_order: 0,
    });
    if (error) throw error;
  }

  const { data: link } = await admin
    .from('service_addon_groups')
    .select('id')
    .eq('service_item_id', serviceId)
    .eq('addon_group_id', groupId)
    .maybeSingle();
  if (!link?.id) {
    const { error } = await admin.from('service_addon_groups').insert({
      venue_id: venueId,
      service_item_id: serviceId,
      appointment_service_id: null,
      addon_group_id: groupId,
      sort_order: 0,
    });
    if (error) throw error;
  }
  return groupId;
}

/** The original fixture: one calendar, deposit + card-hold + options services. */
async function seedDefaultVenue(admin) {
  const venueId = await ensureVenue(admin, {
    slug: VENUE_SLUG,
    name: VENUE_NAME,
    calendarCount: 1,
    featureFlags: {
      waitlist_v2: true,
      guest_self_reschedule: true,
      any_available_practitioner: true,
    },
  });

  const calendarId = await ensureCalendar(admin, venueId, {
    name: 'E2E Calendar',
    slug: 'e2e-calendar',
    sortOrder: 0,
  });

  // Classic upfront-deposit service.
  const depositServiceId = await ensureService(admin, venueId, SERVICE_NAME, {
    deposit_pence: DEPOSIT_PENCE,
    payment_requirement: 'deposit',
  });
  await linkServiceToCalendar(admin, calendarId, depositServiceId);

  // Card-hold service (spec §17): no payment at booking; the guest's card is
  // stored and staff can charge a no-show fee up to deposit_pence later.
  const cardHoldServiceId = await ensureService(admin, venueId, CARD_HOLD_SERVICE_NAME, {
    deposit_pence: CARD_HOLD_FEE_PENCE,
    payment_requirement: 'card_hold',
  });
  await linkServiceToCalendar(admin, calendarId, cardHoldServiceId);

  // Added for the options-and-extras smoke: the original two services are plain,
  // so nothing covered a booking that passes through those steps.
  const optionsServiceId = await ensureService(admin, venueId, OPTIONS_SERVICE_NAME, {
    deposit_pence: DEPOSIT_PENCE,
    payment_requirement: 'deposit',
  });
  await linkServiceToCalendar(admin, calendarId, optionsServiceId);
  await ensureVariants(admin, venueId, optionsServiceId, [
    { name: 'E2E Short Option', durationMinutes: 30, pricePence: 5000 },
    { name: 'E2E Long Option', durationMinutes: 60, pricePence: 8000 },
  ]);
  await ensureAddonGroup(admin, venueId, optionsServiceId, {
    groupName: 'E2E Extras',
    addonName: 'E2E Hot Towel',
  });

  // NB: this fixture venue is appointments-only (unified_scheduling) and the
  // script does not seed booking_restrictions, so no card-hold table rule is
  // seeded here.
  return venueId;
}

/**
 * The staff-first fixture. Two calendars, and deliberately not interchangeable:
 * Alex charges less for the shared service and Bailey has one nobody else does,
 * so a service list that ignored the chosen person would be obvious.
 */
async function seedStaffFirstVenue(admin) {
  const venueId = await ensureVenue(admin, {
    slug: STAFF_FIRST_VENUE_SLUG,
    name: STAFF_FIRST_VENUE_NAME,
    calendarCount: 2,
    featureFlags: {
      staff_first_booking_flow: true,
      any_available_practitioner: true,
      guest_self_reschedule: true,
    },
  });

  const calendarA = await ensureCalendar(admin, venueId, {
    name: STAFF_FIRST_CALENDAR_A,
    slug: 'e2e-alex',
    sortOrder: 0,
  });
  const calendarB = await ensureCalendar(admin, venueId, {
    name: STAFF_FIRST_CALENDAR_B,
    slug: 'e2e-bailey',
    sortOrder: 1,
  });

  const sharedServiceId = await ensureService(admin, venueId, STAFF_FIRST_SHARED_SERVICE_NAME, {
    deposit_pence: DEPOSIT_PENCE,
    payment_requirement: 'deposit',
  });
  await linkServiceToCalendar(admin, calendarA, sharedServiceId, STAFF_FIRST_CALENDAR_A_PRICE_PENCE);
  await linkServiceToCalendar(admin, calendarB, sharedServiceId);

  const exclusiveServiceId = await ensureService(
    admin,
    venueId,
    STAFF_FIRST_EXCLUSIVE_SERVICE_NAME,
    { deposit_pence: DEPOSIT_PENCE, payment_requirement: 'deposit' },
  );
  await linkServiceToCalendar(admin, calendarB, exclusiveServiceId);

  const optionsServiceId = await ensureService(admin, venueId, STAFF_FIRST_OPTIONS_SERVICE_NAME, {
    deposit_pence: DEPOSIT_PENCE,
    payment_requirement: 'deposit',
  });
  await linkServiceToCalendar(admin, calendarA, optionsServiceId);
  await ensureVariants(admin, venueId, optionsServiceId, [
    { name: 'E2E Short Option', durationMinutes: 30, pricePence: 5000 },
    { name: 'E2E Long Option', durationMinutes: 60, pricePence: 8000 },
  ]);
  await ensureAddonGroup(admin, venueId, optionsServiceId, {
    groupName: 'E2E Staff-First Extras',
    addonName: 'E2E Scalp Massage',
  });

  return venueId;
}

async function main() {
  // Config contradictions first: cheaper to fail on, and true regardless of
  // whether Stripe has been set up yet.
  if (VENUE_SLUG === STAFF_FIRST_VENUE_SLUG) {
    console.error(
      `E2E_VENUE_SLUG must not be "${STAFF_FIRST_VENUE_SLUG}": the two fixtures would merge into one venue.`,
    );
    process.exit(1);
  }
  if (!STRIPE_ACCOUNT) {
    console.error(
      'Missing E2E_STRIPE_CONNECTED_ACCOUNT_ID — create a Stripe test Connect account and set this env var.',
    );
    console.error('See Docs/E2E_SMOKE.md');
    process.exit(1);
  }

  const admin = makeAdmin();
  const defaultVenueId = await seedDefaultVenue(admin);
  const staffFirstVenueId = await seedStaffFirstVenue(admin);

  // Teardown of accumulated smoke bookings. Every paid spec writes real bookings
  // through the UI, and repeated runs eat the calendar from the front: on
  // 2026-08-27 the suite had consumed every remaining slot in the month on the
  // default venue and all four booking specs failed on "no availability". These
  // venues exist solely for the suite, so the seeder is the authority on their
  // state: each seed run starts them empty. The portal customer's deterministic
  // bookings are re-created by scripts/seed-e2e-portal-customer.mjs, which runs
  // AFTER this script (CI runs the two in that order; do the same locally).
  const { error: wipeErr, count: wiped } = await admin
    .from('bookings')
    .delete({ count: 'exact' })
    .in('venue_id', [defaultVenueId, staffFirstVenueId]);
  if (wipeErr) {
    console.error('[e2e-seed] booking wipe failed:', wipeErr.message);
    process.exit(1);
  }
  console.log(`[e2e-seed] Wiped ${wiped ?? 0} accumulated smoke booking(s).`);

  // Print what each venue ended up with: a wrong flag here is the difference
  // between testing two orderings and testing one of them twice.
  const { data: seeded } = await admin
    .from('venues')
    .select('slug, feature_flags')
    .in('id', [defaultVenueId, staffFirstVenueId]);
  console.log('\n[e2e-seed] Final feature flags:');
  for (const v of seeded ?? []) {
    console.log(`  ${v.slug}: ${JSON.stringify(v.feature_flags)}`);
  }

  console.log('\n[e2e-seed] Done. Add to .env.local:\n');
  console.log(`E2E_VENUE_SLUG=${VENUE_SLUG}`);
  console.log(`E2E_VENUE_NAME=${VENUE_NAME}`);
  console.log(`E2E_SERVICE_NAME=${SERVICE_NAME}`);
  console.log(`E2E_CARD_HOLD_SERVICE_NAME=${CARD_HOLD_SERVICE_NAME}`);
  console.log(`E2E_OPTIONS_SERVICE_NAME=${OPTIONS_SERVICE_NAME}`);
  console.log(`E2E_STAFF_FIRST_VENUE_SLUG=${STAFF_FIRST_VENUE_SLUG}`);
  console.log(`E2E_STAFF_FIRST_CALENDAR_A=${STAFF_FIRST_CALENDAR_A}`);
  console.log(`E2E_STAFF_FIRST_CALENDAR_B=${STAFF_FIRST_CALENDAR_B}`);
  console.log(`E2E_STAFF_FIRST_SHARED_SERVICE_NAME=${STAFF_FIRST_SHARED_SERVICE_NAME}`);
  console.log(`E2E_STAFF_FIRST_EXCLUSIVE_SERVICE_NAME=${STAFF_FIRST_EXCLUSIVE_SERVICE_NAME}`);
  console.log(`E2E_STAFF_FIRST_OPTIONS_SERVICE_NAME=${STAFF_FIRST_OPTIONS_SERVICE_NAME}`);

  const base = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';
  console.log(`\nPublic booking URLs:\n  ${base}/book/${VENUE_SLUG}\n  ${base}/book/${STAFF_FIRST_VENUE_SLUG}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
