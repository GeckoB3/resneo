/**
 * Dev: four accounts — paid Stripe test subscriptions, onboarding not started (step 0, incomplete).
 *
 *   light1@reserveni.com   — Appointments Light
 *   plus1@reserveni.com    — Appointments Plus
 *   pro1@reserveni.com     — Appointments Pro (pricing_tier `appointments`)
 *   restaurant1@reserveni.com — Restaurant
 *
 * Password for each: Password123
 *
 * Appointment-family venues use `active_booking_models: []` (same as immediately after checkout,
 * before choosing models on /signup/booking-models).
 *
 * Requires .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, STRIPE_SECRET_KEY
 *   STRIPE_LIGHT_PRICE_ID, STRIPE_SMS_LIGHT_PRICE_ID (Light)
 *   STRIPE_APPOINTMENTS_PLUS_PRICE_ID (Plus)
 *   STRIPE_APPOINTMENTS_PRO_PRICE_ID (Pro)
 *   STRIPE_RESTAURANT_PRICE_ID (Restaurant)
 * Optional: STRIPE_SMS_OVERAGE_PRICE_ID (metered SMS on Plus/Pro/Restaurant)
 *
 * Usage:
 *   node scripts/seed-dev-four-plan-onboarding-staging.mjs
 */

import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env.local') });
config();

const PASSWORD = 'Password123';

/** @type {const} */
const ACCOUNTS = [
  {
    email: 'light1@reserveni.com',
    pricingTier: 'light',
    venueName: 'Light1 (dev staging)',
    slugPrefix: 'light1-dev-staging',
    bookingModel: 'unified_scheduling',
    businessType: 'other',
    businessCategory: 'other',
    terminology: { client: 'Client', booking: 'Booking', staff: 'Staff' },
    calendarCount: 1,
    smsMonthlyAllowance: 0,
    appointmentsUnifiedFlow: true,
  },
  {
    email: 'plus1@reserveni.com',
    pricingTier: 'plus',
    venueName: 'Plus1 (dev staging)',
    slugPrefix: 'plus1-dev-staging',
    bookingModel: 'unified_scheduling',
    businessType: 'other',
    businessCategory: 'other',
    terminology: { client: 'Client', booking: 'Booking', staff: 'Staff' },
    calendarCount: null,
    smsMonthlyAllowance: 300,
    appointmentsUnifiedFlow: true,
  },
  {
    email: 'pro1@reserveni.com',
    pricingTier: 'appointments',
    venueName: 'Pro1 (dev staging)',
    slugPrefix: 'pro1-dev-staging',
    bookingModel: 'unified_scheduling',
    businessType: 'other',
    businessCategory: 'other',
    terminology: { client: 'Client', booking: 'Booking', staff: 'Staff' },
    calendarCount: null,
    smsMonthlyAllowance: 800,
    appointmentsUnifiedFlow: true,
  },
  {
    email: 'restaurant1@reserveni.com',
    pricingTier: 'restaurant',
    venueName: 'Restaurant1 (dev staging)',
    slugPrefix: 'restaurant1-dev-staging',
    bookingModel: 'table_reservation',
    businessType: 'restaurant',
    businessCategory: 'food_drink',
    terminology: { client: 'Guest', booking: 'Booking', staff: 'Staff' },
    calendarCount: null,
    smsMonthlyAllowance: 800,
    appointmentsUnifiedFlow: false,
  },
];

