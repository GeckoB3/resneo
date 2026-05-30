/**
 * One-time script to create Stripe Products and Prices for Resneo billing.
 * Run with: npx tsx scripts/create-stripe-products.ts
 *
 * Prerequisites: STRIPE_SECRET_KEY must be set in the environment (or .env.local).
 * This uses Stripe Test Mode - safe to run repeatedly (creates new products each time).
 *
 * After running, copy the printed Price IDs into your .env.local file.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import Stripe from 'stripe';

config({ path: resolve(__dirname, '..', '.env.local') });

const secretKey = process.env.STRIPE_SECRET_KEY;
if (!secretKey) {
  console.error('STRIPE_SECRET_KEY is not set. Add it to .env.local or your environment.');
  process.exit(1);
}

const stripe = new Stripe(secretKey, { typescript: true });

async function main() {
  console.log('Creating Stripe Products and Prices for Resneo...\n');

  const appointmentsProProduct = await stripe.products.create({
    name: 'Resneo Appointments Pro',
    description: 'Appointments Pro — unlimited calendars and users, 500 SMS/month included, £99/month.',
  });

  const appointmentsProPrice = await stripe.prices.create({
    product: appointmentsProProduct.id,
    unit_amount: 9900,
    currency: 'gbp',
    recurring: { interval: 'month' },
  });

  console.log(`Appointments Pro Product: ${appointmentsProProduct.id}`);
  console.log(`Appointments Pro Price:   ${appointmentsProPrice.id}`);

  const appointmentsPlusProduct = await stripe.products.create({
    name: 'Resneo Appointments Plus',
    description: 'Appointments Plus — up to 5 calendars and 5 users, 250 SMS/month included, £49/month.',
  });

  const appointmentsPlusPrice = await stripe.prices.create({
    product: appointmentsPlusProduct.id,
    unit_amount: 4900,
    currency: 'gbp',
    recurring: { interval: 'month' },
  });

  console.log(`Appointments Plus Product: ${appointmentsPlusProduct.id}`);
  console.log(`Appointments Plus Price:   ${appointmentsPlusPrice.id}`);

  const restaurantProduct = await stripe.products.create({
    name: 'Resneo Restaurant',
    description: 'Restaurant plan - unlimited calendars, table management, 500 SMS/month included. £79/month.',
  });

  const restaurantPrice = await stripe.prices.create({
    product: restaurantProduct.id,
    unit_amount: 7900,
    currency: 'gbp',
    recurring: { interval: 'month' },
  });

  console.log(`Restaurant Product:  ${restaurantProduct.id}`);
  console.log(`Restaurant Price:    ${restaurantPrice.id}`);

  const lightProduct = await stripe.products.create({
    name: 'Resneo Appointments Light',
    description: 'Appointments Light — £20/month, one calendar, one login, 100 SMS/month included, 6p overage.',
  });

  const lightPrice = await stripe.prices.create({
    product: lightProduct.id,
    unit_amount: 2000,
    currency: 'gbp',
    recurring: { interval: 'month' },
  });

  console.log(`Appointments Light Product: ${lightProduct.id}`);
  console.log(`Appointments Light Price:   ${lightPrice.id}`);

  const smsProduct = await stripe.products.create({
    name: 'Resneo SMS (metered)',
    description: 'Metered SMS overage for Appointments and Restaurant plans (6p beyond included allowance).',
  });

  const smsOverage6 = await stripe.prices.create({
    product: smsProduct.id,
    currency: 'gbp',
    unit_amount: 6,
    recurring: { interval: 'month', usage_type: 'metered' },
    billing_scheme: 'per_unit',
  });

  console.log(`SMS Product:           ${smsProduct.id}`);
  console.log(`SMS overage 6p Price:  ${smsOverage6.id}`);

  console.log('\n--- Add these to your .env.local ---\n');
  console.log(`STRIPE_APPOINTMENTS_PRO_PRICE_ID=${appointmentsProPrice.id}`);
  console.log(`STRIPE_APPOINTMENTS_PLUS_PRICE_ID=${appointmentsPlusPrice.id}`);
  console.log(`STRIPE_RESTAURANT_PRICE_ID=${restaurantPrice.id}`);
  console.log(`STRIPE_LIGHT_PRICE_ID=${lightPrice.id}`);
  console.log(`STRIPE_SMS_OVERAGE_PRICE_ID=${smsOverage6.id}`);
  console.log('\nAlso register a webhook endpoint at {your-domain}/api/webhooks/stripe-subscription');
  console.log('for events: checkout.session.completed, customer.subscription.updated,');
  console.log('customer.subscription.deleted, invoice.payment_succeeded, invoice.payment_failed');
  console.log('and set STRIPE_ONBOARDING_WEBHOOK_SECRET=whsec_xxx in .env.local\n');
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
