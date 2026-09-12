import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: "setup-checklist",
  helpSection: "gs-start-here",
  title: "Your go-live checklist",
  description: "A friendly walkthrough of the setup card that gets your business ready to take bookings online.",
  tags: ["checklist","onboarding","home","admin","setup","go-live","stripe","getting-started"],
  verified: '2026-09-12',
  content: `# Your go-live checklist

When you sign in as an admin, your **Home** screen shows a setup card listing exactly what is left to do before clients can book you. Work through it and you are ready to go.

> **The one big idea:** the card only lists what is still outstanding. Each row disappears as you finish it, so a shrinking list means you are getting closer, not that something has broken.

## Before you start

- Sign in as an admin. The card is admin only, so team members never see it.
- Finish the setup wizard first. New accounts go through that before the dashboard opens at all. See [welcome to ResNeo](/help/getting-started/welcome).

## Where to find the card

Open **Home** from the top of the sidebar. The card sits just under the page heading, marked **Setup** and titled **What's next** with a count in brackets, for example 3/8. A percent pill and a small **X** sit on the right, with a progress bar underneath. A note under the title explains that the card shows only what still needs attention, and that steps you finished in onboarding are not listed again.

> **Good to know:** the number in brackets counts every step, including ones you have already finished, so it will not match the number of rows on screen. Both are working correctly.

:::help-figure checklist-card

## Working through the steps

Each row has a short title, a line of explanation, and a button that takes you straight to the right screen. There is no enforced order. The rows appear in this order:

1. **Business profile.** Add your business name, address, and phone number so clients know who they are booking. Click **Venue settings**, which opens **Settings → Profile**. The row clears once all three are filled in. Your logo and cover photo live on the **Booking Page** tab, which you can do next. See [set up your business profile](/help/getting-started/business-profile).

2. **Services & calendars.** Add a calendar for each person or chair that takes bookings. Click **Appointment services**. This row clears as soon as you have one calendar.

3. **Create services.** Clients cannot book until at least one active service is offered on an active calendar. Click **Add services**, create a service with a length and a price, then tick the calendar or calendars that offer it. See [set up your services](/help/getting-started/services).

4. **Events**, **Classes**, or **Resources.** These rows only appear when you have switched those booking models on under **Settings → Booking Settings**. Each asks you to add a starter item, with a button called **Event manager**, **Class timetable**, or **Resource timeline**. The row clears once you have one event, one class type, or one resource. These rows have no **Not now** button: if you do not sell them after all, switch the model off and the row goes with it.

5. **Stripe payments.** Connect this only if you want to take deposits or card payments online. **Connect Stripe** opens the **Payments** tab. Stripe asks for your identity details and the bank account it should pay into. The row clears only once you have submitted everything Stripe asked for and it has enabled charges on your account, so do not stop halfway. See [connect Stripe to take payments](/help/getting-started/stripe-payments).

6. **First test booking.** Make one booking yourself to check the flow and the confirmation email. Click **Create booking**, pick a quiet slot, and use your own email address. Cancel it afterwards so it does not sit in your diary. The row clears on the first booking of any kind in your venue.

Three more suggestions sit in the same list from day one, after the steps above:

7. **Customise your booking page.** Add your logo, a photo, and a line of welcome text. Click **Booking page**.
8. **Review communications settings.** Check the emails and texts clients get when they book. Click **Communications**.
9. **Import your bookings and customers.** Bring your existing client list and diary across. Click **Import data**, which opens **Settings → Profile**; scroll down to **Data import** and click **Open Data Import**. See [importing your data](/help/getting-started/importing-data).

> **Good to know:** those last three tick off as soon as you click through to them, and ResNeo remembers that in this browser only. Sign out, sign in on another device, or clear your browsing data, and they can reappear even though you have already done them. Nothing is wrong: click through again, or hide the card.

> **Tip:** if you want to be taking bookings today, do them in this order: calendars, services, business profile, test booking. Stripe can wait until tomorrow unless you want deposits from day one.

:::help-figure checklist-flow

## Skipping a step with Not now

**Stripe payments** and **First test booking** are the two steps a business can reasonably never do, so each has a small **Not now** button beside its main button.

1. Click **Not now** on the row.
2. The row disappears straight away and counts as done in the progress count.

This is saved against your login, so it holds on every device you sign in on and after you sign out. There is no button to bring a snoozed row back, but nothing is lost: **Settings → Payments** and **New Booking** (or **New Appointment**) in the sidebar are always there. The other rows have no **Not now**, because clients cannot book until they are done.

## Making the card go away

You have two options.

1. Click the small **X** at the top right of the card. A dialog titled **Dismiss the setup steps?** opens and reminds you that anything you have not set up yet is still available from the dashboard menu. Choose **Dismiss setup steps** to hide the card, or **Keep showing** to change your mind.
2. Or finish the steps. Once every required row is done and the two optional ones are each done or snoozed, the card hides itself for good, at the latest the next time **Home** loads. The three suggestions do not hold it up.

Hiding it applies to you, on every device you sign in on. A colleague who is also an admin still sees their own card. Nothing is lost either way, because every screen the card links to is still in the sidebar.

> **Tip:** dismissing the card only hides the reminder, it does not finish setup. Hide it before Stripe is connected and clients still cannot pay online until you finish that step.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| Business profile will not clear | Name, address, or phone is still blank | Click **Venue settings**, fill in all three on the **Business profile** card, then return to **Home** |
| Services & calendars will not clear | You have no calendar yet | Click **Appointment services**, then use **Add calendar** for each person or chair |
| Create services will not clear | Your service is not ticked against any calendar, or the service or calendar is switched off | Open the service, tick at least one calendar under **Calendars that offer this service**, and make sure **Active (visible to clients)** is ticked. Check the calendar itself is active too |
| Events, Classes, or Resources will not clear | The booking model is switched on but has nothing in it yet | Add one item from the row's button, or switch the model off under **Settings → Booking Settings** |
| Stripe payments stays open | Stripe setup was started but not finished | Click **Connect Stripe** and work through every step until the card shows **Stripe connected; charges enabled** |
| First test booking is already ticked | A real client has already booked | The row clears on any booking in your venue, so there is nothing left to do |
| I clicked **Not now** by mistake | Snoozed rows do not come back | Nothing is lost: open **Settings → Payments**, or **New Booking** in the sidebar, and do the step there |
| A step I just finished still shows | The card checks progress when **Home** loads | Refresh **Home** |
| The card vanished but I am not done | It was hidden with the **X**, or every required step is done | Open the screen you need from the sidebar and finish the step there |
| The last three steps came back | They are remembered per browser and cleared when you sign out | Click through again, or hide the card |
| I do not see the card | You are signed in as staff, not an admin | The card is admin only. Ask an admin to finish setup |

## Next steps

- [A tour of your dashboard](/help/getting-started/dashboard-overview)
- [Set up your business profile](/help/getting-started/business-profile)
- [Connect Stripe to take payments](/help/getting-started/stripe-payments)
- [Your public booking page and embed](/help/getting-started/public-booking-page)`,
};
