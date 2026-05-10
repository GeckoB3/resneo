/**
 * Dev: Supabase auth user on Appointments plan + active Stripe test subscription.
 *
 * Requires .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY,
 *   STRIPE_SECRET_KEY, STRIPE_APPOINTMENTS_PRO_PRICE_ID
 * Optional: STRIPE_SMS_OVERAGE_PRICE_ID (metered line, matches Checkout)
 *
 * Usage:
 *   node scripts/seed-dev-appointments1-stripe.mjs
 */

import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env.local') });
config();

const EMAIL = 'appointments1@reserveni.com';
const PASSWORD = 'Password123';
const VENUE_NAME = 'Appointments1 (dev)';
const VENUE_SLUG = 'appointments1-dev';

const PRICING_TIER = 'appointments';
const BUSINESS_TYPE = 'other';
const BOOKING_MODEL = 'unified_scheduling';
const BUSINESS_CATEGORY = 'other';
const TERMINOLOGY = { client: 'Client', booking: 'Booking', staff: 'Staff' };
const ACTIVE_BOOKING_MODELS = ['unified_scheduling'];
const SMS_MONTHLY_ALLOWANCE = 300;

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
    createErr?.status === 422 || /already registered|already been registered|duplicate/i.test(msg);
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
      if (updErr) console.warn('[seed] Could not reset password:', updErr.message);
      else console.log('[seed] Password updated.');
      return u.id;
    }
    if (!list?.users?.length || list.users.length < perPage) break;
    page += 1;
  }
  throw new Error(`Could not find existing auth user for ${email}`);
}

function subscriptionItemIds(sub, mainPriceId, smsPriceId) {
  const items = sub.items?.data ?? [];
  let mainSubscriptionItemId = null;
  let smsSubscriptionItemId = null;
  for (const item of items) {
    const pid = typeof item.price === 'string' ? item.price : item.price?.id;
    if (mainPriceId && pid === mainPriceId) mainSubscriptionItemId = item.id;
    if (smsPriceId && pid === smsPriceId) smsSubscriptionItemId = item.id;
  }
  if (!mainSubscriptionItemId && items.length) {
    const nonMetered = items.find((it) => {
      const p = it.price;
      if (typeof p === 'object' && p?.recurring?.usage_type === 'metered') return false;
      return true;
    });
    mainSubscriptionItemId = (nonMetered ?? items[0]).id;
  }
  return { mainSubscriptionItemId, smsSubscriptionItemId };
}

async function ensureStripeCustomerAndSubscription(stripe, { email, userId, existingVenue }) {
  const mainPriceId = process.env.STRIPE_APPOINTMENTS_PRO_PRICE_ID?.trim();
  if (!mainPriceId) throw new Error('STRIPE_APPOINTMENTS_PRO_PRICE_ID is not set');

  const smsPriceId = process.env.STRIPE_SMS_OVERAGE_PRICE_ID?.trim() || '';

  const subIdExisting = existingVenue?.stripe_subscription_id;
  const custIdExisting = existingVenue?.stripe_customer_id;
  if (subIdExisting && custIdExisting) {
    try {
      const sub = await stripe.subscriptions.retrieve(subIdExisting, { expand: ['items.data.price'] });
      if (sub.status === 'active' || sub.status === 'trialing') {
        const { mainSubscriptionItemId, smsSubscriptionItemId } = subscriptionItemIds(
          sub,
          mainPriceId,
          smsPriceId || null,
        );
        console.log('[seed] Reusing existing subscription', subIdExisting, sub.status);
        return {
          customerId: custIdExisting,
          subscriptionId: subIdExisting,
          mainSubscriptionItemId,
          smsSubscriptionItemId,
        };
      }
    } catch (e) {
      console.warn('[seed] Existing subscription not usable, creating a new one:', e?.message ?? e);
    }
  }

  const existing = await stripe.customers.list({ email, limit: 3 });
  let customer =
    existing.data.find((c) => c.metadata?.supabase_user_id === userId) ?? existing.data[0] ?? null;

  if (!customer) {
    customer = await stripe.customers.create({
      email,
      metadata: {
        supabase_user_id: userId,
        plan: 'appointments',
        business_type: BUSINESS_TYPE,
      },
    });
    console.log('[seed] Created Stripe customer', customer.id);
  } else {
    await stripe.customers.update(customer.id, {
      metadata: {
        ...customer.metadata,
        supabase_user_id: userId,
        plan: 'appointments',
        business_type: BUSINESS_TYPE,
      },
    });
    console.log('[seed] Using Stripe customer', customer.id);
  }

  const subItems = [{ price: mainPriceId, quantity: 1 }];
  if (smsPriceId) subItems.push({ price: smsPriceId });

  /** Test-mode accounts often block raw card numbers; a long trial yields an active `trialing` subscription without a PM. */
  const subscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: subItems,
    trial_period_days: 365,
    metadata: {
      supabase_user_id: userId,
      plan: 'appointments',
    },
  });

  const subFull = await stripe.subscriptions.retrieve(subscription.id, {
    expand: ['items.data.price'],
  });

  const { mainSubscriptionItemId, smsSubscriptionItemId } = subscriptionItemIds(
    subFull,
    mainPriceId,
    smsPriceId || null,
  );

  console.log('[seed] Stripe subscription', subscription.id, subscription.status);

  return {
    customerId: customer.id,
    subscriptionId: subscription.id,
    mainSubscriptionItemId,
    smsSubscriptionItemId,
  };
}

