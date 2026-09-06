import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: 'selling-class-packs',
  helpSection: 'operations',
  title: 'Selling class packs (credits)',
  description: 'Sell prepaid class credits, set an expiry, limit a pack to certain class types, and see how clients buy and spend them.',
  tags: ['classes', 'class-packs', 'credits', 'commerce', 'memberships'],
  verified: '2026-09-06',
  content: `# Selling class packs (credits)

A **class pack** sells a set number of credits up front. One credit books one spot in one class, so a client who buys a 10 class pass can book ten classes without reaching for their card again.

> Credits belong to one venue. A pack bought from you can only be spent on your classes, and your client sees each venue's balance separately in their ResNeo account.

## Before you start

1. Turn classes on. Open **Settings**, then the **Booking Settings** tab, then the **Booking models** card, and tick **Classes & sessions**. See [set up your classes](/help/getting-started/classes).
2. Connect Stripe. Clients pay you directly through your own Stripe account, so nothing can be sold until that is done. See [connect Stripe to take payments](/help/getting-started/stripe-payments).
3. Save at least one class type, so you can choose which classes a pack covers.
4. Sign in to a staff account on an Appointments plan.

## Step 1: Turn class packs on

1. Open **Settings**, then the **Booking Settings** tab.
2. Scroll to **Optional Booking features**.
3. Switch on **Class packs, courses & memberships**. It starts switched off.
4. Open **Classes** from the sidebar. A **Class products** button now sits at the top of the **Class timetable** page.

One switch covers packs, courses and memberships together. While it is off there is no **Class products** button, going to the address directly sends you back to the timetable, and the screens behind it will not save.

> Switching it back off hides **Class products** and stops your team editing anything there, but it does not take packs off your booking page. If you want to stop selling, archive each pack first (see below).

## Step 2: Create a credit pack

1. Click **Class products**. The page opens on the **Credit packs** tab, next to **Courses** and **Memberships**.
2. On the left, under **Create a credit pack**, you can start from a template. **Intro 5 pack** fills in 5 credits at £45 valid for 30 days, and **10 class pass** fills in 10 credits at £90 valid for 90 days. Both just fill the form, so change anything you like before saving.
3. Fill in the pack:
   - **Pack name**, which is what clients see. Required.
   - **Description**, an optional line such as "Great for regular weekly classes."
   - **Credits**, how many spots the pack buys. Required, between 1 and 1000.
   - **Price (GBP)**, the total for the pack. Required. Do not leave it at £0: a free pack cannot be bought online.
   - **Valid for days**, how long the credits last from the day they are bought. Leave it blank and they never expire.
   - **Eligible classes**, a list of your class types. Leave it empty and the pack works on every class. Hold Ctrl (or Cmd on a Mac) to pick more than one.
   - **Visible and available to buy**, ticked by default. Untick it to save a pack without putting it on sale.
4. Click **Create credit pack**.

The pack appears in the list on the right with an **Active** or **Archived** pill, its credits and price, and a summary line such as "90 day expiry · All classes".

## Step 3: Check it on your booking page

Open your public booking page and choose the **Classes** tab. Under **Passes, courses & memberships** you will see the heading "Come often? Save with a pack or plan." and your packs listed cheapest first, up to three at a time, each with a **Buy pack** button. Someone who is not signed in sees **Sign in to buy** instead.

## How a client buys a pack

1. They tap **Buy pack** on your booking page.
2. If they are signed out they sign in or create a ResNeo account first.
3. They land on **Passes and plans** in their account, on the **Credits** tab, with your venue and the pack already chosen, and the card form opens for them.
4. They pay by card, and the credits show up under **Balances** with the pack name, your venue and either an expiry date or "No expiry".
5. A **Class credits purchased** email confirms the credits and the expiry date.

They can also buy without going through your booking page: **Passes and plans**, then **Credits**, then **Buy a pack**, choose **Venue** and **Pack**, then **Pay**. Every purchase, use, refund and expiry is listed under **Recent activity** as Bought, Used, Refunded, Expired or Adjusted by the venue.

## How credits are spent

Booking a paid class online, your client ticks **Use class credits or a pack** at the payment step. If they are picking several dates in one go, the box reads **Use class credits for all paid sessions** and anything credits do not cover is charged to their card.

ResNeo spends the credits that expire soonest first, leaves credits with no expiry until last, and breaks any tie by using the oldest purchase. It only spends credits from packs that cover that class type, and only when the balance covers everyone in the booking. If it does not, the class is paid for by card as normal.

Credits sit fourth in the order ResNeo works through:

1. The class costs nothing online, so nothing is settled.
2. A **course** the client is enrolled in covers the session.
3. A **membership** covers the session, either unlimited or from this period's allowance.
4. **Credits**, when the client ticked the box and has enough.
5. Card payment.

Because courses and memberships are settled first, a member never burns a credit on a class their plan already covers.

> The credits box only appears to clients booking themselves. When your team books someone in from the dashboard, credits are not used.

## When credits come back

- A client cancelling online gets the credit back as long as they cancel inside your cancellation notice. Past that, the credit stays spent.
- When your team cancels a class booking, the credit always goes back, and a **Class credits restored** email goes to the client.
- A **No show** does not give the credit back.

Credits always return to the pack they came from, so the original expiry date still applies.

## Expiry and reminders

An overnight job clears any balance whose expiry date has passed and records it as Expired in the client's activity list. In the last seven days before that date, anyone with credits left gets one **Class credits expiring soon** email nudging them to book. It is sent once per purchase, not once a day.

These emails send on their own. They are not among the cards under **Settings**, then the **Communications** tab, so there is nothing to switch on and nothing to reword.

## Editing, archiving and deleting

Each pack in the list has three buttons.

- **Edit** opens the same fields in place. Change what you need and click **Save changes**. Changing the price, the credits or **Valid for days** only affects future sales, because a client's balance and expiry date are fixed on the day they buy. Changing **Eligible classes** does apply to credits people already hold, so narrowing the list can stop an existing balance working on a class it used to cover.
- **Archive** takes the pack off sale and swaps the pill to **Archived**. Credits already bought still work exactly as before. Click **Reactivate** to put it back on sale.
- **Delete** removes it for good. ResNeo asks "Delete product" and warns you to archive instead if guests have used it. If anyone has ever bought this pack, the delete is refused with a message telling you to archive it.

Archive is almost always the right choice. Delete is for a pack you created by mistake and nobody has bought.

## What the numbers at the top mean

- **Active credit packs**, **Active courses** and **Active memberships** count what is on sale right now, with the total underneath.
- **Outstanding class credits** is every credit your clients still hold and could spend.
- **Class checkout (30 days)** is what clients have paid in the last 30 days when they booked several class sessions in one go. Pack, course and membership payments are not counted here.

Use **Search products** to filter a long list by name, and **Refresh** to pull the latest figures.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| There is no **Class products** button | **Class packs, courses & memberships** is off | Turn it on under **Settings**, then **Booking Settings**, then **Optional Booking features**, then reload the **Class timetable** page |
| Opening **Class products** bounces me back to the timetable | The same setting is off, classes are not switched on, or you are not on an Appointments plan | Check **Booking models** and **Optional Booking features** on the **Booking Settings** tab |
| A client sees "Venue has not connected Stripe payments" | Your Stripe account is not connected or not finished | Open **Settings**, then **Payments**, and finish both Stripe steps |
| A client cannot buy a pack priced at £0 | Free packs are not sold online | Give the pack a real price |
| The pack is not on my booking page | It is archived, or three cheaper packs are already showing | Click **Reactivate**, or archive a pack you no longer sell |
| A client says credits were not used | They did not tick the box, the pack does not cover that class type, or the balance did not cover everyone in the booking | Check the pack's **Eligible classes** and their balance under **Balances** |
| A member used a credit instead of their plan | Their plan does not cover that class type, or its allowance had run out | Add the class type to the plan's **Eligible classes**, or raise **Classes per period** |
| A credit did not come back after a cancellation | The client cancelled after your cancellation notice, or the booking was marked as a no-show | Cancel it from the dashboard instead, which always restores the credit |
| I cannot delete a pack | Someone still holds credits from it | Click **Archive** instead |

## Next steps

- [Building a class course](/help/appointments/building-a-class-course)
- [Selling memberships](/help/appointments/selling-memberships)
- [Set up your classes](/help/getting-started/classes)
- [Connect Stripe to take payments](/help/getting-started/stripe-payments)`,
};
