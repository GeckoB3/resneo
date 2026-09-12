import { SMS_INCLUDED_APPOINTMENTS, SMS_INCLUDED_LIGHT, SMS_INCLUDED_PLUS } from '@/lib/billing/sms-allowance';
import { APPOINTMENTS_LIGHT_PRICE, APPOINTMENTS_PLUS_PRICE, APPOINTMENTS_PRO_PRICE, SMS_OVERAGE_GBP_PER_MESSAGE } from '@/lib/pricing-constants';
import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: 'overview',
  helpSection: 'plans',
  title: 'Appointments Light, Plus, and Pro',
  description: 'How unified scheduling fits together, what each tier includes, how the sidebar labels change, and where to manage your subscription.',
  tags: ['plans', 'tiers', 'sms', 'navigation', 'limits'],
  verified: '2026-09-12',
  content: `
# Welcome to your Appointments plan

You run **unified scheduling**: one place to manage **bookable calendars** (often one column per person or room), your **service catalogue**, **availability**, and (when you turn them on) **classes**, **ticketed events**, and **bookable resources**. The articles below walk you through each area in plain language.

**What this covers:** how the three tiers differ, how the left menu adapts to your venue, where to turn booking models on or off, and where to change your plan.

:::help-figure tier-compare

## Compare the three tiers

| | **Light** | **Plus** | **Pro** |
| --- | --- | --- | --- |
| **Monthly price (guide)** | £${APPOINTMENTS_LIGHT_PRICE}/month | £${APPOINTMENTS_PLUS_PRICE}/month | £${APPOINTMENTS_PRO_PRICE}/month |
| **Bookable calendars** | 1 | Up to 5 | Unlimited |
| **Team logins** | 1 | Up to 5 | Unlimited |
| **SMS bundle** | **${SMS_INCLUDED_LIGHT}** segments included per month | **${SMS_INCLUDED_PLUS}** segments included per month | **${SMS_INCLUDED_APPOINTMENTS}** segments included per month |
| **After your SMS bundle** | Overage billed at **${Math.round(SMS_OVERAGE_GBP_PER_MESSAGE * 100)}p** per segment | Same overage rate | Same overage rate |

Your plan is named **Appointments Light**, **Appointments Plus**, or **Appointments Pro** wherever ResNeo shows it to you.

**Settings → Plan** shows the live figures: **SMS usage** as segments used out of your monthly allowance, and **Calendar usage** as calendars used out of your cap (or "Unlimited"). If **Add calendar** or the invite button disappears, you have reached that cap. Deactivate something you no longer need, or upgrade.

> **On Appointments Light, add a card before you rely on SMS.** Light bills SMS as you go, so ResNeo needs a card on file under **Settings → Plan**. Until you add one, text messages are quietly skipped and only the email version goes out. **Settings → Communications** shows a reminder about this until you are set up.

## What “unified scheduling” means day to day

- **Calendar Availability** is where admins build **calendars** and everyone sets hours. It has four tabs: **Calendars**, **Availability**, **Breaks**, and **Closures & amended hours**.
- **Services** holds your appointment catalogue: durations, buffers, deposits, and either **One fixed offering** or **Multiple bookable options** such as "45 min" and "60 min" at different prices.
- **Appointment Calendar** is the live grid for moving and opening bookings. It sits directly under the list link in the sidebar when your venue is calendar-eligible.
- **Appointments** (or **Bookings**) is the high-volume list: filters, search, expandable rows, and bulk messaging. To download a spreadsheet, go to **Settings → Reports** and use **Data export** instead.

If you also enable **classes**, **events**, or **resources**, guests see matching tabs on your public page and you get matching items in the sidebar just **below Contacts**.

## Sidebar labels that change with your setup

:::help-figure sidebar-appointments

- When appointments are the only thing you sell, the list link reads **Appointments** and the action reads **New Appointment**. As soon as you turn on another booking type, those two labels become **Bookings** and **New Booking** so the menu stays accurate. Nothing else in the menu is renamed.
- **Services**, **Classes**, **Events**, and **Resources** only appear once you have turned that booking type on, and they slot in just after **Contacts**. **Compliance** appears there too when you switch compliance records on.
- Venue-wide **Settings** is **admin only**. Staff see the same link relabelled **Account**, and it opens their own profile and password rather than the venue. **Reports** is a tab inside **Settings**, so staff do not see it either.

## Turning booking types on or off

Admins: open **Settings → Booking Settings** and find the **Booking models** card. Tick only what you sell: **Appointments & services**, **Ticketed events**, **Classes & sessions**, or **Resources & facilities**. There is no save button. The card confirms "Changes will save automatically in a moment", then "All booking type changes are saved". Each ticked model gets a **Set up →** link straight to the screen where you build it.

Come back any time you launch a new line of business. For what each model does, and for the other switches on this tab, see [optional booking features](/help/getting-started/optional-booking-features).

:::help-figure booking-models

## A sensible setup order

1. Turn on only the booking models you are ready to sell, under **Settings → Booking Settings**.
2. Create or check the **calendars** those models will use, under **Calendar Availability**, and set each one's hours.
3. Add the matching catalogue items: services, class types, events, or resources.
4. Connect Stripe under **Settings → Payments** if you want deposits or online payment.
5. Test your public booking page as a guest before you share the link. Your dashboard home has a setup checklist that tracks these steps for you.

## Changing your plan

Everything to do with money lives on **Settings → Plan**: your **Current plan**, your **Estimated next invoice**, your next billing date, and the usage cards above.

- **Change Appointments plan** shows the Light, Plus, and Pro cards side by side, with an **Upgrade to** or **Downgrade to** button and a confirmation step. An upgrade tells you what you will "Pay the difference" for the rest of this billing period, a downgrade gives you a "Credit for unused time" on your current plan.
- **Manage Billing** opens the Stripe customer portal for invoices and cancellation, and **Update payment method** changes the card on file.

## Where to go next

- New venue checklist: [Getting started](/help/getting-started/setup-checklist)
- Every switch on the Booking Settings tab: [Optional booking features](/help/getting-started/optional-booking-features)
- Stripe, sessions, and venue profile: [Settings](/help/settings/overview)
- Plan changes and billing in detail: [Plan & billing](/help/settings/plan-billing)
- When something looks wrong: [Troubleshooting](/help/troubleshooting/access-issues)
`.trim(),
};