async function ensureDefaultCalendar(admin, venueId) {
  const { data: existing } = await admin
    .from('unified_calendars')
    .select('id')
    .eq('venue_id', venueId)
    .eq('is_active', true)
    .limit(1);
  if (existing?.length) return;
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
  if (error) console.warn('[seed] unified_calendars insert:', error.message);
  else console.log('[seed] Created default unified_calendar');
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SECRET_KEY;
  const stripeSecret = process.env.STRIPE_SECRET_KEY?.trim();

  if (!url || !serviceKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY');
    process.exit(1);
  }
  if (!stripeSecret) {
    console.error('Missing STRIPE_SECRET_KEY');
    process.exit(1);
  }

  const stripe = new Stripe(stripeSecret);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const userId = await getOrCreateAuthUser(admin, EMAIL, PASSWORD);

  const { data: staffRows } = await admin.from('staff').select('id, venue_id').ilike('email', EMAIL).limit(5);

  let existingVenue = null;
  if (staffRows?.length && staffRows[0].venue_id) {
    const { data: vrow } = await admin
      .from('venues')
      .select('stripe_customer_id, stripe_subscription_id')
      .eq('id', staffRows[0].venue_id)
      .maybeSingle();
    existingVenue = vrow;
  }

  const stripeIds = await ensureStripeCustomerAndSubscription(stripe, {
    email: EMAIL,
    userId,
    existingVenue,
  });

  const venueCore = {
    name: VENUE_NAME,
    timezone: 'Europe/London',
    currency: 'GBP',
    booking_model: BOOKING_MODEL,
    business_type: BUSINESS_TYPE,
    business_category: BUSINESS_CATEGORY,
    terminology: TERMINOLOGY,
    enabled_models: [],
    active_booking_models: ACTIVE_BOOKING_MODELS,
    pricing_tier: PRICING_TIER,
    plan_status: 'active',
    calendar_count: null,
    onboarding_completed: true,
    onboarding_step: 0,
    sms_monthly_allowance: SMS_MONTHLY_ALLOWANCE,
    stripe_customer_id: stripeIds.customerId,
    stripe_subscription_id: stripeIds.subscriptionId,
    stripe_subscription_item_id: stripeIds.mainSubscriptionItemId,
    stripe_sms_subscription_item_id: stripeIds.smsSubscriptionItemId,
    email: EMAIL.toLowerCase(),
  };

  let venueId;
  if (staffRows?.length && staffRows[0].venue_id) {
    venueId = staffRows[0].venue_id;
    const { error: upErr } = await admin.from('venues').update(venueCore).eq('id', venueId);
    if (upErr) throw upErr;
    console.log('[seed] Updated venue', venueId);
  } else {
    const { data: venue, error: vErr } = await admin
      .from('venues')
      .insert({ ...venueCore, slug: `${VENUE_SLUG}-${Date.now()}` })
      .select('id')
      .single();
    if (vErr) throw vErr;
    venueId = venue.id;
    console.log('[seed] Created venue', venueId);

    const { error: sErr } = await admin.from('staff').insert({
      venue_id: venueId,
      email: EMAIL,
      name: 'Appointments1',
      role: 'admin',
    });
    if (sErr) throw sErr;
    console.log('[seed] Created staff for', EMAIL);
  }

  await ensureDefaultCalendar(admin, venueId);

  console.log('[seed] Done.');
  console.log(`[seed] Login: ${EMAIL} / ${PASSWORD}`);
  console.log(`[seed] Stripe customer ${stripeIds.customerId} subscription ${stripeIds.subscriptionId}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
