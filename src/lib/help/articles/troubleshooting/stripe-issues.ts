import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: 'stripe-issues',
  title: 'Stripe and payment problems',
  description: 'Client payment errors, unfinished Stripe setup, and the difference between Stripe Connect and your ResNeo subscription.',
  tags: ['stripe', 'payments', 'errors'],
  verified: '2026-09-06',
  content: `
# Stripe and payment problems

Payment trouble is almost always one of two things, and they live on different tabs. Only an admin can see either.

- **Settings → Payments** is **Stripe Connect**: how your clients pay you. Their money goes to your own Stripe account.
- **Settings → Plan** is your **ResNeo subscription**: what you pay us.

Fixing one never fixes the other.

## Clients get a payment error and no booking appears

Stripe is not finished, but a service is set to take money. Open **Settings**, then **Payments**, and read the **Stripe payments** card:

1. Amber **Step 1 incomplete**: click **Continue Stripe setup** and work through to the end with Stripe.
2. Blue **Step 2: Identity verification required**: click **Complete identity verification**. If that page will not open, Stripe's verification system is not ready yet, so wait a moment and click it again.
3. Both steps ticked but clients still cannot pay: Stripe is reviewing your account. Refresh later, and watch for an email from Stripe asking for another document.

You are ready only when the card reads **Stripe connected; charges enabled**.

Until then, a booking that needs a deposit, full payment or a card hold fails at the last step and is cancelled, so nothing reaches your diary. Your client sees **Venue has not set up payments** if Stripe was never started, or **Payment setup failed** once an account exists but charges are still switched off. To keep taking bookings meanwhile, open **Services**, click **Edit**, and choose **No online payment** under **Online payment when booking**.

## The card shows a red message

**Failed to check Stripe status** means ResNeo could not reach Stripe for a moment. Click **Retry**.

## Stripe is finished but nobody is charged

Connecting Stripe does not ask anyone for money by itself. Set **Online payment when booking** on each service that should take a deposit or a payment.

## A payment link will not open

**Send payment link**, under **Payments and confirmation** on a booking, only appears while a deposit is genuinely outstanding. If your client reports **Invalid or expired link**, the link has been used or the booking has moved on. Send a fresh one.

## I cannot save anything in the dashboard

That is billing, not Connect. A past due subscription answers every save with **Billing is past due. Add or update your payment method under Settings → Plan to continue editing.**, on every plan. Fix it with **Update payment method** or **Manage Billing** on **Settings → Plan**.

## Still stuck

Open **Support** from the sidebar with the client's name, roughly when they tried, whether the failure was on **Payments**, **Plan** or their own card, and the account reference beginning \`acct_\` under the **Stripe payments** card.

## Next steps

- [Connect Stripe to take payments](/help/getting-started/stripe-payments)
- [Deposits, full payment and card holds](/help/appointments/deposits)
- [Plan and billing](/help/settings/plan-billing)
- [SMS not sending](/help/troubleshooting/sms-issues)
`.trim(),
  markdownRestaurant: `
# Stripe and payment problems (Restaurant and Founding Partner)

## Connect for guest charges

**Restaurant** and **Founding Partner** venues use the same **Settings → Payments** Connect onboarding as other plans. Complete Stripe tasks until the in app state reads **active**.

## Table service and deposits

Deposits and card captures still run on your **connected** account. If **Reports** deposit totals look wrong, first confirm bookings reached the expected payment state, then review Stripe payout and charge logs for the same window.

## Availability engine vs Connect

A **503** style response from \`/api/booking/availability\` with text about **no active dining service** means dining configuration, not card rails. Fix **Dining Availability** (\`/dashboard/availability\`) services before debugging Stripe again.

## Subscription vs Connect

**Settings → Plan** covers your **ResNeo** subscription. **Past due** blocks **dashboard mutations** for all tiers. **Public** booking is paused when the subscription has **fully ended** (and for **Appointments Light** combined with **past due**, which is not your tier, but listed here so you understand mixed documentation if you ever downgrade test venues).

## Wrong account or reconnect

Reconnecting Connect on a busy production venue needs care. Use **Support** (\`/dashboard/support\`) before disconnecting accounts with live guest history.
`.trim(),
};
