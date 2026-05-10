/**
 * Dev: Supabase auth user + venue on the Restaurant plan: paid (dev placeholder subscription ids)
 * but onboarding not completed, at step 0 (start of the onboarding wizard).
 *
 * Requires .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY
 *
 * Usage:
 *   node scripts/seed-dev-restaurant1-account.mjs
 *
 * Idempotent: updates venue + staff; resets password to the value below when the user already exists.
 */

import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env.local') });
config();

const EMAIL = 'restaurant1@reserveni.com';
const PASSWORD = 'Password123';

const PRICING_TIER = 'restaurant';
const BOOKING_MODEL = 'table_reservation';
/** Empty until onboarding; same as post-checkout before the wizard fills details. */
const ACTIVE_BOOKING_MODELS = [];

/** Dev-only placeholders so Settings shows an active subscription (no real Stripe charges). */
const DEV_SUB_ID = 'sub_seed_dev_restaurant1';
const DEV_SUB_ITEM_ID = 'si_seed_dev_restaurant1';
const DEV_SMS_ITEM_ID = 'si_seed_dev_restaurant1_sms';

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
      const { error: upErr } = await admin.auth.admin.updateUserById(u.id, {
        password,
        email_confirm: true,
      });
      if (upErr) {
        console.warn('[seed] updateUserById (password):', upErr.message);
      } else {
        console.log('[seed] Auth user exists; password reset:', u.id);
      }
      return u.id;
    }
    if (!list?.users?.length || list.users.length < perPage) break;
    page += 1;
  }
  throw new Error(`Could not find existing auth user for ${email}`);
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

  const now = new Date();
  const periodStart = new Date(now);
  periodStart.setMonth(periodStart.getMonth() - 1);
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  const slugBase = 'restaurant1-dev';
  const venueFields = {
    name: 'Restaurant1 Dev',
    slug: `${slugBase}-${Date.now().toString(36)}`,
    timezone: 'Europe/London',
    currency: 'GBP',
    booking_model: BOOKING_MODEL,
    business_type: 'restaurant',
    business_category: 'food_drink',
    terminology: { client: 'Guest', booking: 'Booking', staff: 'Staff' },
    pricing_tier: PRICING_TIER,
    plan_status: 'active',
    onboarding_completed: false,
    onboarding_step: 0,
    enabled_models: [],
    active_booking_models: ACTIVE_BOOKING_MODELS,
    sms_monthly_allowance: 800,
    stripe_subscription_id: DEV_SUB_ID,
    stripe_subscription_item_id: DEV_SUB_ITEM_ID,
    stripe_sms_subscription_item_id: DEV_SMS_ITEM_ID,
    subscription_current_period_start: periodStart.toISOString(),
    subscription_current_period_end: periodEnd.toISOString(),
    table_management_enabled: false,
  };

  let venueId;

  if (staffRows?.length && staffRows[0].venue_id) {
    venueId = staffRows[0].venue_id;
    const { data: existing } = await admin.from('venues').select('slug').eq('id', venueId).single();
    const { slug: _s, ...updateFields } = venueFields;
    const payload = { ...updateFields, slug: (existing?.slug ?? slugBase) || slugBase };
    const { error: upErr } = await admin.from('venues').update(payload).eq('id', venueId);
    if (upErr) throw upErr;
    console.log('[seed] Updated existing venue:', venueId);
  } else {
    const { data: venue, error: vErr } = await admin
      .from('venues')
      .insert(venueFields)
      .select('id')
      .single();
    if (vErr) throw vErr;
    venueId = venue.id;
    console.log('[seed] Created venue:', venueId);

    const { error: sErr } = await admin.from('staff').insert({
      venue_id: venueId,
      email: EMAIL,
      name: 'Restaurant One',
      role: 'admin',
    });
    if (sErr) throw sErr;
    console.log('[seed] Created staff row for', EMAIL);
  }

  console.log('[seed] Done. Log in:', EMAIL, '/ ', PASSWORD);
  console.log(
    '[seed] Venue ID:',
    venueId,
    '| Restaurant plan | paid (dev sub) | onboarding step 0, not completed |',
    DEV_SUB_ID,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