function planStripePriceIds(pricingTier) {
  const t = pricingTier.toLowerCase();
  if (t === 'light') {
    const main = process.env.STRIPE_LIGHT_PRICE_ID?.trim();
    const sms = process.env.STRIPE_SMS_LIGHT_PRICE_ID?.trim();
    if (!main) throw new Error('STRIPE_LIGHT_PRICE_ID is not set');
    return { mainPriceId: main, smsPriceId: sms || '', planMetadata: 'light' };
  }
  if (t === 'plus') {
    const main = process.env.STRIPE_APPOINTMENTS_PLUS_PRICE_ID?.trim();
    if (!main) throw new Error('STRIPE_APPOINTMENTS_PLUS_PRICE_ID is not set');
    return {
      mainPriceId: main,
      smsPriceId: process.env.STRIPE_SMS_OVERAGE_PRICE_ID?.trim() || '',
      planMetadata: 'plus',
    };
  }
  if (t === 'appointments') {
    const main = process.env.STRIPE_APPOINTMENTS_PRO_PRICE_ID?.trim();
    if (!main) throw new Error('STRIPE_APPOINTMENTS_PRO_PRICE_ID is not set');
    return {
      mainPriceId: main,
      smsPriceId: process.env.STRIPE_SMS_OVERAGE_PRICE_ID?.trim() || '',
      planMetadata: 'appointments',
    };
  }
  if (t === 'restaurant') {
    const main = process.env.STRIPE_RESTAURANT_PRICE_ID?.trim();
    if (!main) throw new Error('STRIPE_RESTAURANT_PRICE_ID is not set');
    return {
      mainPriceId: main,
      smsPriceId: process.env.STRIPE_SMS_OVERAGE_PRICE_ID?.trim() || '',
      planMetadata: 'restaurant',
    };
  }
  throw new Error(`Unknown pricing tier: ${pricingTier}`);
}

async function getOrCreateAuthUser(admin, email, password) {
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (!createErr && created?.user?.id) {
    console.log('[seed]', email, 'created auth user:', created.user.id);
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
      const { error: updErr } = await admin.auth.admin.updateUserById(u.id, {
        password,
        email_confirm: true,
      });
      if (updErr) console.warn('[seed] password reset:', updErr.message);
      else console.log('[seed]', email, 'existing user; password reset');
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

async function ensureStripeCustomerAndSubscription(stripe, { email, userId, pricingTier, existingVenue }) {
  const { mainPriceId, smsPriceId, planMetadata } = planStripePriceIds(pricingTier);

  const subIdExisting = existingVenue?.stripe_subscription_id;
  const custIdExisting = existingVenue?.stripe_customer_id;
  if (subIdExisting && custIdExisting && !subIdExisting.startsWith('sub_seed_')) {
    try {
      const sub = await stripe.subscriptions.retrieve(subIdExisting, { expand: ['items.data.price'] });
      if (sub.status === 'active' || sub.status === 'trialing') {
        const ids = subscriptionItemIds(sub, mainPriceId, smsPriceId || null);
        console.log('[seed]', email, 'reuse subscription', subIdExisting, sub.status);
        return {
          customerId: custIdExisting,
          subscriptionId: subIdExisting,
          mainSubscriptionItemId: ids.mainSubscriptionItemId,
          smsSubscriptionItemId: ids.smsSubscriptionItemId,
        };
      }
    } catch (e) {
      console.warn('[seed]', email, 'existing sub not usable:', e?.message ?? e);
    }
  }

  const existing = await stripe.customers.list({ email, limit: 5 });
  let customer =
    existing.data.find((c) => c.metadata?.supabase_user_id === userId) ?? existing.data[0] ?? null;

  if (!customer) {
    customer = await stripe.customers.create({
      email,
      metadata: {
        supabase_user_id: userId,
        plan: planMetadata,
        business_type: pricingTier === 'restaurant' ? 'restaurant' : 'other',
      },
    });
    console.log('[seed]', email, 'Stripe customer', customer.id);
  } else {
    await stripe.customers.update(customer.id, {
      metadata: {
        ...customer.metadata,
        supabase_user_id: userId,
        plan: planMetadata,
      },
    });
  }

  const subItems = [{ price: mainPriceId, quantity: 1 }];
  if (smsPriceId) subItems.push({ price: smsPriceId });

  const subscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: subItems,
    trial_period_days: 365,
    metadata: {
      supabase_user_id: userId,
      plan: planMetadata,
      pricing_tier: pricingTier,
    },
  });

  const subFull = await stripe.subscriptions.retrieve(subscription.id, {
    expand: ['items.data.price'],
  });
  const ids = subscriptionItemIds(subFull, mainPriceId, smsPriceId || null);
  console.log('[seed]', email, 'subscription', subscription.id, subscription.status);

  return {
    customerId: customer.id,
    subscriptionId: subscription.id,
    mainSubscriptionItemId: ids.mainSubscriptionItemId,
    smsSubscriptionItemId: ids.smsSubscriptionItemId,
  };
}

