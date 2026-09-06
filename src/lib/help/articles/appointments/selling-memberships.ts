import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: 'selling-memberships',
  helpSection: 'operations',
  title: 'Selling memberships',
  description: 'Set up recurring class plans, unlimited or a set number per period, with rollover, a member discount and repeat bookings.',
  tags: ['classes', 'memberships', 'commerce', 'subscriptions'],
  verified: '2026-09-06',
  content: `# Selling memberships

A **membership** is a repeating subscription that gives someone ongoing access to your classes: unlimited, or a set number every billing period. It bills on your own Stripe account, not through ResNeo, so the money comes straight to you.

> Memberships are per venue. Someone who trains with two of your venues holds two memberships, each with its own allowance.

## Before you start

1. Turn classes on and have at least one class type saved. See [set up your classes](/help/getting-started/classes).
2. Switch on **Class packs, courses & memberships**: **Settings**, then the **Booking Settings** tab, then **Optional Booking features**. It starts off. Until it is on there is no **Class products** button, the page sends you back to the timetable, and nothing there will save.
3. Connect Stripe. A membership cannot be sold without it. See [connect Stripe to take payments](/help/getting-started/stripe-payments).

## Step 1: Decide what the plan gives

There are three shapes, and you can mix them.

- **Unlimited.** Every covered class is free for the member.
- **An allowance.** A set number of classes each billing period. Anything beyond that is paid for as usual.
- **A discount.** A percentage off covered classes, rather than free ones. Good for a plan you want cheaper but not free.

## Step 2: Create the membership

1. Open **Classes** from the sidebar, click **Class products**, then the **Memberships** tab.
2. Fill in the form under **Create a membership**:
   - **Membership name**, what members see. Required.
   - **Description**, your marketing line.
   - Under **Recurring billing**: **Price (£ / period)**, **Interval** (Weekly, Monthly or Yearly), and **Every**, which multiplies the interval. Leave **Every** at 1 for a normal monthly plan, or set it to 3 with a monthly interval to bill quarterly.
   - **Manual Stripe Price ID (optional)**, only if you already manage this plan in Stripe yourself. It must exist on your connected account, and it overrides the recurring billing box above.
   - **Classes per period**, the allowance. Leave it blank for an unlimited or discount-only plan.
   - **Rollover limit**, the most that can carry into the next period. Leave it blank and the whole leftover carries.
   - **Member discount %**, the percentage off classes this plan covers.
   - **Booking window days** and **Priority hours**. These two are saved but do not change anything yet, so leave them blank.
   - **Eligible classes**. Leave it empty and the plan covers every class. Hold Ctrl (or Cmd on a Mac) to pick more than one.
3. Tick what applies:
   - **Unlimited class access**, which overrides **Classes per period**.
   - **Unused allowance rolls over**, which carries leftovers forward at each period boundary.
   - **Allow recurring reservations**, which lets members set up repeat bookings (see below).
   - **Visible and available to buy**, ticked by default.
4. Click **Create membership**.

ResNeo creates the Stripe product and price on your account for you. If you leave both the recurring price and the manual price ID blank on an active plan, saving is refused with "Active memberships need either a Stripe price ID or recurring price + billing interval so customers can subscribe."

Each plan in the list shows its shape and a summary line such as "rollover up to 4 · 10% member discount · Stripe billing (auto)". A plan showing "needs billing setup" cannot be bought yet.

## Step 3: Check it on your booking page

Open your public booking page and choose the **Classes** tab. Plans appear under **Passes, courses & memberships** in alphabetical order, up to two at a time, with a **Start membership** button. Someone who is not signed in sees **Sign in to subscribe**.

## How a client subscribes

1. They tap **Start membership** on your booking page and sign in if they need to.
2. They land on **Passes and plans** in their account, on the **Memberships** tab, with your venue and the plan already chosen. Coming in another way, they pick **Venue** and **Plan** under **Start a membership** and click **Continue**.
3. **Confirm your card** opens a card form on the page. There is no separate Stripe checkout page to bounce through.
4. Once the card is saved, the subscription starts and a **Membership started** email goes out. **Membership renewed** follows at each renewal.

Under **Your memberships** they see the plan, your venue, its standing (Active, Free trial, Payment failed, Paused, Setting up or Ended) and either "Unlimited classes." or a line such as "3 / 8 classes used this period. Resets 1 October 2026."

## How a membership pays for a class

When a member books a class that costs money, ResNeo works through the price in a fixed order.

1. **Member discount** comes off the price first. If more than one of their plans covers that class type, the biggest discount wins. A discount of 100% makes the class free.
2. A **course** they are enrolled in covers the session.
3. The **membership** covers it, either unlimited or from this period's allowance.
4. **Class credits**, if they ticked the box and have enough.
5. Whatever is left goes on their card.

An unlimited plan is always preferred. If the member holds two allowance plans that both cover the class, the one with the most left is used. A plan only covers a class when its **Eligible classes** includes that type and the remaining allowance covers everyone in the booking, otherwise the class falls through to credits or card.

If a covered booking is cancelled, the allowance goes back the same way class credits do.

## Periods, allowances and rollover

An overnight job records each member's carry-over as their billing period turns over. With **Unused allowance rolls over** off, they simply start the new period on the full allowance. With it on, whatever they did not use is added on top, capped by **Rollover limit** if you set one.

A separate hourly check keeps every membership in step with Stripe, so a cancelled or failed subscription stops covering classes even if a payment notification goes astray.

## Repeat bookings

Tick **Allow recurring reservations** and members can set up a standing booking. They open **Passes and plans**, then the **Recurring** tab, and under **Set up a repeat booking** choose **Venue**, **Class type**, **Scheduled slot**, **Repeat every** (1 week, 2 weeks, 3 weeks or 4 weeks), plus an optional **End date** and **Max bookings**.

An overnight job then books each session for them ahead of time. If one cannot be booked, for example because the class is full, their entry says so and it tries again on the next run. Without a plan that allows it, they are told "Recurring auto-bookings require an active membership at this venue with recurring booking enabled."

## Cancelling

Members cancel themselves under **Your memberships** with **Cancel at renewal**. ResNeo shows them exactly what happens and when before it goes through. The cancellation is scheduled, not immediate: they keep their access and their allowance until the end of the period they have paid for.

They get a **Membership cancellation scheduled** email straight away, and a **Membership ended** email when the period runs out. Until then they can change their mind with **Keep my membership**.

You cannot cancel a member's plan for them from the dashboard. Ask them to do it from their account, or refund and cancel the subscription in Stripe.

> These membership emails send on their own. They are not among the cards under **Settings**, then the **Communications** tab, so there is nothing to switch on and nothing to reword.

## Changing the price

Reopen a plan with **Edit** and the **Price (£ / period)** box is always empty. That is deliberate.

- Leave it empty and the existing price is kept, whatever else you change.
- Type a new price and ResNeo creates a fresh Stripe price and archives the old one. Only new subscribers pay the new amount. Everyone already on the plan carries on at the price they signed up at.

To move existing members onto a new price, put up a new plan and ask them to switch.

## Archiving and deleting

- **Archive** takes the plan off sale and archives its Stripe product and price too, so nothing new can be bought. Members already on it keep their subscription and keep being billed until they cancel. **Reactivate** puts it back.
- **Delete** is refused while anyone holds a live or half-finished subscription, with a message telling you to archive instead.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| There is no **Class products** button | **Class packs, courses & memberships** is off | Turn it on under **Settings**, then **Booking Settings**, then **Optional Booking features** |
| Saving says active memberships need a price | Both the recurring price and the manual price ID are empty | Add a **Price (£ / period)** and an **Interval**, or paste a **Manual Stripe Price ID** |
| Saving says to connect Stripe first | Your Stripe account is not connected | Open **Settings**, then **Payments**, and finish both Stripe steps |
| The plan says "needs billing setup" | It has no Stripe price attached | Edit it and add a price and interval |
| A member is still charged for a class | The class type is not in the plan's **Eligible classes**, or this period's allowance has run out | Check **Eligible classes**, and their "N / M classes used this period" line |
| A brand new member was charged for their first class | Their billing period had not come back from Stripe yet, so the allowance could not be counted | It sorts itself out within the hour. Refund the class from the booking if they were charged |
| A member's classes are discounted but not free | The plan has a **Member discount %** rather than an allowance or unlimited | Tick **Unlimited class access**, or set **Classes per period** |
| Unused classes did not carry over | **Unused allowance rolls over** is off, or **Rollover limit** capped it | Tick the box, or raise the limit |
| A member cannot set up repeat bookings | Their plan does not have **Allow recurring reservations** ticked | Edit the plan and tick it |
| I changed the price and members are still paying the old one | A new price only applies to new subscribers | Create a new plan and ask members to switch |
| A cancelled member still has access | Cancellation takes effect at the end of the period they paid for | Wait for the period to end, or refund in Stripe |
| I cannot delete a plan | Someone still holds a subscription | Click **Archive** instead |

## Next steps

- [Selling class packs (credits)](/help/appointments/selling-class-packs)
- [Building a class course](/help/appointments/building-a-class-course)
- [Set up your classes](/help/getting-started/classes)
- [Connect Stripe to take payments](/help/getting-started/stripe-payments)`,
};
