import {
  APPOINTMENTS_LIGHT_PRICE,
  APPOINTMENTS_PLUS_PRICE,
  APPOINTMENTS_PRO_PRICE,
  SMS_OVERAGE_GBP_PER_MESSAGE,
} from '@/lib/pricing-constants';
import { SMS_INCLUDED_APPOINTMENTS, SMS_INCLUDED_LIGHT, SMS_INCLUDED_PLUS } from '@/lib/billing/sms-allowance';

import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: 'plan-billing',
  title: 'Managing your plan and billing',
  description: 'The Plan tab: your tier and trial, SMS and calendar usage, changing plan, the Stripe portal, and deleting your venue.',
  tags: ['billing', 'subscription', 'sms', 'plan', 'delete venue'],
  verified: '2026-09-06',
  content: `
# Managing your plan and billing

**Settings → Plan** is about your ResNeo subscription: what you pay us, what your plan includes, and how much of it you have used.

It is not where guests pay you. Card payments from clients are set up under **Settings → Payments**, which connects your Stripe account. Two different things that both mention Stripe.

Only an admin can open this tab.

> **The one big idea:** you change plan here in ResNeo. Card details, invoices, receipts and cancelling all happen in Stripe, through the **Manage Billing** button.

## What the top of the page tells you

- Two pills: your plan name (**Appointments Light**, **Appointments Plus** or **Appointments Pro**) and its state (**Active**, **Payment due** or **Cancelled**).
- A line reminding you that you can cancel at any time, that your subscription runs to the end of the billing period you have paid for, and that you pay nothing at all if you cancel during your free trial.

If your venue has been given **complimentary ResNeo access**, you will see that instead, along with a note that plan limits and SMS caps still apply. There is no billing to manage, so **Manage Billing** does not appear.

## While you are on a free trial

A banner counts down: **"N days of free trial remaining."** with **First charge on** the date it ends.

Underneath, **Trial breakdown** shows where those days came from: your standard signup trial, plus any bonus days from a referral, and who referred you. See [Refer and earn](/help/getting-started/refer-and-earn).

## Current plan and Next billing

Two cards sit side by side.

**Current plan** shows your plan name and what it costs. Once Stripe has a quote ready you also get **Estimated next invoice** with the amount, the published listing price underneath, and a note that promotional pricing is applied in Stripe if it is. Any discount shows as **Coupon applied** with the coupon's name.

**Next billing** shows the date of your next charge, the estimated amount due on that date, and your current billing period underneath. If you have cancelled, the heading changes to **Access until** and it tells you no further charge is scheduled.

Estimates come from Stripe's upcoming invoice preview. The final amount can differ if your usage or tax changes.

## SMS usage

**SMS usage** shows how many text segments you have sent this month against the number your plan includes, with a bar and a percentage.

| Plan | Included SMS per month |
| --- | --- |
| Appointments Light | ${SMS_INCLUDED_LIGHT} |
| Appointments Plus | ${SMS_INCLUDED_PLUS} |
| Appointments Pro | ${SMS_INCLUDED_APPOINTMENTS} |

Past your allowance, extra segments are charged at **£${SMS_OVERAGE_GBP_PER_MESSAGE.toFixed(2)}** each and appear on your next invoice. On complimentary access there is no paid overage: sending simply stops at the cap.

If your usage window follows your Stripe billing period rather than the calendar month, the card says so.

> **Good to know:** a long message counts as more than one segment, so a chatty reminder template uses up your allowance faster. See [SMS messages not sending](/help/troubleshooting/sms-issues).

## Calendar usage

**Calendar usage** counts your active bookable calendars against your plan's cap: **1** on Light, **5** on Plus, and no cap at all on Pro, where it reads **Unlimited**. If the number has not caught up yet, the card says calendar usage syncs after subscription updates.

## Changing plan

The **Change Appointments plan** panel moves you between Light, Plus and Pro without a new checkout. ResNeo updates your existing Stripe subscription and uses the card already on file.

| Plan | Price | Calendars | Team logins |
| --- | --- | --- | --- |
| Appointments Light | £${APPOINTMENTS_LIGHT_PRICE}/month | 1 bookable calendar | 1 team login |
| Appointments Plus | £${APPOINTMENTS_PLUS_PRICE}/month | Up to 5 bookable calendars | Up to 5 team logins |
| Appointments Pro | £${APPOINTMENTS_PRO_PRICE}/month | Unlimited bookable calendars | Unlimited team logins |

1. Look at the card for the plan you want. Under the price, ResNeo shows what the change will cost:
   - Moving up: **Pay the difference for the rest of this billing period**, with the amount due today.
   - Moving down: **Credit for unused time on your current plan**, with the amount you will be credited.
2. Click **Upgrade to** or **Downgrade to** that plan.
3. A confirmation panel opens, headed **Confirm upgrade to** or **Confirm downgrade to** the plan you picked. It repeats the estimate and reminds you that your new limits and SMS allowance apply as soon as you confirm.
4. Click **Confirm upgrade** or **Confirm downgrade**. **Keep current plan** backs out.

> **Good to know:** a downgrade is refused while you are using more than the smaller plan allows. Deactivate the extra calendars, or remove the extra team logins, then try again. The message names which of the two is in the way.

The buttons are greyed out, with **Billing adjustment unavailable until this plan can be selected**, when there is no active Stripe subscription to change, when a payment is overdue, or when you have already cancelled. Sort that out first.

## Manage Billing (the Stripe portal)

**Manage Billing** opens the Stripe Customer Portal in a new tab. That is where you:

- update or replace the card on file
- download invoices and receipts
- change your billing address
- cancel your subscription

When you come back, the Plan tab refreshes itself from Stripe, so a cancellation you made in the portal shows up here within a few seconds without you reloading the page.

## Lifecycle messages you may see

- **Cancelling or cancelled, with time left**: a banner at the top of **Settings** and a panel on the Plan tab both say you keep full access until your paid period ends. **Manage plan** on the banner brings you here.
- **Changed your mind?**: while a cancellation is pending, **Keep my plan** restarts it so nothing changes for your clients. If Stripe has already closed the subscription, this takes you to Stripe to start a new one.
- **Payment required**: your last payment failed. **Update payment method** opens the Stripe portal so invoicing can retry.
- **Your subscription has ended**: venue changes and public online booking are paused. **Resubscribe** takes you to Stripe Checkout.
- **Checkout**: a short-lived banner after you return from Stripe, while the change lands. **Dismiss** hides it.

## Delete your venue

At the bottom of the Plan tab, admins get a **Danger zone** card headed **Delete this venue**.

It permanently removes the venue and everything in it: bookings, contacts, staff, services, uploaded files and any linked-account connections. Once the grace period ends, none of it can be brought back.

1. Read the warning. Deletion is scheduled with a **30-day grace period**.
2. Type your venue's name in the confirmation box, exactly as it is shown.
3. Click **Schedule venue deletion**. The button stays greyed out until the name matches.

What happens next:

- Your subscription is set to cancel at the end of the current billing period.
- We email the admin who made the request, confirming the date and how to stop it.
- Any linked venues are told when the deletion goes through.
- The card now shows a **Deletion scheduled** pill and the date of **Permanent deletion**.

Changed your mind? Click **Cancel scheduled deletion** any time before that date. Your venue carries on as normal and the subscription that was set to cancel is restored.

> **Warning:** this is not the way to pause for a quiet season, and it is not the same as cancelling. Cancelling your subscription keeps your data and stops the billing. Deleting the venue erases the data as well.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| The **Change Appointments plan** buttons are greyed out | No active Stripe subscription, a payment is overdue, or you have already cancelled | Clear the overdue invoice with **Update payment method**, or use **Keep my plan** or **Resubscribe** first |
| My downgrade was refused | You have more calendars or more logins than the smaller plan allows | Deactivate calendars under **Calendar Availability**, or remove logins under **Settings → Staff**, then try again |
| I cancelled in Stripe but ResNeo still says Active | The tab had not refreshed yet | Come back to the Plan tab. It re-checks Stripe when you return to the page |
| My plan did not change after checkout | Stripe's confirmation is still on its way | Wait a few seconds on the Plan tab, then refresh the page |
| Texts have stopped going out | You are at your SMS cap on complimentary access | Ask about a paid plan, or send those messages by email instead |
| I cannot add another calendar | You are at your plan's calendar cap | Check **Calendar usage**, then upgrade here |
| **Venue deletion is unavailable during a support session** | Someone from support is signed in to your venue | End the support session, then try again |
| **Schedule venue deletion** stays greyed out | The name you typed does not match your venue name | Copy the name shown in the sentence above the box |

## Next steps

- [Settings overview](/help/settings/overview)
- [Connect Stripe to take payments](/help/getting-started/stripe-payments)
- [Refer and earn](/help/getting-started/refer-and-earn)
- [SMS messages not sending](/help/troubleshooting/sms-issues)
`.trim(),
  markdownRestaurant: `
# Plan & billing (Restaurant and Founding Partner)

Open **Settings → Plan** for subscription status, SMS summaries, and Stripe portal access. Guest payments are still under **Settings → Payments** (Connect).

## What you will see

- **Tier** shows **Restaurant** or **Founding Partner** with the published **£79** monthly base in standard copy (coupons may alter invoices).
- **Status** covers active, trialing, past due, cancelling, cancelled, same component as other tiers.
- **SMS** mirrors bundled plus metered behaviour: included allowance with optional overage at **£0.06** per segment when not on complimentary access.
- **Calendar usage** reads **Unlimited** because restaurant tiers do not apply the Appointments calendar caps.

## Actions

- **Manage Billing** opens Stripe Customer Portal for cards, invoices, receipts, address, and subscription cancellation according to Stripe’s flows.
- There is **no** in app **Change Appointments plan** rail here; that UI only appears for Appointments SKUs.

## Lifecycle banners

Expect the same checkout banners (\`?upgraded=true\`, etc.) when Stripe returns to the dashboard, plus cancellation notices with **Manage plan** shortcuts.

## Founding Partner note

Founding Partner is the same monthly table product tier with programme positioning; billing mechanics still run through Stripe like Restaurant.

## Reminder

**Plan** is not where you connect Stripe for guest charges. Use **Payments** for Connect onboarding and account health.
`.trim(),
};