async function seedOne(admin, stripe, account) {
  const email = account.email;
  const userId = await getOrCreateAuthUser(admin, email, PASSWORD);

  const { data: staffRows } = await admin.from('staff').select('id, venue_id').ilike('email', email).limit(5);

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
    email,
    userId,
    pricingTier: account.pricingTier,
    existingVenue,
  });

  const now = new Date();
  const periodStart = new Date(now);
  periodStart.setMonth(periodStart.getMonth() - 1);
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  const isAppointmentFamily =
    account.pricingTier === 'light' ||
    account.pricingTier === 'plus' ||
    account.pricingTier === 'appointments';

  const venueCore = {
    name: account.venueName,
    timezone: 'Europe/London',
    currency: 'GBP',
    booking_model: account.bookingModel,
    business_type: account.businessType,
    business_category: account.businessCategory,
    terminology: account.terminology,
    enabled_models: [],
    active_booking_models: isAppointmentFamily ? [] : [],
    pricing_tier: account.pricingTier,
    plan_status: 'active',
    calendar_count: account.calendarCount,
    onboarding_completed: false,
    onboarding_step: 0,
    sms_monthly_allowance: account.smsMonthlyAllowance,
    stripe_customer_id: stripeIds.customerId,
    stripe_subscription_id: stripeIds.subscriptionId,
    stripe_subscription_item_id: stripeIds.mainSubscriptionItemId,
    stripe_sms_subscription_item_id: stripeIds.smsSubscriptionItemId,
    subscription_current_period_start: periodStart.toISOString(),
    subscription_current_period_end: periodEnd.toISOString(),
    appointments_onboarding_unified_flow: account.appointmentsUnifiedFlow,
    email: email.toLowerCase(),
    table_management_enabled: account.pricingTier === 'restaurant' ? false : undefined,
  };

  Object.keys(venueCore).forEach((k) => venueCore[k] === undefined && delete venueCore[k]);

  let venueId;
  if (staffRows?.length && staffRows[0].venue_id) {
    venueId = staffRows[0].venue_id;
    const { data: existing } = await admin.from('venues').select('slug').eq('id', venueId).single();
    const { slug: _drop, ...updateFields } = venueCore;
    const payload = {
      ...updateFields,
      slug: existing?.slug || `${account.slugPrefix}-${Date.now().toString(36)}`,
    };
    const { error: upErr } = await admin.from('venues').update(payload).eq('id', venueId);
    if (upErr) throw upErr;
    console.log('[seed]', email, 'updated venue', venueId);
  } else {
    const { data: venue, error: vErr } = await admin
      .from('venues')
      .insert({
        ...venueCore,
        slug: `${account.slugPrefix}-${Date.now().toString(36)}`,
      })
      .select('id')
      .single();
    if (vErr) throw vErr;
    venueId = venue.id;
    const { error: sErr } = await admin.from('staff').insert({
      venue_id: venueId,
      email,
      name: email.split('@')[0],
      role: 'admin',
    });
    if (sErr) throw sErr;
    console.log('[seed]', email, 'created venue + staff', venueId);
  }

  return { venueId, stripeIds };
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

  for (const account of ACCOUNTS) {
    console.log('\n---', account.email, account.pricingTier, '---');
    await seedOne(admin, stripe, account);
  }

  console.log('\n[seed] All done. Password for each account:', PASSWORD);
  console.log('[seed] Appointment plans: expect redirect to /signup/booking-models until models are chosen.');
  console.log('[seed] Restaurant: opens /onboarding at step 0.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
