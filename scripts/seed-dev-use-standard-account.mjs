/**
 * Dev-only: create a Supabase auth user + USE (appointments) venue on the Appointments plan.
 *
 * Requires .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY
 *
 * Usage:
 *   node scripts/seed-dev-use-standard-account.mjs
 *
 * Idempotent: if staff already exists for the email, updates venue tier/calendar_count/SMS
 * and ensures the requested number of active unified_calendars (does not delete extras).
 */

import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env.local') });
config();

const EMAIL = 'andrew5@resneo.com';
const PASSWORD = 'Password123';
const CALENDAR_COUNT = 3;
const PRICING_TIER = 'appointments';

/** Primary booking model: unified scheduling (appointments / calendars). */
const BOOKING_MODEL = 'unified_scheduling';
const BUSINESS_TYPE = 'physiotherapist';
const BUSINESS_CATEGORY = 'health_wellness';
const TERMINOLOGY = { client: 'Patient', booking: 'Appointment', staff: 'Physio' };

const DEFAULT_WORKING_HOURS = {
  1: [{ start: '09:00', end: '17:00' }],
  2: [{ start: '09:00', end: '17:00' }],
  3: [{ start: '09:00', end: '17:00' }],
  4: [{ start: '09:00', end: '17:00' }],
  5: [{ start: '09:00', end: '17:00' }],
};

const SMS_PER_CALENDAR_STANDARD = 200;

async function getOrCreateAuthUser(admin, email, password) {
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (!createErr && created?.user?.id) {
    console.log('[seed] Created auth user:', created.user.id);
    return created.user.id;
  }
  const msg = createErr?.message ?? '';
  const duplicate =
    createErr?.status === 422 ||
    /already registered|already been registered|duplicate/i.test(msg);
  if (!duplicate) {
    console.error('[seed] createUser failed:', createErr);
    throw createErr;
  }
  let page = 1;
  const perPage = 200;
  for (let i = 0; i < 10; i++) {
    const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page, perPage });
    if (listErr) throw listErr;
    const u = list?.users?.find((x) => (x.email ?? '').toLowerCase() === email.toLowerCase());
    if (u?.id) {
      console.log('[seed] Auth user already exists:', u.id);
      return u.id;
    }
    if (!list?.users?.length || list.users.length < perPage) break;
    page += 1;
  }
  throw new Error(`Could not find existing auth user for ${email}`);
}

async function ensureCalendars(admin, venueId, targetActive, workingHours) {
  const { data: rows, error } = await admin
    .from('unified_calendars')
    .select('id, name, slug, sort_order, is_active')
    .eq('venue_id', venueId)
    .order('sort_order', { ascending: true });
  if (error) throw error;

  const active = (rows ?? []).filter((r) => r.is_active);
  const need = Math.max(0, targetActive - active.length);
  for (let i = 0; i < need; i++) {
    const n = active.length + i + 1;
    const slug = `calendar-${n}`;
    const { error: insErr } = await admin.from('unified_calendars').insert({
      venue_id: venueId,
      name: `Calendar ${n}`,
      slug,
      colour: ['#3B82F6', '#10B981', '#8B5CF6'][(n - 1) % 3],
      working_hours: workingHours,
      sort_order: n - 1,
      is_active: true,
    });
    if (insErr) throw insErr;
    console.log('[seed] Added unified_calendar:', slug);
  }

  const { data: after } = await admin
    .from('unified_calendars')
    .select('id')
    .eq('venue_id', venueId)
    .eq('is_active', true);
  return after ?? [];
}

async function ensureSampleService(admin, venueId, calendarIds) {
  const { data: existing } = await admin
    .from('service_items')
    .select('id')
    .eq('venue_id', venueId)
    .eq('is_active', true)
    .limit(1);
  let serviceId = existing?.[0]?.id;
  if (!serviceId) {
    const { data: ins, error } = await admin
      .from('service_items')
      .insert({
        venue_id: venueId,
        name: 'Initial consultation',
        duration_minutes: 30,
        buffer_minutes: 0,
        price_pence: 5000,
        is_active: true,
        is_bookable_online: true,
      })
      .select('id')
      .single();
    if (error) throw error;
    serviceId = ins.id;
    console.log('[seed] Created service_item:', serviceId);
  }
  for (const calId of calendarIds) {
    const { data: link } = await admin
      .from('calendar_service_assignments')
      .select('id')
      .eq('calendar_id', calId)
      .eq('service_item_id', serviceId)
      .maybeSingle();
    if (link) continue;
    const { error: insErr } = await admin
      .from('calendar_service_assignments')
      .insert({ calendar_id: calId, service_item_id: serviceId });
    if (insErr) console.warn('[seed] calendar_service_assignments:', insErr.message);
  }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !serviceKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local');
    process.exit(1);
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  await getOrCreateAuthUser(admin, EMAIL, PASSWORD);

  const { data: staffRows } = await admin.from('staff').select('id, venue_id').ilike('email', EMAIL).limit(1);

  const slug = `andrew5-dev-${Date.now().toString(36)}`;
  const venueFields = {
    name: 'Andrew5 Dev (USE)',
    timezone: 'Europe/London',
    currency: 'GBP',
    booking_model: BOOKING_MODEL,
    business_type: BUSINESS_TYPE,
    business_category: BUSINESS_CATEGORY,
    terminology: TERMINOLOGY,
    pricing_tier: PRICING_TIER,
    plan_status: 'active',
    calendar_count: CALENDAR_COUNT,
    onboarding_completed: true,
    onboarding_step: 0,
    enabled_models: [],
    sms_monthly_allowance: SMS_PER_CALENDAR_STANDARD * CALENDAR_COUNT,
  };

  let venueId;

  if (staffRows?.length && staffRows[0].venue_id) {
    venueId = staffRows[0].venue_id;
    const { error: upErr } = await admin.from('venues').update(venueFields).eq('id', venueId);
    if (upErr) throw upErr;
    console.log('[seed] Updated existing venue:', venueId);
  } else {
    const { data: venue, error: vErr } = await admin
      .from('venues')
      .insert({ ...venueFields, slug })
      .select('id')
      .single();
    if (vErr) throw vErr;
    venueId = venue.id;
    console.log('[seed] Created venue:', venueId);

    const { error: sErr } = await admin.from('staff').insert({
      venue_id: venueId,
      email: EMAIL,
      name: 'Andrew',
      role: 'admin',
    });
    if (sErr) throw sErr;
    console.log('[seed] Created staff row for', EMAIL);
  }

  const calendars = await ensureCalendars(admin, venueId, CALENDAR_COUNT, DEFAULT_WORKING_HOURS);
  await ensureSampleService(
    admin,
    venueId,
    calendars.map((c) => c.id),
  );

  console.log('[seed] Done. Log in with', EMAIL, '/ password you set.');
  console.log('[seed] Venue ID:', venueId, '| Appointments |', CALENDAR_COUNT, 'calendars |', BOOKING_MODEL);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
