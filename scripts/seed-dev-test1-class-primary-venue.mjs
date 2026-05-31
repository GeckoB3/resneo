/**
 * Dev: Supabase auth user + venue with Appointments plan, primary booking model = classes only.
 *
 * Requires .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY
 *
 * Usage:
 *   node scripts/seed-dev-test1-class-primary-venue.mjs
 *
 * Idempotent: reuses auth user + staff row if present; updates venue fields to match spec.
 */

import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env.local') });
config();

const EMAIL = 'test1@resneo.com';
const PASSWORD = 'Password123';

/** Appointments plan (see 20260501130000_pricing_restructure.sql) */
const PRICING_TIER = 'appointments';
const SMS_MONTHLY_ALLOWANCE = 300;

/** Primary = classes; no secondary models */
const BOOKING_MODEL = 'class_session';
const ENABLED_MODELS = [];

const VENUE_NAME = 'Test1 Classes (dev)';
const VENUE_SLUG = 'test1-classes-dev';

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
      const { error: updErr } = await admin.auth.admin.updateUserById(u.id, { password });
      if (updErr) {
        console.warn('[seed] Could not reset password (ignored):', updErr.message);
      } else {
        console.log('[seed] Password updated for existing user.');
      }
      return u.id;
    }
    if (!list?.users?.length || list.users.length < perPage) break;
    page += 1;
  }
  throw new Error(`Could not find existing auth user for ${email}`);
}

async function ensureDefaultCalendarColumn(admin, venueId) {
  const { data: existing } = await admin
    .from('unified_calendars')
    .select('id')
    .eq('venue_id', venueId)
    .eq('is_active', true)
    .limit(1);
  if (existing?.length) {
    console.log('[seed] Venue already has unified_calendars row(s); skipping insert.');
    return;
  }
  // Default team column label (avoid "Main column", which matched old form placeholder text).
  const { error } = await admin.from('unified_calendars').insert({
    venue_id: venueId,
    name: 'Team calendar',
    staff_id: null,
    slug: null,
    working_hours: {},
    break_times: [],
    break_times_by_day: null,
    days_off: [],
    sort_order: 0,
    is_active: true,
    colour: '#3B82F6',
    calendar_type: 'practitioner',
  });
  if (error) {
    console.warn('[seed] Could not create default calendar column:', error.message);
    return;
  }
  console.log('[seed] Created default unified_calendars column for class scheduling.');
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

  const { data: staffRows } = await admin.from('staff').select('id, venue_id').ilike('email', EMAIL).limit(5);

  const venueFields = {
    name: VENUE_NAME,
    timezone: 'Europe/London',
    currency: 'GBP',
    booking_model: BOOKING_MODEL,
    enabled_models: ENABLED_MODELS,
    pricing_tier: PRICING_TIER,
    plan_status: 'active',
    calendar_count: null,
    onboarding_completed: true,
    onboarding_step: 0,
    sms_monthly_allowance: SMS_MONTHLY_ALLOWANCE,
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
      .insert({ ...venueFields, slug: VENUE_SLUG })
      .select('id')
      .single();
    if (vErr) throw vErr;
    venueId = venue.id;
    console.log('[seed] Created venue:', venueId);

    const { error: sErr } = await admin.from('staff').insert({
      venue_id: venueId,
      email: EMAIL,
      name: 'Test1',
      role: 'admin',
    });
    if (sErr) throw sErr;
    console.log('[seed] Created staff row for', EMAIL);
  }

  await ensureDefaultCalendarColumn(admin, venueId);

  console.log('[seed] Done.');
  console.log(`[seed] Login: ${EMAIL} / ${PASSWORD}`);
  console.log(`[seed] Venue: ${VENUE_NAME} | pricing_tier=${PRICING_TIER} | booking_model=${BOOKING_MODEL} | enabled_models=${JSON.stringify(ENABLED_MODELS)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
