import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: "events",
  helpSection: "gs-catalogue",
  title: "Set up ticketed events",
  description: "Create one-off or repeating ticketed events, set prices and seat limits, show them on your calendar, and check guests in on the day.",
  tags: ["events","tickets","capacity","attendees","check-in","stripe","calendar","scheduling"],
  verified: '2026-09-06',
  content: `# Set up ticketed events

Ticketed events are one-off or repeating occasions clients buy a place at, such as a barbering masterclass. You set the date, the capacity, and one or more ticket types.

## Before you start

1. Turn ticketed events on. Open **Settings**, then the **Booking Settings** tab, and find the **Booking models** card. Tick **Ticketed events**. Until you do, there is no **Events** row in your sidebar.
2. Connect Stripe if you want to sell tickets online. See [connect Stripe to take payments](/help/getting-started/stripe-payments).
3. Admins can always create events. A team member can only create one when their account is linked to a calendar, and they must put the event on a calendar column they manage.

> Turning events on renames two sidebar rows. **Appointments** becomes **Bookings**, and **New Appointment** becomes **New Booking**.

## Step 1: Create the event

1. Open **Events** from the sidebar. The page is called **Event manager**.
2. Click **+ Create event**.
3. Give it an **Event name**.
4. Set the **Capacity**, which is the ceiling for the whole event however many ticket types you add.
5. Set the **Start time** and the **End time**.

:::help-figure events-editor

## Step 2: Choose how often it runs

The **Schedule** choice at the top of a new event is **One date**, **Weekly (same weekday)** or **Custom dates**. It only appears while you are creating, not when you edit later.

- **One date** just asks for a **Date**.
- **Weekly (same weekday)** asks for a **First occurrence** and a **Repeat until** date, and tells you how many events will be created, every 7 days.
- **Custom dates** gives you a **Dates** picker: choose a day, click **Add date**, and repeat. Each date becomes its own event with the same ticket setup. You can create at most 104 dates in one go.

> There is no limit on how many events you can create, on any plan. A weekly repeat that runs all year is fine.

## Step 3: Set your booking rules

Under **Guest booking rules**, set **Max advance (days)** (starts at 90), **Min notice (hours)** (starts at 1), **Cancellation notice (hours)** (starts at 48), and whether **Allow same-day bookings** is ticked. Cancellation notice is the one that decides whether a client gets their money back.

## Step 4: Choose a calendar column

Under **Calendar column**, pick a **Calendar** so the event shows on your dashboard calendar and blocks that time. The column also decides which team members can edit or delete it later: staff linked to that column can, and if you leave it on **Not assigned to a calendar**, only admins can. If you are an admin and need a new column, click **Add calendar**, name it, and it is selected for you straight away.

> Once your plan's calendars are used up, **Add calendar** is replaced by a message about your plan.

## Step 5: Add a description and a photo

Add a **Description**, then an **Image URL** if you want a picture on your public page. This must be a web address for a picture that is already online, for example on your own website or social page. There is no upload button here, and a **Preview** appears once the address works.

## Step 6: Add ticket types

1. The event starts with a **General Admission** tier.
2. Set the **Ticket name**, the **Price**, and an optional **Cap** for that tier. Leave the cap blank for no limit of its own.
3. Click **+ Add ticket type** for more, for example adult and child pricing. **Remove** appears once there is more than one, because you have to keep at least one.
4. Choose one **Online payment (Stripe)** option:
   - **None - pay at venue or free event**
   - **Deposit per person (partial payment online)**, with a **Deposit amount**
   - **Full payment online (per ticket)**
   - **Card hold**, which takes no money when the client books but saves their card, with a **No-show fee per person** of at least £1 that you can charge later if they do not turn up
5. Click **Save event**.

> Deposit and full payment need every ticket priced above zero and a connected Stripe account. If a tier is still free, the save is blocked and the message names it.

> Selling tickets needs Stripe finished, not just started. The form only warns you when no Stripe account is connected at all. If your setup was started but charges are not enabled yet, that warning disappears, and guests trying to buy lose the booking and see a payment error instead.

## Step 7: Run the event on the day

Click the event in **Upcoming** to open its detail panel.

- **Sales & capacity** shows **Tickets sold**, **Revenue**, **Seats taken**, **Fill** as a percentage, and the breakdown **By ticket type**.
- **Attendees** lists everyone who has booked. Click a booking to view the full details.
- Mark people **Arrived** as they turn up, or **Clear** to undo it.
- **Export CSV** appears once at least one person has booked, and downloads the attendee list.
- **Duplicate** reopens the **Create event** form with everything copied, the name marked as a copy and the date left blank for you to fill in.
- Past dates move into the **Past** list on their own. Use **Search events** at the top to find one quickly.

:::help-figure events-attendees

> **Cancel event & notify guests** is admin only and cannot be undone. It cancels every active booking and notifies those guests, and the event then shows a **Cancelled / inactive** pill for good. Use **Duplicate** to put it on a new date instead. **Delete** is separate: it asks **Permanently delete this event?** and throws the event row and its ticket types away.

## What your clients see

On your public booking page the **Events** tab shows **Choose an event** for anything running in the next three months. They pick the event, pick a date from a calendar with your dates highlighted in green, pick a time if you run more than one that day, then set the number of **Tickets** per tier with the plus and minus buttons. Each tier shows its price and how many are left. An **Order summary** follows, then their details and payment.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| There is no **Events** row in my sidebar | The ticketed events model is off | Open **Settings**, then **Booking Settings**, and tick **Ticketed events** |
| Clients cannot find the event | Events are off, or the event was cancelled | Check the model is on. If it shows **Cancelled / inactive**, that cannot be undone: use **Duplicate** to copy it to a new date |
| I cannot save a paid event | A ticket type is still priced at zero | Give every ticket type a price, or set **Online payment (Stripe)** to **None - pay at venue or free event** |
| Saving says the time conflicts | The calendar column already has an appointment, class, resource booking or blocked time then | Move the event, or put it on a different **Calendar** |
| Clients get a payment error and no booking | Stripe is started but charges are not enabled | Finish Stripe in **Settings**, then **Payments** |
| **+ Create event** is missing | Your account is not linked to a calendar | Ask an admin to link your account, or to create the event |
| I cannot pick a calendar and I am not an admin | Team members must assign an event to a column they manage | Ask an admin to link you to the right calendar |
| **Export CSV** is not there | Nobody has booked yet | It appears once you have your first attendee |

## Next steps

- [Using the calendar](/help/getting-started/calendar)
- [Connect Stripe to take payments](/help/getting-started/stripe-payments)
- [Set up your services](/help/getting-started/services)`,
};
